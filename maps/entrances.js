// ============================================================
// orOS Maps — entrances.js (Every Door style entrances, maps wave 9,
// v1.0.0)
// "Entrances and flats" mode (opened from Places): at zoom ≥ 18 the
// building outlines and their entrances appear. Tap on a building's
// outline to add an entrance there (it becomes a node of the building
// way), or tap an entrance to change it: kind (main, staircase…),
// staircase letter (ref), flat numbers (addr:flats) and step-free
// access. Fits Greek apartment blocks: "Είσοδος Β, διαμερίσματα 5-8".
//
// Changes wait in the synced slice "mapsentr" (everydoor-core.js) and
// go up only with Upload: one changeset with the upload comment,
// source=survey. A new entrance is inserted between the two corners it
// was put between, in the building's current node list; if that edge
// no longer exists the entrance stays with an error. Tag changes are
// rebased on the server's current tags (poi-core.js).
//
// Safety: OSM tags go on the page with textContent only.
// ============================================================
(function () {
  "use strict";
  var O = window.OrosMapsOSM;
  var P = window.OrosMapsPoi;
  var ED = window.OrosMapsEveryDoor;
  var A = window.OrosMapsApi;
  var H = window.__orosMapsHost;
  if (!O || !P || !ED || !A || !H || !H.map) return;
  var map = H.map;
  var LANG = window.orosI18n ? window.orosI18n.lang() : (H.lang === "el" ? "el" : "en");
  var OVERPASS = "https://overpass-api.de/api/interpreter";
  var MIN_ZOOM = 18, FRESH_MS = 30 * 60 * 1000;

  var STR = {
    en: {
      "ent.title": "Entrances and flats",
      "ent.hint": "Tap on a building's outline to add an entrance, or tap an entrance to change it.",
      "ent.zoomin": "Zoom in closer to see the buildings and their entrances.", "ent.zoomgo": "Zoom in",
      "ent.loading": "Loading buildings…", "ent.loadfail": "Could not load the area. Try again later.",
      "ent.count": "{b} buildings, {e} entrances here",
      "ent.miss": "{n} entrances without flat numbers or letter",
      "ent.pending": "{n} changes waiting to be uploaded",
      "ent.upload": "Upload {n}", "ent.other": "From another device (it uploads them)",
      "ent.new": "New entrance", "ent.edit": "Entrance",
      "ent.kind": "Kind", "ent.ref": "Letter or number on the door", "ent.ref.ph": "e.g. B",
      "ent.flats": "Flat numbers", "ent.flats.ph": "e.g. 1-8 or 5;6;7",
      "ent.wheel": "Step-free access", "ent.wheel.unknown": "Don't know",
      "ent.save": "Save", "ent.cancel": "Cancel", "ent.del": "Remove", "ent.back": "Back", "ent.close": "Close",
      "ent.bad.ref": "The letter can be up to 4 letters or digits.",
      "ent.bad.flats": "Flat numbers: numbers or letters, with - for a range and ; between them.",
      "ent.nochange": "Nothing changed.",
      "ent.saved": "Saved. Upload when you're done.",
      "ent.far": "Tap closer to a building's outline.",
      "ent.corner": "On the building's corner",
      "ent.up.title": "Upload to OpenStreetMap", "ent.up.comment": "Comment",
      "ent.up.count": "{n} changes from this device will be published under your OpenStreetMap name.",
      "ent.up.go": "Upload", "ent.up.ok": "Uploaded {n} changes to OpenStreetMap",
      "ent.up.fail": "Upload failed: {e}", "ent.up.gone": "It no longer exists on OpenStreetMap",
      "ent.up.moved": "The building changed meanwhile. Remove it and put the entrance again.",
      "ent.up.conflict": "Someone else changed these meanwhile, their value was kept: {k}",
      "ent.up.signin": "Sign in with OpenStreetMap to upload", "ent.up.offline": "You are offline. Your changes are kept.",
      "ent.leave": "{n} changes are waiting to be uploaded"
    },
    el: {
      "ent.title": "Είσοδοι και διαμερίσματα",
      "ent.hint": "Πάτα στο περίγραμμα ενός κτιρίου για να προσθέσεις είσοδο, ή πάτα μια είσοδο για να την αλλάξεις.",
      "ent.zoomin": "Πλησίασε περισσότερο για να δεις τα κτίρια και τις εισόδους τους.", "ent.zoomgo": "Μεγέθυνση",
      "ent.loading": "Φόρτωση κτιρίων…", "ent.loadfail": "Δεν φορτώθηκε η περιοχή. Δοκίμασε ξανά αργότερα.",
      "ent.count": "{b} κτίρια, {e} είσοδοι εδώ",
      "ent.miss": "{n} είσοδοι χωρίς αριθμούς διαμερισμάτων ή γράμμα",
      "ent.pending": "{n} αλλαγές περιμένουν αποστολή",
      "ent.upload": "Αποστολή {n}", "ent.other": "Από άλλη συσκευή (εκείνη τις στέλνει)",
      "ent.new": "Νέα είσοδος", "ent.edit": "Είσοδος",
      "ent.kind": "Είδος", "ent.ref": "Γράμμα ή αριθμός στην πόρτα", "ent.ref.ph": "π.χ. Β",
      "ent.flats": "Αριθμοί διαμερισμάτων", "ent.flats.ph": "π.χ. 1-8 ή 5;6;7",
      "ent.wheel": "Πρόσβαση χωρίς σκαλιά", "ent.wheel.unknown": "Δεν ξέρω",
      "ent.save": "Αποθήκευση", "ent.cancel": "Άκυρο", "ent.del": "Αφαίρεση", "ent.back": "Πίσω", "ent.close": "Κλείσιμο",
      "ent.bad.ref": "Το γράμμα μπορεί να έχει έως 4 γράμματα ή ψηφία.",
      "ent.bad.flats": "Αριθμοί διαμερισμάτων: αριθμοί ή γράμματα, με - για εύρος και ; ανάμεσα.",
      "ent.nochange": "Δεν άλλαξε τίποτα.",
      "ent.saved": "Αποθηκεύτηκε. Στείλ' το όταν τελειώσεις.",
      "ent.far": "Πάτα πιο κοντά στο περίγραμμα ενός κτιρίου.",
      "ent.corner": "Στη γωνία του κτιρίου",
      "ent.up.title": "Αποστολή στο OpenStreetMap", "ent.up.comment": "Σχόλιο",
      "ent.up.count": "{n} αλλαγές από αυτή τη συσκευή θα δημοσιευτούν με το όνομά σου στο OpenStreetMap.",
      "ent.up.go": "Αποστολή", "ent.up.ok": "Στάλθηκαν {n} αλλαγές στο OpenStreetMap",
      "ent.up.fail": "Η αποστολή απέτυχε: {e}", "ent.up.gone": "Δεν υπάρχει πια στο OpenStreetMap",
      "ent.up.moved": "Το κτίριο άλλαξε στο μεταξύ. Αφαίρεσέ την και βάλε ξανά την είσοδο.",
      "ent.up.conflict": "Κάποιος άλλος τα άλλαξε στο μεταξύ, κρατήθηκε η δική του τιμή: {k}",
      "ent.up.signin": "Συνδέσου με το OpenStreetMap για αποστολή", "ent.up.offline": "Είσαι εκτός σύνδεσης. Οι αλλαγές σου κρατιούνται.",
      "ent.leave": "{n} αλλαγές περιμένουν αποστολή"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "maps", LANG);
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (loc()); }
  function t(k, vars) {
    k = "ent." + k;
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
  function txt(o) { return o[LANG] || o.en; }

  // ---------- synced slice "mapsentr" ----------
  var DATA_KEY = "oros-maps-entr-data";
  var data = ED.normalize(null);
  var suppress = false;
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function loadData() {
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e) {}
    if (!raw) return;
    try { data = ED.normalize(JSON.parse(raw)); }
    catch (e) { try { localStorage.setItem("oros-maps-entr-rescue", raw); } catch (e2) {} }
  }
  function saveData() {
    data = ED.normalize(data);
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); }
    catch (e) { toast(H.storeFull || "Storage is full"); return false; }
    if (!suppress) { var api = syncApi(); if (api && api.markDirty) api.markDirty(); }
    return true;
  }
  function sliceGet() { return ED.normalize(data); }
  function sliceSet(d) {
    if (!d || typeof d !== "object") return;
    data = ED.normalize(JSON.parse(JSON.stringify(d)));
    suppress = true;
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) {}
    suppress = false;
    paint();
    if (panelOpen()) render();
  }
  function newId() { return O.randomString(14).toLowerCase().replace(/[^a-z0-9]/g, "0"); }
  function stamp(x) { x.m = Math.max(Date.now(), (x.m || 0) + 1); }
  function items() {
    var srv = A.server();
    return Object.keys(data.items).map(function (k) { return data.items[k]; })
      .filter(function (x) { return x.srv === srv; })
      .sort(function (a, b) { return a.m - b.m || (a.id < b.id ? -1 : 1); });
  }
  function mine() {
    var me = A.deviceId();
    return items().filter(function (x) { return x.dev === me && !x.err; });
  }
  function dropItem(id) {
    var x = data.items[id];
    if (!x) return;
    delete data.items[id];
    data.tombs[id] = Math.max(Date.now(), x.m + 1);
    saveData();
  }

  // ---------- area (Overpass, device memory) ----------
  var ways = [], ents = [], box = null, boxAt = 0, busy = false, failed = false;
  function load(force) {
    if (!modeOn) return;
    if (map.getZoom() < MIN_ZOOM) { paint(); render(); return; }
    var b = map.getBounds();
    if (!force && box && box.contains(b) && Date.now() - boxAt < FRESH_MS) return;
    if (busy || !online()) { render(); return; }
    var bb = b.pad(0.25);
    busy = true; failed = false;
    render();
    fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(ED.query(bb.getSouth(), bb.getWest(), bb.getNorth(), bb.getEast()))
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (j) {
      busy = false;
      box = bb; boxAt = Date.now();
      var res = ED.parse(j);
      ways = res.ways; ents = res.ents;
      paint(); render();
    }, function () {
      busy = false; failed = true;
      render();
    });
  }
  // Entrances as the user sees them: server ones + pending changes and new ones.
  // → [{ key, id (node, 0 for new), item, lat, lon, tags, base }]
  function view() {
    var out = [], byNode = {};
    ents.forEach(function (n) {
      var v = { key: "n" + n.id, id: n.id, item: null, lat: n.lat, lon: n.lon, tags: n.tags, base: n.tags };
      byNode[n.id] = v; out.push(v);
    });
    items().forEach(function (x) {
      if (x.op === "create") {
        out.push({ key: "c" + x.id, id: 0, item: x, lat: x.lat, lon: x.lon, tags: P.applySet({}, x.set), base: {} });
        return;
      }
      var v = byNode[x.oid];
      if (!v) { v = { key: "n" + x.oid, id: x.oid, item: null, lat: x.lat, lon: x.lon, tags: {}, base: {} }; byNode[x.oid] = v; out.push(v); }
      v.item = x;
      v.tags = P.applySet(v.base, x.set);
    });
    return out;
  }
  function done(tags) { return !!(tags["addr:flats"] || tags.ref); }

  // ---------- layers (canvas) ----------
  var layer = L.layerGroup(), rend = null;
  function renderer() {
    if (!rend) { try { rend = L.canvas({ padding: 0.3, tolerance: 4 }); } catch (e) { rend = null; } }
    return rend;
  }
  function paint() {
    layer.clearLayers();
    if (!modeOn || map.getZoom() < MIN_ZOOM) return;
    var r = renderer() || undefined;
    ways.forEach(function (w) {
      layer.addLayer(L.polygon(w.geom, { color: "#8ab4f8", weight: 2, opacity: 0.85, fillColor: "#8ab4f8", fillOpacity: 0.08, interactive: false, renderer: r }));
    });
    var sel = route.v === "form" ? route.key : "";
    view().forEach(function (v) {
      var col = v.item ? "#d4af37" : done(v.tags) ? "#43a047" : "#fb8c00";
      layer.addLayer(L.circleMarker([v.lat, v.lon], { radius: v.key === sel ? 9 : 7, color: "#111", weight: 2, fillColor: col, fillOpacity: 1, interactive: false, renderer: r }));
    });
    if (route.v === "form" && route.spot) {
      layer.addLayer(L.circleMarker([route.spot.lat, route.spot.lon], { radius: 9, color: "#fff", weight: 3, fillColor: "#d4af37", fillOpacity: 1, interactive: false, renderer: r }));
    }
  }
  function mpp() { return 40075016.686 * Math.cos(map.getCenter().lat * Math.PI / 180) / Math.pow(2, map.getZoom() + 8); }
  // A tap: an entrance nearby opens it, else snap to a building outline.
  function tapAt(lat, lon) {
    if (!modeOn || map.getZoom() < MIN_ZOOM) return false;
    var p = map.latLngToContainerPoint([lat, lon]), best = null, bd = 16;
    view().forEach(function (v) {
      var q = map.latLngToContainerPoint([v.lat, v.lon]);
      var d = Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y));
      if (d < bd) { bd = d; best = v; }
    });
    if (best) { openEnt(best.key); return true; }
    var m = mpp();
    var s = ED.snap(ways, [lat, lon], 18 * m, Math.min(6 * m, 1.5));
    if (!s) { toast(t("far")); return false; }
    go({ v: "form", key: "", spot: s, form: ED.entranceForm({}) });
    paint();
    return true;
  }
  map.on("click", function (e) {
    if (!modeOn || !e || !e.latlng) return;
    if (route.v === "form" && route.dirty) return;
    tapAt(e.latlng.lat, e.latlng.lng);
  });
  function openEnt(key) {
    var v = view().filter(function (x) { return x.key === key; })[0];
    if (!v) return;
    go({ v: "form", key: key, form: ED.entranceForm(v.tags) });
    paint();
  }

  // ---------- panel ----------
  var panel = null, modeOn = false, route = { v: "list" };
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
    if (route.v === "form" && renderForm()) { setH(); return; }
    route = { v: "list" };
    renderList();
    setH();
  }
  function renderList() {
    panel.textContent = "";
    panel.appendChild(header(t("title")));
    var body = el("div", "osm-body");
    body.appendChild(el("p", "osm-hint", t("hint")));
    var my = mine();
    if (my.length) {
      var row = el("div", "osm-actions");
      row.appendChild(button(t("upload", { n: my.length }), "osm-btn primary", openUpload));
      body.appendChild(row);
    }
    var pend = items();
    if (pend.length) {
      body.appendChild(el("p", "osm-hint", t("pending", { n: pend.length })));
      var ul = el("ul", "osm-list");
      var me = A.deviceId();
      pend.forEach(function (x) {
        var li = el("li", "osm-row draft");
        var b = el("div", "osm-row-body");
        var kind = ED.ENT_TYPES.filter(function (k) { return k.v === x.set.entrance; })[0];
        b.appendChild(el("div", "osm-row-t", (x.op === "create" ? t("new") : t("edit")) + (kind ? ": " + txt(kind) : "") + (x.set.ref ? " " + x.set.ref : "")));
        var meta = Object.keys(x.set).filter(function (k) { return k !== "entrance" && x.set[k]; }).map(function (k) { return k + "=" + x.set[k]; });
        if (x.dev !== me) meta.push(t("other"));
        if (x.err) meta.push("⚠ " + x.err);
        if (meta.length) b.appendChild(el("div", "osm-row-s", meta.join(" · ")));
        li.appendChild(b);
        li.appendChild(button(t("del"), "osm-mini danger", function () { dropItem(x.id); paint(); render(); }));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }
    if (map.getZoom() < MIN_ZOOM) {
      body.appendChild(el("p", "osm-hint", t("zoomin")));
      var zr = el("div", "osm-actions");
      zr.appendChild(button(t("zoomgo"), "osm-btn", function () { map.setZoom(MIN_ZOOM); }));
      body.appendChild(zr);
    } else if (busy) body.appendChild(el("p", "osm-hint", t("loading")));
    else if (failed) body.appendChild(el("p", "osm-hint", t("loadfail")));
    else {
      var vs = view();
      body.appendChild(el("p", "osm-small", t("count", { b: ways.length, e: vs.length })));
      var miss = vs.filter(function (v) { return !done(v.tags); }).length;
      if (miss) body.appendChild(el("p", "osm-small ent-miss", t("miss", { n: miss })));
    }
    panel.appendChild(body);
  }

  function chips(list, cur, cls, onPick, none) {
    var box2 = el("div", "ent-chips " + cls);
    var all = none ? [{ v: "", en: none, el: none }].concat(list) : list;
    all.forEach(function (o) {
      var b = button(txt(o), "osm-btn ent-chip" + (o.v === cur ? " on" : ""), function () {
        onPick(o.v);
        box2.querySelectorAll(".ent-chip").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
      });
      b.setAttribute("aria-pressed", o.v === cur ? "true" : "false");
      box2.appendChild(b);
    });
    return box2;
  }
  function renderForm() {
    var v = route.key ? view().filter(function (x) { return x.key === route.key; })[0] : null;
    if (route.key && !v) return false;
    if (!route.key && !route.spot) return false;
    var f = route.form;
    panel.textContent = "";
    panel.appendChild(header(v ? t("edit") : t("new"), function () { go({ v: "list" }); paint(); }));
    var body = el("div", "osm-body ent-form");
    if (!v && route.spot.vertex) body.appendChild(el("p", "osm-small", t("corner")));
    body.appendChild(el("h4", "ent-h", t("kind")));
    body.appendChild(chips(ED.ENT_TYPES, f.type, "ent-kind", function (x) { f.type = x; route.dirty = true; }));
    var l1 = el("label", "osm-lab", t("ref"));
    var ref = el("input", "osm-in ent-ref");
    ref.maxLength = 4; ref.value = f.ref; ref.placeholder = t("ref.ph"); ref.autocomplete = "off"; ref.autocapitalize = "characters";
    ref.addEventListener("input", function () { f.ref = ref.value; route.dirty = true; });
    l1.appendChild(ref);
    body.appendChild(l1);
    var l2 = el("label", "osm-lab", t("flats"));
    var flats = el("input", "osm-in ent-flats");
    flats.maxLength = 200; flats.value = f.flats; flats.placeholder = t("flats.ph"); flats.autocomplete = "off"; flats.inputMode = "text";
    flats.addEventListener("input", function () { f.flats = flats.value; route.dirty = true; });
    l2.appendChild(flats);
    body.appendChild(l2);
    body.appendChild(el("h4", "ent-h", t("wheel")));
    body.appendChild(chips(ED.WHEEL, f.wheelchair, "ent-wheel", function (x) { f.wheelchair = x; route.dirty = true; }, t("wheel.unknown")));
    var row = el("div", "osm-actions");
    row.appendChild(button(t("save"), "osm-btn primary", function () { save(v); }));
    row.appendChild(button(t("cancel"), "osm-btn", function () { go({ v: "list" }); paint(); }));
    if (v && v.item) row.appendChild(button(t("del"), "osm-btn danger", function () { dropItem(v.item.id); go({ v: "list" }); paint(); }));
    body.appendChild(row);
    panel.appendChild(body);
    return true;
  }
  function save(v) {
    var r = ED.entranceTags(route.form);
    if (r.error) { toast(t(r.error === "flats" ? "bad.flats" : r.error === "ref" ? "bad.ref" : "nochange")); return; }
    var me = A.deviceId(), x;
    if (!v) {
      var s = route.spot;
      if (s.vertex) {
        x = { id: newId(), m: 0, dev: me, srv: A.server(), op: "modify", oid: s.vertex, lat: s.lat, lon: s.lon, set: r.tags, was: {} };
        Object.keys(r.tags).forEach(function (k) { x.was[k] = ""; });
      } else {
        x = { id: newId(), m: 0, dev: me, srv: A.server(), op: "create", wid: s.wid, a: s.a, b: s.b, lat: s.lat, lon: s.lon, set: r.tags };
      }
    } else if (v.item && v.item.op === "create") {
      x = JSON.parse(JSON.stringify(v.item));
      x.set = r.tags; x.dev = me; delete x.err;
    } else {
      // tags that changed against the server's: "" removes a field
      var set = {}, was = {};
      ["entrance", "ref", "addr:flats", "wheelchair"].forEach(function (k) {
        var nv = r.tags[k] || "", cv = v.base[k] || "";
        if (nv !== cv) { set[k] = nv; was[k] = cv; }
      });
      if (!Object.keys(set).length) {
        if (v.item) dropItem(v.item.id);
        toast(t("nochange")); go({ v: "list" }); paint(); return;
      }
      x = v.item ? JSON.parse(JSON.stringify(v.item)) : { id: newId(), m: 0, srv: A.server(), op: "modify", oid: v.id, lat: v.lat, lon: v.lon };
      x.set = set; x.was = was; x.dev = me; delete x.err;
    }
    stamp(x);
    var n = ED.normItem(x);
    if (!n) { toast(t("nochange")); return; }
    data.items[n.id] = n;
    if (!saveData()) return;
    toast(t("saved"));
    go({ v: "list" });
    paint();
  }

  // ---------- upload ----------
  function osmComment() {
    try { return O.uploadComment(window.__orosMapsNotes && window.__orosMapsNotes.data()); }
    catch (e) { return O.DEFAULT_COMMENT; }
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
    inp.value = osmComment(); inp.maxLength = 255;
    lab.appendChild(inp);
    dlg.appendChild(lab);
    var row = el("div", "osm-actions");
    var goBtn = button(t("up.go"), "osm-btn primary", function () {
      var c = P.cleanVal(inp.value) || O.DEFAULT_COMMENT;
      goBtn.disabled = true; close(); upload(c);
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
  function markErr(x, msg) {
    var y = data.items[x.id];
    if (!y) return;
    y.err = msg; stamp(y); saveData();
  }
  function upload(comment) {
    if (uploading) return Promise.resolve();
    var list = mine();
    if (!list.length) return Promise.resolve();
    uploading = true;
    var srv = A.server(), nodes = [], wayCache = {}, used = [], conflicts = [], nextNeg = -1;
    function el0(j) { return j && Array.isArray(j.elements) ? j.elements[0] : null; }
    function getWay(wid) {
      if (wayCache[wid]) return Promise.resolve(wayCache[wid]);
      return A.request("GET", "/api/0.6/way/" + wid + ".json", null, srv).then(function (j) {
        var w = el0(j);
        if (!w || w.visible === false || !Array.isArray(w.nodes)) throw { status: 410 };
        wayCache[wid] = { w: w, nodes: w.nodes.slice(), dirty: false };
        return wayCache[wid];
      });
    }
    var prep = list.reduce(function (pr, x) {
      return pr.then(function () {
        if (x.op === "create") {
          return getWay(x.wid).then(function (c) {
            var nn = ED.insertNode(c.nodes, x.a, x.b, nextNeg);
            if (!nn) { markErr(x, t("up.moved")); return; }
            c.nodes = nn; c.dirty = true;
            nodes.push({ op: "create", type: "node", id: nextNeg--, lat: x.lat, lon: x.lon, tags: P.cleanTags(x.set) });
            used.push(x);
          }, function (err) {
            if (err && (err.status === 410 || err.status === 404)) { markErr(x, t("up.gone")); return; }
            throw err;
          });
        }
        return A.request("GET", "/api/0.6/node/" + x.oid + ".json", null, srv).then(function (j) {
          var cur = el0(j);
          if (!cur || cur.visible === false) throw { status: 410 };
          var rb = P.rebase(cur.tags || {}, x.set, x.was);
          rb.conflicts.forEach(function (k) { conflicts.push(k); });
          var tags = P.cleanTags(rb.tags);
          if (P.canon(tags) === P.canon(P.cleanTags(cur.tags || {}))) { dropItem(x.id); return; }
          nodes.push({ op: "modify", type: "node", id: x.oid, version: cur.version, lat: cur.lat, lon: cur.lon, tags: tags });
          used.push(x);
        }, function (err) {
          if (err && (err.status === 410 || err.status === 404)) { markErr(x, t("up.gone")); return; }
          throw err;
        });
      });
    }, Promise.resolve());
    var csId = 0;
    return prep.then(function () {
      var its = nodes.slice();
      Object.keys(wayCache).forEach(function (k) {
        var c = wayCache[k];
        if (c.dirty) its.push({ op: "modify", type: "way", id: c.w.id, version: c.w.version, nodes: c.nodes, tags: P.cleanTags(c.w.tags || {}) });
      });
      if (!its.length) return 0;
      var tags = { comment: comment, created_by: "orOS Maps " + (H.ver || ""), locale: LANG, source: "survey", "orOS:mode": "entrances" };
      return A.request("PUT", "/api/0.6/changeset/create", null, srv, { body: P.changesetXml(tags), text: true }).then(function (id) {
        csId = parseInt(String(id).trim(), 10);
        if (!(csId > 0)) throw { status: 0, text: "changeset" };
        return A.request("POST", "/api/0.6/changeset/" + csId + "/upload", null, srv, { body: P.osmChangeXml(csId, its), text: true });
      }).then(function () {
        return A.request("PUT", "/api/0.6/changeset/" + csId + "/close", null, srv, { text: true, body: "" }).catch(function () {});
      }, function (err) {
        if (csId) A.request("PUT", "/api/0.6/changeset/" + csId + "/close", null, srv, { text: true, body: "" }).catch(function () {});
        if (err && err.status === 409) used.forEach(function (x) { markErr(x, "409"); });
        throw err;
      }).then(function () {
        used.forEach(function (x) { dropItem(x.id); });
        return used.length;
      });
    }).then(function (n) {
      uploading = false;
      if (n) toast(t("up.ok", { n: n }));
      if (conflicts.length) setTimeout(function () { toast(t("up.conflict", { k: conflicts.join(", ") })); }, 1500);
      if (n) load(true);
      paint(); render();
    }, function (err) {
      uploading = false;
      toast(t("up.fail", { e: apiErr(err) }));
      paint(); render();
    });
  }

  // ---------- mode ----------
  window.addEventListener("oros-maps-mode", function (e) {
    if (modeOn && e.detail !== "entrances") setMode(false);
  });
  function setMode(on) {
    if (on && !modeOn) {
      try { window.dispatchEvent(new CustomEvent("oros-maps-mode", { detail: "entrances" })); } catch (e) {}
    }
    var was = modeOn;
    modeOn = !!on;
    document.body.classList.toggle("osm-mode", modeOn);
    if (modeOn) {
      layer.addTo(map);
      panel.hidden = false;
      route = { v: "list" };
      paint();
      load(false);
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
    moveTimer = setTimeout(function () { load(false); paint(); if (route.v === "list") render(); }, 350);
  });

  function boot() {
    loadData();
    panel = el("aside", "osm-sheet");
    panel.id = "ent-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", t("title"));
    document.body.appendChild(panel);
    try { new ResizeObserver(setH).observe(panel); } catch (e) {}
    var api = syncApi();
    if (api && typeof api.registerSlice === "function") api.registerSlice("mapsentr", sliceGet, sliceSet, DATA_KEY, ED.merge);
    A.onChange(function () { if (panelOpen()) render(); });
  }

  window.__orosMapsEntrances = {
    data: function () { return ED.normalize(data); },
    area: function () { return { ways: ways, ents: ents }; },
    view: view, setMode: setMode, tapAt: tapAt, openEnt: openEnt, upload: upload
  };
  boot();
})();
