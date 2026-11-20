// ============================================================
// orOS Maps — trails-tab.js (hiking and cycling, wave H3, v1.0.0)
//
// Discover › Trails: the marked hiking, cycling and MTB routes that
// cross the view (OpenStreetMap route relations, through Overpass),
// nearest first, with a filter by kind. Tap one for its page: the
// whole route drawn on the map, from / to, length, the elevation
// along it with climb and descent (AWS Terrain Tiles through
// planner.js) and, for walking, the time by the DIN 33466 hiking
// rule; Go to the start, Save to My tracks, Download GPX, Waymarked
// Trails and OpenStreetMap links.
//
// The kind filter is device-local (in "oros-maps-trails", trails.js).
// Text from OSM goes on the page with textContent only; links are
// built from numbers or checked (https only) in trails-core.js.
// ============================================================
(function () {
  "use strict";
  var TC = window.OrosMapsTrails;
  var H = window.__orosMapsHost;
  var D = window.__orosMapsDiscover;
  if (!TC || !H || !H.map || !window.L || !D || typeof D.addTab !== "function") return;
  var map = H.map;
  var LANG = window.orosI18n ? window.orosI18n.lang() : (H.lang === "el" ? "el" : "en");
  var OVERPASS = "https://overpass-api.de/api/interpreter";
  var MIN_ZOOM = 9;
  var KCOL = { foot: "#c0392b", bike: "#2f6fd6", mtb: "#8e44ad" };

  var STR = {
    en: {
      "trt.tab": "Trails", "trt.f.all": "All", "trt.f.foot": "Hiking", "trt.f.bike": "Cycling", "trt.f.mtb": "MTB",
      "trt.zoom": "Zoom in closer to see the trails.",
      "trt.n": "{n} marked routes in view", "trt.n.of": "{n} of {all} marked routes in view",
      "trt.none": "No marked routes here.", "trt.none.kind": "No routes of this kind here.",
      "trt.k.foot": "Hiking route", "trt.k.bike": "Cycling route", "trt.k.mtb": "MTB route",
      "trt.away": "{d} away", "trt.here": "In view",
      "trt.back": "All trails", "trt.loading": "Loading the route…", "trt.fail": "The route didn't load. Try again in a moment.",
      "trt.retry": "Try again", "trt.big": "This route is too long to show here. Open it on Waymarked Trails.",
      "trt.len": "Length", "trt.len.tag": "{a} drawn on the map, {b} signposted", "trt.from": "From", "trt.to": "To",
      "trt.loop": "Loop: it ends where it starts", "trt.parts": "On the map in {n} separate parts",
      "trt.ele": "Elevation", "trt.ele.wait": "Getting elevation…", "trt.ele.no": "Elevation not available right now.",
      "trt.climb": "↗ {up} ↘ {down}", "trt.lohi": "Lowest {lo} · highest {hi}",
      "trt.time": "About {t} on foot (DIN 33466 hiking rule)", "trt.time.rev": "About {t} the other way",
      "trt.op": "Looked after by", "trt.site": "Website",
      "trt.start": "Go to the start", "trt.save": "Save to My tracks", "trt.saved": "Saved to My tracks",
      "trt.savefail": "Couldn't save it to My tracks.", "trt.gpx": "Download GPX", "trt.gpx.no": "Couldn't make the GPX file.",
      "trt.wt": "Waymarked Trails", "trt.osm": "OpenStreetMap",
      "trt.u.m": "{n} m", "trt.u.km": "{n} km", "trt.u.h": "{h} h {m} min", "trt.u.min": "{m} min"
    },
    el: {
      "trt.tab": "Μονοπάτια", "trt.f.all": "Όλα", "trt.f.foot": "Πεζοπορία", "trt.f.bike": "Ποδήλατο", "trt.f.mtb": "MTB",
      "trt.zoom": "Μεγέθυνε τον χάρτη για να δεις τα μονοπάτια.",
      "trt.n": "{n} σηματοδοτημένες διαδρομές στην οθόνη", "trt.n.of": "{n} από {all} σηματοδοτημένες διαδρομές στην οθόνη",
      "trt.none": "Δεν υπάρχουν σηματοδοτημένες διαδρομές εδώ.", "trt.none.kind": "Δεν υπάρχουν διαδρομές αυτού του είδους εδώ.",
      "trt.k.foot": "Πεζοπορική διαδρομή", "trt.k.bike": "Ποδηλατική διαδρομή", "trt.k.mtb": "Διαδρομή MTB",
      "trt.away": "σε {d}", "trt.here": "Στην οθόνη",
      "trt.back": "Όλα τα μονοπάτια", "trt.loading": "Φόρτωση της διαδρομής…", "trt.fail": "Η διαδρομή δεν φόρτωσε. Δοκίμασε ξανά σε λίγο.",
      "trt.retry": "Δοκίμασε ξανά", "trt.big": "Αυτή η διαδρομή είναι πολύ μεγάλη για να φανεί εδώ. Άνοιξέ τη στο Waymarked Trails.",
      "trt.len": "Μήκος", "trt.len.tag": "{a} στον χάρτη, {b} στις πινακίδες", "trt.from": "Από", "trt.to": "Προς",
      "trt.loop": "Κυκλική: τελειώνει εκεί που ξεκινά", "trt.parts": "Στον χάρτη σε {n} χωριστά κομμάτια",
      "trt.ele": "Υψόμετρο", "trt.ele.wait": "Φόρτωση υψομέτρου…", "trt.ele.no": "Το υψόμετρο δεν είναι διαθέσιμο τώρα.",
      "trt.climb": "↗ {up} ↘ {down}", "trt.lohi": "Χαμηλότερο {lo} · ψηλότερο {hi}",
      "trt.time": "Περίπου {t} με τα πόδια (κανόνας πεζοπορίας DIN 33466)", "trt.time.rev": "Περίπου {t} αντίστροφα",
      "trt.op": "Τη φροντίζει", "trt.site": "Ιστότοπος",
      "trt.start": "Πήγαινε στην αρχή", "trt.save": "Αποθήκευση στις διαδρομές μου", "trt.saved": "Αποθηκεύτηκε στις διαδρομές μου",
      "trt.savefail": "Δεν αποθηκεύτηκε στις διαδρομές μου.", "trt.gpx": "Λήψη GPX", "trt.gpx.no": "Δεν φτιάχτηκε το αρχείο GPX.",
      "trt.wt": "Waymarked Trails", "trt.osm": "OpenStreetMap",
      "trt.u.m": "{n} μ.", "trt.u.km": "{n} χλμ.", "trt.u.h": "{h} ώ. {m} λεπ.", "trt.u.min": "{m} λεπ."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "maps", LANG);
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : LANG; }
  function t(k, vars) {
    var s = (STR[LANG] && STR[LANG][k]) || STR.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function nf(n, d) {
    try { return n.toLocaleString(loc(), { maximumFractionDigits: d || 0 }); }
    catch (e) { return String(Math.round(n)); }
  }
  function m(n) { return t("trt.u.m", { n: nf(Math.round(n)) }); }
  function len(n) { return n >= 1000 ? t("trt.u.km", { n: nf(n / 1000, n < 10000 ? 1 : 0) }) : m(n); }
  function dur(sec) {
    var mins = Math.max(1, Math.round(sec / 60));
    return mins >= 60 ? t("trt.u.h", { h: Math.floor(mins / 60), m: mins % 60 }) : t("trt.u.min", { m: mins });
  }
  function toast(s) { (H.toast || H.localToast)(s); }
  function online() { return navigator.onLine !== false; }
  function post(q) {
    return fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q)
    }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function kindPref() { var T = window.__orosMapsTrails; return T && T.kind ? T.kind() : "all"; }
  function setKind(v) { var T = window.__orosMapsTrails; if (T && T.kind) T.kind(v); }
  function colourOf(r) { return r.colour || KCOL[r.kind] || "#c0392b"; }
  function titleOf(r) { return [r.ref, r.name].filter(Boolean).join(" · ") || trl("trl.unnamed"); }
  // Words trails.js already has (trl.unnamed, trl.net.*).
  function trl(k) { var T = window.__orosMapsTrails; return T && T.t ? T.t(k) : k; }

  // ---------- state ----------
  var api = null;
  var open = null;   // { r: route row, st: "wait"|"ok"|"fail"|"big", trail, ele: { st, … } }
  var seq = 0;
  function closeTrail() { open = null; seq++; }

  // ---------- the tab ----------
  function fetchArea(v) {
    closeTrail();
    if (v.zoom < MIN_ZOOM) return null;
    var b = v.bounds, q = TC.areaQuery(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
    if (!q) return null;
    return post(q).then(function (j) { return TC.areaRoutes(j, v.c); });
  }
  function shown(items) {
    var k = kindPref();
    return (items || []).filter(function (r) { return k === "all" || r.kind === k; });
  }

  function paint(items, layer, markers) {
    if (open && open.st === "ok" && open.trail) {
      var col = colourOf(open.r);
      open.trail.parts.forEach(function (p) {
        L.polyline(p, { color: "#fff", weight: 8, opacity: 0.8, interactive: false }).addTo(layer);
        L.polyline(p, { color: col, weight: 5, opacity: 0.95, interactive: false }).addTo(layer);
      });
      [["s", open.trail.start], ["e", open.trail.end]].forEach(function (x) {
        if (x[0] === "e" && open.r.round) return;
        L.circleMarker(x[1], { radius: 7, color: "#fff", weight: 2, fillColor: x[0] === "s" ? "#2e9e4f" : "#222", fillOpacity: 1, interactive: false }).addTo(layer);
      });
      return;
    }
    if (!items) return;
    shown(items).slice(0, 150).forEach(function (r) {
      var h = document.createElement("span");
      h.style.borderColor = colourOf(r);
      h.textContent = r.ref ? r.ref.slice(0, 6) : (r.kind === "foot" ? "🥾" : r.kind === "mtb" ? "⛰" : "🚲");
      var mk = L.marker([r.lat, r.lon], { icon: L.divIcon({ className: "trt-pin", html: h, iconSize: null, iconAnchor: [14, 12] }),
        keyboard: false, title: titleOf(r) });
      mk.on("click", function () { openTrail(r); });
      markers["trt" + r.id] = mk;
      layer.addLayer(mk);
    });
  }

  function render(body, cur, A) {
    if (open) { renderTrail(body, A); return; }
    if (map.getZoom() < MIN_ZOOM) { body.appendChild(A.el("p", "osm-hint trt-zoom", t("trt.zoom"))); return; }
    var chips = A.el("div", "ent-chips trt-kinds");
    ["all", "foot", "bike", "mtb"].forEach(function (k) {
      var b = A.button(t("trt.f." + k), "osm-mini ent-chip" + (kindPref() === k ? " on" : ""), function () {
        if (kindPref() === k) return;
        setKind(k); A.refresh();
      });
      b.dataset.kind = k;
      b.setAttribute("aria-pressed", kindPref() === k ? "true" : "false");
      chips.appendChild(b);
    });
    body.appendChild(chips);
    var list = cur ? shown(cur.items) : [];
    var txt = !cur ? "" : list.length === cur.items.length ? t("trt.n", { n: list.length }) : t("trt.n.of", { n: list.length, all: cur.items.length });
    if (!A.statusLine(body, txt) || !cur) return;
    if (!list.length) { body.appendChild(A.el("p", "osm-hint dsc-none", t(cur.items.length ? "trt.none.kind" : "trt.none"))); return; }
    var ul = A.el("ul", "osm-list dsc-list trt-list");
    list.slice(0, 100).forEach(function (r) {
      var li = A.el("li", "osm-row dsc-row trt-row");
      li.tabIndex = 0;
      var sw = A.el("span", "trt-sw");
      sw.style.background = colourOf(r);
      li.appendChild(sw);
      var b = A.el("div", "osm-row-body");
      b.appendChild(A.el("div", "osm-row-t", titleOf(r)));
      var sub = [t("trt.k." + r.kind)];
      if (r.net) sub.push(trlNet(r.net));
      if (r.km) sub.push(len(r.km * 1000));
      sub.push(r.d < 300 ? t("trt.here") : t("trt.away", { d: len(r.d) }));
      b.appendChild(A.el("div", "osm-row-s", sub.join(" · ")));
      li.appendChild(b);
      function go() { openTrail(r); }
      li.addEventListener("click", go);
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      ul.appendChild(li);
    });
    body.appendChild(ul);
  }
  function trlNet(n) { return trl("trl.net." + n); }

  // ---------- one route ----------
  function openTrail(r) {
    var my = ++seq;
    open = { r: r, st: "wait", trail: null, ele: null };
    map.closePopup();
    api.refresh();
    if (!online()) { open.st = "fail"; api.refresh(); return; }
    post(TC.geomQuery(r.id)).then(function (j) {
      if (my !== seq) return;
      var tr = TC.trailOf(j, r.id);
      if (!tr) { open.st = "big"; api.refresh(); return; }
      open.trail = tr; open.st = "ok";
      api.refresh();
      fitTrail(tr.bounds);
      loadEle(my);
    }, function () {
      if (my !== seq) return;
      open.st = "fail"; api.refresh();
    });
  }
  // Fit the route into the part of the map the Discover sheet leaves
  // free (a bottom sheet on a phone, a side panel on a computer), right
  // of the phone's button column.
  function fitTrail(bounds) {
    var tl = [Math.min(120, map.getSize().x / 3), 104], br = [16, 16];   // the search bar and the button column
    var pn = document.getElementById("dsc-panel"), W = map.getSize().x, Hh = map.getSize().y;
    if (pn && !pn.hidden) {
      var r = pn.getBoundingClientRect();
      // a bottom sheet grows up to 58% of the height as the page fills in
      if (r.width >= W * 0.9) br[1] = Math.max(Hh - r.top, Hh * 0.58) + 16;
      else if (r.left < W / 2) tl[0] = Math.max(tl[0], r.right + 16);
      else br[0] = Math.max(16, W - r.left + 16);
    }
    if (W - tl[0] - br[0] < 80 || Hh - tl[1] - br[1] < 80) { tl = [16, 16]; br = [16, 16]; }
    try { map.fitBounds(bounds, { paddingTopLeft: tl, paddingBottomRight: br, maxZoom: 16 }); } catch (e) { /* tiny route */ }
  }
  function loadEle(my) {
    if (typeof H.elevationOf !== "function" || !open || !open.trail) return;
    open.ele = { st: "wait" };
    api.refresh();
    H.elevationOf(open.trail.parts[0]).then(function (e) {
      if (my !== seq || !open) return;
      open.ele = { st: e.climb ? "ok" : "no", samples: e.samples, vals: e.vals, climb: e.climb };
      api.refresh();
    }, function () {
      if (my !== seq || !open) return;
      open.ele = { st: "no" };
      api.refresh();
    });
  }

  var NS = "http://www.w3.org/2000/svg";
  function profileSvg(samples, vals) {
    var W = 300, Hh = 72, pts = [];
    samples.forEach(function (s, i) { if (typeof vals[i] === "number" && isFinite(vals[i])) pts.push([s.d, vals[i]]); });
    if (pts.length < 2) return null;
    var total = pts[pts.length - 1][0] || 1, lo = Infinity, hi = -Infinity;
    pts.forEach(function (q) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); });
    if (hi - lo < 20) { hi += 10; lo -= 10; }
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + Hh);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "odr-prof");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", t("trt.ele"));
    var d = "M0 " + Hh;
    pts.forEach(function (q) { d += " L" + (q[0] / total * W).toFixed(1) + " " + (Hh - 3 - (q[1] - lo) / (hi - lo) * (Hh - 6)).toFixed(1); });
    d += " L" + W + " " + Hh + " Z";
    var area = document.createElementNS(NS, "path");
    area.setAttribute("d", d);
    area.setAttribute("class", "odr-prof-area");
    svg.appendChild(area);
    return svg;
  }

  function track() {
    var tr = open.trail;
    return { name: titleOf(open.r).slice(0, 120),
      segs: tr.parts.map(function (p) { return p.map(function (q) { return [q[0], q[1], null, null]; }); }), wpts: [] };
  }
  function saveTrack() {
    var A2 = window.__orosMapsTracks, T = window.OrosMapsTracks;
    if (!A2 || !T || typeof A2.importText !== "function") { toast(t("trt.savefail")); return; }
    var tr = track();
    Promise.resolve(A2.importText(T.writeGpx(tr), tr.name + ".gpx")).then(function (e) {
      toast(t(e ? "trt.saved" : "trt.savefail"));
    }, function () { toast(t("trt.savefail")); });
  }
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function downloadGpx() {
    var T = window.OrosMapsTracks, dlg = dialogHost();
    if (!T || !dlg || typeof dlg.saveFile !== "function") { toast(t("trt.gpx.no")); return; }
    var tr = track();
    var file = (tr.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "trail") + ".gpx";
    var blob = new Blob([T.writeGpx(tr)], { type: "application/gpx+xml" });
    Promise.resolve(dlg.saveFile({ blob: blob, filename: file, mime: "application/gpx+xml",
      types: [{ description: "GPX", accept: { "application/gpx+xml": [".gpx"] } }] }))
      .catch(function () { toast(t("trt.gpx.no")); });
  }

  function renderTrail(body, A) {
    var r = open.r, box = A.el("div", "trt-page");
    box.appendChild(A.button("‹ " + t("trt.back"), "osm-mini trt-back", function () { closeTrail(); A.refresh(); }));
    var head = A.el("div", "trt-head");
    var sw = A.el("span", "trt-sw");
    sw.style.background = colourOf(r);
    head.appendChild(sw);
    var hb = A.el("div", "");
    hb.appendChild(A.el("h4", "trt-title", titleOf(r)));
    hb.appendChild(A.el("div", "osm-row-s", [t("trt.k." + r.kind)].concat(r.net ? [trlNet(r.net)] : []).join(" · ")));
    head.appendChild(hb);
    box.appendChild(head);
    if (open.st === "wait") { box.appendChild(A.el("p", "osm-hint dsc-busy", t("trt.loading"))); body.appendChild(box); return; }
    if (open.st === "fail") {
      box.appendChild(A.el("p", "osm-hint dsc-err", t("trt.fail")));
      box.appendChild(A.button(t("trt.retry"), "osm-btn", function () { openTrail(r); }));
      body.appendChild(box); return;
    }
    if (open.st === "big") {
      box.appendChild(A.el("p", "osm-hint", t("trt.big")));
      box.appendChild(A.link(t("trt.wt"), TC.wtLink(r)));
      body.appendChild(box); return;
    }
    var tr = open.trail;
    var dl = A.el("dl", "trl-rows trt-facts");
    function row(l, v) { dl.appendChild(A.el("dt", "", l)); dl.appendChild(A.el("dd", "", v)); }
    row(t("trt.len"), r.km && Math.abs(r.km * 1000 - tr.m) > Math.max(300, tr.m * 0.1) ? t("trt.len.tag", { a: len(tr.m), b: len(r.km * 1000) }) : len(tr.m));
    if (tr.info.from) row(t("trt.from"), tr.info.from);
    if (tr.info.to) row(t("trt.to"), tr.info.to);
    if (tr.op) row(t("trt.op"), tr.op);
    box.appendChild(dl);
    if (tr.info.round) box.appendChild(A.el("p", "osm-small", t("trt.loop")));
    if (tr.parts.length > 1) box.appendChild(A.el("p", "osm-small", t("trt.parts", { n: tr.parts.length })));
    if (tr.desc) box.appendChild(A.el("p", "trt-desc", tr.desc));

    // elevation
    var e = open.ele;
    if (e) {
      box.appendChild(A.el("div", "rx-h", t("trt.ele")));
      if (e.st === "wait") box.appendChild(A.el("p", "osm-small", t("trt.ele.wait")));
      else if (e.st === "no") box.appendChild(A.el("p", "osm-small", t("trt.ele.no")));
      else {
        var svg = profileSvg(e.samples, e.vals);
        if (svg) box.appendChild(svg);
        box.appendChild(A.el("div", "odr-lohi", t("trt.climb", { up: m(e.climb.up), down: m(e.climb.down) }) + " · " +
          t("trt.lohi", { lo: m(e.climb.min), hi: m(e.climb.max) })));
        var OC = window.OrosMapsOutdoor, ml = e.samples[e.samples.length - 1].d;   // the longest part
        if (r.kind === "foot" && OC && ml > 0) {
          var there = OC.hikeTime(ml, e.climb.up, e.climb.down), back = OC.hikeTime(ml, e.climb.down, e.climb.up);
          box.appendChild(A.el("p", "osm-small trt-time", t("trt.time", { t: dur(there) }) +
            (!tr.info.round && Math.abs(there - back) >= 300 ? " · " + t("trt.time.rev", { t: dur(back) }) : "")));
        }
      }
    }

    var act = A.el("div", "pop-actions trt-act");
    act.appendChild(A.button(t("trt.start"), "", function () {
      var s = tr.start;
      A.close();
      if (H.routeTo) H.routeTo({ lat: s[0], lon: s[1], name: titleOf(r) });
    }));
    act.appendChild(A.button(t("trt.save"), "", saveTrack));
    act.appendChild(A.button(t("trt.gpx"), "", downloadGpx));
    box.appendChild(act);
    var links = A.el("div", "dsc-links");
    links.appendChild(A.link(t("trt.wt"), TC.wtLink(r)));
    links.appendChild(A.link(t("trt.osm"), TC.osmRelLink(r.id)));
    if (tr.site) links.appendChild(A.link(t("trt.site"), tr.site));
    box.appendChild(links);
    body.appendChild(box);
  }

  api = D.addTab({ id: "trails", pos: 1, label: function () { return t("trt.tab"); }, fetch: fetchArea, paint: paint, render: render });

  window.__orosMapsTrailsTab = {
    open: function () { return open ? { id: open.r.id, st: open.st, ele: open.ele && open.ele.st, parts: open.trail ? open.trail.parts.length : 0 } : null; },
    openTrail: function (r) { openTrail(r); },
    close: function () { closeTrail(); if (api) api.refresh(); }
  };
})();
