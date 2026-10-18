// ============================================================
// orOS Maps — discover.js (Discover, maps wave 11, v1.0.0)
//
// The Discover sheet (compass button, or long-press › "What's
// nearby"), three tabs around the middle of the map:
//   - Places: a category (restaurants, cafés, pharmacies, ATMs…)
//     from OpenStreetMap through Overpass, by distance, with "open
//     now / closes at / opens at" read from opening_hours and an
//     "Open now" filter. Popup: hours, address, phone, website, Go
//     here, Save.
//   - Wikipedia: articles with a location (MediaWiki geosearch) in
//     the language of orOS, with a thumbnail; the popup links to the
//     article.
//   - Photos: open street-level photos from Panoramax at zoom ≥ 15,
//     with the direction they look at; tap one to see it larger.
// All three are free services without keys. Nothing is synced: the
// tab, category and "Open now" choice are device-local
// ("oros-maps-discover").
//
// Safety: text from the services goes on the page with textContent
// only; links and images are checked (https only) in discover-core.js.
// ============================================================
(function () {
  "use strict";
  var DC = window.OrosMapsDiscover;
  var H = window.__orosMapsHost;
  if (!DC || !H || !H.map || !window.L) return;
  var map = H.map;
  var LANG = window.orosI18n ? window.orosI18n.lang() : (H.lang === "el" ? "el" : "en");
  var OVERPASS = "https://overpass-api.de/api/interpreter";
  var PREFS_KEY = "oros-maps-discover";
  var PHOTO_ZOOM = 15;

  var STR = {
    en: {
      "dsc.btn": "Discover", "dsc.title": "Discover", "dsc.close": "Close", "dsc.ctx": "What's nearby",
      "dsc.tab.places": "Places", "dsc.tab.wiki": "Wikipedia", "dsc.tab.photos": "Photos",
      "dsc.cat.restaurant": "Restaurants", "dsc.cat.cafe": "Cafés", "dsc.cat.bar": "Bars", "dsc.cat.fast_food": "Fast food",
      "dsc.cat.supermarket": "Supermarkets", "dsc.cat.bakery": "Bakeries", "dsc.cat.pharmacy": "Pharmacies", "dsc.cat.atm": "ATMs and banks",
      "dsc.cat.fuel": "Fuel and charging", "dsc.cat.toilets": "Toilets", "dsc.cat.museum": "Sights and museums", "dsc.cat.park": "Parks and playgrounds",
      "dsc.one.restaurant": "Restaurant", "dsc.one.cafe": "Café", "dsc.one.bar": "Bar", "dsc.one.fast_food": "Fast food",
      "dsc.one.supermarket": "Shop", "dsc.one.bakery": "Bakery", "dsc.one.pharmacy": "Pharmacy", "dsc.one.atm": "ATM / bank",
      "dsc.one.fuel": "Fuel / charging", "dsc.one.toilets": "Toilets", "dsc.one.museum": "Sight", "dsc.one.park": "Park",
      "dsc.open": "Open now", "dsc.area": "Search this area", "dsc.loading": "Loading…",
      "dsc.offline": "You're offline. Discover needs a connection.", "dsc.fail": "The service didn't answer. Try again in a moment.",
      "dsc.none": "Nothing found around here.", "dsc.none.open": "Nothing open right now around here.",
      "dsc.n.places": "{n} places within {d}", "dsc.n.open": "{n} open of {all} within {d}",
      "dsc.s.open": "Open", "dsc.s.closes": "Open · closes {t}", "dsc.s.24": "Open 24 hours", "dsc.s.closed": "Closed",
      "dsc.s.opens": "Closed · opens {t}", "dsc.s.unknown": "Hours unknown",
      "dsc.go": "Go here", "dsc.save": "Save", "dsc.saved": "Saved to Saved places", "dsc.hours": "Opening hours",
      "dsc.site": "Website", "dsc.call": "Call",
      "dsc.w.read": "Read on Wikipedia", "dsc.w.n": "{n} articles within {d}",
      "dsc.p.zoom": "Zoom in closer to see photos.", "dsc.p.n": "{n} photos in view", "dsc.p.open": "Open in Panoramax",
      "dsc.p.by": "By {b}", "dsc.p.look": "Photo looking {dir}", "dsc.unnamed": "No name",
      "dsc.dir.0": "north", "dsc.dir.1": "north-east", "dsc.dir.2": "east", "dsc.dir.3": "south-east",
      "dsc.dir.4": "south", "dsc.dir.5": "south-west", "dsc.dir.6": "west", "dsc.dir.7": "north-west",
      "dsc.u.m": "{n} m", "dsc.u.km": "{n} km"
    },
    el: {
      "dsc.btn": "Ανακάλυψη", "dsc.title": "Ανακάλυψη", "dsc.close": "Κλείσιμο", "dsc.ctx": "Τι υπάρχει κοντά",
      "dsc.tab.places": "Μέρη", "dsc.tab.wiki": "Wikipedia", "dsc.tab.photos": "Φωτογραφίες",
      "dsc.cat.restaurant": "Εστιατόρια", "dsc.cat.cafe": "Καφετέριες", "dsc.cat.bar": "Μπαρ", "dsc.cat.fast_food": "Γρήγορο φαγητό",
      "dsc.cat.supermarket": "Σούπερ μάρκετ", "dsc.cat.bakery": "Φούρνοι", "dsc.cat.pharmacy": "Φαρμακεία", "dsc.cat.atm": "ATM και τράπεζες",
      "dsc.cat.fuel": "Καύσιμα και φόρτιση", "dsc.cat.toilets": "Τουαλέτες", "dsc.cat.museum": "Αξιοθέατα και μουσεία", "dsc.cat.park": "Πάρκα και παιδικές χαρές",
      "dsc.one.restaurant": "Εστιατόριο", "dsc.one.cafe": "Καφετέρια", "dsc.one.bar": "Μπαρ", "dsc.one.fast_food": "Γρήγορο φαγητό",
      "dsc.one.supermarket": "Κατάστημα", "dsc.one.bakery": "Φούρνος", "dsc.one.pharmacy": "Φαρμακείο", "dsc.one.atm": "ATM / τράπεζα",
      "dsc.one.fuel": "Καύσιμα / φόρτιση", "dsc.one.toilets": "Τουαλέτες", "dsc.one.museum": "Αξιοθέατο", "dsc.one.park": "Πάρκο",
      "dsc.open": "Ανοιχτά τώρα", "dsc.area": "Αναζήτηση σε αυτή την περιοχή", "dsc.loading": "Φόρτωση…",
      "dsc.offline": "Είσαι εκτός σύνδεσης. Η Ανακάλυψη θέλει σύνδεση.", "dsc.fail": "Η υπηρεσία δεν απάντησε. Δοκίμασε ξανά σε λίγο.",
      "dsc.none": "Δεν βρέθηκε τίποτα εδώ γύρω.", "dsc.none.open": "Τίποτα ανοιχτό αυτή τη στιγμή εδώ γύρω.",
      "dsc.n.places": "{n} μέρη σε {d}", "dsc.n.open": "{n} ανοιχτά από {all} σε {d}",
      "dsc.s.open": "Ανοιχτό", "dsc.s.closes": "Ανοιχτό · κλείνει {t}", "dsc.s.24": "Ανοιχτό όλο το 24ωρο", "dsc.s.closed": "Κλειστό",
      "dsc.s.opens": "Κλειστό · ανοίγει {t}", "dsc.s.unknown": "Άγνωστο ωράριο",
      "dsc.go": "Πήγαινε εδώ", "dsc.save": "Αποθήκευση", "dsc.saved": "Αποθηκεύτηκε στις Αποθηκευμένες τοποθεσίες", "dsc.hours": "Ωράριο",
      "dsc.site": "Ιστότοπος", "dsc.call": "Κλήση",
      "dsc.w.read": "Διάβασε στη Wikipedia", "dsc.w.n": "{n} άρθρα σε {d}",
      "dsc.p.zoom": "Μεγέθυνε τον χάρτη για να δεις φωτογραφίες.", "dsc.p.n": "{n} φωτογραφίες στην οθόνη", "dsc.p.open": "Άνοιγμα στο Panoramax",
      "dsc.p.by": "Από {b}", "dsc.p.look": "Φωτογραφία προς {dir}", "dsc.unnamed": "Χωρίς όνομα",
      "dsc.dir.0": "βορρά", "dsc.dir.1": "βορειοανατολικά", "dsc.dir.2": "ανατολή", "dsc.dir.3": "νοτιοανατολικά",
      "dsc.dir.4": "νότο", "dsc.dir.5": "νοτιοδυτικά", "dsc.dir.6": "δύση", "dsc.dir.7": "βορειοδυτικά",
      "dsc.u.m": "{n} μ.", "dsc.u.km": "{n} χλμ."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "maps", LANG);
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (loc()); }
  // Decimal comma (Greek, German…): what the language's locale writes.
  function comma() { if (LANG === "el") return true; if (LANG === "en") return false; try { return (1.5).toLocaleString(loc()).indexOf(",") >= 0; } catch (e) { return false; } }
  function t(k, vars) {
    k = "dsc." + k;
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
  function link(label, href, cls) {
    var a = el("a", cls || "osm-ext", label);
    a.href = href;
    if (!/^tel:/.test(href)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
    return a;
  }
  function toast(s) { (H.toast || H.localToast)(s); }
  function online() { return navigator.onLine !== false; }
  function fmtDist(m) {
    if (m < 1000) return t("u.m", { n: Math.round(m) });
    var k = m / 1000;
    var s = k < 10 ? k.toFixed(1) : String(Math.round(k));
    if (comma()) s = s.replace(".", ",");
    return t("u.km", { n: s });
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function timeOf(d, now) {
    var s = pad(d.getHours()) + ":" + pad(d.getMinutes());
    var same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (same) return s;
    var wd = "";
    try { wd = d.toLocaleDateString(loc(), { weekday: "short" }); } catch (e) { wd = DC.DAYS[(d.getDay() + 6) % 7]; }
    return wd + " " + s;
  }
  // { cls: open|closed|unknown, text }
  function hoursText(h, now) {
    var st = DC.status(h, now);
    if (st.state === "unknown") return { cls: "unknown", text: t("s.unknown") };
    if (st.state === "open") return { cls: "open", text: st.at ? t("s.closes", { t: timeOf(st.at, now) }) : t("s.24") };
    return { cls: "closed", text: st.at ? t("s.opens", { t: timeOf(st.at, now) }) : t("s.closed") };
  }
  var ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>';

  // ---------- device-local prefs ----------
  var prefs = { tab: "places", cat: "restaurant", open: 0 };
  try {
    var pr = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    if (pr && typeof pr === "object") {
      if (["places", "wiki", "photos"].indexOf(pr.tab) >= 0) prefs.tab = pr.tab;
      if (DC.catById(pr.cat)) prefs.cat = pr.cat;
      prefs.open = pr.open ? 1 : 0;
    }
  } catch (e) {}
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }

  // ---------- state ----------
  var panel = null, modeBtn = null, modeOn = false;
  var res = { places: null, wiki: null, photos: null };   // { items, at: center, r, key }
  var busy = "", err = "", seq = 0, moved = false;
  var layer = L.layerGroup();
  var markers = {};

  function setH() {
    var h = 0;
    document.querySelectorAll(".osm-sheet").forEach(function (s) { if (!s.hidden) h = Math.max(h, s.offsetHeight); });
    document.body.style.setProperty("--osm-h", h + "px");
  }
  window.addEventListener("oros-maps-mode", function (e) {
    if (modeOn && e.detail !== "discover") setMode(false);
  });
  function setMode(on) {
    if (on && !modeOn) {
      try { window.dispatchEvent(new CustomEvent("oros-maps-mode", { detail: "discover" })); } catch (e) {}
    }
    modeOn = !!on;
    if (modeBtn) { modeBtn.classList.toggle("on", modeOn); modeBtn.setAttribute("aria-pressed", modeOn ? "true" : "false"); }
    if (modeOn) {
      document.body.classList.add("osm-mode");
      layer.addTo(map);
      panel.hidden = false;
      if (!res[prefs.tab]) load();
      else { paint(); render(); }
    } else {
      seq++; busy = "";
      map.removeLayer(layer);
      panel.hidden = true;
      document.body.classList.toggle("osm-mode", document.querySelectorAll(".osm-sheet:not([hidden])").length > 0);
    }
    setH();
  }

  // ---------- loading ----------
  function center() { var c = map.getCenter(); return { lat: c.lat, lon: c.lng }; }
  function viewRadius() {
    var b = map.getBounds(), c = center();
    return DC.radiusFor(c, { lat: b.getNorth(), lon: b.getEast() });
  }
  function load() {
    var tab = prefs.tab, my = ++seq;
    err = ""; moved = false;
    if (!online()) { busy = ""; err = "offline"; render(); return; }
    var c = center(), r = viewRadius(), req;
    if (tab === "photos") {
      if (map.getZoom() < PHOTO_ZOOM) { busy = ""; res.photos = null; paint(); render(); return; }
      var b = map.getBounds();
      req = fetch(DC.photosUrl(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), 150)).then(json).then(function (j) { return DC.parsePhotos(j); });
    } else if (tab === "wiki") {
      req = fetch(DC.wikiUrl(LANG, c.lat, c.lon, Math.min(10000, r))).then(json).then(function (j) { return DC.parseWiki(j, LANG, c); });
    } else {
      var cat = prefs.cat;
      req = fetch(OVERPASS, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(DC.nearbyQuery(cat, c.lat, c.lon, r))
      }).then(json).then(function (j) { return DC.parseNearby(j, cat, c, LANG); });
    }
    busy = tab;
    render();
    req.then(function (items) {
      if (my !== seq) return;
      busy = "";
      res[tab] = { items: items, at: c, r: tab === "wiki" ? Math.min(10000, r) : r, cat: prefs.cat };
      paint(); render();
    }, function () {
      if (my !== seq) return;
      busy = ""; err = "fail";
      render();
    });
  }
  function json(r) { if (!r.ok) throw new Error(r.status); return r.json(); }

  var moveTimer = null;
  map.on("moveend", function () {
    if (!modeOn) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(function () {
      // Photos follow the map; the other tabs offer "Search this area".
      if (prefs.tab === "photos") { load(); return; }
      var cur = res[prefs.tab];
      if (cur && DC.dist(cur.at, center()) > cur.r * 0.3) { moved = true; render(); }
    }, 500);
  });

  // ---------- map ----------
  function visiblePlaces() {
    var cur = res.places;
    if (!cur) return [];
    if (!prefs.open) return cur.items;
    var now = new Date();
    return cur.items.filter(function (p) { return DC.status(p.hours, now).state === "open"; });
  }
  function placeIcon(p, now) {
    var c = DC.catById(p.cat), s = hoursText(p.hours, now);
    var h = el("span", s.cls);
    h.textContent = c ? c.icon : "•";
    return L.divIcon({ className: "dsc-pin", html: h, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
  }
  function paint() {
    layer.clearLayers();
    markers = {};
    if (!modeOn) return;
    var now = new Date();
    if (prefs.tab === "places") {
      visiblePlaces().forEach(function (p) {
        var m = L.marker([p.lat, p.lon], { icon: placeIcon(p, now), keyboard: false, title: p.name || t("one." + p.cat) });
        m.bindPopup(function () { return placePopup(p); }, { maxWidth: 280 });
        markers[p.id] = m; layer.addLayer(m);
      });
    } else if (prefs.tab === "wiki" && res.wiki) {
      res.wiki.items.forEach(function (w) {
        var h = el("span", "", "W");
        var m = L.marker([w.lat, w.lon], { icon: L.divIcon({ className: "dsc-wiki", html: h, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] }), keyboard: false, title: w.title });
        m.bindPopup(function () { return wikiPopup(w); }, { maxWidth: 280 });
        markers[w.id] = m; layer.addLayer(m);
      });
    } else if (prefs.tab === "photos" && res.photos) {
      res.photos.items.forEach(function (p) {
        var h = el("span", p.az === null ? "" : "dir");
        if (p.az !== null) h.style.transform = "rotate(" + Math.round(p.az) + "deg)";
        var m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "dsc-photo", html: h, iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10] }), keyboard: false });
        m.bindPopup(function () { return photoPopup(p); }, { maxWidth: 300, minWidth: 220 });
        markers[p.id] = m; layer.addLayer(m);
      });
    }
  }
  function focus(id, lat, lon) {
    map.setView([lat, lon], Math.max(map.getZoom(), 17));
    var m = markers[id];
    if (m) setTimeout(function () { m.openPopup(); }, 50);
  }

  // ---------- popups (DOM-built) ----------
  function placePopup(p) {
    var now = new Date(), w = el("div", "dsc-pop");
    w.appendChild(el("b", "", p.name || t("unnamed")));
    w.appendChild(el("div", "dsc-pop-s", t("one." + p.cat) + (p.addr ? " · " + p.addr : "")));
    var s = hoursText(p.hours, now);
    w.appendChild(el("div", "dsc-st " + s.cls, s.text));
    if (p.hours) {
      var hh = el("div", "dsc-pop-s");
      hh.textContent = t("hours") + ": " + p.hours;
      w.appendChild(hh);
    }
    var links = el("div", "dsc-links");
    if (p.phone) links.appendChild(link(t("call") + " " + p.phone, "tel:" + p.phone.replace(/[^\d+]/g, "")));
    if (p.site) links.appendChild(link(t("site"), p.site));
    if (links.childNodes.length) w.appendChild(links);
    var act = el("div", "pop-actions");
    act.appendChild(button(t("go"), "", function () {
      map.closePopup();
      setMode(false);
      if (H.routeTo) H.routeTo({ lat: p.lat, lon: p.lon, name: p.name || t("one." + p.cat), sub: p.addr });
    }));
    act.appendChild(button(t("save"), "", function () {
      if (H.addPlaces && H.addPlaces([{ lat: p.lat, lon: p.lon, name: p.name || t("one." + p.cat), sub: p.addr }])) toast(t("saved"));
    }));
    w.appendChild(act);
    return w;
  }
  function wikiPopup(x) {
    var w = el("div", "dsc-pop");
    if (x.thumb) { var im = el("img", "dsc-thumb"); im.src = x.thumb; im.alt = ""; im.loading = "lazy"; w.appendChild(im); }
    w.appendChild(el("b", "", x.title));
    if (x.desc) w.appendChild(el("div", "dsc-pop-s", x.desc));
    w.appendChild(link(t("w.read"), x.url));
    var act = el("div", "pop-actions");
    act.appendChild(button(t("go"), "", function () { map.closePopup(); setMode(false); if (H.routeTo) H.routeTo({ lat: x.lat, lon: x.lon, name: x.title }); }));
    w.appendChild(act);
    return w;
  }
  function photoPopup(p) {
    var w = el("div", "dsc-pop");
    var im = el("img", "dsc-photo-img");
    im.src = p.sd; im.alt = p.az === null ? "" : t("p.look", { dir: t("dir." + (Math.round(((p.az % 360) + 360) % 360 / 45) % 8)) });
    w.appendChild(im);
    var meta = [];
    if (p.time) { try { meta.push(new Date(p.time).toLocaleDateString(loc(), { year: "numeric", month: "short", day: "numeric" })); } catch (e) {} }
    if (p.by) meta.push(t("p.by", { b: p.by }));
    if (p.lic) meta.push(p.lic);
    if (meta.length) w.appendChild(el("div", "dsc-pop-s", meta.join(" · ")));
    w.appendChild(link(t("p.open"), p.page));
    return w;
  }

  // ---------- sheet ----------
  function render() {
    if (!panel) return;
    panel.textContent = "";
    var head = el("header", "");
    head.appendChild(el("h3", "", t("title")));
    var c = button("", "osm-iconbtn osm-close", function () { setMode(false); });
    c.setAttribute("aria-label", t("close")); c.title = t("close");
    c.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    head.appendChild(c);
    panel.appendChild(head);
    var body = el("div", "osm-body");
    var tabs = el("div", "osm-tabs");
    ["places", "wiki", "photos"].forEach(function (k) {
      var b = button(t("tab." + k), "osm-tab" + (prefs.tab === k ? " on" : ""), function () {
        if (prefs.tab === k) return;
        prefs.tab = k; savePrefs();
        if (!res[k] || k === "photos" || (res[k] && DC.dist(res[k].at, center()) > res[k].r * 0.3)) load();
        else { paint(); render(); }
      });
      b.dataset.tab = k;
      b.setAttribute("aria-pressed", prefs.tab === k ? "true" : "false");
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
    if (prefs.tab === "places") renderPlaces(body);
    else if (prefs.tab === "wiki") renderWiki(body);
    else renderPhotos(body);
    panel.appendChild(body);
    setH();
  }
  function statusLine(body, okText) {
    if (busy === prefs.tab) { body.appendChild(el("p", "osm-hint dsc-busy", t("loading"))); return false; }
    if (err) {
      body.appendChild(el("p", "osm-hint dsc-err", t(err)));
      body.appendChild(button(t("area"), "osm-btn", load));
      return false;
    }
    if (moved) body.appendChild(button(t("area"), "osm-btn primary dsc-area", load));
    if (okText) body.appendChild(el("p", "osm-small dsc-count", okText));
    return true;
  }
  function renderPlaces(body) {
    var chips = el("div", "ent-chips dsc-cats");
    DC.CATS.forEach(function (c) {
      var b = button(c.icon + " " + t("cat." + c.id), "osm-mini ent-chip" + (prefs.cat === c.id ? " on" : ""), function () {
        if (prefs.cat === c.id) return;
        prefs.cat = c.id; savePrefs(); load();
      });
      b.dataset.cat = c.id;
      b.setAttribute("aria-pressed", prefs.cat === c.id ? "true" : "false");
      chips.appendChild(b);
    });
    body.appendChild(chips);
    // The chosen category stays in view on the phone's scrolling row
    setTimeout(function () {
      var on = chips.querySelector(".on");
      if (on && chips.scrollWidth > chips.clientWidth) chips.scrollLeft = Math.max(0, on.offsetLeft - chips.offsetLeft - 8);
    }, 0);
    var lab = el("label", "dsc-open");
    var cb = el("input", "");
    cb.type = "checkbox"; cb.checked = !!prefs.open;
    cb.addEventListener("change", function () { prefs.open = cb.checked ? 1 : 0; savePrefs(); paint(); render(); });
    lab.appendChild(cb);
    lab.appendChild(el("span", "", t("open")));
    body.appendChild(lab);
    var cur = res.places, list = cur && cur.cat === prefs.cat ? visiblePlaces() : [];
    var txt = "";
    if (cur && cur.cat === prefs.cat) txt = prefs.open ? t("n.open", { n: list.length, all: cur.items.length, d: fmtDist(cur.r) }) : t("n.places", { n: list.length, d: fmtDist(cur.r) });
    if (!statusLine(body, txt) || !cur) return;
    if (!list.length) { body.appendChild(el("p", "osm-hint dsc-none", prefs.open ? t("none.open") : t("none"))); return; }
    var ul = el("ul", "osm-list dsc-list"), now = new Date();
    list.slice(0, 100).forEach(function (p) {
      var li = el("li", "osm-row dsc-row");
      li.tabIndex = 0;
      var cc = DC.catById(p.cat), s = hoursText(p.hours, now);
      li.appendChild(el("span", "dsc-ico " + s.cls, cc ? cc.icon : "•"));
      var b = el("div", "osm-row-body");
      b.appendChild(el("div", "osm-row-t", p.name || t("one." + p.cat)));
      var sub = el("div", "osm-row-s");
      sub.appendChild(el("span", "dsc-st " + s.cls, s.text));
      sub.appendChild(document.createTextNode(" · " + fmtDist(p.d)));
      b.appendChild(sub);
      li.appendChild(b);
      function go() { focus(p.id, p.lat, p.lon); }
      li.addEventListener("click", go);
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      ul.appendChild(li);
    });
    body.appendChild(ul);
  }
  function renderWiki(body) {
    var cur = res.wiki;
    if (!statusLine(body, cur ? t("w.n", { n: cur.items.length, d: fmtDist(cur.r) }) : "") || !cur) return;
    if (!cur.items.length) { body.appendChild(el("p", "osm-hint dsc-none", t("none"))); return; }
    var ul = el("ul", "osm-list dsc-list");
    cur.items.forEach(function (w) {
      var li = el("li", "osm-row dsc-row");
      li.tabIndex = 0;
      if (w.thumb) { var im = el("img", "dsc-wthumb"); im.src = w.thumb; im.alt = ""; im.loading = "lazy"; li.appendChild(im); }
      else li.appendChild(el("span", "dsc-ico wiki", "W"));
      var b = el("div", "osm-row-body");
      b.appendChild(el("div", "osm-row-t", w.title));
      b.appendChild(el("div", "osm-row-s", (w.desc ? w.desc + " · " : "") + fmtDist(w.d)));
      li.appendChild(b);
      function go() { focus(w.id, w.lat, w.lon); }
      li.addEventListener("click", go);
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      ul.appendChild(li);
    });
    body.appendChild(ul);
  }
  function renderPhotos(body) {
    if (map.getZoom() < PHOTO_ZOOM) { body.appendChild(el("p", "osm-hint dsc-zoom", t("p.zoom"))); return; }
    var cur = res.photos;
    if (!statusLine(body, cur ? t("p.n", { n: cur.items.length }) : "") || !cur) return;
    if (!cur.items.length) { body.appendChild(el("p", "osm-hint dsc-none", t("none"))); return; }
    var grid = el("div", "dsc-grid");
    cur.items.slice(0, 60).forEach(function (p) {
      var b = button("", "dsc-tile", function () { focus(p.id, p.lat, p.lon); });
      var im = el("img", "");
      im.src = p.thumb; im.alt = ""; im.loading = "lazy";
      b.appendChild(im);
      grid.appendChild(b);
    });
    body.appendChild(grid);
  }

  function nearHere(place) {
    map.setView([place.lat, place.lon], Math.max(map.getZoom(), 16), { animate: false });
    if (prefs.tab === "photos" && map.getZoom() < PHOTO_ZOOM) prefs.tab = "places";
    res = { places: null, wiki: null, photos: null };
    if (modeOn) load(); else setMode(true);
  }

  function boot() {
    panel = el("aside", "osm-sheet dsc-sheet");
    panel.id = "dsc-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", t("title"));
    document.body.appendChild(panel);
    try { new ResizeObserver(setH).observe(panel); } catch (e) {}
    var controls = document.getElementById("controls");
    if (controls) {
      modeBtn = el("button", "");
      modeBtn.id = "dsc-btn";
      modeBtn.type = "button";
      modeBtn.title = t("btn");
      modeBtn.setAttribute("aria-label", t("btn"));
      modeBtn.setAttribute("aria-pressed", "false");
      modeBtn.innerHTML = ICON;
      modeBtn.addEventListener("click", function () { setMode(!modeOn); });
      controls.insertBefore(modeBtn, document.getElementById("places-btn") ? document.getElementById("places-btn").nextSibling : null);
    }
    if (Array.isArray(H.ctxItems)) {
      H.ctxItems.push(function (place) {
        return { icon: ICON.replace(/18/g, "14"), label: t("ctx"), run: function () { nearHere(place); } };
      });
    }
  }

  window.__orosMapsDiscover = {
    setMode: setMode, load: load, near: nearHere,
    tab: function (k) { if (["places", "wiki", "photos"].indexOf(k) >= 0) { prefs.tab = k; savePrefs(); load(); } },
    cat: function (id) { if (DC.catById(id)) { prefs.cat = id; savePrefs(); load(); } },
    state: function () {
      return { on: modeOn, tab: prefs.tab, cat: prefs.cat, open: prefs.open, busy: busy, err: err, moved: moved,
        places: res.places && res.places.items.length, wiki: res.wiki && res.wiki.items.length,
        photos: res.photos && res.photos.items.length, markers: Object.keys(markers).length };
    }
  };
  boot();
})();
