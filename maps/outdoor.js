// ============================================================
// orOS Maps — outdoor.js (hiking and cycling routes, wave H2, v1.0.0)
//
// - Walk and Bike routes from BRouter, with a route type per mode:
//   Walk: Hiking (mountain paths) or Standard; Bike: Touring, Road
//   bike, Quiet roads, Gravel, Mountain bike or Standard. "Standard"
//   is the OSRM router Maps used before. If BRouter does not answer,
//   Maps falls back to Standard and says so.
// - The route bar shows the climb and descent; Directions gets the
//   route type chips, the elevation profile (lowest / highest point)
//   and two bars: surfaces (paved, gravel, ground, unknown) and kinds
//   of way (road, track, path, cycleway, steps), as OsmAnd analyses a
//   route.
// - Plan a track uses the same route type for its Walk / Bike parts.
// - Maps settings › Trail router: the address of your own BRouter.
//
// Choices are device-local ("oros-maps-outdoor"). Nothing is synced.
// Text goes on the page with textContent; numbers only from the
// router reach the chart.
// ============================================================
(function () {
  "use strict";
  var OC = window.OrosMapsOutdoor;
  var H = window.__orosMapsHost;
  if (!OC || !H || !H.map) return;
  var LANG = window.orosI18n ? window.orosI18n.lang() : (H.lang === "el" ? "el" : "en");
  var PREFS_KEY = "oros-maps-outdoor";
  var TIMEOUT = 25000;

  var STR = {
    en: {
      "odr.type": "Route type", "odr.k.foot.hiking": "Hiking", "odr.k.foot.std": "Standard",
      "odr.k.bike.trekking": "Touring", "odr.k.bike.road": "Road bike", "odr.k.bike.quiet": "Quiet roads",
      "odr.k.bike.gravel": "Gravel", "odr.k.bike.mtb": "Mountain bike", "odr.k.bike.std": "Standard",
      "odr.h.foot.hiking": "Paths and trails, with the climbs in the time", "odr.h.foot.std": "The quickest way on foot",
      "odr.h.bike.trekking": "Cycleways and quiet roads, some gravel", "odr.h.bike.road": "Smooth asphalt, fast",
      "odr.h.bike.quiet": "Avoids busy roads", "odr.h.bike.gravel": "Gravel roads and tracks",
      "odr.h.bike.mtb": "Trails and tracks", "odr.h.bike.std": "The quickest way by bike",
      "odr.fallback": "The trail router didn't answer, so this is the standard route.",
      "odr.climb": "↗ {up} ↘ {down}", "odr.climb.aria": "Climb {up}, descent {down}",
      "odr.prof": "Elevation", "odr.prof.lohi": "Lowest {lo} · highest {hi}",
      "odr.surf": "Surface", "odr.way": "Kind of way",
      "odr.s.paved": "Paved", "odr.s.gravel": "Gravel", "odr.s.ground": "Earth, grass, rock", "odr.s.unknown": "Not known",
      "odr.w.road": "Road", "odr.w.track": "Track", "odr.w.path": "Path", "odr.w.cycleway": "Cycleway", "odr.w.steps": "Steps", "odr.w.other": "Other",
      "odr.time.foot": "The walking time counts the climbs (DIN 33466 hiking rule: 4 km/h, 300 m up and 500 m down an hour).",
      "odr.set": "Trail router", "odr.set.hint": "Walk and Bike routes come from BRouter (brouter.de), a free open-source router. You can use your own BRouter server instead.",
      "odr.set.base": "Server address", "odr.set.save": "Save", "odr.set.reset": "Use brouter.de",
      "odr.set.bad": "Use an https:// address (http:// only for localhost).", "odr.set.ok": "Trail router saved",
      "odr.u.m": "{n} m", "odr.u.km": "{n} km"
    },
    el: {
      "odr.type": "Είδος διαδρομής", "odr.k.foot.hiking": "Πεζοπορία", "odr.k.foot.std": "Τυπική",
      "odr.k.bike.trekking": "Περιήγηση", "odr.k.bike.road": "Ποδήλατο δρόμου", "odr.k.bike.quiet": "Ήσυχοι δρόμοι",
      "odr.k.bike.gravel": "Gravel", "odr.k.bike.mtb": "Ποδήλατο βουνού", "odr.k.bike.std": "Τυπική",
      "odr.h.foot.hiking": "Μονοπάτια, με τις ανηφόρες μέσα στον χρόνο", "odr.h.foot.std": "Ο πιο γρήγορος δρόμος με τα πόδια",
      "odr.h.bike.trekking": "Ποδηλατόδρομοι και ήσυχοι δρόμοι, λίγο χαλίκι", "odr.h.bike.road": "Λεία άσφαλτος, γρήγορα",
      "odr.h.bike.quiet": "Αποφεύγει τους πολυσύχναστους δρόμους", "odr.h.bike.gravel": "Χαλικόδρομοι και χωματόδρομοι",
      "odr.h.bike.mtb": "Μονοπάτια και χωματόδρομοι", "odr.h.bike.std": "Ο πιο γρήγορος δρόμος με ποδήλατο",
      "odr.fallback": "Ο δρομολογητής μονοπατιών δεν απάντησε, οπότε αυτή είναι η τυπική διαδρομή.",
      "odr.climb": "↗ {up} ↘ {down}", "odr.climb.aria": "Ανάβαση {up}, κατάβαση {down}",
      "odr.prof": "Υψόμετρο", "odr.prof.lohi": "Χαμηλότερο {lo} · ψηλότερο {hi}",
      "odr.surf": "Επιφάνεια", "odr.way": "Είδος δρόμου",
      "odr.s.paved": "Στρωμένο", "odr.s.gravel": "Χαλίκι", "odr.s.ground": "Χώμα, χόρτο, βράχος", "odr.s.unknown": "Άγνωστο",
      "odr.w.road": "Δρόμος", "odr.w.track": "Χωματόδρομος", "odr.w.path": "Μονοπάτι", "odr.w.cycleway": "Ποδηλατόδρομος", "odr.w.steps": "Σκαλιά", "odr.w.other": "Άλλο",
      "odr.time.foot": "Ο χρόνος με τα πόδια μετράει τις ανηφόρες (κανόνας πεζοπορίας DIN 33466: 4 χλμ./ώρα, 300 μ. ανάβαση και 500 μ. κατάβαση την ώρα).",
      "odr.set": "Δρομολογητής μονοπατιών", "odr.set.hint": "Οι διαδρομές με τα πόδια και με ποδήλατο έρχονται από το BRouter (brouter.de), έναν δωρεάν δρομολογητή ανοιχτού κώδικα. Μπορείς να βάλεις δικό σου διακομιστή BRouter.",
      "odr.set.base": "Διεύθυνση διακομιστή", "odr.set.save": "Αποθήκευση", "odr.set.reset": "Χρήση του brouter.de",
      "odr.set.bad": "Βάλε διεύθυνση https:// (http:// μόνο για localhost).", "odr.set.ok": "Ο δρομολογητής μονοπατιών αποθηκεύτηκε",
      "odr.u.m": "{n} μ.", "odr.u.km": "{n} χλμ."
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
  function toast(s) { (H.toast || H.localToast)(s); }
  function online() { return navigator.onLine !== false; }
  function nf(n, d) { try { return n.toLocaleString(loc(), { maximumFractionDigits: d || 0 }); } catch (e) { return String(Math.round(n)); } }
  function m(n) { return t("odr.u.m", { n: nf(Math.round(n)) }); }
  function len(n) { return n >= 1000 ? t("odr.u.km", { n: nf(n / 1000, n < 10000 ? 1 : 0) }) : m(n); }
  function okNum(x) { return typeof x === "number" && isFinite(x); }

  // ---------- device-local prefs ----------
  var prefs = { foot: OC.DEFAULT.foot, bike: OC.DEFAULT.bike, base: "" };
  try {
    var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    if (p) {
      ["foot", "bike"].forEach(function (k) { if (p[k] && OC.kindOf(k, p[k]).id === p[k]) prefs[k] = p[k]; });
      if (typeof p.base === "string" && OC.cleanBase(p.base)) prefs.base = OC.cleanBase(p.base);
    }
  } catch (e) { /* defaults */ }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* a preference */ } }

  // ---------- the router ----------
  function fetchOutdoor(mode, pts) {
    if (mode !== "foot" && mode !== "bike") return null;
    var kind = OC.kindOf(mode, prefs[mode]);
    if (!kind || !kind.brf || !online()) return null;
    var url = OC.routeUrl(prefs.base || OC.BASE, kind.brf, pts);
    if (!url) return null;
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    return fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }, function (e) { clearTimeout(timer); throw e; }).then(function (j) {
      var out = OC.toOsrm(j, mode, pts);
      if (!out) throw new Error("shape");
      return out;
    });
  }
  H.outdoorFetch = fetchOutdoor;
  H.outdoorFailed = function () { toast(t("odr.fallback")); };

  // ---------- route bar: climb ----------
  function cleanOutdoor(o) {
    if (!o || typeof o !== "object" || !okNum(o.up) || !okNum(o.down)) return null;
    return o;
  }
  function paintBar(o) {
    var sum = document.getElementById("route-summary");
    if (!sum) return;
    var chip = document.getElementById("route-climb");
    o = cleanOutdoor(o);
    if (!o) { if (chip) chip.remove(); return; }
    if (!chip) { chip = el("span", ""); chip.id = "route-climb"; sum.appendChild(chip); }
    chip.textContent = t("odr.climb", { up: m(o.up), down: m(o.down) });
    chip.setAttribute("aria-label", t("odr.climb.aria", { up: m(o.up), down: m(o.down) }));
    chip.title = chip.getAttribute("aria-label");
  }
  H.routeHooks.push(function (r) { paintBar(r && r.outdoor); });

  // ---------- Directions: type, profile, bars ----------
  var NS = "http://www.w3.org/2000/svg";
  function profileSvg(prof) {
    var W = 300, Hh = 72;
    var pts = prof.filter(function (q) { return Array.isArray(q) && okNum(q[0]) && okNum(q[1]); });
    if (pts.length < 2) return null;
    var total = pts[pts.length - 1][0] || 1, lo = Infinity, hi = -Infinity;
    pts.forEach(function (q) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); });
    var lo2 = lo, hi2 = hi;
    if (hi2 - lo2 < 20) { hi2 += 10; lo2 -= 10; }
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + Hh);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "odr-prof");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", t("odr.prof") + ": " + t("odr.prof.lohi", { lo: m(lo), hi: m(hi) }));
    var d = "M0 " + Hh;
    pts.forEach(function (q) { d += " L" + (q[0] / total * W).toFixed(1) + " " + (Hh - 3 - (q[1] - lo2) / (hi2 - lo2) * (Hh - 6)).toFixed(1); });
    d += " L" + W + " " + Hh + " Z";
    var area = document.createElementNS(NS, "path");
    area.setAttribute("d", d);
    area.setAttribute("class", "odr-prof-area");
    svg.appendChild(area);
    return { svg: svg, lo: lo, hi: hi };
  }
  function bar(title, list, prefix) {
    var box = el("div", "odr-bar");
    box.appendChild(el("div", "rx-h", title));
    var total = 0;
    list.forEach(function (x) { total += x.m; });
    var strip = el("div", "odr-strip");
    var legend = el("div", "odr-legend");
    list.forEach(function (x) {
      if (!(x.m > 0) || !/^[a-z]+$/.test(x.k)) return;
      var seg = el("span", "odr-seg odr-" + prefix + "-" + x.k);
      seg.style.width = (x.m / total * 100).toFixed(2) + "%";
      strip.appendChild(seg);
      var li = el("span", "odr-li");
      li.appendChild(el("i", "odr-seg odr-" + prefix + "-" + x.k));
      li.appendChild(document.createTextNode(t("odr." + prefix + "." + x.k) + " " + len(x.m)));
      legend.appendChild(li);
    });
    box.appendChild(strip);
    box.appendChild(legend);
    return box;
  }
  H.extrasHooks.push(function (host, mode) {
    if (mode !== "foot" && mode !== "bike") return;
    var box = el("div", "odr-box");
    box.appendChild(el("div", "rx-h", t("odr.type")));
    var chips = el("div", "odr-kinds");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", t("odr.type"));
    OC.PROFILES[mode].forEach(function (k) {
      var b = el("button", "odr-kind" + (prefs[mode] === k.id ? " on" : ""), t("odr.k." + mode + "." + k.id));
      b.type = "button";
      b.title = t("odr.h." + mode + "." + k.id);
      b.setAttribute("aria-pressed", prefs[mode] === k.id ? "true" : "false");
      b.setAttribute("data-kind", k.id);
      b.addEventListener("click", function () {
        if (prefs[mode] === k.id) return;
        prefs[mode] = k.id;
        savePrefs();
        H.reroute();
      });
      chips.appendChild(b);
    });
    box.appendChild(chips);
    var o = cleanOutdoor(H.routeOutdoor && H.routeOutdoor());
    if (o && o.mode === mode) {
      var pr = Array.isArray(o.prof) ? profileSvg(o.prof) : null;
      if (pr) {
        var ph = el("div", "rx-h", t("odr.prof"));
        box.appendChild(ph);
        box.appendChild(pr.svg);
        box.appendChild(el("div", "odr-lohi", t("odr.climb", { up: m(o.up), down: m(o.down) }) + " · " + t("odr.prof.lohi", { lo: m(pr.lo), hi: m(pr.hi) })));
      }
      if (Array.isArray(o.surf) && o.surf.length) box.appendChild(bar(t("odr.surf"), o.surf, "s"));
      if (Array.isArray(o.way) && o.way.length) box.appendChild(bar(t("odr.way"), o.way, "w"));
      if (mode === "foot") box.appendChild(el("p", "odr-note", t("odr.time.foot")));
    }
    host.insertBefore(box, host.firstChild ? host.firstChild.nextSibling : null);
  });

  // ---------- settings ----------
  function boot() {
    var sbody = document.getElementById("mapsettings-body");
    if (sbody) {
      var box = el("div", "odr-settings");
      box.appendChild(el("h4", "", t("odr.set")));
      box.appendChild(el("p", "", t("odr.set.hint")));
      var lab = el("label", "osm-lab");
      lab.appendChild(el("span", "", t("odr.set.base")));
      var inp = el("input", "osm-in");
      inp.type = "url"; inp.id = "odr-base"; inp.placeholder = OC.BASE; inp.value = prefs.base;
      inp.setAttribute("autocomplete", "off"); inp.spellcheck = false;
      lab.appendChild(inp);
      box.appendChild(lab);
      var row = el("div", "odr-set-row");
      var save = el("button", "ms-btn", t("odr.set.save"));
      save.type = "button";
      save.addEventListener("click", function () {
        var v = OC.cleanBase(inp.value);
        if (v === null) { toast(t("odr.set.bad")); return; }
        prefs.base = v; inp.value = v; savePrefs(); toast(t("odr.set.ok"));
      });
      var reset = el("button", "ms-btn", t("odr.set.reset"));
      reset.type = "button";
      reset.addEventListener("click", function () { prefs.base = ""; inp.value = ""; savePrefs(); toast(t("odr.set.ok")); });
      row.appendChild(save); row.appendChild(reset);
      box.appendChild(row);
      sbody.appendChild(box);
    }
    paintBar(H.routeOutdoor && H.routeOutdoor());   // a route restored at start
  }

  window.__orosMapsOutdoor = {
    prefs: function () { return JSON.parse(JSON.stringify(prefs)); },
    setKind: function (mode, id) { if (OC.kindOf(mode, id) && OC.kindOf(mode, id).id === id) { prefs[mode] = id; savePrefs(); } },
    fetch: fetchOutdoor
  };
  boot();
})();
