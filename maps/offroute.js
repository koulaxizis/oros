// ============================================================
// orOS Maps — offroute.js (walking and cycling routes with no network,
// hiking and cycling wave H8, experimental, v1.0.0)
//
// - With no network (or when the router cannot be reached), Walk and
//   Bike routes come from the offline map packs on this device
//   (offroute-core.js reads the roads and paths of the pack's tiles).
//   It works only where a downloaded pack holds every stop, at the
//   "Streets" detail level or more.
// - The route bar says "Offline · experimental"; Directions explains
//   what such a route does not know (one-way and access rules, heights)
//   and shows the kinds of way along it.
// - Nothing is sent anywhere and nothing is stored: the graph lives in
//   memory for the last area only.
// ============================================================
(function () {
  "use strict";
  var OR = window.OrosMapsOffRoute;
  var H = window.__orosMapsHost;
  if (!OR || !H || !H.map) return;
  var LANG = window.orosI18n ? window.orosI18n.lang() : (H.lang === "el" ? "el" : "en");

  var STR = {
    en: {
      "ofr.chip": "Offline · experimental", "ofr.chip.aria": "Route from your offline maps, experimental",
      "ofr.done": "Route from your offline maps (experimental). Check one-way streets and closed paths on the spot.",
      "ofr.far": "No road or path of your offline maps near a stop.",
      "ofr.none": "Your offline maps have no way between these stops.",
      "ofr.big": "Too far for a route from offline maps. Try a shorter stretch.",
      "ofr.fail": "The route from your offline maps didn't work.",
      "ofr.title": "Offline route (experimental)",
      "ofr.note": "Made on this device from your offline maps. They know roads, paths, steps and cycleways, but not one-way rules for bikes, who may use a way, turn rules or heights, so the time is for flat ground (on foot 4 km/h).",
      "ofr.way": "Kind of way",
      "ofr.w.road": "Road", "ofr.w.track": "Track", "ofr.w.path": "Path", "ofr.w.cycleway": "Cycleway", "ofr.w.steps": "Steps", "ofr.w.other": "Other",
      "ofr.u.m": "{n} m", "ofr.u.km": "{n} km"
    },
    el: {
      "ofr.chip": "Εκτός σύνδεσης · πειραματικό", "ofr.chip.aria": "Διαδρομή από τους χάρτες εκτός σύνδεσης, πειραματική",
      "ofr.done": "Διαδρομή από τους χάρτες εκτός σύνδεσης (πειραματική). Έλεγξε επί τόπου μονόδρομους και κλειστά μονοπάτια.",
      "ofr.far": "Δεν υπάρχει δρόμος ή μονοπάτι των χαρτών εκτός σύνδεσης κοντά σε μια στάση.",
      "ofr.none": "Οι χάρτες εκτός σύνδεσης δεν έχουν δρόμο ανάμεσα σε αυτές τις στάσεις.",
      "ofr.big": "Πολύ μακριά για διαδρομή από χάρτες εκτός σύνδεσης. Δοκίμασε μικρότερο κομμάτι.",
      "ofr.fail": "Η διαδρομή από τους χάρτες εκτός σύνδεσης δεν πέτυχε.",
      "ofr.title": "Διαδρομή εκτός σύνδεσης (πειραματική)",
      "ofr.note": "Φτιάχτηκε σε αυτή τη συσκευή από τους χάρτες εκτός σύνδεσης. Ξέρουν δρόμους, μονοπάτια, σκαλιά και ποδηλατόδρομους, αλλά όχι τους μονόδρομους για ποδήλατα, ποιος επιτρέπεται σε έναν δρόμο, τις απαγορεύσεις στροφής ή το υψόμετρο, οπότε ο χρόνος είναι για ίσιωμα (με τα πόδια 4 χλμ./ώρα).",
      "ofr.way": "Είδος δρόμου",
      "ofr.w.road": "Δρόμος", "ofr.w.track": "Χωματόδρομος", "ofr.w.path": "Μονοπάτι", "ofr.w.cycleway": "Ποδηλατόδρομος", "ofr.w.steps": "Σκαλιά", "ofr.w.other": "Άλλο",
      "ofr.u.m": "{n} μ.", "ofr.u.km": "{n} χλμ."
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
  function nf(n, d) { try { return n.toLocaleString(loc(), { maximumFractionDigits: d || 0 }); } catch (e) { return String(Math.round(n)); } }
  function len(n) { return n >= 1000 ? t("ofr.u.km", { n: nf(n / 1000, n < 10000 ? 1 : 0) }) : t("ofr.u.m", { n: nf(Math.round(n)) }); }
  function told(code) { var e = new Error(code); e.told = true; toast(t("ofr." + code)); return e; }

  // the graph of the last area (one per mode), kept while routes stay in it
  var cache = null;      // { mode, maxz, z, g, inner }
  var saidOnce = false;
  function inside(b, pts) { return pts.every(function (p) { return p.lon >= b[0] && p.lon <= b[2] && p.lat >= b[1] && p.lat <= b[3]; }); }
  function graphFor(mode, pts, maxz) {
    if (cache && cache.mode === mode && cache.maxz === maxz && inside(cache.inner, pts)) return Promise.resolve(cache);
    var bbox = OR.areaOf(pts);
    var z = bbox ? OR.pickZoom(bbox, maxz) : -1;
    if (z < 0) return Promise.reject(told("big"));
    var tiles = OR.tilesOf(bbox, z), g = OR.newGraph(mode), i = 0;
    function step() {
      var batch = tiles.slice(i, i + 12);
      i += batch.length;
      if (!batch.length) {
        // routes whose stops stay this far inside the box can reuse it
        var mx = (bbox[2] - bbox[0]) * 0.15, my = (bbox[3] - bbox[1]) * 0.15;
        cache = { mode: mode, maxz: maxz, z: z, g: g, inner: [bbox[0] + mx, bbox[1] + my, bbox[2] - mx, bbox[3] - my] };
        return cache;
      }
      return Promise.all(batch.map(function (tz) {
        return H.offlineTile(tz[0], tz[1], tz[2]).then(function (layers) { if (layers) OR.addTile(g, layers, tz[0], tz[1], tz[2]); }, function () { /* a damaged tile: no ways from it */ });
      })).then(function () { return new Promise(function (res) { setTimeout(res, 0); }); }).then(step);
    }
    return step();
  }

  H.offlineRoute = function (profile, pts, probe) {
    if (profile !== "foot" && profile !== "bike") return probe ? false : null;
    if (!H.offlineTile || !H.offlineCover) return probe ? false : null;
    pts = (pts || []).filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lon); });
    if (pts.length < 2) return probe ? false : null;
    var maxz = H.offlineCover(pts);
    if (maxz < OR.MIN_ZOOM) return probe ? false : null;
    if (probe) return true;
    return graphFor(profile, pts, maxz).then(function (c) {
      var r = OR.route(c.g, pts);
      if (!r.ok) throw told(r.err === "far" ? "far" : "none");
      var o = OR.toOsrm(c.g, r, c.z);
      if (!o) throw told("fail");
      if (!saidOnce) { saidOnce = true; toast(t("ofr.done")); }   // then the chip says it
      return o;
    }, function (e) { throw e && e.told ? e : told("fail"); });
  };
  window.__orosMapsOffRoute = { cache: function () { return cache; }, clear: function () { cache = null; } };

  // ---------- the route bar ----------
  var last = null;
  H.routeHooks.push(function (r) {
    last = r && r.offline ? r.offline : null;
    var sum = document.getElementById("route-summary");
    var chip = document.getElementById("route-offline");
    if (!last || !sum) { if (chip) chip.remove(); return; }
    if (!chip) { chip = el("span", "ofr-chip"); chip.id = "route-offline"; sum.appendChild(chip); }
    chip.textContent = t("ofr.chip");
    chip.setAttribute("aria-label", t("ofr.chip.aria"));
    chip.title = t("ofr.chip.aria");
  });

  // ---------- Directions ----------
  H.extrasHooks.push(function (host, mode) {
    if (!last || last.mode !== mode || !document.getElementById("route-offline")) return;
    var box = el("div", "odr-box ofr-box");
    box.appendChild(el("div", "rx-h", t("ofr.title")));
    box.appendChild(el("p", "odr-note", t("ofr.note")));
    var list = (last.way || []).filter(function (x) { return x && x.m > 0 && /^[a-z]+$/.test(x.k); });
    if (list.length) {
      var bar = el("div", "odr-bar");
      bar.appendChild(el("div", "rx-h", t("ofr.way")));
      var total = 0;
      list.forEach(function (x) { total += x.m; });
      var strip = el("div", "odr-strip"), legend = el("div", "odr-legend");
      list.forEach(function (x) {
        var seg = el("span", "odr-seg odr-w-" + x.k);
        seg.style.width = (x.m / total * 100).toFixed(2) + "%";
        strip.appendChild(seg);
        var li = el("span", "odr-li");
        li.appendChild(el("i", "odr-seg odr-w-" + x.k));
        li.appendChild(document.createTextNode(t("ofr.w." + x.k) + " " + len(x.m)));
        legend.appendChild(li);
      });
      bar.appendChild(strip);
      bar.appendChild(legend);
      box.appendChild(bar);
    }
    host.insertBefore(box, host.firstChild ? host.firstChild.nextSibling : null);
  });
})();
