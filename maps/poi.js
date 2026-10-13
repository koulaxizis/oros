// ============================================================
// orOS Maps — poi.js (edit places on OpenStreetMap, Every Door style;
// OSM upgrade wave 2, v1.0.0)
// "Places" mode: at zoom ≥ 17 the shops, cafés, offices… of the area
// (Overpass) appear as dots and in a list. Tap one to see it, mark it
// "Checked today", "Closed / gone", edit its details with the preset
// form (id-tagging-schema, EN/EL) or its raw tags, move it (points),
// delete it (points with no ways or relations). "Add place" puts a new
// point at the map centre.
//
// Every change is first a pending edit in the synced slice
// "mapsedits" (poi-core.js). "Upload" sends this device's edits in one
// changeset with the upload comment (default "Uploaded using orOS
// Maps", editable in the upload dialog), created_by=orOS Maps <ver>,
// source=survey. Before uploading, each element is fetched again and
// the change is rebased on its current tags: keys the user didn't
// touch follow the server, a key both sides changed keeps the server
// value and is reported. Nothing is uploaded automatically.
//
// Safety: OSM tags go on the page with textContent only; a website is
// a link only when it is http(s).
// ============================================================
(function () {
  "use strict";
  var O = window.OrosMapsOSM;
  var P = window.OrosMapsPoi;
  var A = window.OrosMapsApi;
  var H = window.__orosMapsHost;
  var ED = window.OrosMapsEveryDoor;    // maps wave 9 (optional)
  if (!O || !P || !A || !H || !H.map) return;
  var map = H.map;
  var LANG = H.lang === "el" ? "el" : "en";
  var OVERPASS = "https://overpass-api.de/api/interpreter";

  var STR = {
    en: {
      "btn": "Edit places (OpenStreetMap)",
      "title": "Places on OpenStreetMap",
      "zoomin": "Zoom in closer to see and edit the places of this street.",
      "loading": "Loading places…",
      "loadfail": "Couldn't load places. The OpenStreetMap data server may be busy; try again in a minute.",
      "none": "No shops or services mapped here yet. Use Add place to put one on the map.",
      "add": "Add place",
      "add.hint": "Move the map so the cross is on the spot, then pick what it is.",
      "micro": "Small things (one tap)",
      "miss": "Missing: {k}", "miss.name": "name", "miss.opening_hours": "opening hours",
      "ent.btn": "Entrances and flats",
      "upload": "Upload ({n})",
      "pending": "Changes waiting: {n}",
      "edit": "Edit details",
      "checked": "Checked today",
      "checked.done": "Marked as checked today",
      "closed": "Closed / gone",
      "closed.ask": "Mark “{n}” as closed? Its name, hours and contact details are removed; the address stays.",
      "discard": "Undo my change",
      "move": "Move",
      "move.hint": "Drag the map until the cross sits on the right spot.",
      "move.here": "Move here",
      "move.far": "That is {d} m away. Move it anyway?",
      "del": "Delete",
      "del.ask": "Delete “{n}” from OpenStreetMap? Only do this if it never existed or was mapped twice. If it closed, use Closed / gone.",
      "onosm": "Open on openstreetmap.org",
      "kind": "Type", "change": "Change",
      "pick": "What is it?", "search.ph": "Search: café, pharmacy, φούρνος…",
      "alltags": "All tags (key=value, one per line)",
      "save": "Save", "cancel": "Cancel", "back": "Back", "close": "Close",
      "yes": "Yes", "no": "No", "unset": "—",
      "oh.add": "Add hours", "oh.raw": "As text",
      "oh.days": ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
      "oh.closed": "closed",
      "saved": "Saved. Upload when you are ready.",
      "nochange": "Nothing changed",
      "up.title": "Upload to OpenStreetMap",
      "up.comment": "Comment",
      "up.count": "{n} changes from this device will be published under your OpenStreetMap name.",
      "up.go": "Upload",
      "up.ok": "Uploaded {n} changes to OpenStreetMap",
      "up.conflict": "Someone else changed these meanwhile, their value was kept: {k}",
      "up.fail": "Upload failed: {e}",
      "up.used": "It is part of a street, building or relation, so it can't be deleted here",
      "up.gone": "It no longer exists on OpenStreetMap",
      "up.signin": "Sign in with OpenStreetMap to upload",
      "up.offline": "You are offline. Your changes are kept.",
      "wait.other": "From another device",
      "wait.here": "Upload from here",
      "wait.del": "Discard",
      "op.create": "New", "op.modify": "Edited", "op.delete": "Deleted",
      "unnamed": "(no name)",
      "leave": "{n} changes are waiting to be uploaded",
      "f.addr": "Address", "f.street": "Street", "f.no": "Number", "f.pc": "Postcode", "f.city": "City",
      "dist.m": "{n} m"
    },
    el: {
      "btn": "Επεξεργασία μερών (OpenStreetMap)",
      "title": "Μέρη στο OpenStreetMap",
      "zoomin": "Κάνε zoom πιο κοντά για να δεις και να διορθώσεις τα μέρη του δρόμου.",
      "loading": "Φόρτωση μερών…",
      "loadfail": "Τα μέρη δεν φόρτωσαν. Ο διακομιστής δεδομένων του OpenStreetMap μπορεί να είναι φορτωμένος· δοκίμασε σε ένα λεπτό.",
      "none": "Δεν έχουν χαρτογραφηθεί μαγαζιά ή υπηρεσίες εδώ. Πάτα Προσθήκη μέρους για να βάλεις ένα.",
      "add": "Προσθήκη μέρους",
      "add.hint": "Μετακίνησε τον χάρτη ώστε ο σταυρός να είναι στο σημείο και διάλεξε τι είναι.",
      "micro": "Μικρά πράγματα (ένα πάτημα)",
      "miss": "Λείπει: {k}", "miss.name": "όνομα", "miss.opening_hours": "ωράριο",
      "ent.btn": "Είσοδοι και διαμερίσματα",
      "upload": "Αποστολή ({n})",
      "pending": "Αλλαγές σε αναμονή: {n}",
      "edit": "Επεξεργασία",
      "checked": "Ελέγχθηκε σήμερα",
      "checked.done": "Σημειώθηκε ότι ελέγχθηκε σήμερα",
      "closed": "Έκλεισε / δεν υπάρχει",
      "closed.ask": "Να σημειωθεί ότι έκλεισε το «{n}»; Φεύγουν όνομα, ωράριο και στοιχεία επικοινωνίας· η διεύθυνση μένει.",
      "discard": "Αναίρεση της αλλαγής μου",
      "move": "Μετακίνηση",
      "move.hint": "Σύρε τον χάρτη ώσπου ο σταυρός να πέσει στο σωστό σημείο.",
      "move.here": "Μετακίνηση εδώ",
      "move.far": "Αυτό απέχει {d} μ. Να μετακινηθεί;",
      "del": "Διαγραφή",
      "del.ask": "Να διαγραφεί το «{n}» από το OpenStreetMap; Μόνο αν δεν υπήρξε ποτέ ή είναι διπλό. Αν έκλεισε, πάτα Έκλεισε / δεν υπάρχει.",
      "onosm": "Άνοιγμα στο openstreetmap.org",
      "kind": "Είδος", "change": "Αλλαγή",
      "pick": "Τι είναι;", "search.ph": "Αναζήτηση: καφέ, φαρμακείο, bakery…",
      "alltags": "Όλα τα tags (κλειδί=τιμή, ένα ανά γραμμή)",
      "save": "Αποθήκευση", "cancel": "Άκυρο", "back": "Πίσω", "close": "Κλείσιμο",
      "yes": "Ναι", "no": "Όχι", "unset": "—",
      "oh.add": "Προσθήκη ωραρίου", "oh.raw": "Ως κείμενο",
      "oh.days": ["Δε", "Τρ", "Τε", "Πε", "Πα", "Σα", "Κυ"],
      "oh.closed": "κλειστό",
      "saved": "Αποθηκεύτηκε. Στείλ' το όταν είσαι έτοιμος.",
      "nochange": "Δεν άλλαξε τίποτα",
      "up.title": "Αποστολή στο OpenStreetMap",
      "up.comment": "Σχόλιο",
      "up.count": "{n} αλλαγές από αυτή τη συσκευή θα δημοσιευτούν με το όνομά σου στο OpenStreetMap.",
      "up.go": "Αποστολή",
      "up.ok": "Στάλθηκαν {n} αλλαγές στο OpenStreetMap",
      "up.conflict": "Κάποιος άλλος τα άλλαξε στο μεταξύ και κρατήθηκε η δική του τιμή: {k}",
      "up.fail": "Η αποστολή απέτυχε: {e}",
      "up.used": "Είναι μέρος δρόμου, κτιρίου ή σχέσης και δεν διαγράφεται από εδώ",
      "up.gone": "Δεν υπάρχει πια στο OpenStreetMap",
      "up.signin": "Συνδέσου με OpenStreetMap για αποστολή",
      "up.offline": "Δεν έχεις σύνδεση. Οι αλλαγές σου κρατιούνται.",
      "wait.other": "Από άλλη συσκευή",
      "wait.here": "Αποστολή από εδώ",
      "wait.del": "Απόρριψη",
      "op.create": "Νέο", "op.modify": "Αλλαγή", "op.delete": "Διαγραφή",
      "unnamed": "(χωρίς όνομα)",
      "leave": "{n} αλλαγές περιμένουν αποστολή",
      "f.addr": "Διεύθυνση", "f.street": "Οδός", "f.no": "Αριθμός", "f.pc": "Τ.Κ.", "f.city": "Πόλη",
      "dist.m": "{n} μ."
    }
  };
  function t(k, vars) {
    var s = STR[LANG][k] !== undefined ? STR[LANG][k] : STR.en[k];
    if (s === undefined) s = k;
    if (vars && typeof s === "string") Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
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
  function online() { return navigator.onLine !== false; }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  // ---------- presets (lazy) ----------
  var idx = null, presetsP = null;
  function loadPresets() {
    if (idx) return Promise.resolve(idx);
    if (presetsP) return presetsP;
    presetsP = new Promise(function (resolve, reject) {
      if (window.OrosMapsPresets) { idx = P.presetIndex(window.OrosMapsPresets); resolve(idx); return; }
      var s = document.createElement("script");
      s.src = "presets-data.js" + (H.ver ? "?v=" + encodeURIComponent(H.ver) : "");
      s.onload = function () { idx = P.presetIndex(window.OrosMapsPresets || {}); resolve(idx); };
      s.onerror = function () { presetsP = null; reject(); };
      document.head.appendChild(s);
    });
    return presetsP;
  }

  // ---------- synced slice "mapsedits" ----------
  var DATA_KEY = "oros-maps-edits-data";
  var data = P.normalizeEdits(null);
  var suppress = false;
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function loadData() {
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e) {}
    if (!raw) return;
    try { data = P.normalizeEdits(JSON.parse(raw)); }
    catch (e) { try { localStorage.setItem("oros-maps-edits-rescue", raw); } catch (e2) {} }
  }
  function saveData() {
    data = P.normalizeEdits(data);
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); }
    catch (e) { toast(H.storeFull || "Storage is full"); return false; }
    if (!suppress) { var api = syncApi(); if (api && api.markDirty) api.markDirty(); }
    return true;
  }
  function sliceGet() { return P.normalizeEdits(data); }
  function sliceSet(d) {
    if (!d || typeof d !== "object") return;
    data = P.normalizeEdits(JSON.parse(JSON.stringify(d)));
    suppress = true;
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) {}
    suppress = false;
    paint();
    if (panelOpen()) render();
  }
  function editList() {
    return Object.keys(data.edits).map(function (k) { return data.edits[k]; })
      .sort(function (a, b) { return a.m - b.m || (a.id < b.id ? -1 : 1); });
  }
  function newId() { return O.randomString(14).toLowerCase().replace(/[^a-z0-9]/g, "0"); }
  function editFor(key) {
    var list = editList(), srv = A.server();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.srv !== srv) continue;
      if (e.op === "create" ? "c" + e.id === key : e.t + e.oid === key) return e;
    }
    return null;
  }
  function dropEdit(id) {
    var e = data.edits[id];
    if (!e) return;
    delete data.edits[id];
    data.tombs[id] = Math.max(Date.now(), e.m + 1);
    saveData();
  }
  function stamp(e) { e.m = Math.max(Date.now(), (e.m || 0) + 1); }

  // ---------- places (Overpass cache, device memory) ----------
  var places = {};               // key "n123" → { t, id, lat, lon, tags } as on the server
  var box = null, boxAt = 0, busy = false, failed = false;
  var MIN_ZOOM = 17, FRESH_MS = 30 * 60 * 1000;

  function keyOf(p) { return p.t + p.id; }

  // What the user sees: server state + this device's / synced pending edits.
  function view() {
    var out = {};
    Object.keys(places).forEach(function (k) {
      var p = places[k];
      out[k] = { key: k, t: p.t, id: p.id, lat: p.lat, lon: p.lon, tags: p.tags, base: p.tags, edit: null };
    });
    editList().forEach(function (e) {
      if (e.srv !== A.server()) return;
      if (e.op === "create") {
        var k = "c" + e.id;
        out[k] = { key: k, t: "n", id: 0, lat: e.lat, lon: e.lon, tags: P.applySet({}, e.set), base: {}, edit: e };
        return;
      }
      var v = out[e.t + e.oid];
      if (!v) return;
      v.edit = e;
      if (e.op === "delete") { v.deleted = true; return; }
      v.tags = P.applySet(v.base, e.set);
      if (e.lat !== undefined) { v.lat = e.lat; v.lon = e.lon; }
    });
    return out;
  }

  function loadPlaces(force) {
    if (!modeOn) return;
    if (map.getZoom() < MIN_ZOOM) { render(); return; }
    var b = map.getBounds();
    if (!force && box && box.contains(b) && Date.now() - boxAt < FRESH_MS) return;
    if (busy || !online()) { render(); return; }
    var bb = b.pad(0.2);
    busy = true; failed = false;
    render();
    var q = P.overpassQuery(bb.getSouth(), bb.getWest(), bb.getNorth(), bb.getEast());
    fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q)
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (j) {
      busy = false;
      box = bb; boxAt = Date.now();
      var next = {};
      P.parseOverpass(j).forEach(function (p) { next[keyOf(p)] = p; });
      places = next;
      paint();
      render();
    }, function () {
      busy = false; failed = true;
      render();
    });
  }

  // ---------- layer ----------
  var layer = L.layerGroup();
  var COLORS = { amenity: "#e0915a", shop: "#5aa9e6", tourism: "#b37fd6", leisure: "#59b36b",
    office: "#9aa3ad", craft: "#c9a227", healthcare: "#e06c75", club: "#d17fb0" };
  function dotIcon(v) {
    var m = P.mainTag(v.tags);
    var col = v.deleted ? "#777" : (m && COLORS[m.k]) || "#d4af37";
    var cls = "poi-dot" + (v.edit ? " pend" : "") + (v.deleted ? " gone" : "") +
      (!v.deleted && ED && ED.missing(v.tags).length ? " miss" : "");
    return L.divIcon({
      className: cls,
      html: '<span style="background:' + col + '"></span>',
      iconSize: [30, 30], iconAnchor: [15, 15]
    });
  }
  function paint() {
    layer.clearLayers();
    if (!modeOn) return;
    var v = view();
    Object.keys(v).forEach(function (k) {
      var p = v[k];
      var mk = L.marker([p.lat, p.lon], { icon: dotIcon(p), keyboard: true, title: label(p) });
      mk.on("click", function () { show(k); });
      layer.addLayer(mk);
    });
  }
  function label(p) {
    var name = p.tags.name || p.tags.brand || "";
    var pre = idx ? P.presetName(P.matchPreset(idx, p.tags), LANG) : "";
    return name || pre || t("unnamed");
  }
  function kindName(tags) {
    if (!idx) return "";
    var p = P.matchPreset(idx, tags);
    if (p) return P.presetName(p, LANG);
    var m = P.mainTag(tags);
    return m ? m.k + "=" + m.v : "";
  }

  // ---------- panel ----------
  var panel = null, modeOn = false, route = { v: "list" };
  function panelOpen() { return !!panel && !panel.hidden; }
  function setH() {
    var h = 0;
    Array.prototype.forEach.call(document.querySelectorAll(".osm-sheet"), function (p) {
      if (!p.hidden) h = Math.max(h, p.offsetHeight);
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
  function go(r) { route = r; render(); }

  function render() {
    if (!panel) return;
    if (route.v !== "pick" && route.v !== "move") showCross(false);
    if (route.v === "place") return renderPlace(route.key);
    if (route.v === "edit") return renderEdit();
    if (route.v === "pick") return renderPick();
    if (route.v === "move") return renderMove(route.key);
    renderList();
  }

  function mineHere() {
    var me = A.deviceId(), srv = A.server();
    return editList().filter(function (e) { return e.dev === me && e.srv === srv && !e.err; });
  }

  function renderList() {
    panel.textContent = "";
    panel.appendChild(header(t("title")));
    var body = el("div", "osm-body");
    var a = A.account();
    body.appendChild(el("p", "osm-hint", a ? t("pending", { n: editList().length }) : t("up.signin")));
    var row = el("div", "osm-actions");
    row.appendChild(button(t("add"), "osm-btn", startAdd));
    if (window.__orosMapsEntrances) row.appendChild(button(t("ent.btn"), "osm-btn poi-ent-btn", function () { window.__orosMapsEntrances.setMode(true); }));
    var mine = mineHere();
    if (mine.length) row.appendChild(button(t("upload", { n: mine.length }), "osm-btn primary", openUpload));
    body.appendChild(row);

    var waiting = editList();
    if (waiting.length) {
      var ul = el("ul", "osm-list");
      var me = A.deviceId();
      waiting.forEach(function (e) {
        var li = el("li", "osm-row draft");
        var b = el("div", "osm-row-body");
        b.appendChild(el("div", "osm-row-t", t("op." + e.op) + ": " + (e.name || t("unnamed"))));
        var meta = [];
        if (e.srv === "dev") meta.push("dev");
        if (e.dev !== me) meta.push(t("wait.other"));
        if (e.err) meta.push("⚠ " + e.err);
        if (meta.length) b.appendChild(el("div", "osm-row-s", meta.join(" · ")));
        li.appendChild(b);
        if (e.dev !== me) {
          li.appendChild(button(t("wait.here"), "osm-mini", function () {
            var x = data.edits[e.id]; if (!x) return;
            x.dev = me; delete x.err; stamp(x); saveData(); render();
          }));
        } else if (e.err) {
          li.appendChild(button("↻", "osm-mini", function () {
            var x = data.edits[e.id]; if (!x) return;
            delete x.err; stamp(x); saveData(); render();
          }));
        }
        li.appendChild(button(t("wait.del"), "osm-mini danger", function () { dropEdit(e.id); paint(); render(); }));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }

    if (map.getZoom() < MIN_ZOOM) { body.appendChild(el("p", "osm-hint", t("zoomin"))); panel.appendChild(body); return; }
    if (busy) body.appendChild(el("p", "osm-hint", t("loading")));
    else if (failed) body.appendChild(el("p", "osm-hint", t("loadfail")));
    var v = view(), c = map.getCenter();
    var list = Object.keys(v).map(function (k) { return v[k]; })
      .map(function (p) { return { p: p, d: O.distM(c.lat, c.lng, p.lat, p.lon) }; })
      .sort(function (x, y) { return x.d - y.d || (x.p.key < y.p.key ? -1 : 1); });
    if (!list.length && !busy && !failed) body.appendChild(el("p", "osm-hint", t("none")));
    var ul2 = el("ul", "osm-list");
    list.slice(0, 80).forEach(function (x) {
      var p = x.p;
      var li = el("li", "osm-row");
      li.tabIndex = 0;
      var dot = el("span", "poi-row-dot");
      var m = P.mainTag(p.tags);
      dot.style.background = p.deleted ? "#777" : (m && COLORS[m.k]) || "#d4af37";
      li.appendChild(dot);
      var b = el("div", "osm-row-body");
      b.appendChild(el("div", "osm-row-t", label(p)));
      var meta = [t("dist.m", { n: Math.round(x.d) })];
      var kn = kindName(p.tags);
      if (kn && kn !== label(p)) meta.push(kn);
      if (p.edit) meta.push(t("op." + p.edit.op));
      if (p.tags.check_date) meta.push("✓ " + p.tags.check_date);
      b.appendChild(el("div", "osm-row-s", meta.join(" · ")));
      li.appendChild(b);
      li.addEventListener("click", function () { show(p.key); });
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") show(p.key); });
      ul2.appendChild(li);
    });
    body.appendChild(ul2);
    panel.appendChild(body);
  }

  function show(key) {
    if (!modeOn) setMode(true);
    var v = view()[key];
    if (v) map.panTo([v.lat, v.lon]);
    go({ v: "place", key: key });
  }

  var INFO_KEYS = ["addr:street", "addr:housenumber", "opening_hours", "phone", "contact:phone", "website", "contact:website", "email", "wheelchair", "level", "cuisine", "operator", "check_date"];
  function renderPlace(key) {
    var p = view()[key];
    panel.textContent = "";
    if (!p) { go({ v: "list" }); return; }
    panel.appendChild(header(label(p), function () { go({ v: "list" }); }));
    var body = el("div", "osm-body");
    var kn = kindName(p.tags);
    if (kn) body.appendChild(el("span", "osm-badge poi-kind", kn));
    if (p.deleted) body.appendChild(el("p", "osm-hint", t("op.delete")));
    var miss = !p.deleted && ED ? ED.missing(p.tags) : [];
    if (miss.length) body.appendChild(el("p", "osm-small poi-miss", t("miss", { k: miss.map(function (k) { return t("miss." + k); }).join(", ") })));
    var dl = el("dl", "poi-info");
    INFO_KEYS.forEach(function (k) {
      var val = p.tags[k];
      if (!val) return;
      dl.appendChild(el("dt", "", k));
      var dd = el("dd", "");
      if ((k === "website" || k === "contact:website") && /^https?:\/\//i.test(val)) {
        var a = el("a", "", val);
        a.href = val; a.target = "_blank"; a.rel = "noopener noreferrer nofollow";
        dd.appendChild(a);
      } else dd.textContent = val;
      dl.appendChild(dd);
    });
    body.appendChild(dl);
    if (!p.deleted) {
      var r1 = el("div", "osm-actions");
      r1.appendChild(button(t("edit"), "osm-btn primary", function () { startEdit(key); }));
      r1.appendChild(button(t("checked"), "osm-btn", function () {
        commit(p, P.applySet(p.tags, { check_date: today() }), null);
        toast(t("checked.done"));
      }));
      body.appendChild(r1);
      var r2 = el("div", "osm-actions");
      if (p.id) {
        r2.appendChild(button(t("closed"), "osm-btn", function () {
          confirmDlg(t("closed.ask", { n: label(p) }), function () { commit(p, P.closedTags(p.tags, today()), null); });
        }));
      }
      if (p.t === "n") {
        r2.appendChild(button(t("move"), "osm-btn", function () {
          map.panTo([p.lat, p.lon]);
          go({ v: "move", key: key });
        }));
        r2.appendChild(button(t("del"), "osm-btn", function () {
          confirmDlg(t("del.ask", { n: label(p) }), function () { removePlace(p); });
        }));
      }
      body.appendChild(r2);
    }
    if (p.edit) {
      var r3 = el("div", "osm-actions");
      r3.appendChild(button(t("discard"), "osm-btn", function () {
        dropEdit(p.edit.id); paint(); go(p.id ? { v: "place", key: key } : { v: "list" });
      }));
      body.appendChild(r3);
    }
    if (p.id) {
      var a = el("a", "osm-ext", t("onosm"));
      a.href = O.SERVERS[A.server()].web + "/" + P.TYPES[p.t] + "/" + p.id;
      a.target = "_blank"; a.rel = "noopener noreferrer";
      body.appendChild(a);
    }
    panel.appendChild(body);
  }

  // ---------- writing pending edits ----------
  function commit(p, tags, move) {
    tags = P.cleanTags(tags);
    var e = p.edit ? data.edits[p.edit.id] : null;
    var me = A.deviceId();
    if (!p.id) {                                           // a new place not uploaded yet
      if (!e) {
        e = { id: newId(), m: 0, dev: me, srv: A.server(), op: "create", t: "n", oid: 0, lat: p.lat, lon: p.lon };
      }
      e.set = tags;
      if (move) { e.lat = move.lat; e.lon = move.lon; }
    } else {
      var d = P.diffTags(p.base, tags);
      if (!e) e = { id: newId(), m: 0, dev: me, srv: A.server(), op: "modify", t: p.t, oid: p.id };
      e.op = "modify";
      e.set = d.set; e.was = d.was;
      if (move) { e.lat = move.lat; e.lon = move.lon; }
      if (!Object.keys(d.set).length && e.lat === undefined) {
        if (p.edit) dropEdit(p.edit.id);
        toast(t("nochange"));
        paint(); go({ v: "place", key: p.key });
        return;
      }
    }
    e.dev = me;
    delete e.err;
    e.name = tags.name || tags.brand || (p.tags && (p.tags.name || p.tags.brand)) || p.label || kindName(tags) || "";
    var pre = idx ? P.matchPreset(idx, tags) : null;
    e.pre = pre ? pre.id : "";
    stamp(e);
    var n = P.normEdit(e);
    if (!n) { toast(t("nochange")); return; }
    data.edits[n.id] = n;
    saveData();
    paint();
    toast(t("saved"));
    go({ v: "place", key: n.op === "create" ? "c" + n.id : p.key });
  }

  function removePlace(p) {
    if (!p.id) { if (p.edit) dropEdit(p.edit.id); paint(); go({ v: "list" }); return; }
    var e = p.edit ? data.edits[p.edit.id] : { id: newId(), t: p.t, oid: p.id, srv: A.server() };
    e.op = "delete"; e.set = {}; e.was = {}; delete e.lat; delete e.lon; delete e.err;
    e.dev = A.deviceId();
    e.name = label(p);
    stamp(e);
    var n = P.normEdit(e);
    if (n) { data.edits[n.id] = n; saveData(); }
    paint(); go({ v: "list" });
  }

  // ---------- add ----------
  var cross = null;
  // Visible map centre: on phones the bottom sheet covers the lower part of
  // the map, so aim above it (the crosshair CSS uses the same rule).
  function aim() {
    var sz = map.getSize(), h = 0;
    try { if (window.matchMedia("(max-width: 480px)").matches && !panel.hidden) h = panel.offsetHeight; } catch (e) {}
    return map.containerPointToLatLng([sz.x / 2, Math.max(20, (sz.y - h) / 2)]);
  }
  function showCross(on) {
    if (!cross) {
      cross = el("div", "poi-cross");
      cross.innerHTML = '<svg width="40" height="40" viewBox="0 0 40 40"><path d="M20 4v12M20 24v12M4 20h12M24 20h12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="20" cy="20" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
      document.body.appendChild(cross);
    }
    cross.hidden = !on;
  }
  function startAdd() {
    if (map.getZoom() < MIN_ZOOM) map.setZoom(MIN_ZOOM);
    loadPresets().then(function () { go({ v: "pick", add: true }); }, function () {});
  }

  // ---------- move ----------
  function renderMove(key) {
    var p = view()[key];
    if (!p) { showCross(false); return go({ v: "list" }); }
    panel.textContent = "";
    showCross(true);
    var back = function () { showCross(false); go({ v: "place", key: key }); };
    panel.appendChild(header(label(p), back));
    var body = el("div", "osm-body");
    body.appendChild(el("p", "osm-hint", t("move.hint")));
    var row = el("div", "osm-actions");
    row.appendChild(button(t("move.here"), "osm-btn primary", function () {
      var c = aim();
      var d = O.distM(p.lat, p.lon, c.lat, c.lng);
      var doIt = function () { showCross(false); commit(p, p.tags, { lat: c.lat, lon: c.lng }); };
      if (d > 20) confirmDlg(t("move.far", { d: Math.round(d) }), doIt); else doIt();
    }));
    row.appendChild(button(t("cancel"), "osm-btn", back));
    body.appendChild(row);
    panel.appendChild(body);
    setH();
  }

  // ---------- preset picker ----------
  function renderPick() {
    panel.textContent = "";
    var adding = !!route.add;
    showCross(adding);
    panel.appendChild(header(t("pick"), function () {
      showCross(false);
      go(adding ? { v: "list" } : { v: "edit", key: route.key, work: route.work, pre: route.pre });
    }));
    var body = el("div", "osm-body");
    if (adding) body.appendChild(el("p", "osm-hint", t("add.hint")));
    if (adding && ED) {
      body.appendChild(el("h4", "poi-micro-h", t("micro")));
      var grid = el("div", "poi-micro");
      ED.MICRO.forEach(function (x) {
        var b = button("", "osm-btn poi-micro-b", function () {
          var c = aim();
          showCross(false);
          commit({ lat: c.lat, lon: c.lng, tags: {}, edit: null, label: LANG === "el" ? x.el : x.en }, ED.microTags(x.id), null);
        });
        var ic = el("span", "poi-micro-ic", x.icon);
        ic.setAttribute("aria-hidden", "true");
        b.appendChild(ic);
        b.appendChild(el("span", "", LANG === "el" ? x.el : x.en));
        b.setAttribute("data-micro", x.id);
        grid.appendChild(b);
      });
      body.appendChild(grid);
    }
    var inp = el("input", "osm-in");
    inp.type = "search";
    inp.placeholder = t("search.ph");
    inp.setAttribute("aria-label", t("pick"));
    body.appendChild(inp);
    var ul = el("ul", "osm-list");
    body.appendChild(ul);
    function fill() {
      ul.textContent = "";
      var list = inp.value.trim() ? P.searchPresets(idx, inp.value, LANG, 40)
        : idx.list.filter(function (p) { return /^(amenity\/(cafe|restaurant|pharmacy|bank|fast_food|bar|atm)|shop\/(supermarket|bakery|convenience|clothes|hairdresser|kiosk))$/.test(p.id); });
      list.filter(function (p) {
        return !Object.keys(p.t).some(function (k) { return p.t[k] === "*"; });
      }).forEach(function (p) {
        var li = el("li", "osm-row");
        li.tabIndex = 0;
        var b = el("div", "osm-row-body");
        b.appendChild(el("div", "osm-row-t", P.presetName(p, LANG)));
        b.appendChild(el("div", "osm-row-s", Object.keys(p.t).map(function (k) { return k + "=" + p.t[k]; }).join(" ")));
        li.appendChild(b);
        function choose() {
          if (adding) {
            var c = aim();
            showCross(false);
            var tags = P.applySet({}, p.at || p.t);
            go({ v: "edit", key: null, work: tags, pre: p.id, at: { lat: c.lat, lon: c.lng } });
          } else {
            // Change of type: the old main tag goes, the new preset's tags come in.
            var w = P.applySet({}, route.work || {});
            var old = P.mainTag(w);
            if (old) delete w[old.k];
            Object.keys(p.at || p.t).forEach(function (k) { w[k] = (p.at || p.t)[k]; });
            go({ v: "edit", key: route.key, work: w, pre: p.id, at: route.at });
          }
        }
        li.addEventListener("click", choose);
        li.addEventListener("keydown", function (e) { if (e.key === "Enter") choose(); });
        ul.appendChild(li);
      });
    }
    inp.addEventListener("input", fill);
    fill();
    panel.appendChild(body);
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 50);
  }

  // ---------- edit form ----------
  function startEdit(key) {
    loadPresets().then(function () {
      var p = view()[key];
      if (!p) return;
      go({ v: "edit", key: key, work: P.applySet({}, p.tags) });
    }, function () {});
  }

  function fieldLabel(f, fallback) {
    return (f.l && (f.l[LANG] || f.l.en)) || fallback;
  }
  function optLabel(f, v) {
    var ol = f.ol && (f.ol[LANG] || f.ol.en);
    return (ol && ol[v]) || v;
  }

  function renderEdit() {
    var work = route.work || {};
    var key = route.key;
    var p = key ? view()[key] : null;
    panel.textContent = "";
    panel.appendChild(header(work.name || (p ? label(p) : t("add")), function () {
      go(key ? { v: "place", key: key } : { v: "list" });
    }));
    var body = el("div", "osm-body poi-form");
    var pre = P.matchPreset(idx, work);
    var kindRow = el("div", "poi-kindrow");
    kindRow.appendChild(el("span", "osm-lab", t("kind")));
    kindRow.appendChild(el("b", "", pre ? P.presetName(pre, LANG) : (P.mainTag(work) ? P.mainTag(work).k + "=" + P.mainTag(work).v : "?")));
    kindRow.appendChild(button(t("change"), "osm-mini", function () {
      go({ v: "pick", key: key, work: work, at: route.at });
    }));
    body.appendChild(kindRow);

    var ta = el("textarea", "osm-ta poi-raw");
    function syncRaw() {
      ta.value = Object.keys(work).sort().map(function (k) { return k + "=" + work[k]; }).join("\n");
    }
    function setTag(k, v) {
      v = P.cleanVal(v);
      if (v) work[k] = v; else delete work[k];
      syncRaw();
    }

    P.fieldsFor(idx, pre, work).forEach(function (fid) {
      var f = idx.fields[fid];
      var box = el("div", "poi-field");
      if (f.ty === "address") {
        box.appendChild(el("span", "osm-lab", fieldLabel(f, t("f.addr"))));
        var grid = el("div", "poi-addr");
        [["addr:street", "f.street"], ["addr:housenumber", "f.no"], ["addr:postcode", "f.pc"], ["addr:city", "f.city"]].forEach(function (x) {
          var i = el("input", "osm-in");
          i.placeholder = t(x[1]);
          i.setAttribute("aria-label", t(x[1]));
          i.value = work[x[0]] || "";
          i.addEventListener("input", function () { setTag(x[0], i.value); });
          grid.appendChild(i);
        });
        box.appendChild(grid);
        body.appendChild(box);
        return;
      }
      var k = f.k || "";
      if (!k) return;
      var lab = el("label", "osm-lab", fieldLabel(f, k));
      box.appendChild(lab);
      var ctl;
      if (f.ty === "check" || f.ty === "defaultCheck") {
        ctl = el("select", "osm-in");
        [["", t("unset")], ["yes", t("yes")], ["no", t("no")]].forEach(function (o) {
          var op = el("option", "", o[1]); op.value = o[0]; ctl.appendChild(op);
        });
        if (work[k] && ["yes", "no"].indexOf(work[k]) < 0) {
          var x = el("option", "", work[k]); x.value = work[k]; ctl.appendChild(x);
        }
        ctl.value = work[k] || "";
        ctl.addEventListener("change", function () { setTag(k, ctl.value); });
      } else if ((f.ty === "multiCombo" && /:$/.test(k)) || f.ty === "semiCombo") {
        ctl = el("div", "poi-checks");
        var opts = (f.o || []).slice(0, 40);
        var cur = f.ty === "semiCombo" ? (work[k] || "").split(";").map(function (s) { return s.trim(); }).filter(Boolean) : null;
        opts.forEach(function (o) {
          var l = el("label", "poi-check");
          var c = el("input", "");
          c.type = "checkbox";
          c.checked = f.ty === "semiCombo" ? cur.indexOf(o) >= 0 : work[k + o] === "yes";
          c.addEventListener("change", function () {
            if (f.ty === "semiCombo") {
              var now = (work[k] || "").split(";").map(function (s) { return s.trim(); }).filter(Boolean);
              if (c.checked && now.indexOf(o) < 0) now.push(o);
              if (!c.checked) now = now.filter(function (z) { return z !== o; });
              setTag(k, now.join(";"));
            } else setTag(k + o, c.checked ? "yes" : "");
          });
          l.appendChild(c);
          l.appendChild(document.createTextNode(" " + optLabel(f, o)));
          ctl.appendChild(l);
        });
        if (!opts.length) {
          ctl = el("input", "osm-in");
          ctl.value = work[k] || "";
          ctl.addEventListener("input", function () { setTag(k, ctl.value); });
        }
      } else if (f.ty === "combo" && f.o && f.o.length) {
        ctl = el("select", "osm-in");
        var none = el("option", "", t("unset")); none.value = ""; ctl.appendChild(none);
        f.o.forEach(function (o) { var op = el("option", "", optLabel(f, o)); op.value = o; ctl.appendChild(op); });
        if (work[k] && f.o.indexOf(work[k]) < 0) { var cu = el("option", "", work[k]); cu.value = work[k]; ctl.appendChild(cu); }
        ctl.value = work[k] || "";
        ctl.addEventListener("change", function () { setTag(k, ctl.value); });
      } else if (f.ty === "schedule") {
        ctl = ohEditor(work[k] || "", function (v) { setTag(k, v); });
      } else {
        ctl = el(f.ty === "textarea" ? "textarea" : "input", "osm-in");
        if (ctl.tagName === "INPUT") {
          ctl.type = { tel: "tel", url: "url", email: "email", number: "text" }[f.ty] || "text";
          if (f.ty === "number") ctl.inputMode = "decimal";
        }
        ctl.maxLength = 255;
        var ph = f.ph && (f.ph[LANG] || f.ph.en);
        if (ph) ctl.placeholder = ph;
        ctl.value = work[k] || "";
        ctl.addEventListener("input", function () { setTag(k, ctl.value); });
      }
      if (ctl.tagName === "INPUT" || ctl.tagName === "SELECT" || ctl.tagName === "TEXTAREA") {
        var cid = "poi-f-" + fid.replace(/[^a-z0-9]/gi, "-");
        ctl.id = cid; lab.htmlFor = cid;
      }
      box.appendChild(ctl);
      body.appendChild(box);
    });

    var det = el("details", "poi-all");
    det.appendChild(el("summary", "", t("alltags")));
    ta.rows = 8;
    ta.spellcheck = false;
    ta.setAttribute("aria-label", t("alltags"));
    syncRaw();
    ta.addEventListener("change", function () {
      var next = {};
      ta.value.split("\n").forEach(function (line) {
        var i = line.indexOf("=");
        if (i <= 0) return;
        var k = P.cleanKey(line.slice(0, i)), v = P.cleanVal(line.slice(i + 1));
        if (k && v) next[k] = v;
      });
      route.work = next;
      render();
    });
    det.appendChild(ta);
    body.appendChild(det);

    var row = el("div", "osm-actions");
    row.appendChild(button(t("save"), "osm-btn primary", function () {
      if (key && p) commit(p, work, null);
      else if (route.at) commit({ key: null, t: "n", id: 0, lat: route.at.lat, lon: route.at.lon, tags: {}, base: {}, edit: null }, work, null);
    }));
    row.appendChild(button(t("cancel"), "osm-btn", function () { go(key ? { v: "place", key: key } : { v: "list" }); }));
    body.appendChild(row);
    panel.appendChild(body);
  }

  // Simple opening hours editor: rows of days + times; anything the
  // simple shape can't hold stays as text.
  function ohEditor(value, onChange) {
    var wrap = el("div", "poi-oh");
    var raw = el("input", "osm-in");
    raw.value = value;
    raw.placeholder = "Mo-Fr 09:00-17:00; Sa 10:00-14:00";
    raw.setAttribute("aria-label", t("oh.raw"));
    var rowsBox = el("div", "poi-oh-rows");
    var rows = P.parseOH(value);
    function emit() {
      var v = P.formatOH(rows);
      raw.value = v;
      onChange(v);
    }
    function draw() {
      rowsBox.textContent = "";
      if (rows === null) return;
      rows.forEach(function (r, ri) {
        var line = el("div", "poi-oh-row");
        var days = el("div", "poi-oh-days");
        t("oh.days").forEach(function (dn, di) {
          var b = button(dn, "poi-day" + (r.days[di] ? " on" : ""), function () {
            r.days[di] = r.days[di] ? 0 : 1;
            b.classList.toggle("on", !!r.days[di]);
            b.setAttribute("aria-pressed", r.days[di] ? "true" : "false");
            emit();
          });
          b.setAttribute("aria-pressed", r.days[di] ? "true" : "false");
          days.appendChild(b);
        });
        line.appendChild(days);
        var times = el("input", "osm-in poi-oh-times");
        times.value = r.times.map(function (x) { return x[0] + "-" + x[1]; }).join(", ");
        times.placeholder = "09:00-14:00, 17:00-21:00 / " + t("oh.closed");
        times.setAttribute("aria-label", "09:00-17:00");
        times.addEventListener("change", function () {
          var parsed = P.parseOH("Mo " + (times.value.trim() ? times.value.replace(/\s+/g, "") : "off"));
          if (!parsed) { times.classList.add("bad"); return; }
          times.classList.remove("bad");
          r.times = parsed[0].times;
          emit();
        });
        line.appendChild(times);
        line.appendChild(button("×", "osm-mini danger", function () { rows.splice(ri, 1); emit(); draw(); }));
        rowsBox.appendChild(line);
      });
    }
    wrap.appendChild(rowsBox);
    var add = button(t("oh.add"), "osm-mini", function () {
      if (rows === null) rows = [];
      var used = [0, 0, 0, 0, 0, 0, 0];
      rows.forEach(function (r) { r.days.forEach(function (d, i) { if (d) used[i] = 1; }); });
      rows.push({ days: used.map(function (u, i) { return !u && i < 5 ? 1 : 0; }), times: [["09:00", "17:00"]] });
      emit(); draw();
    });
    wrap.appendChild(add);
    raw.addEventListener("change", function () {
      rows = P.parseOH(raw.value);
      add.hidden = rows === null;
      onChange(P.cleanVal(raw.value));
      draw();
    });
    add.hidden = rows === null;
    draw();
    wrap.appendChild(raw);
    return wrap;
  }

  function confirmDlg(text, onOk) {
    var dlg = el("dialog", "osm-dlg");
    dlg.appendChild(el("p", "poi-q", text));
    var row = el("div", "osm-actions");
    row.appendChild(button(t("yes"), "osm-btn primary", function () { close(); onOk(); }));
    row.appendChild(button(t("cancel"), "osm-btn", close));
    dlg.appendChild(row);
    function close() { if (dlg.open) dlg.close(); dlg.remove(); }
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- upload ----------
  function osmComment() {
    try {
      var d = window.__orosMapsNotes && window.__orosMapsNotes.data();
      return O.uploadComment(d);
    } catch (e) { return O.DEFAULT_COMMENT; }
  }

  function openUpload() {
    if (!online()) { toast(t("up.offline")); return; }
    if (!A.account()) {
      if (!A.configured()) { toast(t("up.signin")); return; }
      A.signIn().then(openUpload, function () {});
      return;
    }
    var list = mineHere();
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
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  var uploading = false;
  function apiErr(e) {
    if (e && e.offline) return t("up.offline");
    return (e && e.status ? e.status + " " : "") + (e && e.text || "");
  }

  function upload(comment) {
    if (uploading) return Promise.resolve();
    var list = mineHere();
    if (!list.length) return Promise.resolve();
    uploading = true;
    var srv = A.server();
    var items = [], used = [], conflicts = [], nextNeg = -1, byOld = {};
    function el0(j) { return j && Array.isArray(j.elements) ? j.elements[0] : null; }

    var prep = list.reduce(function (pr, e) {
      return pr.then(function () {
        if (e.op === "create") {
          var it = { op: "create", type: "node", id: nextNeg--, lat: e.lat, lon: e.lon, tags: P.cleanTags(e.set) };
          byOld[it.id] = e; items.push(it); used.push(e);
          return;
        }
        var type = P.TYPES[e.t];
        return A.request("GET", "/api/0.6/" + type + "/" + e.oid + ".json", null, srv).then(function (j) {
          var cur = el0(j);
          if (!cur || cur.visible === false) throw { status: 410 };
          if (e.op === "delete") {
            return Promise.all([
              A.request("GET", "/api/0.6/node/" + e.oid + "/ways.json", null, srv),
              A.request("GET", "/api/0.6/node/" + e.oid + "/relations.json", null, srv)
            ]).then(function (r) {
              if ((r[0].elements || []).length || (r[1].elements || []).length) { markErr(e, t("up.used")); return; }
              items.push({ op: "delete", type: "node", id: e.oid, version: cur.version, lat: cur.lat, lon: cur.lon, tags: {} });
              used.push(e);
            });
          }
          var rb = P.rebase(cur.tags || {}, e.set, e.was);
          rb.conflicts.forEach(function (k) { conflicts.push(k); });
          var it2 = { op: "modify", type: type, id: e.oid, version: cur.version, tags: P.cleanTags(rb.tags),
            lat: e.lat !== undefined ? e.lat : cur.lat, lon: e.lon !== undefined ? e.lon : cur.lon,
            nodes: cur.nodes, members: cur.members };
          items.push(it2); used.push(e);
        }, function (err) {
          if (err && (err.status === 410 || err.status === 404)) { markErr(e, t("up.gone")); return; }
          throw err;
        });
      });
    }, Promise.resolve());

    var csId = 0;
    return prep.then(function () {
      if (!items.length) return null;
      var tags = { comment: comment, created_by: "orOS Maps " + (H.ver || ""), locale: LANG, source: "survey" };
      return A.request("PUT", "/api/0.6/changeset/create", null, srv, { body: P.changesetXml(tags), text: true })
        .then(function (id) {
          csId = parseInt(String(id).trim(), 10);
          if (!(csId > 0)) throw { status: 0, text: "changeset" };
          return A.request("POST", "/api/0.6/changeset/" + csId + "/upload", null, srv,
            { body: P.osmChangeXml(csId, items), text: true });
        }).then(function (xml) {
          var res = P.parseDiffResult(xml);
          return A.request("PUT", "/api/0.6/changeset/" + csId + "/close", null, srv, { text: true, body: "" })
            .catch(function () {}).then(function () { return res; });
        });
    }).then(function (res) {
      uploading = false;
      if (!res) { render(); return; }
      // Apply to the local cache so the map shows the result before
      // Overpass catches up.
      items.forEach(function (it, i) {
        var e = used[i];
        var r = res.filter(function (x) { return x.old === it.id && x.type === it.type; })[0];
        if (it.op === "delete") delete places[e.t + e.oid];
        else {
          var id = it.op === "create" ? (r && r.id) : it.id;
          if (id) places[it.type.charAt(0) + id] = { t: it.type.charAt(0), id: id,
            lat: it.lat !== undefined ? it.lat : (places[e.t + e.oid] || {}).lat,
            lon: it.lon !== undefined ? it.lon : (places[e.t + e.oid] || {}).lon, tags: it.tags };
        }
        dropEdit(e.id);
      });
      toast(t("up.ok", { n: items.length }));
      if (conflicts.length) setTimeout(function () { toast(t("up.conflict", { k: conflicts.join(", ") })); }, 1500);
      paint();
      if (route.v === "place" && !view()[route.key]) route = { v: "list" };
      render();
    }, function (err) {
      uploading = false;
      if (csId) A.request("PUT", "/api/0.6/changeset/" + csId + "/close", null, srv, { text: true, body: "" }).catch(function () {});
      toast(t("up.fail", { e: apiErr(err) }));
      if (err && err.status === 409) used.forEach(function (e) { markErr(e, "409"); });
      render();
    });
  }
  function markErr(e, msg) {
    var x = data.edits[e.id];
    if (!x) return;
    x.err = msg;
    stamp(x);
    saveData();
  }

  // ---------- mode ----------
  var modeBtn = null;
  window.addEventListener("oros-maps-mode", function (e) {
    if (modeOn && e.detail !== "poi") setMode(false);
  });
  function setMode(on) {
    if (on && !modeOn) {
      try { window.dispatchEvent(new CustomEvent("oros-maps-mode", { detail: "poi" })); } catch (e) {}
    }
    var was = modeOn;
    modeOn = !!on;
    document.body.classList.toggle("osm-mode", modeOn);
    if (modeBtn) { modeBtn.classList.toggle("on", modeOn); modeBtn.setAttribute("aria-pressed", modeOn ? "true" : "false"); }
    if (modeOn) {
      layer.addTo(map);
      panel.hidden = false;
      route = { v: "list" };
      loadPresets().then(function () { paint(); render(); }, function () {});
      paint();
      loadPlaces(false);
      render();
    } else {
      map.removeLayer(layer);
      panel.hidden = true;
      showCross(false);
      var n = mineHere().length;
      if (was && n) toast(t("leave", { n: n }));
    }
    setH();
  }
  var moveTimer = null;
  map.on("moveend", function () {
    if (!modeOn) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(function () {
      loadPlaces(false);
      if (route.v === "list") render();
    }, 800);
  });

  var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h4l11-11a2.8 2.8 0 0 0-4-4L3 17v4z"/><path d="M13.5 6.5l4 4"/></svg>';
  function boot() {
    loadData();
    panel = el("aside", "osm-sheet");
    panel.id = "poi-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", t("title"));
    document.body.appendChild(panel);
    try { new ResizeObserver(setH).observe(panel); } catch (e) {}
    var controls = document.getElementById("controls");
    if (controls) {
      modeBtn = el("button", "");
      modeBtn.id = "poi-btn";
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
      api.registerSlice("mapsedits", sliceGet, sliceSet, DATA_KEY, P.mergeEdits);
    }
    A.onChange(function () { if (panelOpen()) render(); });
  }

  window.__orosMapsPoi = {
    data: function () { return P.normalizeEdits(data); },
    places: function () { return places; },
    setMode: setMode, show: show, upload: upload, loadPresets: loadPresets
  };
  boot();
})();
