// ============================================================
// orOS Name Generator — App logic (v1.0.0)
// Names for your corners of the web, your bios and your stories.
//   - three modes: handles (adjective + noun, Latin letters),
//     titles ([adjective] role [of something]) and regal pairs
//     (a fantasy name + an epithet)
//   - names in English or Greek; Greek handles are transliterated,
//     Greek titles and epithets agree with the gender
//   - handle styles: leet, separators, numbers
//   - batches of 8, no repeats; copy one or all; star to keep
// Data:
//   - synced slice "names" (oros-names-data): favourites only, LWW
//     per name + tombstones (R5, R17, R26); the id comes from the
//     mode and the text, so the same name starred on two devices
//     is one favourite
//   - device-local (R10): oros-names-prefs (mode, words, styles)
//   - batches are never stored
// Sections:
//   1. Constants, i18n, helpers
//   2. Random
//   3. Greek to Latin
//   4. Generators
//   5. Favourites: ids, merge
//   6. Storage + prefs
//   7. UI
//   8. Copy + toasts
//   9. Keyboard (Contract Β)
//  10. Sync slice + palette
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-names-data";
  var PREFS_KEY   = "oros-names-prefs";
  var DATA_VER    = 1;
  var BATCH       = 8;
  var MAX_FAVS    = 1000;
  var MAX_TEXT    = 80;
  var MODES       = ["handle", "title", "regal"];
  var W           = window.NAME_WORDS;

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
      "app.name": "Name Generator",
      "mode.handle": "Handles", "mode.title": "Titles", "mode.regal": "Regal pairs",
      "mode.handle.sub": "usernames for the web", "mode.title.sub": "epithets for your bio", "mode.regal.sub": "fantasy name + epithet",
      "sec.words": "Words", "words.en": "English", "words.el": "Greek",
      "sec.style": "Style", "st.leet": "Leet (a→4)", "st.sep": "Separators (_ -)", "st.num": "Numbers",
      "btn.gen": "New names", "btn.gen.key": "Enter",
      "btn.copy": "Copy", "btn.star": "Keep", "btn.unstar": "Remove from favourites", "btn.del": "Delete",
      "fav.title": "Favourites", "fav.empty": "Star a name to keep it here. Favourites follow you to all your devices.",
      "fav.copyAll": "Copy all",
      "list": "New names",
      "live.batch": "{n} new names", "toast.copied": "Copied", "toast.copiedAll": "Copied {n} names",
      "toast.copyFail": "Could not copy", "toast.deleted": "Removed from favourites", "toast.undo": "Undo",
      "toast.full": "Favourites are full ({n})", "toast.save": "Could not save: storage is full"
    },
    el: {
      "app.name": "Γεννήτρια ονομάτων",
      "mode.handle": "Handles", "mode.title": "Τίτλοι", "mode.regal": "Βασιλικά ζεύγη",
      "mode.handle.sub": "ονόματα χρήστη για το διαδίκτυο", "mode.title.sub": "επίθετα για το bio σου", "mode.regal.sub": "όνομα φαντασίας + επίθετο",
      "sec.words": "Λέξεις", "words.en": "Αγγλικά", "words.el": "Ελληνικά",
      "sec.style": "Ύφος", "st.leet": "Leet (a→4)", "st.sep": "Διαχωριστικά (_ -)", "st.num": "Αριθμοί",
      "btn.gen": "Νέα ονόματα", "btn.gen.key": "Enter",
      "btn.copy": "Αντιγραφή", "btn.star": "Κράτα το", "btn.unstar": "Αφαίρεση από τα αγαπημένα", "btn.del": "Διαγραφή",
      "fav.title": "Αγαπημένα", "fav.empty": "Πάτα το αστέρι για να κρατήσεις ένα όνομα εδώ. Τα αγαπημένα σε ακολουθούν σε όλες τις συσκευές σου.",
      "fav.copyAll": "Αντιγραφή όλων",
      "list": "Νέα ονόματα",
      "live.batch": "{n} νέα ονόματα", "toast.copied": "Αντιγράφηκε", "toast.copiedAll": "Αντιγράφηκαν {n} ονόματα",
      "toast.copyFail": "Δεν έγινε αντιγραφή", "toast.deleted": "Αφαιρέθηκε από τα αγαπημένα", "toast.undo": "Αναίρεση",
      "toast.full": "Τα αγαπημένα γέμισαν ({n})", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος"
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
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("names.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Random ----------
  // rng() returns a float in [0, 1). The app uses crypto; tests pass
  // a seeded one so every batch can be checked exactly.
  function cryptoRng() {
    var buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  }
  function seeded(seed) {             // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(rng, list) { return list[Math.floor(rng() * list.length)]; }
  function chance(rng, p) { return rng() < p; }

  // ---------- 3. Greek to Latin ----------
  // Plain greeklish for handles: no accents, one Latin spelling per
  // sound (ou, ch, ps, mp → b at the start, nt → d at the start).
  var GR1 = {
    "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th",
    "ι": "i", "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p",
    "ρ": "r", "σ": "s", "ς": "s", "τ": "t", "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o"
  };
  var VOICELESS = "θκξπστφχψ";
  function stripAccents(s) {
    return s.toLowerCase()
      .replace(/[άᾶ]/g, "α").replace(/έ/g, "ε").replace(/[ήῆ]/g, "η")
      .replace(/[ίϊΐῖ]/g, "ι").replace(/ό/g, "ο").replace(/[ύϋΰῦ]/g, "υ").replace(/[ώῶ]/g, "ω");
  }
  function greeklish(word) {
    var s = stripAccents(word), out = "", i = 0;
    while (i < s.length) {
      var c = s.charAt(i), n = s.charAt(i + 1), two = c + n;
      if (two === "ου") { out += "ou"; i += 2; continue; }
      if (two === "αι") { out += "ai"; i += 2; continue; }
      if (two === "ει") { out += "ei"; i += 2; continue; }
      if (two === "οι") { out += "oi"; i += 2; continue; }
      if (two === "αυ" || two === "ευ") {
        var after = s.charAt(i + 2);
        out += (c === "α" ? "a" : "e") + (after && VOICELESS.indexOf(after) >= 0 ? "f" : "v");
        i += 2; continue;
      }
      if (two === "μπ") { out += i === 0 ? "b" : "mp"; i += 2; continue; }
      if (two === "ντ") { out += i === 0 ? "d" : "nt"; i += 2; continue; }
      if (two === "γκ") { out += i === 0 ? "g" : "ng"; i += 2; continue; }
      if (two === "γγ") { out += "ng"; i += 2; continue; }
      if (two === "τζ") { out += "tz"; i += 2; continue; }
      out += GR1[c] !== undefined ? GR1[c] : (/[a-z0-9]/.test(c) ? c : "");
      i += 1;
    }
    return out;
  }

  // ---------- 4. Generators ----------
  // opts = { leet, sep, num } (0 | 1), handles only.
  var MAX_HANDLE = 24;
  var LEET = { a: "4", e: "3", i: "1", o: "0", s: "5", t: "7" };
  var handleWords = { en: null, el: null };
  function wordsFor(lang) {
    if (!handleWords[lang]) {
      var src = W.handle[lang];
      handleWords[lang] = {
        adj: lang === "el" ? src.adj.map(greeklish) : src.adj.slice(),
        noun: lang === "el" ? src.noun.map(greeklish) : src.noun.slice()
      };
    }
    return handleWords[lang];
  }

  function leetify(rng, s) {
    var idx = [];
    for (var i = 0; i < s.length; i++) if (LEET[s.charAt(i)]) idx.push(i);
    if (!idx.length) return s;
    var chars = s.split(""), done = 0;
    idx.forEach(function (j) {
      if (chance(rng, 0.35)) { chars[j] = LEET[chars[j]]; done++; }
    });
    if (!done) { var j = pick(rng, idx); chars[j] = LEET[chars[j]]; }
    return chars.join("");
  }

  function genHandle(rng, lang, opts) {
    var w = wordsFor(lang), a, n;
    do {
      a = pick(rng, w.adj);
      n = pick(rng, w.noun);
    } while (a === n || a.length + n.length > MAX_HANDLE - 5 ||
             (opts.leet && !/[aeiost]/.test(a + n)));
    var sep = opts.sep ? (chance(rng, 0.5) ? "_" : "-") : "";
    var s = a + sep + n;
    if (opts.leet) s = leetify(rng, s);
    if (opts.num) s += String(chance(rng, 0.5) ? 1 + Math.floor(rng() * 99) : 100 + Math.floor(rng() * 900));
    return s;
  }

  function genTitle(rng, lang) {
    var w = W.title[lang], r = rng(), withAdj = r >= 0.45, withThing = r < 0.7;
    if (lang === "el") {
      var g = chance(rng, 0.5) ? 1 : 0;
      var parts = [];
      if (withAdj) parts.push(pick(rng, w.adj)[g]);
      parts.push(pick(rng, w.role)[g]);
      if (withThing) parts.push(pick(rng, w.thing));
      // sentence case: adjectives are stored capitalised, roles not
      return cap(parts.join(" "));
    }
    var out = [];
    if (withAdj) out.push(pick(rng, w.adj));
    out.push(pick(rng, w.role));
    if (withThing) out.push(pick(rng, w.thing));
    return out.join(" ");
  }

  function fantasyName(rng, lang, g) {
    var w = W.regal[lang];
    var s = pick(rng, w.start) + pick(rng, w.mid) + pick(rng, g ? w.endF : w.endM);
    if (lang === "en") s = s.replace(/([aeiouy])\1+/g, "$1");
    return s;
  }

  function genRegal(rng, lang) {
    var g = chance(rng, 0.5) ? 1 : 0;
    var name = fantasyName(rng, lang, g);
    if (lang === "el") {
      var w = W.regal.el;
      if (chance(rng, 0.75)) return name + " " + (g ? "η " : "ο ") + pick(rng, w.epiAdj)[g];
      return name + " " + pick(rng, w.epiOf);
    }
    return name + " " + pick(rng, W.regal.en.epi);
  }

  function generate(mode, lang, opts, rng) {
    if (mode === "title") return genTitle(rng, lang);
    if (mode === "regal") return genRegal(rng, lang);
    return genHandle(rng, lang, opts || {});
  }

  // A batch of n different names.
  function batch(mode, lang, opts, rng, n) {
    var seen = {}, out = [];
    for (var tries = 0; out.length < (n || BATCH) && tries < 400; tries++) {
      var s = generate(mode, lang, opts, rng);
      if (seen[s]) continue;
      seen[s] = 1;
      out.push(s);
    }
    return out;
  }

  // ---------- 5. Favourites: ids, merge ----------
  // fav = { id, m: mtime, k: mode, s: text }
  // data = { ver: 1, favs: [fav…] sorted by id, tombs: { id: deletedAt } }
  function fnv(str, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function favId(mode, text) {
    var key = mode + "|" + text;
    var a = fnv(key, 2166136261).toString(36), b = fnv(key, 3323198485).toString(36);
    return "n" + ("000000" + a).slice(-7) + ("000000" + b).slice(-7);
  }

  function cleanText(s) {
    return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "";
  }

  function normFav(f) {
    if (!f || typeof f !== "object" || MODES.indexOf(f.k) < 0 ||
        !isInt(f.m) || f.m < 0) return null;
    var s = cleanText(f.s);
    if (!s || f.id !== favId(f.k, s)) return null;
    return { id: f.id, m: f.m, k: f.k, s: s };
  }

  // LWW per favourite (newer m wins; equal m: the larger canonical
  // JSON), tombstones max-merged, delete wins ties, a newer star
  // brings a name back (R17).
  function mergeNames(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!/^n[a-z0-9]{14}$/.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.favs, b.favs].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var f = normFav(raw);
        if (!f) return;
        var cur = best[f.id];
        if (!cur || f.m > cur.m ||
            (f.m === cur.m && JSON.stringify(f) > JSON.stringify(cur))) best[f.id] = f;
      });
    });
    var favs = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      favs.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, favs: favs, tombs: sortedTombs };
  }

  function findFav(dat, mode, text) {
    var id = favId(mode, text);
    for (var i = 0; i < dat.favs.length; i++) if (dat.favs[i].id === id) return dat.favs[i];
    return null;
  }

  // Star: a fresh mtime beats any old tombstone (R17).
  function addFav(dat, mode, text, nowMs) {
    var s = cleanText(text), id = favId(mode, s);
    if (!s || findFav(dat, mode, s)) return dat;
    var f = { id: id, m: Math.max(nowMs, (dat.tombs[id] || 0) + 1), k: mode, s: s };
    return mergeNames(dat, { favs: [f], tombs: {} });
  }
  function removeFav(dat, id, nowMs) {
    var f = null;
    dat.favs.forEach(function (x) { if (x.id === id) f = x; });
    if (!f) return dat;
    var tombs = {};
    tombs[id] = Math.max(nowMs, f.m);
    return mergeNames(dat, { favs: [], tombs: tombs });
  }

  // Display order: by mode, newest first.
  function favGroups(dat) {
    return MODES.map(function (k) {
      return {
        k: k,
        list: dat.favs.filter(function (f) { return f.k === k; })
          .sort(function (x, y) { return y.m - x.m || cmpStr(x.s, y.s); })
      };
    });
  }

  // ---------- 6. Storage + prefs ----------
  var data = { ver: DATA_VER, favs: [], tombs: {} };
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.favs)) {
          data = mergeNames(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] names: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: DATA_VER, favs: [], tombs: {} };
  }

  var saveFailShown = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      mode: MODES.indexOf(p.mode) >= 0 ? p.mode : "handle",
      words: p.words === "el" || p.words === "en" ? p.words : LANG,
      leet: p.leet === 1 ? 1 : 0,
      sep: p.sep === 1 ? 1 : 0,
      num: p.num === 1 ? 1 : 0
    };
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 7. UI ----------
  var ICON = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    gen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>'
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
  function shown(mode, s) { return mode === "handle" ? "@" + s : s; }

  var batches = {};          // mode → [text…], this session only

  function newBatch() {
    batches[prefs.mode] = batch(prefs.mode, prefs.words, prefs, cryptoRng, BATCH);
    renderList();
    live(t("live.batch", { n: batches[prefs.mode].length }));
  }

  function buildTabs() {
    var host = $("tabs");
    host.innerHTML = "";
    MODES.forEach(function (m) {
      var b = el("button", "tab");
      b.type = "button";
      b.id = "tab-" + m;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-controls", "list");
      b.setAttribute("data-m", m);
      b.appendChild(el("span", "tab-name", t("mode." + m)));
      b.appendChild(el("span", "tab-sub", t("mode." + m + ".sub")));
      b.addEventListener("click", function () { setMode(m); });
      b.addEventListener("keydown", function (e) {
        var i = MODES.indexOf(m);
        if (e.key === "ArrowRight" || e.key === "ArrowDown") i = (i + 1) % MODES.length;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i = (i + MODES.length - 1) % MODES.length;
        else return;
        e.preventDefault();
        setMode(MODES[i]);
        $("tab-" + MODES[i]).focus();
      });
      host.appendChild(b);
    });
  }

  function buildOptions() {
    var host = $("words");
    host.innerHTML = "";
    ["el", "en"].forEach(function (w) {
      var b = el("button", "chip", t("words." + w));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-w", w);
      b.addEventListener("click", function () {
        if (prefs.words === w) return;
        prefs.words = w; savePrefs();
        batches = {};
        renderOptions(); newBatch();
      });
      host.appendChild(b);
    });
    var styles = $("styles");
    styles.innerHTML = "";
    ["leet", "sep", "num"].forEach(function (k) {
      var b = el("button", "chip", t("st." + k));
      b.type = "button";
      b.setAttribute("data-k", k);
      b.addEventListener("click", function () {
        prefs[k] = prefs[k] ? 0 : 1; savePrefs();
        renderOptions(); newBatch();
      });
      styles.appendChild(b);
    });
  }

  function setMode(m) {
    if (prefs.mode === m) return;
    prefs.mode = m; savePrefs();
    renderOptions();
    if (!batches[m]) newBatch(); else renderList();
  }

  function renderOptions() {
    [].forEach.call(document.querySelectorAll(".tab"), function (b) {
      var on = b.getAttribute("data-m") === prefs.mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    [].forEach.call(document.querySelectorAll("#words .chip"), function (b) {
      var on = b.getAttribute("data-w") === prefs.words;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
    [].forEach.call(document.querySelectorAll("#styles .chip"), function (b) {
      var on = !!prefs[b.getAttribute("data-k")];
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $("style-sec").hidden = prefs.mode !== "handle";
    $("list").setAttribute("aria-labelledby", "tab-" + prefs.mode);
    $("title-sub").textContent = t("mode." + prefs.mode);
  }

  function renderList() {
    var host = $("list"), mode = prefs.mode;
    host.innerHTML = "";
    (batches[mode] || []).forEach(function (s, i) {
      var li = el("li", "row");
      li.style.setProperty("--i", i);
      var txt = el("span", "name", shown(mode, s));
      if (mode !== "handle" && prefs.words === "el") txt.lang = "el";
      li.appendChild(txt);
      var c = iconBtn("copy-btn", ICON.copy, t("btn.copy") + ": " + shown(mode, s));
      c.addEventListener("click", function () { copyOne(s); });
      li.appendChild(c);
      var on = !!findFav(data, mode, s);
      var st = iconBtn("star-btn" + (on ? " on" : ""), ICON.star, (on ? t("btn.unstar") : t("btn.star")) + ": " + shown(mode, s));
      st.setAttribute("aria-pressed", on ? "true" : "false");
      st.addEventListener("click", function () { toggleStar(mode, s); });
      li.appendChild(st);
      host.appendChild(li);
    });
  }

  // Star state only, so starring does not replay the rows' entrance.
  function refreshStars() {
    var mode = prefs.mode, rows = $("list").children;
    (batches[mode] || []).forEach(function (s, i) {
      var b = rows[i] && rows[i].querySelector(".star-btn");
      if (!b) return;
      var on = !!findFav(data, mode, s);
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      var label = (on ? t("btn.unstar") : t("btn.star")) + ": " + shown(mode, s);
      b.setAttribute("aria-label", label);
      b.title = label;
    });
  }

  function renderFavs() {
    var host = $("favs");
    host.innerHTML = "";
    var total = data.favs.length;
    $("fav-count").textContent = total ? String(total) : "";
    $("copy-all").hidden = !total;
    $("fav-empty").hidden = !!total;
    favGroups(data).forEach(function (g) {
      if (!g.list.length) return;
      var sec = el("section", "fav-group");
      sec.appendChild(el("h3", "", t("mode." + g.k)));
      var ul = el("ul", "fav-list");
      g.list.forEach(function (f) {
        var li = el("li", "row fav");
        li.appendChild(el("span", "name", shown(f.k, f.s)));
        var c = iconBtn("copy-btn", ICON.copy, t("btn.copy") + ": " + shown(f.k, f.s));
        c.addEventListener("click", function () { copyOne(f.s); });
        li.appendChild(c);
        var d = iconBtn("del-btn", ICON.del, t("btn.del") + ": " + shown(f.k, f.s));
        d.addEventListener("click", function () { deleteFav(f, li); });
        li.appendChild(d);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      host.appendChild(sec);
    });
  }

  function toggleStar(mode, s) {
    var f = findFav(data, mode, s);
    if (f) data = removeFav(data, f.id, Date.now());
    else {
      if (data.favs.length >= MAX_FAVS) { showToast(t("toast.full", { n: MAX_FAVS })); return; }
      data = addFav(data, mode, s, Date.now());
    }
    save();
    refreshStars();
    renderFavs();
  }

  function deleteFav(f, li) {
    // keep focus in the list: the row that takes this one's place
    var at = [].indexOf.call(li.parentNode.children, li);
    data = removeFav(data, f.id, Date.now());
    save();
    renderFavs();
    refreshStars();
    focusFavRow(f.k, at);
    undoToast(t("toast.deleted"), function () {
      data = addFav(data, f.k, f.s, Date.now());
      save();
      renderFavs();
      refreshStars();
    });
  }
  function focusFavRow(k, i) {
    var groups = $("favs").querySelectorAll(".fav-group");
    var order = favGroups(data).filter(function (g) { return g.list.length; });
    for (var gi = 0; gi < order.length; gi++) {
      if (order[gi].k !== k) continue;
      var rows = groups[gi].querySelectorAll(".row");
      var r = rows[Math.max(0, Math.min(i, rows.length - 1))];
      if (r) { r.querySelector(".del-btn").focus(); return; }
    }
    $("gen-btn").focus();
  }

  // ---------- 8. Copy + toasts ----------
  function copyText(s) {
    function fallback() {
      try {
        var ta = el("textarea");
        ta.value = s;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch (e) { return false; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).then(function () { return true; },
        function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }
  function copyOne(s) {
    copyText(s).then(function (ok) { showToast(ok ? t("toast.copied") : t("toast.copyFail")); });
  }
  function copyAll() {
    var lines = [];
    favGroups(data).forEach(function (g) { g.list.forEach(function (f) { lines.push(f.s); }); });
    if (!lines.length) return;
    copyText(lines.join("\n")).then(function (ok) {
      showToast(ok ? t("toast.copiedAll", { n: lines.length }) : t("toast.copyFail"));
    });
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "names", title: String(text) })) return;
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
    // Enter or Space: a new batch (not on a button or a field)
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      var tag = e.target && e.target.tagName;
      if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Enter" || e.key === " " || e.code === "Space") {
        e.preventDefault();
        newBatch();
      }
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
    api.registerSlice("names", sliceGet, sliceSet, STORAGE_KEY, mergeNames);
  }

  function sliceGet() { return mergeNames(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.favs)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeNames(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) !== before) { renderFavs(); refreshStars(); }   // no toast on merge
  }

  // ---------- 11. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    var g = $("gen-btn");
    g.innerHTML = ICON.gen;
    g.appendChild(el("span", "", t("btn.gen")));
    g.appendChild(el("kbd", "", t("btn.gen.key")));
    $("list").setAttribute("aria-label", t("list"));
  }

  function wire() {
    $("gen-btn").addEventListener("click", newBatch);
    $("copy-all").addEventListener("click", copyAll);
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    buildTabs();
    buildOptions();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderOptions();
    renderFavs();
    newBatch();
  }

  boot();
})();
