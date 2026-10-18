// ============================================================
// orOS Maps — heat.js (personal heatmap + statistics, OSM upgrade
// wave 4, v1.0.0). OsmAnd style.
//
//   - "Heatmap and statistics" (from My tracks): a sheet with the
//     heatmap switch, filters (year, folder), totals per year, a bar
//     chart per month, and "new ground" (metres of path through
//     squares of ~40 m you had never crossed before).
//   - The heatmap is our own canvas layer over the map (no library):
//     the Web Worker heat-worker.js parses the GPX files and draws the
//     grid (heat-core.js); the page only scales the picture up. A
//     track whose file is not on this device yet counts with its
//     preview line.
//   - OpenStreetMap public GPS traces (gps.tile.openstreetmap.org) as
//     a see-through overlay: where people walk and drive, for mapping.
//
// Device-local preferences (not synced): oros-maps-heat
//   { on: 0|1, gps: 0|1, year: "", folder: "" }
// Test hook: window.__orosMapsHeat { open, close, state, ready }
// ============================================================
(function () {
  "use strict";
  var HC = window.OrosMapsHeat;
  var T = window.OrosMapsTracks;
  var H = window.__orosMapsHost;
  if (!HC || !T || !H || !H.map || !window.L) return;
  var map = H.map;
  var LANG = window.orosI18n ? window.orosI18n.lang() : (H.lang === "el" ? "el" : "en");

  var STR = {
    en: {
      "heat.title": "Heatmap and statistics",
      "heat.show": "Show my heatmap on the map",
      "heat.gps": "OpenStreetMap GPS traces (everyone's)",
      "heat.gps.hint": "Lines where people uploaded GPS traces. Useful when you map paths and roads.",
      "heat.year": "Year", "heat.folder": "Folder", "heat.all": "All", "heat.allf": "All folders",
      "heat.reading": "Reading tracks… {a} of {b}",
      "heat.built": "From {n} tracks",
      "heat.prev": "{n} of them with a simplified line (the GPX file is not on this device yet)",
      "heat.none": "No tracks yet. Record one or import a GPX file in My tracks.",
      "heat.nomatch": "No track matches the filter.",
      "heat.tot.dist": "Distance", "heat.tot.time": "Time", "heat.tot.n": "Tracks", "heat.tot.new": "New ground",
      "heat.new.hint": "New ground counts the path through squares of about 40 m that you had not crossed in an earlier track.",
      "heat.years": "Per year", "heat.months": "Per month in {y}",
      "heat.col.year": "Year", "heat.col.dist": "Distance", "heat.col.n": "Tracks", "heat.col.new": "New ground",
      "heat.back": "Back", "heat.close": "Close",
      "heat.km": "{n} km", "heat.h": "{n} h",
      "heat.m1": "Jan", "heat.m2": "Feb", "heat.m3": "Mar", "heat.m4": "Apr", "heat.m5": "May", "heat.m6": "Jun",
      "heat.m7": "Jul", "heat.m8": "Aug", "heat.m9": "Sep", "heat.m10": "Oct", "heat.m11": "Nov", "heat.m12": "Dec",
      "heat.chart.label": "Distance per month in {y}: {list}"
    },
    el: {
      "heat.title": "Heatmap και στατιστικά",
      "heat.show": "Εμφάνιση του heatmap μου στον χάρτη",
      "heat.gps": "GPS traces του OpenStreetMap (όλων)",
      "heat.gps.hint": "Γραμμές όπου ο κόσμος ανέβασε GPS traces. Χρήσιμο όταν χαρτογραφείς μονοπάτια και δρόμους.",
      "heat.year": "Έτος", "heat.folder": "Φάκελος", "heat.all": "Όλα", "heat.allf": "Όλοι οι φάκελοι",
      "heat.reading": "Διαβάζονται διαδρομές… {a} από {b}",
      "heat.built": "Από {n} διαδρομές",
      "heat.prev": "{n} από αυτές με απλοποιημένη γραμμή (το αρχείο GPX δεν έχει έρθει σε αυτή τη συσκευή)",
      "heat.none": "Καμία διαδρομή ακόμα. Κατέγραψε μία ή φέρε ένα αρχείο GPX στις Διαδρομές μου.",
      "heat.nomatch": "Καμία διαδρομή δεν ταιριάζει στο φίλτρο.",
      "heat.tot.dist": "Απόσταση", "heat.tot.time": "Χρόνος", "heat.tot.n": "Διαδρομές", "heat.tot.new": "Νέο έδαφος",
      "heat.new.hint": "Το νέο έδαφος μετρά τη διαδρομή μέσα από τετράγωνα περίπου 40 μ. που δεν είχες περάσει σε προηγούμενη διαδρομή.",
      "heat.years": "Ανά έτος", "heat.months": "Ανά μήνα το {y}",
      "heat.col.year": "Έτος", "heat.col.dist": "Απόσταση", "heat.col.n": "Διαδρομές", "heat.col.new": "Νέο έδαφος",
      "heat.back": "Πίσω", "heat.close": "Κλείσιμο",
      "heat.km": "{n} χλμ.", "heat.h": "{n} ώ.",
      "heat.m1": "Ιαν", "heat.m2": "Φεβ", "heat.m3": "Μαρ", "heat.m4": "Απρ", "heat.m5": "Μάι", "heat.m6": "Ιούν",
      "heat.m7": "Ιούλ", "heat.m8": "Αύγ", "heat.m9": "Σεπ", "heat.m10": "Οκτ", "heat.m11": "Νοέ", "heat.m12": "Δεκ",
      "heat.chart.label": "Απόσταση ανά μήνα το {y}: {list}"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "maps", LANG);
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (loc()); }
  function t(k, vars) {
    k = "heat." + k;
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
  function fmtNum(v, d) {
    try { return Number(v).toLocaleString(loc(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
    catch (e) { return Number(v).toFixed(d); }
  }
  function fmtKm(m) { return t("km", { n: fmtNum((m || 0) / 1000, m >= 100000 ? 0 : 1) }); }
  function fmtH(ms) { return t("h", { n: fmtNum((ms || 0) / 3600000, 1) }); }

  // ---------- preferences (device-local) ----------
  var PREF_KEY = "oros-maps-heat";
  var pref = { on: 0, gps: 0, year: "", folder: "" };
  try {
    var pv = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
    if (pv && typeof pv === "object") {
      pref.on = pv.on ? 1 : 0; pref.gps = pv.gps ? 1 : 0;
      pref.year = typeof pv.year === "string" && /^\d{4}$/.test(pv.year) ? pv.year : "";
      pref.folder = typeof pv.folder === "string" ? pv.folder.slice(0, T.LIM.folder) : "";
    }
  } catch (e) {}
  function savePref() { try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch (e) {} }

  // ---------- engine: worker, or the same code on the page ----------
  var worker = null, local = null, seq = 0, cb = {};
  try {
    worker = new Worker("heat-worker.js");
    worker.onmessage = onMsg;
    worker.onerror = function () { worker = null; startLocal(); resync(true); };
  } catch (e) { worker = null; }
  function startLocal() { if (!local) local = new HC.Engine(); }
  if (!worker) startLocal();
  function simp(s) { return T.simplifySeg(s, 3); }
  function prevSegs(prev) {
    var pts = T.decode(prev || ""), segs = [], cur = [];
    pts.forEach(function (p, i) {
      if (i && T.distM(pts[i - 1][0], pts[i - 1][1], p[0], p[1]) > 2000) { if (cur.length) segs.push(cur); cur = []; }
      cur.push([p[0], p[1], null, null]);
    });
    if (cur.length) segs.push(cur);
    return { segs: segs };
  }
  function post(m, then) {
    if (then) { m.seq = ++seq; cb[m.seq] = then; }
    if (worker) { worker.postMessage(m); return; }
    // page fallback, async like the worker
    setTimeout(function () {
      var r = null;
      if (m.op === "add") {
        var tr = T.parseAny(String(m.text || ""), "x.gpx");
        if (tr && tr.segs.length) local.add(m.id, HC.pack(tr, simp), m.start);
        r = { op: "added", id: m.id, ok: !!(tr && tr.segs.length) };
      } else if (m.op === "addPrev") { local.add(m.id, HC.pack(prevSegs(m.prev), null), m.start); r = { op: "added", id: m.id, ok: true }; }
      else if (m.op === "remove") local.remove(m.id);
      else if (m.op === "render") { r = local.render(m.ids, m.view); r.op = "render"; r.seq = m.seq; }
      else if (m.op === "ground") { r = local.newGround(m.ids); r.op = "ground"; r.seq = m.seq; }
      if (r) onMsg({ data: r });
    }, 0);
  }
  function onMsg(e) {
    var m = e.data || {};
    if (m.op === "added") { addedOne(m.id); return; }
    if (m.seq && cb[m.seq]) { var f = cb[m.seq]; delete cb[m.seq]; f(m); }
  }

  // ---------- keeping the engine in step with the track list ----------
  var loaded = {};         // id → { m, prev: bool }
  var pending = 0, total = 0, groundRes = null;
  function fsApi() {
    try { return window.parent && window.parent !== window ? window.parent.orosFS : window.orosFS; }
    catch (e) { return window.orosFS || null; }
  }
  function entries() {
    var tk = window.__orosMapsTracks;
    var d = tk ? tk.data() : { tracks: {} };
    return Object.keys(d.tracks).map(function (k) { return d.tracks[k]; });
  }
  function wanted() { return pref.on || (panel && !panel.hidden); }
  var resyncTimer = 0;
  function resync(force) {
    if (!wanted()) return;
    if (force) loaded = {};
    var list = entries(), ids = {}, fs = fsApi(), todo = [];
    list.forEach(function (e) {
      ids[e.id] = 1;
      var l = loaded[e.id];
      if (l && l.m === e.m && !l.prev) return;
      if (l && l.prev && l.m === e.m && l.tried && Date.now() - l.tried < 30000) return;
      todo.push(e);
    });
    Object.keys(loaded).forEach(function (id) { if (!ids[id]) { delete loaded[id]; post({ op: "remove", id: id }); } });
    if (!todo.length) { refresh(); return; }
    total = todo.length; pending = todo.length;
    groundRes = null;
    render();
    // one file at a time keeps memory flat on a phone
    todo.reduce(function (p, e) {
      return p.then(function () {
        var path = T.pathOf(e.id);
        var rd = fs && path ? Promise.resolve().then(function () { return fs.readText(path); }) : Promise.reject(new Error("nofs"));
        return rd.then(function (txt) {
          loaded[e.id] = { m: e.m, prev: false };
          post({ op: "add", id: e.id, text: txt, start: e.start });
        }, function () {
          loaded[e.id] = { m: e.m, prev: true, tried: Date.now() };
          if (e.prev) post({ op: "addPrev", id: e.id, prev: e.prev, start: e.start });
          else addedOne(e.id);
        });
      });
    }, Promise.resolve());
  }
  function addedOne() {
    if (pending > 0) pending--;
    if (!pending) refresh();
    else if (panel && !panel.hidden && (pending % 5 === 0)) renderStatus();
  }
  function refresh() {
    groundRes = null;
    draw();
    ground();
    render();
  }
  window.addEventListener("oros-maps-tracks-changed", function () {
    clearTimeout(resyncTimer);
    resyncTimer = setTimeout(function () { resync(false); }, 400);
  });

  function filtered() { return HC.filterEntries(entries(), { year: pref.year, folder: pref.folder }); }
  function filteredIds() { return filtered().map(function (e) { return e.id; }); }

  // ---------- the heat layer ----------
  var canvas = null, drawSeq = 0, layerOn = false;
  function layerAdd() {
    if (layerOn) return;
    layerOn = true;
    canvas = el("canvas", "heat-canvas leaflet-zoom-hide");
    canvas.setAttribute("aria-hidden", "true");
    map.getPanes().overlayPane.appendChild(canvas);
    map.on("moveend zoomend resize viewreset", draw);
    draw();
  }
  function layerRemove() {
    if (!layerOn) return;
    layerOn = false;
    map.off("moveend zoomend resize viewreset", draw);
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null;
  }
  function draw() {
    if (!layerOn || !canvas) return;
    var size = map.getSize(), pb = map.getPixelBounds(), z = map.getZoom();
    var topLeft = map.containerPointToLayerPoint([0, 0]);
    var mine = ++drawSeq;
    var cell = z >= 15 ? 3 : 2;
    post({ op: "render", ids: filteredIds(), view: { z: z, x0: pb.min.x, y0: pb.min.y, w: size.x, h: size.y, cell: cell } }, function (r) {
      if (mine !== drawSeq || !canvas) return;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(size.x * dpr); canvas.height = Math.round(size.y * dpr);
      canvas.style.width = size.x + "px"; canvas.style.height = size.y + "px";
      L.DomUtil.setPosition(canvas, topLeft);
      var g = canvas.getContext("2d");
      if (!g) return;
      g.clearRect(0, 0, canvas.width, canvas.height);
      canvas.dataset.max = String(r.max || 0);
      canvas.dataset.drawn = String(r.drawn || 0);
      if (!r.max) return;
      var off = document.createElement("canvas");
      off.width = r.gw; off.height = r.gh;
      var og = off.getContext("2d");
      og.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.gw, r.gh), 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(off, 0, 0, r.gw * r.cell * dpr, r.gh * r.cell * dpr);
    });
  }

  // OpenStreetMap public GPS traces overlay
  var gpsLayer = null;
  function gpsSet(on) {
    if (on && !gpsLayer) {
      gpsLayer = L.tileLayer("https://gps.tile.openstreetmap.org/lines/{z}/{x}/{y}.png", {
        maxZoom: 20, maxNativeZoom: 20, opacity: 0.85, zIndex: 5,
        attribution: 'GPS traces © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
      }).addTo(map);
    } else if (!on && gpsLayer) { map.removeLayer(gpsLayer); gpsLayer = null; }
  }

  // ---------- new ground ----------
  var groundSeq = 0;
  function ground() {
    var mine = ++groundSeq;
    post({ op: "ground", ids: filteredIds() }, function (r) {
      if (mine !== groundSeq) return;
      groundRes = r;
      if (panel && !panel.hidden) render();
    });
  }

  // ---------- the sheet ----------
  var panel = null, statusEl = null;
  function setH() {
    var h = 0;
    document.querySelectorAll(".osm-sheet").forEach(function (s) { if (!s.hidden) h = Math.max(h, s.offsetHeight); });
    document.body.style.setProperty("--osm-h", h + "px");
  }
  function open() {
    try { window.dispatchEvent(new CustomEvent("oros-maps-mode", { detail: "heat" })); } catch (e) {}
    panel.hidden = false;
    document.body.classList.add("osm-mode");
    resync(false);
    render();
  }
  function close(toTracks) {
    if (panel.hidden) return;
    panel.hidden = true;
    document.body.classList.toggle("osm-mode", document.querySelectorAll(".osm-sheet:not([hidden])").length > 0);
    setH();
    if (toTracks && window.__orosMapsTracks) window.__orosMapsTracks.setMode(true);
  }
  window.addEventListener("oros-maps-mode", function (e) { if (e.detail !== "heat") close(false); });

  function renderStatus() {
    if (!statusEl) return;
    statusEl.textContent = "";
    var all = entries();
    if (pending) { statusEl.appendChild(el("p", "osm-hint", t("reading", { a: total - pending, b: total }))); return; }
    var f = filtered();
    if (!all.length) { statusEl.appendChild(el("p", "osm-hint", t("none"))); return; }
    if (!f.length) { statusEl.appendChild(el("p", "osm-hint", t("nomatch"))); return; }
    statusEl.appendChild(el("p", "osm-small", t("built", { n: f.length })));
    var np = f.filter(function (e) { return loaded[e.id] && loaded[e.id].prev; }).length;
    if (np) statusEl.appendChild(el("p", "osm-small", t("prev", { n: np })));
  }

  function render() {
    if (!panel || panel.hidden) return;
    panel.textContent = "";
    var hd = el("header", "");
    var back = button("", "osm-iconbtn", function () { close(true); });
    back.setAttribute("aria-label", t("back")); back.title = t("back");
    back.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
    hd.appendChild(back);
    hd.appendChild(el("h3", "", t("title")));
    var cl = button("", "osm-iconbtn osm-close", function () { close(false); });
    cl.setAttribute("aria-label", t("close")); cl.title = t("close");
    cl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    hd.appendChild(cl);
    panel.appendChild(hd);
    var body = el("div", "osm-body");

    function check(label, on, fn, cls) {
      var lab = el("label", "heat-check" + (cls ? " " + cls : ""));
      var cb2 = el("input", "");
      cb2.type = "checkbox"; cb2.checked = !!on;
      cb2.addEventListener("change", function () { fn(cb2.checked); });
      lab.appendChild(cb2);
      lab.appendChild(el("span", "", label));
      body.appendChild(lab);
      return cb2;
    }
    check(t("show"), pref.on, function (v) { pref.on = v ? 1 : 0; savePref(); if (v) { layerAdd(); resync(false); } else layerRemove(); }, "heat-show");
    check(t("gps"), pref.gps, function (v) { pref.gps = v ? 1 : 0; savePref(); gpsSet(v); }, "heat-gps");
    body.appendChild(el("p", "osm-small heat-gps-hint", t("gps.hint")));

    var all = entries();
    var fr = el("div", "heat-filters");
    var ys = el("select", "osm-in");
    ys.setAttribute("aria-label", t("year"));
    var o = el("option", "", t("year") + ": " + t("all")); o.value = ""; ys.appendChild(o);
    HC.years(all).forEach(function (y) { var x = el("option", "", y); x.value = y; ys.appendChild(x); });
    ys.value = pref.year;
    if (ys.value !== pref.year) { pref.year = ""; ys.value = ""; }
    fr.appendChild(ys);
    var folders = [];
    all.forEach(function (e) { if (e.folder && folders.indexOf(e.folder) < 0) folders.push(e.folder); });
    folders.sort();
    var fs = null;
    if (folders.length) {
      fs = el("select", "osm-in");
      fs.setAttribute("aria-label", t("folder"));
      var o2 = el("option", "", t("allf")); o2.value = ""; fs.appendChild(o2);
      folders.forEach(function (f) { var x = el("option", "", f); x.value = f; fs.appendChild(x); });
      fs.value = pref.folder;
      if (fs.value !== pref.folder) { pref.folder = ""; fs.value = ""; }
      fr.appendChild(fs);
    } else pref.folder = "";
    function onFilter() { pref.year = ys.value; pref.folder = fs ? fs.value : ""; savePref(); refresh(); }
    ys.addEventListener("change", onFilter);
    if (fs) fs.addEventListener("change", onFilter);
    body.appendChild(fr);

    statusEl = el("div", "heat-status");
    body.appendChild(statusEl);
    renderStatus();

    var f = filtered();
    if (f.length) {
      var st = HC.stats(f);
      var grid = el("div", "trk-stats heat-totals");
      [[t("tot.dist"), fmtKm(st.dist)], [t("tot.time"), fmtH(st.dur)], [t("tot.n"), String(st.n)],
       [t("tot.new"), groundRes ? fmtKm(groundRes.total) : "…"]].forEach(function (v) {
        var c = el("div", "trk-stat");
        c.appendChild(el("b", "", v[1]));
        c.appendChild(el("span", "", v[0]));
        grid.appendChild(c);
      });
      body.appendChild(grid);
      body.appendChild(el("p", "osm-small", t("new.hint")));

      // per month chart for the chosen year (or the newest one)
      var yrs = HC.years(f);
      var y = pref.year || yrs[0];
      if (y) body.appendChild(monthChart(st, y));

      // per year table
      var allSt = HC.stats(HC.filterEntries(all, { folder: pref.folder }));
      var yk = Object.keys(allSt.years).sort().reverse();
      if (yk.length) {
        body.appendChild(el("h4", "heat-h", t("years")));
        var tb = el("table", "heat-table");
        var tr0 = el("tr", "");
        [t("col.year"), t("col.dist"), t("col.n"), t("col.new")].forEach(function (h) { tr0.appendChild(el("th", "", h)); });
        tb.appendChild(tr0);
        yk.forEach(function (k) {
          var r = el("tr", "");
          var nm = 0;
          if (groundRes && !pref.year) Object.keys(groundRes.months).forEach(function (mk) { if (mk.slice(0, 4) === k) nm += groundRes.months[mk]; });
          [k, fmtKm(allSt.years[k].dist), String(allSt.years[k].n), groundRes && !pref.year ? fmtKm(nm) : "–"].forEach(function (v) { r.appendChild(el("td", "", v)); });
          tb.appendChild(r);
        });
        body.appendChild(tb);
      }
    }
    panel.appendChild(body);
    setH();
  }

  function monthChart(st, y) {
    var box = el("div", "heat-chart");
    box.appendChild(el("h4", "heat-h", t("months", { y: y })));
    var vals = [];
    for (var i = 1; i <= 12; i++) {
      var k = y + "-" + (i < 10 ? "0" : "") + i;
      vals.push(st.months[k] ? st.months[k].dist : 0);
    }
    var cv = el("canvas", "");
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", t("chart.label", { y: y, list: vals.map(function (v, i) { return t("m" + (i + 1)) + " " + fmtKm(v); }).join(", ") }));
    box.appendChild(cv);
    requestAnimationFrame(function () {
      var w = Math.max(200, Math.round(box.clientWidth || 300)), h = 130, dpr = window.devicePixelRatio || 1;
      cv.width = w * dpr; cv.height = h * dpr;
      cv.style.width = w + "px"; cv.style.height = h + "px";
      var g = cv.getContext("2d");
      if (!g) return;
      g.scale(dpr, dpr);
      var css = getComputedStyle(document.body);
      var acc = (css.getPropertyValue("--accent") || "#d4af37").trim() || "#d4af37";
      var dim = (css.getPropertyValue("--text-dim") || "#888").trim() || "#888";
      var max = Math.max.apply(null, vals) || 1, bw = w / 12;
      g.font = "10px system-ui, sans-serif";
      g.textAlign = "center";
      vals.forEach(function (v, i) {
        var bh = Math.round(v / max * (h - 34));
        g.fillStyle = acc;
        if (v) g.fillRect(i * bw + 3, h - 16 - bh, bw - 6, Math.max(2, bh));
        g.fillStyle = dim;
        g.fillText(t("m" + (i + 1)), i * bw + bw / 2, h - 3);
        if (v) g.fillText(fmtNum(v / 1000, v >= 100000 ? 0 : 1), i * bw + bw / 2, h - 20 - bh);
      });
    });
    return box;
  }

  function boot() {
    panel = el("aside", "osm-sheet");
    panel.id = "heat-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", t("title"));
    document.body.appendChild(panel);
    try { new ResizeObserver(setH).observe(panel); } catch (e) {}
    if (pref.on) { layerAdd(); resync(false); }
    if (pref.gps) gpsSet(true);
  }

  window.__orosMapsHeat = {
    open: open,
    close: function () { close(false); },
    state: function () {
      return { pref: JSON.parse(JSON.stringify(pref)), pending: pending, loaded: JSON.parse(JSON.stringify(loaded)),
        ground: groundRes, worker: !!worker, layer: layerOn, gps: !!gpsLayer };
    },
    ready: function () { return !pending; }
  };
  boot();
})();
