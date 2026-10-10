// ============================================================
// orOS One-Minute Museum — App logic (v1.0.0)
// A random Wikipedia article every minute, as an "exhibit".
//   - English or Greek Wikipedia (follows orOS at first)
//   - halls: everything, pictures only, featured of the day (+ most
//     read), on this day (English)
//   - 30 s / 1 / 2 / 5 min; the clock stops while the app is hidden;
//     the next exhibit loads before the minute ends
//   - previous / next through the last 50 of this visit
//   - the collection: starred exhibits (synced, no images), readable
//     offline; thumbnails cached on this device (IndexedDB)
//   - offline: "the museum is closed", visit your collection instead
//   - credit + licence under every exhibit (CC BY-SA)
// Network: {en,el}.wikipedia.org/api/rest_v1 (anonymous CORS) and
//   upload.wikimedia.org images. Text goes in as textContent; links are
//   built for fixed Wikimedia hosts only (core.js).
// Data:
//   - synced slice "museum" (oros-museum-data): the collection, LWW per
//     item + tombstones (R5, R17, R26)
//   - device-local (R10): oros-museum-prefs (language, hall, duration,
//     paused); IndexedDB "oros-museum" (thumbnails of the collection)
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Thumbnail cache (IndexedDB)
//   4. Fetching exhibits
//   5. The clock
//   6. UI
//   7. Collection actions
//   8. Toasts
//   9. Keyboard (Contract Β)
//  10. Sync slice + palette
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C           = window.MuseumCore;
  var STORAGE_KEY = "oros-museum-data";
  var PREFS_KEY   = "oros-museum-prefs";
  var DB_NAME     = "oros-museum";
  var MAX_ITEMS   = 500;
  var MAX_HISTORY = 50;
  var DURATIONS   = [30, 60, 120, 300];
  var HALLS       = ["all", "images", "featured", "onthisday"];
  var TRIES       = 6;                // random pages tried before giving up on one exhibit
  var PREFETCH_S  = 8;                // load the next exhibit this long before the minute ends
  var TIMEOUT_MS  = 12000;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app.name": "One-Minute Museum",
      "lang.label": "Wikipedia", "lang.en": "English", "lang.el": "Ελληνικά",
      "hall.label": "Hall", "hall.all": "Everything", "hall.images": "Pictures",
      "hall.featured": "Featured today", "hall.onthisday": "On this day",
      "dur.label": "Each exhibit", "dur.s": "{n} s", "dur.m": "{n} min",
      "btn.pause": "Pause (Space)", "btn.play": "Continue (Space)",
      "btn.prev": "Previous (←)", "btn.next": "Next (→)",
      "btn.star": "Add to your collection (S)", "btn.unstar": "Remove from your collection (S)",
      "btn.open": "Read it all on Wikipedia (O)",
      "credit.article": "From Wikipedia, licence CC BY-SA 4.0", "credit.authors": "authors",
      "credit.picture": "Wikimedia Commons", "credit.licence": "licence",
      "picture": "Picture of the day", "fromCollection": "From your collection",
      "loading": "Opening the next room…",
      "closed.title": "The museum is closed", "closed.text": "There is no connection to Wikipedia right now.",
      "closed.visit": "Visit your collection", "closed.retry": "Try again",
      "closed.empty": "Your collection is empty. Star exhibits to keep them for days like this.",
      "back.live": "Back to Wikipedia",
      "col.title": "Your collection", "col.empty": "Star an exhibit to keep it. Your collection follows you to all your devices and can be read offline.",
      "item.open": "Show", "item.delete": "Remove",
      "toast.starred": "Added to your collection", "toast.unstarred": "Removed from your collection",
      "toast.undo": "Undo", "toast.full": "Your collection is full ({n})",
      "toast.saveFail": "Could not save: storage is full",
      "toast.noFeatured": "This hall is closed today in this language; showing everything instead.",
      "live.paused": "Paused", "live.playing": "Continuing",
      "remaining": "{s} seconds left",
      "keys": "Space pause · ← → previous / next · S keep · O open"
    },
    el: {
      "app.name": "Μουσείο του λεπτού",
      "lang.label": "Wikipedia", "lang.en": "English", "lang.el": "Ελληνικά",
      "hall.label": "Αίθουσα", "hall.all": "Όλα", "hall.images": "Εικόνες",
      "hall.featured": "Επιλεγμένα σήμερα", "hall.onthisday": "Σαν σήμερα",
      "dur.label": "Κάθε έκθεμα", "dur.s": "{n} δευτ.", "dur.m": "{n} λεπ.",
      "btn.pause": "Παύση (Space)", "btn.play": "Συνέχεια (Space)",
      "btn.prev": "Προηγούμενο (←)", "btn.next": "Επόμενο (→)",
      "btn.star": "Στη συλλογή σου (S)", "btn.unstar": "Αφαίρεση από τη συλλογή σου (S)",
      "btn.open": "Διάβασέ το ολόκληρο στη Wikipedia (O)",
      "credit.article": "Από τη Wikipedia, άδεια CC BY-SA 4.0", "credit.authors": "συντάκτες",
      "credit.picture": "Wikimedia Commons", "credit.licence": "άδεια",
      "picture": "Εικόνα της ημέρας", "fromCollection": "Από τη συλλογή σου",
      "loading": "Ανοίγει η επόμενη αίθουσα…",
      "closed.title": "Το μουσείο είναι κλειστό", "closed.text": "Δεν υπάρχει σύνδεση με τη Wikipedia αυτή τη στιγμή.",
      "closed.visit": "Επίσκεψη στη συλλογή σου", "closed.retry": "Ξανά",
      "closed.empty": "Η συλλογή σου είναι άδεια. Βάλε αστέρι σε εκθέματα για να τα έχεις σε τέτοιες μέρες.",
      "back.live": "Πίσω στη Wikipedia",
      "col.title": "Η συλλογή σου", "col.empty": "Βάλε αστέρι σε ένα έκθεμα για να το κρατήσεις. Η συλλογή σε ακολουθεί σε όλες τις συσκευές σου και διαβάζεται και χωρίς σύνδεση.",
      "item.open": "Προβολή", "item.delete": "Αφαίρεση",
      "toast.starred": "Μπήκε στη συλλογή σου", "toast.unstarred": "Βγήκε από τη συλλογή σου",
      "toast.undo": "Αναίρεση", "toast.full": "Η συλλογή σου γέμισε ({n})",
      "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.noFeatured": "Αυτή η αίθουσα είναι κλειστή σήμερα σε αυτή τη γλώσσα· δείχνω όλα τα άρθρα.",
      "live.paused": "Παύση", "live.playing": "Συνέχεια",
      "remaining": "Απομένουν {s} δευτερόλεπτα",
      "keys": "Space παύση · ← → προηγούμενο / επόμενο · S κράτα · O άνοιγμα"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("museum.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = { ver: 1, items: [], tombs: {} };
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
          data = C.mergeMuseum(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] museum: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: 1, items: [], tombs: {} };
  }

  var saveFailShown = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.saveFail")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      lang: C.LANGS.indexOf(p.lang) >= 0 ? p.lang : LANG,
      hall: HALLS.indexOf(p.hall) >= 0 ? p.hall : "all",
      dur: DURATIONS.indexOf(p.dur) >= 0 ? p.dur : 60,
      paused: p.paused === true
    };
    if (prefs.hall === "onthisday" && prefs.lang !== "en") prefs.hall = "all";
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 3. Thumbnail cache (IndexedDB) ----------
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore("thumbs"); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbP;
  }
  function idb(mode, fn) {
    return db().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction("thumbs", mode), st = tx.objectStore("thumbs");
          var req = fn(st);
          tx.oncomplete = function () { resolve(req && req.result !== undefined ? req.result : null); };
          tx.onerror = tx.onabort = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }
  function cacheThumb(id, url) {
    if (!url) return;
    fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" })
      .then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (b) { if (b && b.size < 2e6) idb("readwrite", function (st) { return st.put(b, id); }); })
      .catch(function () {});
  }
  function dropThumb(id) { idb("readwrite", function (st) { return st.delete(id); }); }
  var objUrls = {};
  // Cached blob for saved exhibits, the network URL otherwise.
  function thumbSrc(x) {
    if (!x.thumb) return Promise.resolve("");
    if (!C.findItem(data, x.id)) return Promise.resolve(x.thumb);
    if (objUrls[x.id]) return Promise.resolve(objUrls[x.id]);
    return idb("readonly", function (st) { return st.get(x.id); }).then(function (b) {
      if (!b) return x.thumb;
      objUrls[x.id] = URL.createObjectURL(b);
      return objUrls[x.id];
    });
  }

  // ---------- 4. Fetching exhibits ----------
  function getJson(url) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    return fetch(url, { headers: { "Accept": "application/json" }, credentials: "omit",
                        referrerPolicy: "no-referrer", signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      }, function (e) { clearTimeout(timer); throw e; });
  }

  var source = "live";        // "live" | "collection"
  var featQueue = null, featKey = "", colQueue = [];

  function randomExhibit(needImage) {
    var tries = 0;
    function one() {
      tries++;
      return getJson(C.randomUrl(prefs.lang)).then(function (j) {
        var x = C.parseSummary(j, prefs.lang, { needImage: needImage });
        if (!x.skip) return x;
        if (tries >= TRIES) {                 // keep the image rule, drop the length rule
          x = C.parseSummary(j, prefs.lang, { needImage: needImage, anyLength: true });
          if (!x.skip) return x;
        }
        if (tries >= TRIES * 2) throw new Error("no exhibit");
        return one();
      });
    }
    return one();
  }

  function featuredExhibit() {
    var onThisDay = prefs.hall === "onthisday";
    var key = prefs.lang + "|" + prefs.hall + "|" + new Date().toISOString().slice(0, 10);
    var ready = featQueue && featKey === key ? Promise.resolve() :
      getJson(C.featuredUrl(prefs.lang)).then(function (f) {
        featKey = key;
        featQueue = { list: C.parseFeatured(f, prefs.lang, onThisDay), i: 0 };
      });
    return ready.then(function () {
      if (!featQueue.list.length) {
        if (!featQueue.told) { featQueue.told = true; showToast(t("toast.noFeatured")); }
        return randomExhibit(false);
      }
      var x = featQueue.list[featQueue.i % featQueue.list.length];
      featQueue.i++;
      return x;
    });
  }

  function collectionExhibit() {
    if (!data.items.length) return Promise.reject(new Error("empty"));
    if (!colQueue.length) colQueue = C.shuffle(data.items, Math.random);
    var x = colQueue.shift();
    return Promise.resolve(C.findItem(data, x.id) || x);
  }

  function fetchExhibit() {
    if (source === "collection") return collectionExhibit();
    if (prefs.hall === "featured" || prefs.hall === "onthisday") return featuredExhibit();
    return randomExhibit(prefs.hall === "images");
  }

  // ---------- 5. The clock ----------
  var history = [], pos = -1;       // exhibits seen this visit
  var remaining = 0, lastTick = 0;
  var nextP = null, loading = false, closed = false, gen = 0;

  function appVisible() {
    if (document.visibilityState === "hidden") return false;
    try {
      var fe = window.frameElement;
      if (fe && fe.offsetParent === null && fe.getClientRects().length === 0) return false;
    } catch (e) {}
    return true;
  }

  function prefetch() {
    if (nextP) return nextP;
    var g = gen;
    nextP = fetchExhibit().then(function (x) { return g === gen ? x : null; });
    nextP.catch(function () {});
    return nextP;
  }
  function resetSource() {
    gen++;
    nextP = null;
    featQueue = null;
    colQueue = [];
  }

  function advance() {
    if (pos < history.length - 1) { pos++; show(history[pos]); return; }
    if (loading) return;
    loading = true;
    renderLoading(true);
    var g = gen;
    prefetch().then(function (x) {
      nextP = null;
      loading = false;
      if (g !== gen) return advance();
      if (!x) return advance();
      closed = false;
      history.push(x);
      if (history.length > MAX_HISTORY) history.shift();
      pos = history.length - 1;
      show(x);
    }, function () {
      nextP = null;
      loading = false;
      if (g !== gen) return advance();
      setClosed(true);
    });
  }
  function back() {
    if (pos <= 0) return;
    pos--;
    show(history[pos]);
  }

  function tick() {
    var now = Date.now(), dt = now - lastTick;
    lastTick = now;
    if (prefs.paused || loading || closed || pos < 0 || !appVisible()) { renderRing(); return; }
    remaining -= dt;
    if (remaining <= PREFETCH_S * 1000 && pos === history.length - 1) prefetch();
    if (remaining <= 0) advance();
    renderRing();
  }

  // ---------- 6. UI ----------
  var ICON = {
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function iconBtn(cls, svg, label) {
    var b = el("button", "icon-btn " + cls);
    b.type = "button";
    b.innerHTML = svg;
    b.setAttribute("aria-label", label);
    b.title = label;
    return b;
  }
  function extLink(href, text, cls) {
    var a = el("a", cls || "", text);
    a.href = C.safeLink(href) || "#";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }
  function setLabel(b, label) { b.setAttribute("aria-label", label); b.title = label; }

  function chipRow(host, values, label, cur, onPick) {
    host.innerHTML = "";
    values.forEach(function (v) {
      var b = el("button", "chip", label(v));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", v === cur ? "true" : "false");
      if (v === cur) b.classList.add("on");
      b.addEventListener("click", function () { if (v !== cur) onPick(v); });
      host.appendChild(b);
    });
  }
  function renderControls() {
    chipRow($("langs"), C.LANGS, function (l) { return t("lang." + l); }, prefs.lang, function (l) {
      prefs.lang = l;
      if (l !== "en" && prefs.hall === "onthisday") prefs.hall = "all";
      savePrefs(); changed();
    });
    var halls = HALLS.filter(function (h) { return h !== "onthisday" || prefs.lang === "en"; });
    chipRow($("halls"), halls, function (h) { return t("hall." + h); }, prefs.hall, function (h) {
      prefs.hall = h; savePrefs(); changed();
    });
    chipRow($("durs"), DURATIONS, function (d) {
      return d < 60 ? t("dur.s", { n: d }) : t("dur.m", { n: d / 60 });
    }, prefs.dur, function (d) {
      var left = remaining - prefs.dur * 1000;
      prefs.dur = d; savePrefs();
      remaining = Math.max(1000, d * 1000 + left);
      renderControls(); renderRing();
    });
  }
  // Language or hall changed: drop what was loading and open a new room.
  function changed() {
    source = "live";
    resetSource();
    history = history.slice(0, pos + 1);
    renderControls();
    loading = false;
    advance();
  }

  var shown = null, imgGen = 0;
  function show(x) {
    shown = x;
    closed = false;
    renderLoading(false);
    $("closed").hidden = true;
    $("exhibit").hidden = false;
    remaining = prefs.dur * 1000;
    $("ex-kicker").textContent = x.kind === "picture" ? t("picture") :
      (source === "collection" ? t("fromCollection") : (x.event ? t("hall.onthisday") : ""));
    $("ex-kicker").hidden = !$("ex-kicker").textContent;
    $("ex-event").textContent = x.event || "";
    $("ex-event").hidden = !x.event;
    $("ex-title").textContent = x.title;
    $("ex-desc").textContent = x.desc;
    $("ex-desc").hidden = !x.desc;
    $("ex-text").textContent = x.extract;
    var fig = $("ex-figure"), img = $("ex-img"), g = ++imgGen;
    fig.hidden = true;
    img.removeAttribute("src");
    img.alt = x.title;
    thumbSrc(x).then(function (src) {
      if (g !== imgGen || !src) return;
      img.onload = function () { if (g === imgGen) fig.hidden = false; };
      img.onerror = function () { if (g === imgGen) fig.hidden = true; };
      img.src = src;
    });
    var cr = $("ex-credit");
    cr.innerHTML = "";
    if (x.kind === "picture") {
      cr.appendChild(extLink(x.url, t("credit.picture")));
      if (x.credit) cr.appendChild(document.createTextNode(" · " + x.credit));
    } else {
      cr.appendChild(extLink(x.url, t("credit.article")));
      cr.appendChild(document.createTextNode(" · "));
      cr.appendChild(extLink(x.hist, t("credit.authors")));
    }
    $("open-btn").href = C.safeLink(x.url) || "#";
    $("back-live").hidden = source !== "collection";
    $("stage").scrollTop = 0;
    renderButtons();
    renderRing();
    live(x.title);
    if (pos === history.length - 1) prefetch();
  }

  function renderLoading(on) {
    $("loading").hidden = !on;
    if (on) { $("exhibit").hidden = true; $("closed").hidden = true; }
  }
  function setClosed(on) {
    closed = on;
    if (!on) return;
    renderLoading(false);
    $("exhibit").hidden = true;
    $("closed").hidden = false;
    var has = data.items.length > 0;
    $("closed-visit").hidden = !has;
    $("closed-empty").hidden = has;
    live(t("closed.title"));
  }

  function renderButtons() {
    var pb = $("pause-btn");
    pb.innerHTML = prefs.paused ? ICON.play : ICON.pause;
    setLabel(pb, prefs.paused ? t("btn.play") : t("btn.pause"));
    pb.setAttribute("aria-pressed", prefs.paused ? "true" : "false");
    $("prev-btn").disabled = pos <= 0;
    var sb = $("star-btn"), on = !!(shown && C.findItem(data, shown.id));
    sb.classList.toggle("on", on);
    sb.setAttribute("aria-pressed", on ? "true" : "false");
    setLabel(sb, on ? t("btn.unstar") : t("btn.star"));
    sb.disabled = !shown;
  }

  var RING_LEN = 2 * Math.PI * 20;
  function renderRing() {
    var frac = shown ? Math.max(0, Math.min(1, remaining / (prefs.dur * 1000))) : 0;
    $("ring-arc").style.strokeDashoffset = String(RING_LEN * (1 - frac));
    var s = Math.max(0, Math.ceil(remaining / 1000));
    var txt = s >= 60 ? Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2) : String(s);
    if ($("ring-text").textContent !== txt) {
      $("ring-text").textContent = txt;
      $("ring").setAttribute("aria-label", t("remaining", { s: s }));
    }
    $("ring").classList.toggle("paused", !!prefs.paused);
  }

  function renderCollection() {
    var host = $("collection"), list = C.newestFirst(data.items);
    host.innerHTML = "";
    $("col-empty").hidden = list.length > 0;
    $("col-count").textContent = list.length ? String(list.length) : "";
    list.forEach(function (it) {
      var li = el("li", "row");
      var open = el("button", "row-open");
      open.type = "button";
      open.setAttribute("aria-label", t("item.open") + ": " + it.title);
      var th = el("span", "row-thumb");
      if (it.thumb) {
        var im = el("img");
        im.alt = "";
        im.loading = "lazy";
        im.referrerPolicy = "no-referrer";
        thumbSrc(it).then(function (src) { if (src) im.src = src; });
        im.onerror = function () { th.classList.add("none"); im.remove(); };
        th.appendChild(im);
      } else th.classList.add("none");
      open.appendChild(th);
      var body = el("span", "row-body");
      body.appendChild(el("span", "row-title", it.title));
      if (it.desc || it.kind === "picture") body.appendChild(el("span", "row-desc", it.desc || t("picture")));
      open.appendChild(body);
      open.addEventListener("click", function () {
        history = history.slice(0, pos + 1);
        history.push(it);
        if (history.length > MAX_HISTORY) history.shift();
        pos = history.length - 1;
        show(it);
        $("stage").scrollIntoView({ block: "nearest" });
      });
      li.appendChild(open);
      var d = iconBtn("del-btn", ICON.del, t("item.delete") + ": " + it.title);
      d.addEventListener("click", function () { unstar(it.id); });
      li.appendChild(d);
      host.appendChild(li);
    });
    if (closed) setClosed(true);
  }

  // ---------- 7. Collection actions ----------
  function toggleStar() {
    if (!shown) return;
    if (C.findItem(data, shown.id)) { unstar(shown.id); return; }
    if (data.items.length >= MAX_ITEMS) { showToast(t("toast.full", { n: MAX_ITEMS })); return; }
    var it = C.toItem(shown, Math.max(Date.now(), (data.tombs[shown.id] || 0) + 1));   // past an old tomb (R17)
    if (!it) return;
    data = C.mergeMuseum(data, { items: [it], tombs: {} });
    save();
    cacheThumb(it.id, it.thumb);
    renderCollection(); renderButtons();
    showToast(t("toast.starred"));
  }
  function unstar(id) {
    var it = C.findItem(data, id);
    if (!it) return;
    var snap = JSON.parse(JSON.stringify(it)), tombs = {};
    tombs[id] = Math.max(Date.now(), it.m);
    data = C.mergeMuseum(data, { items: [], tombs: tombs });
    save();
    renderCollection(); renderButtons();
    var dropTimer = setTimeout(function () { if (!C.findItem(data, id)) dropThumb(id); }, 9000);
    undoToast(t("toast.unstarred"), function () {
      clearTimeout(dropTimer);
      snap.m = Math.max(Date.now(), (data.tombs[snap.id] || 0) + 1);   // R17
      data = C.mergeMuseum(data, { items: [snap], tombs: {} });
      save();
      renderCollection(); renderButtons();
    });
  }
  function togglePause() {
    prefs.paused = !prefs.paused;
    savePrefs();
    renderButtons(); renderRing();
    live(prefs.paused ? t("live.paused") : t("live.playing"));
  }
  function visitCollection() {
    source = "collection";
    resetSource();
    history = history.slice(0, pos + 1);
    closed = false;
    advance();
  }
  function backToLive() {
    source = "live";
    resetSource();
    history = history.slice(0, pos + 1);
    advance();
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "museum", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 9. Keyboard ----------
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (document.querySelector("dialog[open]")) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = (e.key || "").toLowerCase();
      if (k === " " && !e.repeat) {
        if (tag === "BUTTON" || tag === "A") return;         // Space presses the focused control
        e.preventDefault(); togglePause();
      } else if (e.key === "ArrowRight" && !e.repeat) { e.preventDefault(); advance(); }
      else if (e.key === "ArrowLeft" && !e.repeat) { e.preventDefault(); back(); }
      else if (k === "s" && !e.repeat) { e.preventDefault(); toggleStar(); }
      else if (k === "o" && !e.repeat && shown) { e.preventDefault(); $("open-btn").click(); }
    });
  }

  // ---------- 10. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("museum", sliceGet, sliceSet, STORAGE_KEY, C.mergeMuseum);
  }

  function sliceGet() { return C.mergeMuseum(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.items)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeMuseum(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) !== before) {     // no toast on merge
      data.items.forEach(function (it) {       // thumbnails for items that came from elsewhere
        idb("readonly", function (st) { return st.count(it.id); }).then(function (n) {
          if (!n && navigator.onLine !== false) cacheThumb(it.id, it.thumb);
        });
      });
      renderCollection(); renderButtons();
    }
  }

  // ---------- 11. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
    $("prev-btn").innerHTML = ICON.prev; setLabel($("prev-btn"), t("btn.prev"));
    $("next-btn").innerHTML = ICON.next; setLabel($("next-btn"), t("btn.next"));
    $("star-btn").innerHTML = ICON.star;
    var ob = $("open-btn");
    ob.innerHTML = ICON.open;
    setLabel(ob, t("btn.open"));
  }

  function wire() {
    $("pause-btn").addEventListener("click", togglePause);
    $("prev-btn").addEventListener("click", back);
    $("next-btn").addEventListener("click", advance);
    $("star-btn").addEventListener("click", toggleStar);
    $("closed-visit").addEventListener("click", visitCollection);
    $("closed-retry").addEventListener("click", function () { setClosed(false); advance(); });
    $("back-live").addEventListener("click", backToLive);
    window.addEventListener("online", function () { if (closed && source === "live") { setClosed(false); advance(); } });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    inheritPalette();
    renderControls();
    wire();
    registerSync();
    watchPalette();
    renderCollection();
    renderButtons();
    lastTick = Date.now();
    setInterval(tick, 250);
    advance();
  }

  boot();
})();
