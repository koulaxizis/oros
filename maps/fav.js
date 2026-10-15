// ============================================================
// orOS Maps — fav.js (favourite groups, maps wave 10C, v1.0.0)
//
// OsmAnd style groups for Saved places:
//   - Groups with a name and a colour. A saved place goes into one
//     group from its popup or from the list (folder button); the pin
//     on the map takes the group's colour.
//   - Saved places list: a header per group (fold, show / hide on
//     the map, export as GPX), then "No group".
//   - Groups button: make, rename, recolour, delete (places stay
//     saved, without a group). Import: the waypoints of a GPX, KML or
//     GeoJSON file become saved places in a group (also when such a
//     file without a track is opened in My tracks); KMZ and Google
//     Takeout lists go through import-ui.js, which puts the new places
//     in a group per list with importPins (Undo: undoPins).
//   Groups and pins sync in the slice "mapsfav" (fav-core.js). Which
//   groups are hidden or folded is device-local ("oros-maps-fav-prefs").
//
// Safety: user text goes on the page with textContent only.
// ============================================================
(function () {
  "use strict";
  var FC = window.OrosMapsFav;
  var T = window.OrosMapsTracks;
  var H = window.__orosMapsHost;
  if (!FC || !H || !H.map || typeof H.places !== "function") return;
  var LANG = H.lang === "el" ? "el" : "en";
  var DATA_KEY = "oros-maps-fav-data";
  var PREFS_KEY = "oros-maps-fav-prefs";
  var NONE = "_none";                 // fold key of "No group"

  var STR = {
    en: {
      "label": "Group", "groups": "Groups", "import": "Import",
      "none": "No group", "pick": "Group for “{n}”", "new": "New group",
      "edit": "Edit group", "name": "Name", "color": "Colour",
      "save": "Save", "cancel": "Cancel", "close": "Close", "delete": "Delete group",
      "del.ask": "Delete the group “{n}”? Its places stay saved, without a group.",
      "show": "Show on the map", "hide": "Hide from the map",
      "fold": "Fold", "unfold": "Unfold",
      "export": "Export GPX", "count1": "1 place", "count": "{n} places",
      "manage": "Favourite groups", "manage.empty": "No groups yet. Make one to colour and sort your saved places.",
      "moved": "Moved to {g}", "ungrouped": "Now without a group",
      "dup": "A group with this name exists already.", "noname": "Give the group a name.",
      "full": "That's the most groups you can have.", "deleted": "Group deleted",
      "imp.title": "Import places", "imp.found": "{n} places in “{f}”", "imp.into": "Put them in",
      "imp.newgrp": "New group “{f}”", "imp.go": "Import", "imp.done": "{n} places saved",
      "imp.bad": "No places (waypoints) found in this file.", "imp.big": "This file is too big.",
      "nodlg": "Saving files isn't available here.", "empty": "This group has no places yet.",
      "saved": "Saved places"
    },
    el: {
      "label": "Ομάδα", "groups": "Ομάδες", "import": "Εισαγωγή",
      "none": "Χωρίς ομάδα", "pick": "Ομάδα για «{n}»", "new": "Νέα ομάδα",
      "edit": "Επεξεργασία ομάδας", "name": "Όνομα", "color": "Χρώμα",
      "save": "Αποθήκευση", "cancel": "Άκυρο", "close": "Κλείσιμο", "delete": "Διαγραφή ομάδας",
      "del.ask": "Διαγραφή της ομάδας «{n}»; Οι τοποθεσίες της μένουν αποθηκευμένες, χωρίς ομάδα.",
      "show": "Εμφάνιση στον χάρτη", "hide": "Απόκρυψη από τον χάρτη",
      "fold": "Σύμπτυξη", "unfold": "Ανάπτυξη",
      "export": "Εξαγωγή GPX", "count1": "1 τοποθεσία", "count": "{n} τοποθεσίες",
      "manage": "Ομάδες αγαπημένων", "manage.empty": "Δεν υπάρχουν ομάδες ακόμα. Φτιάξε μία για να χρωματίσεις και να οργανώσεις τις αποθηκευμένες τοποθεσίες σου.",
      "moved": "Μετακινήθηκε στην ομάδα {g}", "ungrouped": "Τώρα χωρίς ομάδα",
      "dup": "Υπάρχει ήδη ομάδα με αυτό το όνομα.", "noname": "Δώσε ένα όνομα στην ομάδα.",
      "full": "Δεν μπορείς να έχεις περισσότερες ομάδες.", "deleted": "Η ομάδα διαγράφηκε",
      "imp.title": "Εισαγωγή τοποθεσιών", "imp.found": "{n} τοποθεσίες στο «{f}»", "imp.into": "Βάλ' τα στην ομάδα",
      "imp.newgrp": "Νέα ομάδα «{f}»", "imp.go": "Εισαγωγή", "imp.done": "Αποθηκεύτηκαν {n} τοποθεσίες",
      "imp.bad": "Δεν βρέθηκαν τοποθεσίες (σημεία) σε αυτό το αρχείο.", "imp.big": "Το αρχείο είναι πολύ μεγάλο.",
      "nodlg": "Η αποθήκευση αρχείων δεν είναι διαθέσιμη εδώ.", "empty": "Αυτή η ομάδα δεν έχει τοποθεσίες ακόμα.",
      "saved": "Αποθηκευμένες τοποθεσίες"
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
  function count(n) { return n === 1 ? t("count1") : t("count", { n: n }); }
  var ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  var ICON_EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var ICON_EYE_OFF = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4.1M6.6 6.6A18 18 0 0 0 1 12s4 7 11 7a10.6 10.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  var ICON_DL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';
  var ICON_PEN = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  var ICON_CARET = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

  // ---------- synced slice "mapsfav" ----------
  var data = FC.normalize(null);
  var suppress = false;
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function loadData() {
    var raw = null;
    try { raw = localStorage.getItem(DATA_KEY); } catch (e) {}
    if (!raw) return;
    try { data = FC.normalize(JSON.parse(raw)); }
    catch (e) { try { localStorage.setItem("oros-maps-fav-rescue", raw); } catch (e2) {} }
  }
  function saveData() {
    data = FC.normalize(data);
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); }
    catch (e) { toast(H.storeFull || "Storage is full"); return false; }
    if (!suppress) { var api = syncApi(); if (api && api.markDirty) api.markDirty(); }
    H.refreshPlaces();
    return true;
  }
  function sliceGet() { return FC.normalize(data); }
  function sliceSet(d) {
    if (!d || typeof d !== "object") return;
    data = FC.normalize(JSON.parse(JSON.stringify(d)));
    suppress = true;
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) {}
    suppress = false;
    H.refreshPlaces();
  }
  function stamp(x) { x.m = Math.max(Date.now(), (x.m || 0) + 1); return x; }

  // ---------- device-local prefs: hidden and folded groups ----------
  var prefs = { hide: [], fold: [] };
  try {
    var pr = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    if (pr && typeof pr === "object") {
      prefs.hide = Array.isArray(pr.hide) ? pr.hide.filter(function (g) { return typeof g === "string"; }).slice(0, 200) : [];
      prefs.fold = Array.isArray(pr.fold) ? pr.fold.filter(function (g) { return typeof g === "string"; }).slice(0, 200) : [];
    }
  } catch (e) {}
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function toggle(list, key) {
    var i = prefs[list].indexOf(key);
    if (i >= 0) prefs[list].splice(i, 1); else prefs[list].push(key);
    savePrefs();
    H.refreshPlaces();
  }

  // ---------- groups ----------
  function placesIn(gid) {
    return H.places().filter(function (p) { return FC.groupOf(data, p.id) === gid; });
  }
  function assign(pid, gid, quiet) {
    if (!FC.PID_RE.test(pid)) return false;
    if (gid && !data.groups[gid]) gid = "";
    var cur = data.pins[pid];
    if (cur && cur.g === gid) return true;
    data.pins[pid] = stamp({ g: gid, m: cur ? cur.m : 0 });
    var ok = saveData();
    if (ok && !quiet) toast(gid ? t("moved", { g: data.groups[gid].name }) : t("ungrouped"));
    return ok;
  }
  function makeGroup(name, color) {
    if (Object.keys(data.groups).length >= FC.LIM.groups) { toast(t("full")); return ""; }
    var id = FC.newId();
    while (data.groups[id] || data.tombs[id]) id = FC.newId();
    data.groups[id] = stamp({ name: FC.cleanName(name), color: color || FC.COLORS[0], m: 0 });
    return saveData() ? id : "";
  }
  function deleteGroup(gid) {
    if (!data.groups[gid]) return;
    var now = Math.max(Date.now(), data.groups[gid].m + 1);
    delete data.groups[gid];
    data.tombs[gid] = now;
    prefs.hide = prefs.hide.filter(function (g) { return g !== gid; });
    prefs.fold = prefs.fold.filter(function (g) { return g !== gid; });
    savePrefs();
    if (saveData()) toast(t("deleted"));
  }

  // ---------- dialogs ----------
  function dialog(title) {
    var dlg = el("dialog", "osm-dlg fav-dlg");
    dlg.appendChild(el("h3", "", title));
    function close() { if (dlg.open) dlg.close(); dlg.remove(); }
    dlg.addEventListener("cancel", function (ev) { ev.preventDefault(); close(); });
    dlg.addEventListener("click", function (e) {
      if (e.target !== dlg) return;
      var r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    });
    return { dlg: dlg, close: close, show: function () { document.body.appendChild(dlg); dlg.showModal(); } };
  }
  function dot(color) {
    var d = el("span", "fav-dot");
    d.style.background = color;
    return d;
  }
  function optRow(label, color, on, fn) {
    var b = button("", "fav-opt" + (on ? " on" : ""), fn);
    b.appendChild(color ? dot(color) : el("span", "fav-dot fav-dot-none"));
    b.appendChild(el("span", "fav-opt-name", label));
    b.setAttribute("aria-pressed", on ? "true" : "false");
    return b;
  }

  // Which group for this place: the groups, "No group", "New group".
  function pick(place) {
    if (!place || !FC.PID_RE.test(place.id)) return;
    var cur = FC.groupOf(data, place.id);
    var d = dialog(t("pick", { n: place.name || "?" }));
    var list = el("div", "fav-opts");
    FC.order(data, LANG).forEach(function (g) {
      list.appendChild(optRow(data.groups[g].name, data.groups[g].color, g === cur, function () { d.close(); assign(place.id, g); }));
    });
    list.appendChild(optRow(t("none"), "", cur === "", function () { d.close(); assign(place.id, ""); }));
    d.dlg.appendChild(list);
    var row = el("div", "osm-actions");
    row.appendChild(button(t("new"), "osm-btn primary", function () {
      d.close();
      editGroup("", function (gid) { if (gid) assign(place.id, gid); });
    }));
    row.appendChild(button(t("cancel"), "osm-btn", d.close));
    d.dlg.appendChild(row);
    d.show();
  }

  // Name + colour; `after(gid)` once saved. Deleting from here too.
  function editGroup(gid, after) {
    var g = gid ? data.groups[gid] : null;
    if (gid && !g) return;
    var d = dialog(g ? t("edit") : t("new"));
    var lab = el("label", "osm-lab", t("name"));
    var inp = el("input", "osm-in fav-name");
    inp.type = "text";
    inp.maxLength = FC.LIM.name;
    inp.value = g ? g.name : "";
    lab.appendChild(inp);
    d.dlg.appendChild(lab);
    d.dlg.appendChild(el("span", "osm-lab", t("color")));
    var used = {};
    Object.keys(data.groups).forEach(function (k) { used[data.groups[k].color] = 1; });
    var color = g ? g.color : (FC.COLORS.filter(function (c) { return !used[c]; })[0] || FC.COLORS[0]);
    var sw = el("div", "trk-colors");
    FC.COLORS.forEach(function (c) {
      var b = button("", "trk-color" + (c === color ? " on" : ""), function () {
        color = c;
        sw.querySelectorAll(".trk-color").forEach(function (x) { x.classList.toggle("on", x === b); });
      });
      b.style.background = c;
      b.setAttribute("aria-label", t("color") + " " + c);
      sw.appendChild(b);
    });
    d.dlg.appendChild(sw);
    var err = el("div", "fav-err");
    err.hidden = true;
    d.dlg.appendChild(err);
    function ok() {
      var name = FC.cleanName(inp.value);
      if (!name) { err.textContent = t("noname"); err.hidden = false; return; }
      var same = FC.findByName(data, name, LANG);
      if (same && same !== gid) { err.textContent = t("dup"); err.hidden = false; return; }
      d.close();
      if (g) {
        if (name === g.name && color === g.color) { if (after) after(gid); return; }
        g.name = name; g.color = color; stamp(g);
        if (saveData() && after) after(gid);
      } else {
        var id = makeGroup(name, color);
        if (after) after(id);
      }
    }
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ok(); } });
    var row = el("div", "osm-actions");
    row.appendChild(button(t("save"), "osm-btn primary", ok));
    row.appendChild(button(t("cancel"), "osm-btn", d.close));
    d.dlg.appendChild(row);
    if (g) {
      var row2 = el("div", "osm-actions");
      // Two steps instead of a native confirm (R14): the first tap
      // shows the question, the second deletes.
      var ask = el("p", "fav-ask", t("del.ask", { n: g.name }));
      ask.hidden = true;
      d.dlg.appendChild(ask);
      row2.appendChild(button(t("delete"), "osm-btn danger fav-del", function () {
        if (ask.hidden) { ask.hidden = false; this.classList.add("armed"); return; }
        d.close();
        deleteGroup(gid);
        if (after) after("");
      }));
      d.dlg.appendChild(row2);
    }
    d.show();
    inp.focus();
  }

  // The Groups button in Saved places: every group with its count.
  function manage() {
    var d = dialog(t("manage"));
    var list = el("div", "fav-opts");
    function paint() {
      list.textContent = "";
      var ids = FC.order(data, LANG);
      if (!ids.length) list.appendChild(el("p", "fav-empty", t("manage.empty")));
      ids.forEach(function (g) {
        var b = optRow(data.groups[g].name, data.groups[g].color, false, function () {
          editGroup(g, paint);
        });
        b.classList.add("fav-mrow");
        b.appendChild(el("span", "fav-count", count(placesIn(g).length)));
        list.appendChild(b);
      });
    }
    paint();
    d.dlg.appendChild(list);
    var row = el("div", "osm-actions");
    row.appendChild(button(t("new"), "osm-btn primary", function () { editGroup("", paint); }));
    row.appendChild(button(t("close"), "osm-btn", d.close));
    d.dlg.appendChild(row);
    d.show();
  }

  // ---------- export / import ----------
  function fileName(name) {
    return (String(name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "places") + ".gpx";
  }
  function exportGroup(gid) {
    var places = placesIn(gid);
    if (!places.length) { toast(t("empty")); return; }
    var name = gid ? data.groups[gid].name : t("none");
    var dlg = null;
    try { dlg = window.orosDialog || (window.parent && window.parent.orosDialog) || null; } catch (e) { dlg = window.orosDialog || null; }
    if (!dlg || typeof dlg.saveFile !== "function") { toast(t("nodlg")); return; }
    var blob = new Blob([FC.toGpx(name, places)], { type: "application/gpx+xml" });
    return dlg.saveFile({ blob: blob, filename: fileName(name), mime: "application/gpx+xml",
      types: [{ description: "GPX", accept: { "application/gpx+xml": [".gpx"] } }] });
  }

  // Waypoints of a parsed file → a dialog: which group, then save.
  function importWpts(tr, file) {
    var list = FC.fromWpts(tr && tr.wpts, 1000);
    if (!list.length) { toast(t("imp.bad")); return false; }
    var base = FC.cleanName((tr && tr.name) || String(file || "").replace(/\.[a-z0-9]+$/i, "")) || t("saved");
    var existing = FC.findByName(data, base, LANG);
    var choice = existing || "+new";
    var d = dialog(t("imp.title"));
    d.dlg.appendChild(el("p", "fav-found", t("imp.found", { n: list.length, f: base })));
    d.dlg.appendChild(el("span", "osm-lab", t("imp.into")));
    var opts = el("div", "fav-opts");
    function opt(key, label, color) {
      var b = optRow(label, color, key === choice, function () {
        choice = key;
        opts.querySelectorAll(".fav-opt").forEach(function (x) {
          x.classList.toggle("on", x === b);
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
      });
      opts.appendChild(b);
    }
    if (!existing) opt("+new", t("imp.newgrp", { f: base }), "");
    FC.order(data, LANG).forEach(function (g) { opt(g, data.groups[g].name, data.groups[g].color); });
    opt("", t("none"), "");
    d.dlg.appendChild(opts);
    var row = el("div", "osm-actions");
    row.appendChild(button(t("imp.go"), "osm-btn primary fav-imp-go", function () {
      d.close();
      var gid = choice;
      if (gid === "+new") {
        var used = {};
        Object.keys(data.groups).forEach(function (k) { used[data.groups[k].color] = 1; });
        gid = makeGroup(base, FC.COLORS.filter(function (c) { return !used[c]; })[0] || FC.COLORS[0]);
        if (!gid) return;
      }
      var n = H.addPlaces(list);
      if (!n) return;
      list.forEach(function (p) {
        var pid = H.placeId(p.lat, p.lon), cur = data.pins[pid];
        if (!cur || cur.g !== gid) data.pins[pid] = stamp({ g: gid, m: cur ? cur.m : 0 });
      });
      saveData();
      toast(t("imp.done", { n: n }));
    }));
    row.appendChild(button(t("cancel"), "osm-btn", d.close));
    d.dlg.appendChild(row);
    d.show();
    return true;
  }
  // "Import from another app" (import-ui.js): the lists of the file
  // become groups (an existing group with the same name is reused) and
  // the NEW places get their pin, in one write. byList: { list name:
  // [place ids] } ("" = no group). Returns what undoPins needs.
  function importPins(byList) {
    var undo = { groups: [], pins: {} }, used = {};
    Object.keys(data.groups).forEach(function (k) { used[data.groups[k].color] = 1; });
    Object.keys(byList || {}).forEach(function (name) {
      var gid = name ? FC.findByName(data, name, LANG) : "";
      if (name && !gid && Object.keys(data.groups).length < FC.LIM.groups) {
        gid = FC.newId();
        while (data.groups[gid] || data.tombs[gid]) gid = FC.newId();
        var color = FC.COLORS.filter(function (c) { return !used[c]; })[0] || FC.COLORS[undo.groups.length % FC.COLORS.length];
        used[color] = 1;
        data.groups[gid] = stamp({ name: FC.cleanName(name), color: color, m: 0 });
        undo.groups.push(gid);
      }
      if (!gid) return;
      byList[name].forEach(function (pid) {
        if (!FC.PID_RE.test(pid) || undo.pins[pid] !== undefined) return;
        var cur = data.pins[pid];
        undo.pins[pid] = cur ? cur.g : null;
        data.pins[pid] = stamp({ g: gid, m: cur ? cur.m : 0 });
      });
    });
    if (undo.groups.length || Object.keys(undo.pins).length) saveData();
    return undo;
  }
  // Undo of importPins: new groups get a tombstone, each pin its old
  // group back (newer stamps, so a sync that has the import loses).
  function undoPins(undo) {
    if (!undo) return;
    var n = 0;
    (undo.groups || []).forEach(function (gid) {
      var g = data.groups[gid];
      if (!g) return;
      delete data.groups[gid];
      data.tombs[gid] = Math.max(Date.now(), g.m + 1);
      n++;
    });
    Object.keys(undo.pins || {}).forEach(function (pid) {
      var cur = data.pins[pid];
      if (!cur) return;
      data.pins[pid] = stamp({ g: undo.pins[pid] || "", m: cur.m });
      n++;
    });
    if (n) saveData();
  }
  function pinRoom() { return FC.LIM.pins - Object.keys(data.pins).length; }
  // An .orosmap (package-ui.js): its groups always come in as NEW
  // groups (fresh ids; a name the user has already gets " (2)"…), with
  // their colour, and the given places (the ones the file added) get
  // their pin. list: [{ name, color, pids }]. Returns what undoPins
  // needs; a group that does not fit leaves its places ungrouped.
  function importGroups(list) {
    var undo = { groups: [], pins: {} }, used = {};
    Object.keys(data.groups).forEach(function (k) { used[data.groups[k].color] = 1; });
    (list || []).forEach(function (x) {
      var base = FC.cleanName(x && x.name);
      if (!base || !x.pids || !x.pids.length || Object.keys(data.groups).length >= FC.LIM.groups) return;
      var name = base, n = 2;
      while (FC.findByName(data, name, LANG) && n < 1000) {
        var tail = " (" + n++ + ")";
        name = base.slice(0, FC.LIM.name - tail.length).trim() + tail;
      }
      var gid = FC.newId();
      while (data.groups[gid] || data.tombs[gid]) gid = FC.newId();
      var color = FC.COLORS.indexOf(x.color) >= 0 ? x.color
        : (FC.COLORS.filter(function (c) { return !used[c]; })[0] || FC.COLORS[undo.groups.length % FC.COLORS.length]);
      used[color] = 1;
      data.groups[gid] = stamp({ name: name, color: color, m: 0 });
      undo.groups.push(gid);
      x.pids.forEach(function (pid) {
        if (!FC.PID_RE.test(pid) || undo.pins[pid] !== undefined) return;
        var cur = data.pins[pid];
        undo.pins[pid] = cur ? cur.g : null;
        data.pins[pid] = stamp({ g: gid, m: cur ? cur.m : 0 });
      });
    });
    if (undo.groups.length) saveData();
    return undo;
  }

  var fileIn = el("input", "");
  fileIn.type = "file";
  fileIn.accept = ".gpx,.kml,.geojson,.json,.kmz,.csv,.zip,application/gpx+xml,application/vnd.google-earth.kml+xml,application/geo+json";
  fileIn.hidden = true;
  fileIn.id = "fav-file";
  fileIn.addEventListener("change", function () {
    var f = fileIn.files && fileIn.files[0];
    fileIn.value = "";
    if (f) importFile([f]);
  });
  // Google Takeout, KMZ… → the preview of import-ui.js; a GPX, KML or
  // GeoJSON file → its waypoints, as before.
  function importFile(files) {
    var UI = window.__orosMapsImport;
    if (UI) return UI.files(files, plainFile);
    return plainFile(files);
  }
  function plainFile(files) {
    var f = files && files[0];
    if (!f || !T) return Promise.resolve();
    if (f.size > T.LIM.chars) { toast(t("imp.big")); return Promise.resolve(); }
    return f.text().then(function (txt) {
      var tr = T.parseAny(txt, f.name);
      if (!tr) { toast(t("imp.bad")); return; }
      importWpts(tr, f.name);
    }, function () { toast(t("imp.bad")); });
  }
  function pickImport() {
    var UI = window.__orosMapsImport;
    if (UI) UI.pick(importFile); else fileIn.click();
  }

  // ---------- pieces for maps.js (renderSavedLayer / renderPlacesList) ----------
  function header(gid, places) {
    var groups = Object.keys(data.groups).length;
    if (!gid && !groups) return null;          // no groups at all: the plain list
    var g = gid ? data.groups[gid] : null;
    var foldKey = gid || NONE, folded = prefs.fold.indexOf(foldKey) >= 0;
    var li = el("li", "fav-head" + (folded ? " folded" : ""));
    li.dataset.g = gid;
    var f = button("", "fav-fold", function () { toggle("fold", foldKey); });
    f.setAttribute("aria-expanded", folded ? "false" : "true");
    f.title = folded ? t("unfold") : t("fold");
    f.innerHTML = ICON_CARET;
    f.appendChild(g ? dot(g.color) : el("span", "fav-dot fav-dot-none"));
    f.appendChild(el("span", "fav-head-name", g ? g.name : t("none")));
    f.appendChild(el("span", "fav-count", String(places.length)));
    li.appendChild(f);
    if (gid) {
      var hid = prefs.hide.indexOf(gid) >= 0;
      var eye = button("", "fav-eye" + (hid ? " off" : ""), function () { toggle("hide", gid); });
      eye.innerHTML = hid ? ICON_EYE_OFF : ICON_EYE;
      eye.title = hid ? t("show") : t("hide");
      eye.setAttribute("aria-label", eye.title);
      eye.setAttribute("aria-pressed", hid ? "false" : "true");
      li.appendChild(eye);
      var ed = button("", "fav-edit", function () { editGroup(gid); });
      ed.innerHTML = ICON_PEN;
      ed.title = t("edit");
      ed.setAttribute("aria-label", t("edit"));
      li.appendChild(ed);
    }
    var ex = button("", "fav-exp", function () { exportGroup(gid); });
    ex.innerHTML = ICON_DL;
    ex.title = t("export");
    ex.setAttribute("aria-label", t("export"));
    li.appendChild(ex);
    return li;
  }
  function groupButton(p) {
    var b = button("", "p-grp", function (e) { e.stopPropagation(); pick(p); });
    b.innerHTML = ICON;
    b.title = t("label");
    b.setAttribute("aria-label", t("label"));
    return b;
  }

  function boot() {
    loadData();
    document.body.appendChild(fileIn);
    var aside = document.getElementById("places");
    var list = document.getElementById("places-list");
    if (aside && list) {
      var bar = el("div", "fav-bar");
      var gb = button("", "osm-btn fav-groups", manage);
      gb.innerHTML = ICON;
      gb.appendChild(el("span", "", t("groups")));
      bar.appendChild(gb);
      bar.appendChild(button(t("import"), "osm-btn fav-import", pickImport));
      aside.insertBefore(bar, list);
    }
    var api = syncApi();
    if (api && typeof api.registerSlice === "function") api.registerSlice("mapsfav", sliceGet, sliceSet, DATA_KEY, FC.merge);
  }

  window.__orosMapsFav = {
    ICON: ICON, label: t("label"),
    colorOf: function (pid) { var g = FC.groupOf(data, pid); return g ? data.groups[g].color : ""; },
    hidden: function (pid) { var g = FC.groupOf(data, pid); return !!g && prefs.hide.indexOf(g) >= 0; },
    collapsed: function (gid) {
      if (!gid && !Object.keys(data.groups).length) return false;
      return prefs.fold.indexOf(gid || NONE) >= 0;
    },
    sections: function (places) { return FC.sections(data, places, LANG); },
    header: header, groupButton: groupButton, pick: pick,
    // hooks for tracks.js and the tests
    importWpts: importWpts, manage: manage, editGroup: editGroup,
    importPins: importPins, importGroups: importGroups, undoPins: undoPins, pinRoom: pinRoom, groupRoom: function () { return FC.LIM.groups - Object.keys(data.groups).length; },
    assign: assign, makeGroup: makeGroup, deleteGroup: deleteGroup, exportGroup: exportGroup,
    data: function () { return FC.normalize(data); }, prefs: function () { return JSON.parse(JSON.stringify(prefs)); }
  };
  boot();
  H.refreshPlaces();
})();
