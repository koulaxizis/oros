// ============================================================
// orOS Maps — trails.js (hiking and cycling, wave H1, v1.0.0)
//
// - Two overlays in the layer switcher, on top of any map:
//   "Hiking trails" and "Cycling and MTB routes" (Waymarked Trails,
//   drawn from OpenStreetMap route relations).
// - A base map "Cycling" (CyclOSM): cycleways, bike lanes, surfaces.
// - Long-press › "About this path": the way under the point through
//   Overpass, read in plain words (kind, surface, smoothness, hiking
//   and MTB difficulty, trail visibility, incline, who may use it)
//   with the marked routes it belongs to.
//
// Which overlays are on (and, since H3, the kind shown in Discover ›
// Trails) is device-local ("oros-maps-trails"), like the map style.
// Nothing is synced. Text from OSM goes on the page with textContent
// only; links are built from numbers (trails-core.js).
// Tiles load without crossOrigin, so a server without CORS headers
// still draws (they are then not kept for offline use).
// ============================================================
(function () {
  "use strict";
  var TC = window.OrosMapsTrails;
  var H = window.__orosMapsHost;
  if (!TC || !H || !H.map || !window.L) return;
  var map = H.map;
  var LANG = window.orosI18n ? window.orosI18n.lang() : (H.lang === "el" ? "el" : "en");
  var OVERPASS = "https://overpass-api.de/api/interpreter";
  var PREFS_KEY = "oros-maps-trails";

  var STR = {
    en: {
      "trl.ov.hiking": "Hiking trails", "trl.ov.cycling": "Cycling routes", "trl.ov.mtb": "MTB routes",
      "trl.base.cyclosm": "Cycling (CyclOSM)",
      "trl.ctx": "About this path", "trl.title": "About this path", "trl.loading": "Looking at the map data…",
      "trl.offline": "You're offline. This needs a connection.", "trl.fail": "OpenStreetMap data didn't answer. Try again in a moment.",
      "trl.none": "No path or street here. Long-press right on the line.",
      "trl.routes": "Marked routes here", "trl.noroutes": "Not part of a marked route.",
      "trl.r.foot": "Hiking", "trl.r.bike": "Cycling", "trl.r.mtb": "MTB",
      "trl.net.intl": "international", "trl.net.national": "national", "trl.net.regional": "regional", "trl.net.local": "local",
      "trl.km": "{n} km", "trl.unnamed": "No name", "trl.open.wt": "Waymarked Trails", "trl.open.osm": "Open on OpenStreetMap",
      "trl.nodata": "OpenStreetMap has no more details for this one. You can add them in Quests or Edit places.",
      "trl.hw.path": "Path", "trl.hw.footway": "Footpath", "trl.hw.sidewalk": "Sidewalk", "trl.hw.shared": "Shared path (walk and bike)",
      "trl.hw.track": "Track (farm or forest road)", "trl.hw.cycleway": "Cycleway", "trl.hw.bridleway": "Bridleway",
      "trl.hw.steps": "Steps", "trl.hw.pedestrian": "Pedestrian street", "trl.hw.living_street": "Living street",
      "trl.hw.residential": "Residential street", "trl.hw.unclassified": "Minor road", "trl.hw.service": "Service road",
      "trl.hw.tertiary": "Road", "trl.hw.secondary": "Main road", "trl.hw.primary": "Main road", "trl.hw.trunk": "Major road",
      "trl.hw.via_ferrata": "Via ferrata", "trl.hw.other": "Way",
      "trl.l.surface": "Surface", "trl.l.tracktype": "Track", "trl.l.smooth": "Smoothness", "trl.l.sac": "Hiking difficulty",
      "trl.l.mtb": "MTB difficulty", "trl.l.vis": "Trail visibility", "trl.l.incline": "Incline", "trl.l.steps": "Steps",
      "trl.l.width": "Width", "trl.l.foot": "On foot", "trl.l.bicycle": "By bike", "trl.l.horse": "On horseback",
      "trl.l.segregated": "Separate lanes for walking and cycling", "trl.l.lit": "Lit at night", "trl.l.informal": "Informal path",
      "trl.surf.paved": "Paved", "trl.surf.asphalt": "Asphalt", "trl.surf.concrete": "Concrete", "trl.surf.paving": "Paving stones",
      "trl.surf.sett": "Cobblestones", "trl.surf.metal": "Metal", "trl.surf.wood": "Wood", "trl.surf.unpaved": "Unpaved",
      "trl.surf.compacted": "Compacted gravel", "trl.surf.fine_gravel": "Fine gravel", "trl.surf.gravel": "Gravel",
      "trl.surf.rock": "Rock", "trl.surf.ground": "Earth", "trl.surf.grass": "Grass", "trl.surf.sand": "Sand",
      "trl.surf.mud": "Mud", "trl.surf.woodchips": "Woodchips",
      "trl.tt.grade1": "Solid, paved or heavily compacted", "trl.tt.grade2": "Mostly solid gravel",
      "trl.tt.grade3": "Mixed, soft in places", "trl.tt.grade4": "Mostly soft: earth, grass", "trl.tt.grade5": "Soft, barely a track",
      "trl.sm.excellent": "Excellent: fine for inline skates", "trl.sm.good": "Good: fine for road bikes",
      "trl.sm.intermediate": "Intermediate: city and trekking bikes", "trl.sm.bad": "Bad: sturdy bikes, wide tyres",
      "trl.sm.very_bad": "Very bad: mountain bikes", "trl.sm.horrible": "Horrible: off-road vehicles, skilled riders",
      "trl.sm.very_horrible": "Very horrible: tractors, on foot", "trl.sm.impassable": "Impassable for wheels",
      "trl.sac.1": "T1 · Easy walk", "trl.sac.2": "T2 · Mountain path, good shoes", "trl.sac.3": "T3 · Demanding: steep, sure footing",
      "trl.sac.4": "T4 · Alpine route: hands needed at times", "trl.sac.5": "T5 · Demanding alpine route: climbing",
      "trl.sac.6": "T6 · Difficult alpine route: climbing gear",
      "trl.mtb.0": "0 · Easy, no obstacles", "trl.mtb.1": "1 · Small obstacles, roots and stones",
      "trl.mtb.2": "2 · Bigger obstacles, low steps", "trl.mtb.3": "3 · Difficult: rocks, steep switchbacks",
      "trl.mtb.4": "4 · Very difficult: steep, technical", "trl.mtb.5": "5 · Extreme: experts only", "trl.mtb.6": "6 · Not rideable",
      "trl.vis.excellent": "Excellent, clear path", "trl.vis.good": "Good, markings visible", "trl.vis.intermediate": "Intermediate, needs attention",
      "trl.vis.bad": "Bad, hard to see in places", "trl.vis.horrible": "Horrible, route finding needed", "trl.vis.no": "No path visible",
      "trl.inc.up": "Uphill (in drawing direction)", "trl.inc.down": "Downhill (in drawing direction)",
      "trl.acc.yes": "Allowed", "trl.acc.no": "Not allowed", "trl.acc.designated": "Meant for it", "trl.acc.permissive": "Allowed by the owner",
      "trl.acc.dismount": "Push the bike", "trl.acc.private": "Private", "trl.acc.destination": "Only to get somewhere here",
      "trl.yn.yes": "Yes", "trl.yn.no": "No"
    },
    el: {
      "trl.ov.hiking": "Πεζοπορικά μονοπάτια", "trl.ov.cycling": "Ποδηλατικές διαδρομές", "trl.ov.mtb": "Διαδρομές MTB",
      "trl.base.cyclosm": "Ποδηλατικός (CyclOSM)",
      "trl.ctx": "Τι δρόμος είναι αυτός", "trl.title": "Τι δρόμος είναι αυτός", "trl.loading": "Κοιτάζω τα δεδομένα του χάρτη…",
      "trl.offline": "Είσαι εκτός σύνδεσης. Αυτό θέλει σύνδεση.", "trl.fail": "Τα δεδομένα του OpenStreetMap δεν απάντησαν. Δοκίμασε ξανά σε λίγο.",
      "trl.none": "Δεν υπάρχει μονοπάτι ή δρόμος εδώ. Πάτα παρατεταμένα ακριβώς πάνω στη γραμμή.",
      "trl.routes": "Σηματοδοτημένες διαδρομές εδώ", "trl.noroutes": "Δεν ανήκει σε σηματοδοτημένη διαδρομή.",
      "trl.r.foot": "Πεζοπορία", "trl.r.bike": "Ποδήλατο", "trl.r.mtb": "MTB",
      "trl.net.intl": "διεθνής", "trl.net.national": "εθνική", "trl.net.regional": "περιφερειακή", "trl.net.local": "τοπική",
      "trl.km": "{n} χλμ.", "trl.unnamed": "Χωρίς όνομα", "trl.open.wt": "Waymarked Trails", "trl.open.osm": "Άνοιγμα στο OpenStreetMap",
      "trl.nodata": "Το OpenStreetMap δεν έχει άλλες λεπτομέρειες για αυτόν. Μπορείς να τις προσθέσεις στις Αποστολές ή στην Επεξεργασία σημείων.",
      "trl.hw.path": "Μονοπάτι", "trl.hw.footway": "Πεζόδρομος", "trl.hw.sidewalk": "Πεζοδρόμιο", "trl.hw.shared": "Κοινός δρόμος (πεζοί και ποδήλατα)",
      "trl.hw.track": "Χωματόδρομος (αγροτικός ή δασικός)", "trl.hw.cycleway": "Ποδηλατόδρομος", "trl.hw.bridleway": "Μονοπάτι για άλογα",
      "trl.hw.steps": "Σκαλιά", "trl.hw.pedestrian": "Πεζόδρομος", "trl.hw.living_street": "Δρόμος ήπιας κυκλοφορίας",
      "trl.hw.residential": "Δρόμος γειτονιάς", "trl.hw.unclassified": "Μικρός δρόμος", "trl.hw.service": "Δρόμος πρόσβασης",
      "trl.hw.tertiary": "Δρόμος", "trl.hw.secondary": "Κεντρικός δρόμος", "trl.hw.primary": "Κεντρικός δρόμος", "trl.hw.trunk": "Μεγάλος δρόμος",
      "trl.hw.via_ferrata": "Via ferrata", "trl.hw.other": "Δρόμος",
      "trl.l.surface": "Επιφάνεια", "trl.l.tracktype": "Χωματόδρομος", "trl.l.smooth": "Ομαλότητα", "trl.l.sac": "Δυσκολία πεζοπορίας",
      "trl.l.mtb": "Δυσκολία MTB", "trl.l.vis": "Ορατότητα μονοπατιού", "trl.l.incline": "Κλίση", "trl.l.steps": "Σκαλιά",
      "trl.l.width": "Πλάτος", "trl.l.foot": "Με τα πόδια", "trl.l.bicycle": "Με ποδήλατο", "trl.l.horse": "Με άλογο",
      "trl.l.segregated": "Χωριστές λωρίδες για πεζούς και ποδήλατα", "trl.l.lit": "Φωτισμός τη νύχτα", "trl.l.informal": "Ανεπίσημο μονοπάτι",
      "trl.surf.paved": "Στρωμένο", "trl.surf.asphalt": "Άσφαλτος", "trl.surf.concrete": "Τσιμέντο", "trl.surf.paving": "Πλακόστρωτο",
      "trl.surf.sett": "Λιθόστρωτο", "trl.surf.metal": "Μέταλλο", "trl.surf.wood": "Ξύλο", "trl.surf.unpaved": "Χωρίς επίστρωση",
      "trl.surf.compacted": "Πατημένο χαλίκι", "trl.surf.fine_gravel": "Ψιλό χαλίκι", "trl.surf.gravel": "Χαλίκι",
      "trl.surf.rock": "Βράχος", "trl.surf.ground": "Χώμα", "trl.surf.grass": "Γρασίδι", "trl.surf.sand": "Άμμος",
      "trl.surf.mud": "Λάσπη", "trl.surf.woodchips": "Ροκανίδι",
      "trl.tt.grade1": "Σταθερός, στρωμένος ή πολύ πατημένος", "trl.tt.grade2": "Κυρίως σταθερό χαλίκι",
      "trl.tt.grade3": "Μικτός, μαλακός σε σημεία", "trl.tt.grade4": "Κυρίως μαλακός: χώμα, χόρτο", "trl.tt.grade5": "Μαλακός, μόλις φαίνεται",
      "trl.sm.excellent": "Άριστη: ακόμα και για πατίνια", "trl.sm.good": "Καλή: για ποδήλατο δρόμου",
      "trl.sm.intermediate": "Μέτρια: για ποδήλατο πόλης και τζάμπα", "trl.sm.bad": "Κακή: γερό ποδήλατο, φαρδιά λάστιχα",
      "trl.sm.very_bad": "Πολύ κακή: ποδήλατο βουνού", "trl.sm.horrible": "Απαίσια: εκτός δρόμου, έμπειροι αναβάτες",
      "trl.sm.very_horrible": "Πολύ απαίσια: τρακτέρ, με τα πόδια", "trl.sm.impassable": "Αδιάβατο με ρόδες",
      "trl.sac.1": "T1 · Εύκολος περίπατος", "trl.sac.2": "T2 · Ορεινό μονοπάτι, καλά παπούτσια", "trl.sac.3": "T3 · Απαιτητικό: απότομο, σταθερό βήμα",
      "trl.sac.4": "T4 · Αλπική διαδρομή: πού και πού με τα χέρια", "trl.sac.5": "T5 · Απαιτητική αλπική: αναρρίχηση",
      "trl.sac.6": "T6 · Δύσκολη αλπική: εξοπλισμός αναρρίχησης",
      "trl.mtb.0": "0 · Εύκολο, χωρίς εμπόδια", "trl.mtb.1": "1 · Μικρά εμπόδια, ρίζες και πέτρες",
      "trl.mtb.2": "2 · Μεγαλύτερα εμπόδια, χαμηλά σκαλιά", "trl.mtb.3": "3 · Δύσκολο: βράχια, απότομες στροφές",
      "trl.mtb.4": "4 · Πολύ δύσκολο: απότομο, τεχνικό", "trl.mtb.5": "5 · Ακραίο: μόνο για έμπειρους", "trl.mtb.6": "6 · Δεν περνιέται με ποδήλατο",
      "trl.vis.excellent": "Άριστη, καθαρό μονοπάτι", "trl.vis.good": "Καλή, φαίνεται η σήμανση", "trl.vis.intermediate": "Μέτρια, θέλει προσοχή",
      "trl.vis.bad": "Κακή, δύσκολα φαίνεται σε σημεία", "trl.vis.horrible": "Απαίσια, θέλει προσανατολισμό", "trl.vis.no": "Δεν φαίνεται μονοπάτι",
      "trl.inc.up": "Ανηφόρα (προς την κατεύθυνση σχεδίασης)", "trl.inc.down": "Κατηφόρα (προς την κατεύθυνση σχεδίασης)",
      "trl.acc.yes": "Επιτρέπεται", "trl.acc.no": "Απαγορεύεται", "trl.acc.designated": "Φτιαγμένο γι' αυτό", "trl.acc.permissive": "Επιτρέπεται από τον ιδιοκτήτη",
      "trl.acc.dismount": "Με το ποδήλατο στο χέρι", "trl.acc.private": "Ιδιωτικό", "trl.acc.destination": "Μόνο για να πας κάπου εδώ",
      "trl.yn.yes": "Ναι", "trl.yn.no": "Όχι"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "maps", LANG);
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : LANG; }
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
  function link(label, href) {
    var a = el("a", "osm-ext", label);
    a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
    return a;
  }
  function online() { return navigator.onLine !== false; }
  function km(n) {
    var s;
    try { s = n.toLocaleString(loc(), { maximumFractionDigits: n < 10 ? 1 : 0 }); } catch (e) { s = String(Math.round(n * 10) / 10); }
    return t("trl.km", { n: s });
  }

  // ---------- device-local prefs ----------
  var prefs = { ov: [], tk: "all" };   // tk: the kind shown in Discover › Trails (wave H3)
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* view state only */ } }

  // ---------- layers ----------
  var WT_ATTR = 'Trails &copy; <a href="https://waymarkedtrails.org">Waymarked Trails</a> (CC-BY-SA), data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var OVERLAYS = { hiking: "hiking", cycling: "cycling", mtb: "mtb" };
  var overlays = {};
  Object.keys(OVERLAYS).forEach(function (id) {
    var lay = L.tileLayer("https://tile.waymarkedtrails.org/" + OVERLAYS[id] + "/{z}/{x}/{y}.png", {
      maxZoom: 19, maxNativeZoom: 18, opacity: 0.85, zIndex: 5, attribution: WT_ATTR
    });
    lay.orosId = "trl-" + id;
    overlays[id] = lay;
  });
  try {
    var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    if (p && Array.isArray(p.ov)) prefs.ov = p.ov.filter(function (x) { return !!overlays[x]; });
    if (p && ["all", "foot", "bike", "mtb"].indexOf(p.tk) >= 0) prefs.tk = p.tk;
  } catch (e) { prefs.ov = []; }

  var cyclosm = L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", {
    maxZoom: 20, subdomains: "abc",
    attribution: '<a href="https://www.cyclosm.org">CyclOSM</a> (CC-BY-SA), hosted by OpenStreetMap France, data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });

  function syncPrefs() {
    prefs.ov = Object.keys(overlays).filter(function (id) { return map.hasLayer(overlays[id]); });
    savePrefs();
  }
  map.on("overlayadd overlayremove", function (e) {
    if (e.layer && /^trl-/.test(e.layer.orosId || "")) syncPrefs();
  });

  // ---------- About this path ----------
  var hiLine = null, seq = 0;
  function clearHi() { if (hiLine) { map.removeLayer(hiLine); hiLine = null; } }
  map.on("popupclose", function (e) { if (e.popup && e.popup._orosTrl) clearHi(); });

  function post(q) {
    return fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q)
    }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  // The tap radius follows the zoom: ~30 m at street level, wider out.
  function radius() { var z = map.getZoom(); return z >= 17 ? 15 : z >= 16 ? 25 : z >= 15 ? 40 : 70; }

  function about(place) {
    var my = ++seq;
    clearHi();
    var wrap = el("div", "trl-pop");
    wrap.appendChild(el("b", "", t("trl.title")));
    var body = el("div", "trl-body");
    wrap.appendChild(body);
    // On a phone the column of mode buttons sits on the left of the
    // map: keep the popup to its right.
    var w = map.getSize().x, narrow = w < 600;
    var pop = L.popup({ maxWidth: Math.max(200, Math.min(300, w - (narrow ? 130 : 48))), minWidth: Math.min(200, w - 130),
      autoPanPaddingTopLeft: L.point(narrow ? 78 : 16, 16), autoPanPaddingBottomRight: L.point(16, 16) })
      .setLatLng([place.lat, place.lon]).setContent(wrap);
    pop._orosTrl = true;
    pop.openOn(map);
    function msg(k) { body.textContent = ""; body.appendChild(el("p", "trl-msg", t(k))); pop.update(); }
    if (!online()) { msg("trl.offline"); return; }
    msg("trl.loading");
    var r = radius();
    post(TC.wayQuery(place.lat, place.lon, r)).then(function (j) {
      if (my !== seq) return;
      var w = TC.nearestWay(j, place.lat, place.lon, r);
      if (!w) { msg("trl.none"); return; }
      hiLine = L.polyline(w.pts, { color: "#ffb400", weight: 9, opacity: 0.55, interactive: false }).addTo(map);
      render(body, w, null);
      pop.update();
      return post(TC.routeQuery(w.id)).then(function (rj) {
        if (my !== seq) return;
        render(body, w, TC.routesOf(rj));
        pop.update();
      }, function () {
        if (my !== seq) return;
        render(body, w, []);
        pop.update();
      });
    }, function () { if (my === seq) msg("trl.fail"); });
  }

  function render(body, w, routes) {
    var d = TC.describeWay(w.tags);
    body.textContent = "";
    body.appendChild(el("div", "trl-kind", t(d.kind)));
    if (d.name) body.appendChild(el("div", "trl-name", d.name));
    if (d.rows.length) {
      var dl = el("dl", "trl-rows");
      d.rows.forEach(function (row) {
        dl.appendChild(el("dt", "", t(row.l)));
        dl.appendChild(el("dd", "", row.raw !== undefined ? row.raw : t(row.v)));
      });
      body.appendChild(dl);
    } else body.appendChild(el("p", "trl-msg", t("trl.nodata")));

    var rbox = el("div", "trl-routes");
    rbox.appendChild(el("h4", "", t("trl.routes")));
    if (routes === null) rbox.appendChild(el("p", "trl-msg", t("trl.loading")));
    else if (!routes.length) rbox.appendChild(el("p", "trl-msg", t("trl.noroutes")));
    else {
      var ul = el("ul", "");
      routes.slice(0, 8).forEach(function (rt) {
        var li = el("li", "trl-route");
        var sw = el("span", "trl-sw");
        if (rt.colour) sw.style.background = rt.colour;
        li.appendChild(sw);
        var txt = el("span", "trl-rt");
        txt.appendChild(el("b", "", [rt.ref, rt.name].filter(Boolean).join(" · ") || t("trl.unnamed")));
        var sub = [t("trl.r." + rt.kind)];
        if (rt.net) sub.push(t("trl.net." + rt.net));
        if (rt.km) sub.push(km(rt.km));
        txt.appendChild(el("span", "trl-rt-s", sub.join(" · ")));
        li.appendChild(txt);
        li.appendChild(link(t("trl.open.wt"), TC.wtLink(rt)));
        ul.appendChild(li);
      });
      rbox.appendChild(ul);
    }
    body.appendChild(rbox);
    body.appendChild(link(t("trl.open.osm"), TC.osmWayLink(w.id)));
  }

  var ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20c3-1 4-4 7-5s5 1 9-3"/><circle cx="19" cy="6" r="2"/><path d="M5 9l2 2 3-4"/></svg>';

  // ---------- boot ----------
  function boot() {
    if (H.addOverlay) Object.keys(overlays).forEach(function (id) { H.addOverlay("trl-" + id, overlays[id], t("trl.ov." + id)); });
    prefs.ov.forEach(function (id) { if (overlays[id] && !map.hasLayer(overlays[id])) overlays[id].addTo(map); });
    if (H.addBaseLayer) {
      H.addBaseLayer("cyclosm", cyclosm, t("trl.base.cyclosm"));
      if (H.prefLayer && H.prefLayer() === "cyclosm" && H.setBase) H.setBase("cyclosm");
    }
    if (Array.isArray(H.ctxItems)) {
      H.ctxItems.push(function (place) {
        return { icon: ICON, label: t("trl.ctx"), run: function () { map.closePopup(); about(place); } };
      });
    }
  }

  window.__orosMapsTrails = {
    about: about, overlays: overlays, cyclosm: cyclosm, t: t,
    prefs: function () { return JSON.parse(JSON.stringify(prefs)); },
    kind: function (v) {
      if (v === undefined) return prefs.tk;
      if (["all", "foot", "bike", "mtb"].indexOf(v) >= 0) { prefs.tk = v; savePrefs(); }
      return prefs.tk;
    }
  };
  boot();
})();
