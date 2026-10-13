// ============================================================
// orOS Maps — planner.js (OsmAnd "Plan a route", maps wave 10B,
// v1.0.0)
// "Plan a track" sheet (long-press › "Plan a track from here", or
// My tracks › "Plan a track"): tap the map to add points. Each new
// part follows the roads for walking, bike or car (OSRM, the same
// free servers as Directions) or goes straight, as chosen when the
// point is added. Points can be dragged (their parts are routed
// again) or tapped to remove them. The sheet shows the length and,
// online, an elevation profile with climb and descent read from
// AWS Terrain Tiles (free, no key). "Save to My tracks" keeps it as
// a GPX track (synced like any import); nothing else is saved.
//
// Safety: the track name goes on the page with textContent only.
// ============================================================
(function () {
  "use strict";
  var PC = window.OrosMapsPlanner;
  var RC = window.OrosMapsRoute;
  var H = window.__orosMapsHost;
  if (!PC || !RC || !H || !H.map || !window.L) return;
  var map = H.map;
  var LANG = H.lang === "el" ? "el" : "en";
  var TC = window.OrosMapsTools;

  var STR = {
    en: {
      "ctx": "Plan a track from here", "title": "Plan a track",
      "hint": "Tap the map to add points. Drag a point to move it, tap it to remove it.",
      "m.foot": "Walk", "m.bike": "Bike", "m.car": "Car", "m.line": "Straight line",
      "next": "Next part", "dist": "Length", "pts": "{n} points",
      "ele": "Elevation", "ele.wait": "Getting elevation…", "ele.off": "Elevation needs a connection.",
      "ele.fail": "Elevation could not be loaded.", "ele.more": "Add a second point to see the profile.",
      "up": "Climb {n} m", "down": "Descent {n} m", "range": "Lowest {a} m · highest {b} m",
      "routing": "Following the roads…", "noroute": "No road route there, so that part is a straight line.",
      "offline": "Offline: new parts are straight lines.",
      "undo": "Undo", "clear": "Clear", "name": "Name", "name.def": "Planned track {d}",
      "save": "Save to My tracks", "saved": "Saved to My tracks", "savefail": "Could not save the track.",
      "need2": "Add at least two points.", "max": "That's the most points a plan can have.",
      "profile": "Elevation profile", "close": "Close"
    },
    el: {
      "ctx": "Σχεδίασε διαδρομή από εδώ", "title": "Σχεδίαση διαδρομής",
      "hint": "Πάτα στον χάρτη για να προσθέσεις σημεία. Σύρε ένα σημείο για να το μετακινήσεις, πάτα το για να το αφαιρέσεις.",
      "m.foot": "Με τα πόδια", "m.bike": "Ποδήλατο", "m.car": "Αυτοκίνητο", "m.line": "Ευθεία γραμμή",
      "next": "Επόμενο κομμάτι", "dist": "Μήκος", "pts": "{n} σημεία",
      "ele": "Υψόμετρο", "ele.wait": "Φόρτωση υψομέτρου…", "ele.off": "Το υψόμετρο θέλει σύνδεση.",
      "ele.fail": "Δεν φορτώθηκε το υψόμετρο.", "ele.more": "Πρόσθεσε δεύτερο σημείο για να δεις το προφίλ.",
      "up": "Ανάβαση {n} μ.", "down": "Κατάβαση {n} μ.", "range": "Χαμηλότερο {a} μ. · υψηλότερο {b} μ.",
      "routing": "Ακολουθεί τους δρόμους…", "noroute": "Δεν βρέθηκε δρόμος εκεί, οπότε το κομμάτι είναι ευθεία γραμμή.",
      "offline": "Χωρίς σύνδεση: τα νέα κομμάτια είναι ευθείες γραμμές.",
      "undo": "Αναίρεση", "clear": "Καθαρισμός", "name": "Όνομα", "name.def": "Σχεδιασμένη διαδρομή {d}",
      "save": "Αποθήκευση στις Διαδρομές μου", "saved": "Αποθηκεύτηκε στις Διαδρομές μου", "savefail": "Δεν αποθηκεύτηκε η διαδρομή.",
      "need2": "Πρόσθεσε τουλάχιστον δύο σημεία.", "max": "Ένα σχέδιο δεν μπορεί να έχει περισσότερα σημεία.",
      "profile": "Προφίλ υψομέτρου", "close": "Κλείσιμο"
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
  function online() { return navigator.onLine !== false; }
  function fmtLen(m) {
    if (TC) return TC.fmtLen(m, LANG);
    return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km";
  }
  var ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h4l2-12h4"/></svg>';

  // ---------- state ----------
  var pts = [], segs = [], curMode = "foot", seq = 0, name = "";
  var layer = L.layerGroup(), markers = [];
  var ele = { samples: null, vals: null, state: "", key: "" };
  var open = false, panel = null, offlineSaid = false;

  function routeSeg(i) {
    var s = segs[i];
    if (!s) return;
    var a = pts[i], b = pts[i + 1];
    s.line = PC.straight(a, b);
    s.busy = false;
    if (s.mode === "line") return;
    if (!online()) {
      if (!offlineSaid) { toast(t("offline")); offlineSaid = true; }
      return;
    }
    var base = H.routerBase && H.routerBase[s.mode];
    if (!base) return;
    var my = s.req = ++seq;
    s.busy = true;
    fetch(RC.routeUrl(base, [a, b], { profile: s.mode })).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (j) {
      if (s.req !== my || segs[i] !== s) return;
      s.busy = false;
      var line = PC.lineFromOsrm(j);
      if (line) {
        // OSRM snaps the ends to the road: the line starts and ends
        // at the points themselves, so the parts always meet.
        line[0] = [a.lat, a.lon]; line[line.length - 1] = [b.lat, b.lon];
        s.line = line;
      } else toast(t("noroute"));
      changed();
    }, function () {
      if (s.req !== my || segs[i] !== s) return;
      s.busy = false;
      toast(t("noroute"));
      changed();
    });
  }
  function add(lat, lon) {
    if (pts.length >= PC.MAX_PTS) { toast(t("max")); return; }
    pts.push({ lat: lat, lon: lon });
    if (pts.length > 1) {
      segs.push({ mode: curMode, line: null, busy: false });
      routeSeg(segs.length - 1);
    }
    changed();
  }
  function removeAt(i) {
    if (i < 0 || i >= pts.length) return;
    pts.splice(i, 1);
    if (!pts.length) { segs = []; }
    else if (i === 0) segs.shift();
    else if (i === pts.length) segs.pop();
    else {
      // The two parts around the point become one, with the mode of the first.
      var m = segs[i - 1].mode;
      segs.splice(i - 1, 2, { mode: m, line: null, busy: false });
      routeSeg(i - 1);
    }
    changed();
  }
  function moveTo(i, lat, lon) {
    pts[i] = { lat: lat, lon: lon };
    if (i > 0) routeSeg(i - 1);
    if (i < segs.length) routeSeg(i);
    changed();
  }
  function clearAll() {
    pts = []; segs = []; ele = { samples: null, vals: null, state: "", key: "" };
    changed();
  }

  // ---------- drawing ----------
  function ptIcon(i, last) {
    return L.divIcon({ className: "pl-pt" + (i === 0 ? " first" : last ? " last" : ""),
      html: "<span>" + (i + 1) + "</span>", iconSize: [22, 22], iconAnchor: [11, 11] });
  }
  function paint() {
    layer.clearLayers();
    markers = [];
    segs.forEach(function (s) {
      if (!s.line) return;
      L.polyline(s.line, {
        color: s.busy ? "#888" : "#2b8a3e", weight: 4, opacity: 0.9, interactive: false,
        dashArray: s.mode === "line" ? "8 6" : (s.busy ? "2 6" : null)
      }).addTo(layer);
    });
    pts.forEach(function (p, i) {
      var m = L.marker([p.lat, p.lon], { icon: ptIcon(i, i === pts.length - 1 && i > 0), draggable: true, keyboard: false, zIndexOffset: 600 });
      m.on("dragend", function (e) { var q = e.target.getLatLng(); moveTo(i, q.lat, q.lng); });
      m.on("click", function () { removeAt(i); });
      m.addTo(layer);
      markers.push(m);
    });
  }

  // ---------- elevation (AWS Terrain Tiles, Terrarium) ----------
  var tiles = {}, tileOrder = [];
  function tilePixels(tl) {
    var key = tl.z + "/" + tl.x + "/" + tl.y;
    if (tiles[key]) return tiles[key];
    tiles[key] = new Promise(function (res, rej) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        try {
          var c = document.createElement("canvas");
          c.width = 256; c.height = 256;
          var g = c.getContext("2d");
          g.drawImage(img, 0, 0);
          res(g.getImageData(0, 0, 256, 256).data);
        } catch (e) { rej(e); }
      };
      img.onerror = function () { rej(new Error("tile")); };
      img.src = PC.tileUrl(tl);
    });
    tiles[key].catch(function () { delete tiles[key]; });
    tileOrder.push(key);
    while (tileOrder.length > 80) delete tiles[tileOrder.shift()];
    return tiles[key];
  }
  var eleTimer = null;
  function eleSoon() {
    clearTimeout(eleTimer);
    eleTimer = setTimeout(loadEle, 600);
  }
  function loadEle() {
    var line = PC.fullLine(segs);
    if (line.length < 2 || segs.some(function (s) { return s.busy; })) {
      if (line.length < 2) ele = { samples: null, vals: null, state: "", key: "" };
      render();
      return;
    }
    var key = JSON.stringify(line);
    if (key === ele.key && ele.vals) return;
    if (!online()) { ele = { samples: null, vals: null, state: "off", key: "" }; render(); return; }
    var samples = PC.sample(line, 30, 300);
    var mine = ele = { samples: samples, vals: null, state: "wait", key: key };
    render();
    var tl = samples.map(function (p) { return PC.tileFor(p.lat, p.lon); });
    Promise.all(tl.map(function (x) { return tilePixels(x).then(function (d) {
      var o = (x.py * 256 + x.px) * 4;
      return PC.decode(d[o], d[o + 1], d[o + 2]);
    }); })).then(function (vals) {
      if (ele !== mine) return;
      ele.vals = vals; ele.state = "ok";
      render();
    }, function () {
      if (ele !== mine) return;
      ele.state = "fail";
      render();
    });
  }
  function profileSvg(samples, vals) {
    var W = 300, Hh = 80, ns = "http://www.w3.org/2000/svg";
    var total = samples[samples.length - 1].d || 1;
    var nums = vals.filter(function (v) { return typeof v === "number"; });
    var lo = Math.min.apply(null, nums), hi = Math.max.apply(null, nums);
    if (hi - lo < 10) { hi += 5; lo -= 5; }
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + Hh);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "pl-prof");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", t("profile"));
    var xy = [];
    samples.forEach(function (p, i) {
      var v = vals[i];
      if (typeof v !== "number") return;
      xy.push([p.d / total * W, Hh - 4 - (v - lo) / (hi - lo) * (Hh - 8)]);
    });
    var d = "M" + xy[0][0].toFixed(1) + " " + Hh;
    xy.forEach(function (q) { d += " L" + q[0].toFixed(1) + " " + q[1].toFixed(1); });
    d += " L" + xy[xy.length - 1][0].toFixed(1) + " " + Hh + " Z";
    var area = document.createElementNS(ns, "path");
    area.setAttribute("d", d);
    area.setAttribute("class", "pl-prof-area");
    svg.appendChild(area);
    return svg;
  }

  // ---------- sheet ----------
  function setH() {
    var h = 0;
    document.querySelectorAll(".osm-sheet").forEach(function (s) { if (!s.hidden) h = Math.max(h, s.offsetHeight); });
    document.body.style.setProperty("--osm-h", h + "px");
  }
  function header() {
    var h = el("header", "");
    h.appendChild(el("h3", "", t("title")));
    var c = button("", "osm-iconbtn osm-close", function () { setMode(false); });
    c.setAttribute("aria-label", t("close")); c.title = t("close");
    c.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    h.appendChild(c);
    return h;
  }
  function changed() {
    paint();
    render();
    eleSoon();
  }
  function render() {
    if (!open) return;
    panel.textContent = "";
    panel.appendChild(header());
    var body = el("div", "osm-body");
    body.appendChild(el("div", "ent-h", t("next")));
    var chips = el("div", "ent-chips pl-modes");
    PC.MODES.forEach(function (m) {
      var b = button(t("m." + m), "osm-mini ent-chip" + (curMode === m ? " on" : ""), function () { curMode = m; render(); });
      b.setAttribute("data-mode", m);
      b.setAttribute("aria-pressed", curMode === m ? "true" : "false");
      chips.appendChild(b);
    });
    body.appendChild(chips);

    var read = el("div", "tl-read");
    var line = PC.fullLine(segs);
    read.appendChild(el("div", "tl-lab", t("dist")));
    read.appendChild(el("div", "tl-big pl-len", fmtLen(PC.lineLength(line))));
    read.appendChild(el("div", "tl-sub", t("pts", { n: pts.length }) +
      (segs.some(function (s) { return s.busy; }) ? " · " + t("routing") : "")));
    body.appendChild(read);

    var eb = el("div", "pl-ele");
    eb.appendChild(el("div", "tl-lab", t("ele")));
    if (pts.length < 2) eb.appendChild(el("p", "osm-small", t("ele.more")));
    else if (ele.state === "wait") eb.appendChild(el("p", "osm-small", t("ele.wait")));
    else if (ele.state === "off") eb.appendChild(el("p", "osm-small", t("ele.off")));
    else if (ele.state === "fail") eb.appendChild(el("p", "osm-small", t("ele.fail")));
    else if (ele.state === "ok" && ele.vals) {
      var c = PC.climb(ele.vals);
      if (c) {
        eb.appendChild(el("div", "pl-climb", t("up", { n: c.up }) + " · " + t("down", { n: c.down })));
        eb.appendChild(el("div", "tl-sub", t("range", { a: c.min, b: c.max })));
        eb.appendChild(profileSvg(ele.samples, ele.vals));
      } else eb.appendChild(el("p", "osm-small", t("ele.fail")));
    }
    body.appendChild(eb);

    var row = el("div", "osm-actions");
    var u = button(t("undo"), "osm-btn", function () { removeAt(pts.length - 1); });
    u.disabled = !pts.length;
    row.appendChild(u);
    var cl = button(t("clear"), "osm-btn", clearAll);
    cl.disabled = !pts.length;
    row.appendChild(cl);
    body.appendChild(row);

    var lab = el("label", "osm-lab", t("name"));
    var inp = el("input", "osm-in pl-name");
    inp.maxLength = 120;
    inp.value = name;
    inp.addEventListener("input", function () { name = inp.value; });
    lab.appendChild(inp);
    body.appendChild(lab);
    var sv = button(t("save"), "osm-btn primary pl-save", save);
    sv.disabled = pts.length < 2;
    body.appendChild(sv);
    body.appendChild(el("p", "osm-hint", t("hint")));
    panel.appendChild(body);
    setH();
  }
  function defName() {
    var d = new Date();
    return t("name.def", { d: d.getDate() + "/" + (d.getMonth() + 1) });
  }
  function save() {
    if (pts.length < 2) { toast(t("need2")); return; }
    var api = window.__orosMapsTracks, T = window.OrosMapsTracks;
    var line = PC.fullLine(segs);
    var ok = ele.state === "ok" && ele.key === JSON.stringify(line);
    var tr = PC.toTrack(name.trim() || defName(), pts, line, ok ? ele.samples : null, ok ? ele.vals : null);
    if (!api || !T || typeof api.importText !== "function" || !tr) { toast(t("savefail")); return; }
    Promise.resolve(api.importText(T.writeGpx(tr), tr.name + ".gpx")).then(function (e) {
      toast(t(e ? "saved" : "savefail"));
    }, function () { toast(t("savefail")); });
  }

  // ---------- mode ----------
  window.addEventListener("oros-maps-mode", function (e) {
    if (open && e.detail !== "plantrack") setMode(false);
  });
  function setMode(on, place) {
    if (on && !open) {
      try { window.dispatchEvent(new CustomEvent("oros-maps-mode", { detail: "plantrack" })); } catch (e) {}
    }
    open = !!on;
    panel.hidden = !open;
    document.body.classList.toggle("osm-mode", open);
    if (open) {
      layer.addTo(map);
      if (!name) name = defName();
      offlineSaid = false;
      if (place) { clearAll(); add(place.lat, place.lon); }
      else changed();
    } else {
      map.removeLayer(layer);
      panel.textContent = "";
    }
    setH();
  }
  map.on("click", function (e) {
    if (!open || !e || !e.latlng) return;
    add(e.latlng.lat, e.latlng.lng);
  });

  function boot() {
    panel = el("aside", "osm-sheet");
    panel.id = "pl-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", t("title"));
    document.body.appendChild(panel);
    try { new ResizeObserver(setH).observe(panel); } catch (e) {}
    if (Array.isArray(H.ctxItems)) {
      H.ctxItems.push(function (place) {
        return { icon: ICON, label: t("ctx"), run: function () { setMode(true, place); } };
      });
    }
  }

  window.__orosMapsPlanner = {
    setMode: setMode, add: add, removeAt: removeAt, moveTo: moveTo, clear: clearAll, save: save,
    setModeOf: function (m) { curMode = PC.mode(m); render(); },
    state: function () {
      return { pts: pts.slice(), segs: segs.map(function (s) { return { mode: s.mode, n: s.line ? s.line.length : 0, busy: !!s.busy }; }),
        ele: ele.state, vals: ele.vals ? ele.vals.slice() : null, open: open };
    },
    label: function () { return t("title"); }
  };
  boot();
})();
