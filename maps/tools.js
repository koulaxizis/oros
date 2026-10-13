// ============================================================
// orOS Maps — tools.js (OsmAnd style tools, maps wave 10A, v1.0.0)
//
//   - Measure (ruler): long-press menu › "Measure distance" opens the
//     Measure sheet with that point; each tap on the map adds one.
//     Points can be dragged. Shows the total length, the last
//     segment, and with "Close the shape" the area and perimeter.
//     Nothing is saved.
//   - Parking: long-press menu › "I parked here" asks for a reminder
//     (none, 30 min, 1 h, 2 h or a time of day) and a short note
//     ("level -2, spot 14"). A P pin marks the car; its popup walks
//     you there or removes it. Device-local (localStorage
//     "oros-maps-parking"): the car is where this phone is. The
//     reminder is a notification from the shell (parkCheckTick in
//     shell.js), so it comes with Maps closed too.
//
// Safety: user text goes on the page with textContent only.
// ============================================================
(function () {
  "use strict";
  var TC = window.OrosMapsTools;
  var H = window.__orosMapsHost;
  if (!TC || !H || !H.map || !window.L) return;
  var map = H.map;
  var LANG = H.lang === "el" ? "el" : "en";
  var PARK_KEY = "oros-maps-parking";

  var STR = {
    en: {
      "ctx.measure": "Measure distance", "ctx.park": "I parked here", "ctx.car": "Show my parked car",
      "m.title": "Measure", "m.hint": "Tap the map to add points. Drag a point to move it.",
      "m.total": "Distance", "m.last": "Last part {d}", "m.points": "{n} points",
      "m.area": "Area", "m.perim": "Perimeter {d}",
      "m.close": "Close the shape", "m.open": "Open the shape",
      "m.undo": "Undo", "m.clear": "Clear", "m.more": "Add at least one more point.",
      "m.max": "That's the most points a measurement can have.",
      "p.title": "Parked here", "p.remind": "Remind me", "p.none": "No reminder",
      "p.30": "In 30 min", "p.60": "In 1 hour", "p.120": "In 2 hours", "p.at": "At a time",
      "p.note": "Note (optional)", "p.note.ph": "e.g. level -2, spot 14",
      "p.save": "Save", "p.cancel": "Cancel", "p.badtime": "Pick a time for the reminder.",
      "p.saved": "Parking saved", "p.savedat": "Parking saved, reminder at {t}",
      "p.pin": "My parked car", "p.since": "Parked at {t}", "p.until": "Reminder at {t}",
      "p.due": "Time's up since {t}",
      "p.walk": "Walk there", "p.change": "Change", "p.remove": "I left",
      "p.removed": "Parking removed", "p.full": "Could not save: the device storage is full.",
      "close": "Close"
    },
    el: {
      "ctx.measure": "Μέτρηση απόστασης", "ctx.park": "Πάρκαρα εδώ", "ctx.car": "Πού πάρκαρα",
      "m.title": "Μέτρηση", "m.hint": "Πάτα στον χάρτη για να προσθέσεις σημεία. Σύρε ένα σημείο για να το μετακινήσεις.",
      "m.total": "Απόσταση", "m.last": "Τελευταίο κομμάτι {d}", "m.points": "{n} σημεία",
      "m.area": "Εμβαδόν", "m.perim": "Περίμετρος {d}",
      "m.close": "Κλείσιμο σχήματος", "m.open": "Άνοιγμα σχήματος",
      "m.undo": "Αναίρεση", "m.clear": "Καθαρισμός", "m.more": "Πρόσθεσε τουλάχιστον ένα σημείο ακόμα.",
      "m.max": "Μια μέτρηση δεν μπορεί να έχει περισσότερα σημεία.",
      "p.title": "Πάρκαρα εδώ", "p.remind": "Υπενθύμιση", "p.none": "Χωρίς υπενθύμιση",
      "p.30": "Σε 30 λεπτά", "p.60": "Σε 1 ώρα", "p.120": "Σε 2 ώρες", "p.at": "Σε συγκεκριμένη ώρα",
      "p.note": "Σημείωση (προαιρετικά)", "p.note.ph": "π.χ. επίπεδο -2, θέση 14",
      "p.save": "Αποθήκευση", "p.cancel": "Άκυρο", "p.badtime": "Διάλεξε ώρα για την υπενθύμιση.",
      "p.saved": "Η θέση στάθμευσης αποθηκεύτηκε", "p.savedat": "Η θέση στάθμευσης αποθηκεύτηκε, υπενθύμιση στις {t}",
      "p.pin": "Το αυτοκίνητό μου", "p.since": "Πάρκαρες στις {t}", "p.until": "Υπενθύμιση στις {t}",
      "p.due": "Ο χρόνος έληξε στις {t}",
      "p.walk": "Πήγαινε με τα πόδια", "p.change": "Αλλαγή", "p.remove": "Έφυγα",
      "p.removed": "Η θέση στάθμευσης αφαιρέθηκε", "p.full": "Δεν αποθηκεύτηκε: ο χώρος της συσκευής γέμισε.",
      "close": "Κλείσιμο"
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
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hm(ms) { var d = new Date(ms); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  var ICON_RULER = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>';
  var ICON_P = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg>';

  // ---------- sheets (one open at a time, exclusive with other modes) ----------
  var sheet = null, open = "";          // "", "ruler", "park"
  function setH() {
    var h = 0;
    document.querySelectorAll(".osm-sheet").forEach(function (s) { if (!s.hidden) h = Math.max(h, s.offsetHeight); });
    document.body.style.setProperty("--osm-h", h + "px");
  }
  function header(title) {
    var h = el("header", "");
    h.appendChild(el("h3", "", title));
    var c = button("", "osm-iconbtn osm-close", function () { closeSheet(); });
    c.setAttribute("aria-label", t("close")); c.title = t("close");
    c.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    h.appendChild(c);
    return h;
  }
  window.addEventListener("oros-maps-mode", function (e) {
    if (open && e.detail !== open) closeSheet();
  });
  function openSheet(kind) {
    if (open !== kind) {
      if (open) closeSheet();
      try { window.dispatchEvent(new CustomEvent("oros-maps-mode", { detail: kind })); } catch (e) {}
    }
    open = kind;
    sheet.id = kind === "ruler" ? "ruler-panel" : "park-panel";
    sheet.setAttribute("aria-label", kind === "ruler" ? t("m.title") : t("p.title"));
    sheet.hidden = false;
    document.body.classList.add("osm-mode");
  }
  function closeSheet() {
    var was = open;
    open = "";
    sheet.hidden = true;
    sheet.textContent = "";
    document.body.classList.remove("osm-mode");
    if (was === "ruler") rulerClear();
    if (was === "park") parkDraftClear();
    setH();
  }

  // ---------- Measure ----------
  var pts = [], closed = false;
  var rLayer = L.layerGroup();
  var rLine = null, rMarkers = [];
  function ptIcon(i) {
    return L.divIcon({ className: "tl-pt" + (i === 0 ? " first" : ""), html: "<span></span>",
      iconSize: [18, 18], iconAnchor: [9, 9] });
  }
  function rulerPaint() {
    rLayer.clearLayers();
    rMarkers = [];
    if (!pts.length) return;
    var ll = pts.map(function (p) { return [p[0], p[1]]; });
    if (closed && pts.length > 2) {
      rLine = L.polygon(ll, { color: "#e8590c", weight: 3, dashArray: "6 6", fillOpacity: 0.12, interactive: false });
    } else {
      rLine = L.polyline(ll, { color: "#e8590c", weight: 3, dashArray: "6 6", interactive: false });
    }
    rLine.addTo(rLayer);
    pts.forEach(function (p, i) {
      var m = L.marker([p[0], p[1]], { icon: ptIcon(i), draggable: true, keyboard: false, zIndexOffset: 500 });
      m.on("drag", function (e) {
        var q = e.target.getLatLng();
        pts[i] = [q.lat, q.lng];
        var next = pts.map(function (x) { return [x[0], x[1]]; });
        rLine.setLatLngs(next);
        rulerRead();
      });
      m.on("dragend", function () { rulerPaint(); rulerRender(); });
      m.addTo(rLayer);
      rMarkers.push(m);
    });
  }
  function rulerAdd(lat, lon) {
    if (pts.length >= TC.MAX_PTS) { toast(t("m.max")); return; }
    pts.push([lat, lon]);
    rulerPaint();
    rulerRender();
  }
  function rulerClear() {
    pts = []; closed = false;
    rLayer.clearLayers();
    map.removeLayer(rLayer);
  }
  var readEl = null;
  function rulerRead() {
    if (!readEl) return;
    readEl.textContent = "";
    var len = TC.length(pts, closed);
    if (closed && pts.length > 2) {
      readEl.appendChild(el("div", "tl-lab", t("m.area")));
      readEl.appendChild(el("div", "tl-big", TC.fmtArea(TC.area(pts), LANG)));
      readEl.appendChild(el("div", "tl-sub", t("m.perim", { d: TC.fmtLen(len, LANG) })));
    } else {
      readEl.appendChild(el("div", "tl-lab", t("m.total")));
      readEl.appendChild(el("div", "tl-big", TC.fmtLen(len, LANG)));
      if (pts.length > 2) {
        readEl.appendChild(el("div", "tl-sub",
          t("m.last", { d: TC.fmtLen(TC.dist(pts[pts.length - 2], pts[pts.length - 1]), LANG) })));
      }
    }
    readEl.appendChild(el("div", "tl-sub", t("m.points", { n: pts.length })));
  }
  function rulerRender() {
    if (open !== "ruler") return;
    sheet.textContent = "";
    sheet.appendChild(header(t("m.title")));
    var body = el("div", "osm-body");
    readEl = el("div", "tl-read");
    body.appendChild(readEl);
    rulerRead();
    var row = el("div", "osm-actions");
    var undo = button(t("m.undo"), "osm-btn", function () {
      pts.pop();
      if (pts.length < 3) closed = false;
      rulerPaint(); rulerRender();
    });
    undo.disabled = !pts.length;
    row.appendChild(undo);
    var shape = button(closed ? t("m.open") : t("m.close"), "osm-btn" + (closed ? " primary" : ""), function () {
      if (!closed && pts.length < 3) { toast(t("m.more")); return; }
      closed = !closed;
      rulerPaint(); rulerRender();
    });
    row.appendChild(shape);
    var clr = button(t("m.clear"), "osm-btn", function () {
      pts = []; closed = false;
      rulerPaint(); rulerRender();
    });
    clr.disabled = !pts.length;
    row.appendChild(clr);
    body.appendChild(row);
    body.appendChild(el("p", "osm-hint", t("m.hint")));
    sheet.appendChild(body);
    setH();
  }
  function rulerStart(place) {
    openSheet("ruler");
    pts = []; closed = false;
    rLayer.addTo(map);
    if (place) pts.push([place.lat, place.lon]);
    rulerPaint();
    rulerRender();
  }
  map.on("click", function (e) {
    if (open !== "ruler" || !e || !e.latlng) return;
    rulerAdd(e.latlng.lat, e.latlng.lng);
  });

  // ---------- Parking ----------
  function parkRead() {
    try { return TC.normPark(JSON.parse(localStorage.getItem(PARK_KEY) || "null")); }
    catch (e) { return null; }
  }
  function parkWrite(p) {
    try {
      if (p) localStorage.setItem(PARK_KEY, JSON.stringify(p));
      else localStorage.removeItem(PARK_KEY);
      return true;
    } catch (e) { toast(t("p.full")); return false; }
  }
  var pMarker = null;
  function parkIcon() {
    return L.divIcon({ className: "tl-park", html: "<span>P</span>", iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
  }
  function parkPopup(p) {
    var wrap = el("div", "tl-park-pop");
    wrap.appendChild(el("b", "", t("p.pin")));
    wrap.appendChild(el("div", "pop-sub", t("p.since", { t: hm(p.at) })));
    if (p.until) {
      var due = Date.now() >= p.until;
      wrap.appendChild(el("div", "pop-sub" + (due ? " tl-due" : ""),
        due ? t("p.due", { t: hm(p.until) }) : t("p.until", { t: hm(p.until) })));
    }
    if (p.note) wrap.appendChild(el("div", "pop-sub tl-note", p.note));
    var acts = el("div", "pop-actions");
    function act(label, fn) {
      var b = button("", "", function () { map.closePopup(); fn(); });
      b.appendChild(el("span", "", label));
      acts.appendChild(b);
    }
    act(t("p.walk"), function () {
      if (typeof H.routeTo === "function") H.routeTo({ lat: p.lat, lon: p.lon, name: t("p.pin"), sub: p.note || "" }, "foot");
    });
    act(t("p.change"), function () { parkForm({ lat: p.lat, lon: p.lon }, p); });
    act(t("p.remove"), function () {
      parkWrite(null);
      parkPaint();
      toast(t("p.removed"));
    });
    wrap.appendChild(acts);
    return wrap;
  }
  function parkPaint() {
    var p = parkRead();
    if (pMarker) { map.removeLayer(pMarker); pMarker = null; }
    if (!p) return;
    pMarker = L.marker([p.lat, p.lon], { icon: parkIcon(), keyboard: false, title: t("p.pin"), zIndexOffset: 400 });
    pMarker.bindPopup(function () { return parkPopup(parkRead() || p); }, { maxWidth: 280 });
    pMarker.addTo(map);
  }
  // The form: where (place), and the record being changed (old) if any.
  var draft = null, draftPin = null;
  function parkDraftClear() {
    draft = null;
    if (draftPin) { map.removeLayer(draftPin); draftPin = null; }
  }
  function parkForm(place, old) {
    openSheet("park");
    parkDraftClear();
    var remind = 0, at = "";
    if (old && old.until && old.until > Date.now()) { remind = -1; at = hm(old.until); }
    draft = { lat: place.lat, lon: place.lon, at: old ? old.at : Date.now(), remind: remind, time: at,
      note: old ? old.note : "" };
    if (!old) {
      draftPin = L.marker([place.lat, place.lon], { icon: parkIcon(), keyboard: false, interactive: false, opacity: 0.6 }).addTo(map);
    }
    parkRender();
  }
  function parkRender() {
    if (open !== "park" || !draft) return;
    sheet.textContent = "";
    sheet.appendChild(header(t("p.title")));
    var body = el("div", "osm-body tl-park-form");
    body.appendChild(el("div", "ent-h", t("p.remind")));
    var chips = el("div", "ent-chips");
    [[0, "p.none"], [30, "p.30"], [60, "p.60"], [120, "p.120"], [-1, "p.at"]].forEach(function (c) {
      var b = button(t(c[1]), "osm-mini ent-chip" + (draft.remind === c[0] ? " on" : ""), function () {
        draft.remind = c[0];
        parkRender();
      });
      b.setAttribute("data-remind", String(c[0]));
      b.setAttribute("aria-pressed", draft.remind === c[0] ? "true" : "false");
      chips.appendChild(b);
    });
    body.appendChild(chips);
    if (draft.remind === -1) {
      var tm = el("input", "osm-in tl-time");
      tm.type = "time";
      tm.value = draft.time || "";
      tm.setAttribute("aria-label", t("p.at"));
      tm.addEventListener("input", function () { draft.time = tm.value; });
      body.appendChild(tm);
    }
    var lab = el("label", "osm-lab", t("p.note"));
    var note = el("input", "osm-in tl-pnote");
    note.maxLength = 120;
    note.placeholder = t("p.note.ph");
    note.value = draft.note || "";
    note.addEventListener("input", function () { draft.note = note.value; });
    lab.appendChild(note);
    body.appendChild(lab);
    var row = el("div", "osm-actions");
    row.appendChild(button(t("p.cancel"), "osm-btn", function () { closeSheet(); }));
    row.appendChild(button(t("p.save"), "osm-btn primary tl-psave", parkSave));
    body.appendChild(row);
    sheet.appendChild(body);
    setH();
  }
  function parkSave() {
    if (!draft) return;
    var now = Date.now(), until = 0;
    if (draft.remind === -1) {
      until = TC.untilAt(now, draft.time);
      if (!until) { toast(t("p.badtime")); return; }
    } else until = TC.untilFor(now, draft.remind);
    var p = TC.normPark({ lat: draft.lat, lon: draft.lon, at: draft.at, until: until, note: draft.note });
    if (!p || !parkWrite(p)) return;
    closeSheet();
    parkPaint();
    toast(p.until ? t("p.savedat", { t: hm(p.until) }) : t("p.saved"));
  }
  function showCar() {
    var p = parkRead();
    if (!p) return;
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), 17));
    if (pMarker) pMarker.openPopup();
  }
  // Another tab (the shell's notification) or device-local change.
  window.addEventListener("storage", function (e) { if (e.key === PARK_KEY) parkPaint(); });

  // ---------- boot ----------
  function boot() {
    sheet = el("aside", "osm-sheet tl-sheet");
    sheet.hidden = true;
    document.body.appendChild(sheet);
    try { new ResizeObserver(setH).observe(sheet); } catch (e) {}
    if (Array.isArray(H.ctxItems)) {
      H.ctxItems.push(function (place) {
        return { icon: ICON_RULER, label: t("ctx.measure"), run: function () { rulerStart(place); } };
      });
      H.ctxItems.push(function (place) {
        return { icon: ICON_P, label: t("ctx.park"), run: function () { parkForm(place, null); } };
      });
      H.ctxItems.push(function () {
        return parkRead() ? { icon: ICON_P, label: t("ctx.car"), run: showCar } : null;
      });
    }
    parkPaint();
    // The parking reminder's deep link ("maps:park" →
    // __orosOpenAt("maps", { park: true })): shows the car.
    var prevOpenAt = window.__orosOpenAt;
    window.__orosOpenAt = function (target) {
      if (target && target.park) { showCar(); return; }
      if (typeof prevOpenAt === "function") return prevOpenAt(target);
    };
    if (H.pendingTarget && H.pendingTarget.park) {
      H.pendingTarget = null;
      setTimeout(showCar, 400);
    }
  }

  window.__orosMapsTools = {
    ruler: function () { return { pts: pts.slice(), closed: closed, open: open === "ruler" }; },
    rulerStart: rulerStart, rulerAdd: rulerAdd,
    park: parkRead, parkForm: parkForm, parkSave: parkSave, showCar: showCar, close: closeSheet
  };
  boot();
})();
