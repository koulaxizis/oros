// ============================================================
// orOS Maps — hh.js (places shared with a household, BR-HH)
//
// Each household has a folder of places (favourite shops, the doctor,
// the kids' school, holiday spots) with a note, shared live between
// its people through the household (window.parent.orosHousehold,
// household/engine.js; hh-core.js turns the document into places):
//   - "Household" in a place's popup puts it in a household's folder
//     (name and note can be changed; the first place makes the folder);
//   - the folders show after the own saved places in the list (open,
//     route, edit, remove), and their pins on the map in their own
//     colour with the note and who changed it last;
//   - "Stop sharing" on a folder takes it out of the household for
//     everyone and keeps its places as own saved places; the others
//     can bring it back from Household for 30 days.
// No live location: a place is only ever where someone put it.
// Safety: user text goes on the page with textContent only.
// ============================================================
(function () {
  "use strict";
  var HC = window.OrosMapsHH, Core = window.OrosHouseCore, H = window.__orosMapsHost;
  if (!HC || !Core || !H || !H.map || typeof H.routeTo !== "function" || !window.L) return;
  function hh() {
    try {
      var p = window.parent;
      return p && p !== window && p.orosHousehold && typeof p.orosHousehold.docs === "function" ? p.orosHousehold : null;
    } catch (e) { return null; }
  }
  if (!hh()) return;
  var LANG = window.orosI18n ? window.orosI18n.lang() : (H.lang === "el" ? "el" : "en");
  var COLOR = "#e5a03b";

  var STR = {
    en: {
      "hh.btn": "Household", "hh.in": "In {hh}", "hh.add": "Add to the household's places",
      "hh.edit": "Household place", "hh.which": "Household", "hh.name": "Name", "hh.note": "Note",
      "hh.notePh": "Opening hours, which entrance, who to ask for…",
      "hh.editBtn": "Edit", "hh.save": "Save", "hh.cancel": "Cancel", "hh.remove": "Remove", "hh.route": "Route",
      "hh.nohh": "Make or join a household first, in the Household app.", "hh.open": "Open Household",
      "hh.folder": "Places", "hh.added": "Added to {hh}", "hh.saved": "Saved", "hh.removed": "Removed from {hh}",
      "hh.undo": "Undo", "hh.fail": "Could not reach the household. Try again.",
      "hh.by": "Last changed by {n}", "hh.count1": "1 place", "hh.count": "{n} places",
      "hh.stop": "Stop sharing", "hh.stop.t": "Stop sharing the places?",
      "hh.stop.x": "The folder leaves {hh} for everyone, and its places become your own saved places. The others can bring it back from Household for 30 days.",
      "hh.stopped": "Sharing stopped. The places are in your saved places.",
      "hh.empty": "No places yet. Open a place's pin and choose Household to add one."
    },
    el: {
      "hh.btn": "Νοικοκυριό", "hh.in": "Στο «{hh}»", "hh.add": "Προσθήκη στις τοποθεσίες του νοικοκυριού",
      "hh.edit": "Τοποθεσία του νοικοκυριού", "hh.which": "Νοικοκυριό", "hh.name": "Όνομα", "hh.note": "Σημείωση",
      "hh.notePh": "Ώρες λειτουργίας, ποια είσοδος, ποιον να ζητήσεις…",
      "hh.editBtn": "Επεξεργασία", "hh.save": "Αποθήκευση", "hh.cancel": "Άκυρο", "hh.remove": "Αφαίρεση", "hh.route": "Διαδρομή",
      "hh.nohh": "Φτιάξε πρώτα ένα νοικοκυριό ή μπες σε ένα, από την εφαρμογή Νοικοκυριό.", "hh.open": "Άνοιγμα Νοικοκυριού",
      "hh.folder": "Τοποθεσίες", "hh.added": "Προστέθηκε στο «{hh}»", "hh.saved": "Αποθηκεύτηκε", "hh.removed": "Αφαιρέθηκε από το «{hh}»",
      "hh.undo": "Αναίρεση", "hh.fail": "Δεν έγινε σύνδεση με το νοικοκυριό. Δοκίμασε ξανά.",
      "hh.by": "Τελευταία αλλαγή: {n}", "hh.count1": "1 τοποθεσία", "hh.count": "{n} τοποθεσίες",
      "hh.stop": "Διακοπή κοινής χρήσης", "hh.stop.t": "Διακοπή κοινής χρήσης των τοποθεσιών;",
      "hh.stop.x": "Ο φάκελος φεύγει από το «{hh}» για όλους και οι τοποθεσίες του γίνονται δικές σου αποθηκευμένες. Οι άλλοι μπορούν να τον φέρουν πίσω από το Νοικοκυριό για 30 ημέρες.",
      "hh.stopped": "Η κοινή χρήση σταμάτησε. Οι τοποθεσίες είναι στις αποθηκευμένες σου.",
      "hh.empty": "Δεν υπάρχουν τοποθεσίες ακόμα. Άνοιξε την πινέζα μιας τοποθεσίας και διάλεξε Νοικοκυριό για να προσθέσεις."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "maps", LANG);
  function t(k, vars) {
    k = "hh." + k;
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
  var ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>';

  // ---------- the folders ----------
  var folders = [];       // [{ box, id, hh, view, places }]
  var layer = window.L.layerGroup().addTo(H.map);
  function read() {
    var h = hh(), out = [];
    if (!h) return;
    h.docs("places").forEach(function (d) {
      if (!d.ready) return;
      var v = h.view(d.box, d.id);
      if (!v) return;
      out.push({ box: d.box, id: d.id, hh: d.hh || "", view: v, places: HC.build(v) });
    });
    out.sort(function (a, b) { return a.hh.localeCompare(b.hh) || (a.id < b.id ? -1 : 1); });
    folders = out;
  }
  function findPlace(lat, lon) {
    var id = HC.itemId(lat, lon), hit = null;
    folders.forEach(function (f) { f.places.forEach(function (p) { if (!hit && p.id === id) hit = { f: f, p: p }; }); });
    return hit;
  }
  function byName(f, p) {
    var h = hh();
    if (!h || !p.by || p.by === h.me(f.box)) return "";
    var m = h.member(f.box, p.by);
    return m ? m.name : "";
  }

  // ---------- the map ----------
  function paint() {
    layer.clearLayers();
    folders.forEach(function (f) {
      f.places.forEach(function (p) {
        var m = window.L.marker([p.lat, p.lon], { icon: H.markerIcon(COLOR) });
        m.bindPopup(function () { return popupOf(f, p, function () { H.map.closePopup(); }); }, { maxWidth: 280 });
        m.__hh = p.id;
        layer.addLayer(m);
      });
    });
  }
  function popupOf(f, p, close) {
    var wrap = el("div", "hh-pop");
    wrap.appendChild(el("b", "", p.name));
    if (p.sub) wrap.appendChild(el("div", "hh-sub", p.sub));
    if (p.note) wrap.appendChild(el("div", "hh-note", p.note));
    var meta = el("div", "hh-sub", t("in", { hh: f.hh }));
    var who = byName(f, p);
    if (who) meta.textContent += " · " + t("by", { n: who });
    wrap.appendChild(meta);
    var acts = el("div", "pop-actions");
    acts.appendChild(button(t("route"), "", function () { close(); H.routeTo({ lat: p.lat, lon: p.lon, name: p.name, sub: p.sub }); }));
    acts.appendChild(button(t("editBtn"), "", function () { close(); editDialog(p, f); }));
    acts.appendChild(button(t("remove"), "", function () { close(); remove(f, p); }));
    wrap.appendChild(acts);
    return wrap;
  }

  // ---------- add, edit, remove ----------
  function dialog(title) {
    var dlg = el("dialog", "osm-dlg fav-dlg hh-dlg");
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
  // place: { lat, lon, name, sub, note? }; f: its folder when it is in one
  function editDialog(place, f) {
    var h = hh();
    if (!h) return;
    var hhs = h.list();
    var d = dialog(f ? t("edit") : t("add"));
    if (!f && !hhs.length) {
      d.dlg.appendChild(el("p", "osm-hint", t("nohh")));
      var r0 = el("div", "osm-actions");
      r0.appendChild(button(t("open"), "osm-btn primary", function () {
        d.close();
        try { window.parent.__orosOpenAt("household", null); } catch (e) {}
      }));
      r0.appendChild(button(t("cancel"), "osm-btn", d.close));
      d.dlg.appendChild(r0);
      d.show();
      return;
    }
    var sel = null;
    if (!f && hhs.length > 1) {
      var ls = el("label", "osm-lab", t("which"));
      sel = el("select", "osm-in");
      sel.id = "hh-box";
      hhs.forEach(function (x) { var o = el("option", "", x.name || "?"); o.value = x.box; sel.appendChild(o); });
      ls.appendChild(sel);
      d.dlg.appendChild(ls);
    }
    var ln = el("label", "osm-lab", t("name"));
    var name = el("input", "osm-in");
    name.id = "hh-name";
    name.type = "text";
    name.maxLength = HC.LIM.name;
    name.value = place.name || "";
    ln.appendChild(name);
    d.dlg.appendChild(ln);
    var lt = el("label", "osm-lab", t("note"));
    var note = el("textarea", "osm-in");
    note.id = "hh-note";
    note.rows = 3;
    note.maxLength = HC.LIM.note;
    note.placeholder = t("notePh");
    note.value = place.note || "";
    lt.appendChild(note);
    d.dlg.appendChild(lt);
    var row = el("div", "osm-actions");
    var ok = button(t("save"), "osm-btn primary", function () {
      var box = f ? f.box : (sel ? sel.value : hhs[0].box);
      var val = { lat: place.lat, lon: place.lon, name: name.value, sub: place.sub || "", note: note.value };
      ok.disabled = true;
      put(box, f, val).then(function (where) {
        d.close();
        toast(f ? t("saved") : t("added", { hh: where }));
      }, function () { ok.disabled = false; toast(t("fail")); });
    });
    row.appendChild(ok);
    row.appendChild(button(t("cancel"), "osm-btn", d.close));
    d.dlg.appendChild(row);
    d.show();
    name.focus();
  }
  // Adds or updates one place in the household `box` (its folder, or
  // a new one when the household has none yet). Resolves the
  // household's name.
  function put(box, f, val) {
    var h = hh();
    if (!h) return Promise.reject(new Error("nohh"));
    var name = ((h.list().filter(function (x) { return x.box === box; })[0]) || {}).name || "";
    if (making[box]) return making[box].then(function () { return put(box, null, val); });
    read();                       // fresh: a folder made a moment ago counts
    var folder = (f && folders.filter(function (x) { return x.id === f.id; })[0]) || folders.filter(function (x) { return x.box === box; })[0];
    if (folder) {
      var c = HC.change(folder.view, val);
      return Promise.resolve(c ? h.change(folder.box, folder.id, c) : true).then(function () { return name; });
    }
    var first = HC.change(null, val);
    if (!first) return Promise.reject(new Error("bad"));
    var done = function () { delete making[box]; read(); };
    making[box] = Promise.resolve(h.share(box, "places", t("folder"), first)).then(done, function (e) { done(); throw e; });
    return making[box].then(function () { return name; });
  }
  var making = {};                // box → the folder being made (one folder per household)
  function remove(f, p) {
    var h = hh();
    if (!h) return;
    Promise.resolve(h.change(f.box, f.id, { del: [p.id] })).then(function () {
      var back = { lat: p.lat, lon: p.lon, name: p.name, sub: p.sub, note: p.note };
      if (H.localToast) H.localToast(t("removed", { hh: f.hh }), t("undo"), function () { put(f.box, null, back).catch(function () {}); });
      else toast(t("removed", { hh: f.hh }));
    }, function () { toast(t("fail")); });
  }
  function stop(f) {
    var h = hh();
    if (!h) return;
    var d = dialog(t("stop.t"));
    d.dlg.appendChild(el("p", "osm-hint", t("stop.x", { hh: f.hh })));
    var row = el("div", "osm-actions");
    row.appendChild(button(t("stop"), "osm-btn primary", function () {
      d.close();
      Promise.resolve(h.unshare(f.box, f.id)).then(function () { copies(); toast(t("stopped")); }, function () { toast(t("fail")); });
    }));
    row.appendChild(button(t("cancel"), "osm-btn", d.close));
    d.dlg.appendChild(row);
    d.show();
  }
  // A folder this person stopped sharing (or of a household left):
  // its places become own saved places (a saved one stays as it is).
  function copies() {
    var h = hh();
    if (!h) return;
    h.archived("places").forEach(function (a) {
      if (!a.take) return;
      var list = HC.copyOf(Core.view(a.doc));
      if (list.length && typeof H.importPlaces === "function") H.importPlaces(list);
      h.dropArchived(a.box, a.id);
    });
  }

  // ---------- the list (maps.js renderPlacesList) ----------
  function listInto(ul, hidePanel) {
    folders.forEach(function (f) {
      var head = el("li", "fav-head hh-head");
      var lab = el("span", "fav-head-name");
      lab.insertAdjacentHTML("beforeend", ICON);
      lab.appendChild(document.createTextNode(" " + (f.hh || t("folder"))));
      head.appendChild(lab);
      head.appendChild(el("span", "fav-count", String(f.places.length)));
      var st = button(t("stop"), "hh-stop", function () { stop(f); });
      head.appendChild(st);
      ul.appendChild(head);
      if (!f.places.length) { ul.appendChild(el("li", "hh-empty", t("empty"))); return; }
      f.places.forEach(function (p) {
        var li = el("li", "place hh-place");
        var pin = el("span", "p-pin");
        pin.style.color = COLOR;
        pin.innerHTML = ICON;
        li.appendChild(pin);
        var body = el("div", "p-body");
        body.appendChild(el("div", "p-name", p.name));
        var sub = [p.note ? p.note.replace(/\s+/g, " ") : "", p.sub].filter(Boolean).join(" · ");
        if (sub) body.appendChild(el("div", "p-sub", sub));
        li.appendChild(body);
        li.addEventListener("click", function () {
          if (hidePanel) hidePanel();
          H.map.flyTo([p.lat, p.lon], 15);
          layer.eachLayer(function (mk) { if (mk.__hh === p.id) mk.openPopup(); });
        });
        var ed = button("", "p-ren", function (e) { e.stopPropagation(); editDialog(p, f); });
        ed.title = t("editBtn");
        ed.setAttribute("aria-label", t("editBtn") + ": " + p.name);
        ed.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
        li.appendChild(ed);
        var del = button("", "p-del", function (e) { e.stopPropagation(); remove(f, p); });
        del.title = t("remove");
        del.setAttribute("aria-label", t("remove") + ": " + p.name);
        del.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        li.appendChild(del);
        ul.appendChild(li);
      });
    });
  }
  // The popup button (maps.js bindPlacePopup).
  function popupButton(place, close) {
    var hit = findPlace(place.lat, place.lon);
    var b = button("", "pop-hh", function () {
      close();
      var now = findPlace(place.lat, place.lon);
      editDialog(now ? now.p : place, now ? now.f : null);
    });
    b.innerHTML = ICON + "<span></span>";
    b.querySelector("span").textContent = hit ? t("in", { hh: hit.f.hh }) : t("btn");
    return b;
  }

  // ---------- refresh ----------
  var queued = false, shown = "[]";
  function refresh() {
    if (queued) return;
    queued = true;
    setTimeout(function () {
      queued = false;
      read();
      copies();
      var sig = JSON.stringify(folders.map(function (f) { return [f.box, f.id, f.hh, f.places]; }));
      if (sig === shown) return;
      shown = sig;
      paint();
      if (typeof H.refreshPlaces === "function") H.refreshPlaces();
    }, 0);
  }
  window.__orosMapsHH = {
    popupButton: popupButton, listInto: listInto,
    count: function () { return folders.length; }
  };
  var h0 = hh();
  var off = h0.on(function (e) {
    if (e && (e.type === "doc" || e.type === "list" || e.type === "roster" || e.type === "archive")) refresh();
  });
  window.addEventListener("pagehide", function () { try { off(); } catch (e) {} });
  Promise.resolve(h0.ready()).then(refresh, refresh);
})();
