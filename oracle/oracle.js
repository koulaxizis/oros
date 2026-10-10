// ============================================================
// orOS Oracle — App logic (v1.0.0)
// Ask a question, get a prophecy: always true, never helpful.
//   - the same question on the same day gets the same answer
//     ("the Oracle does not change its mind")
//   - topics from keywords (time, love, work, yes/no, general),
//     in Greek or English, with or without accents
//   - a short ceremony (smoke, letter-by-letter), instant with
//     reduced motion; optional gong (off by default)
//   - oracle of the day, the same on every device
//   - favourites (synced), a log of the last 100 questions (this
//     device only), copy as text, save as a PNG card
// Data:
//   - synced slice "oracle" (oros-oracle-data): favourites, LWW per
//     item + tombstones (R5, R17, R26)
//   - device-local (R10): oros-oracle-prefs (log, sound)
// Sections:
//   1. Constants, i18n, helpers
//   2. Prophecies
//   3. Favourites: merge
//   4. Storage + prefs
//   5. UI
//   6. Ceremony + sound
//   7. Copy + card
//   8. Toasts
//   9. Keyboard (Contract Β)
//  10. Sync slice + palette
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-oracle-data";
  var PREFS_KEY   = "oros-oracle-prefs";
  var DATA_VER    = 1;
  var MAX_Q       = 200;
  var MAX_A       = 400;
  var MAX_FAVS    = 500;
  var MAX_LOG     = 100;
  var TOPICS      = ["time", "love", "work", "yesno", "general"];
  var W           = window.ORACLE_WORDS;

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
      "app.name": "Oracle",
      "q.ph": "Ask the Oracle anything…", "q.label": "Your question", "btn.ask": "Ask the Oracle",
      "silence": "The Oracle does not answer silence.",
      "daily": "Oracle of the day", "you.asked": "You asked",
      "btn.star": "Add to favourites", "btn.unstar": "Remove from favourites",
      "btn.copy": "Copy", "btn.card": "Save as image",
      "sound.on": "Gong: on", "sound.off": "Gong: off",
      "fav.title": "Favourites", "fav.empty": "Star a prophecy to keep it. Favourites follow you to all your devices.",
      "log.title": "Recent questions", "log.empty": "Your questions stay on this device.",
      "log.clear": "Clear", "item.delete": "Delete", "item.reask": "Show again",
      "toast.copied": "Copied", "toast.copyFail": "Could not copy", "toast.saved": "Saved",
      "toast.starred": "Added to favourites", "toast.unstarred": "Removed from favourites",
      "toast.deleted": "Deleted", "toast.cleared": "Recent questions cleared", "toast.undo": "Undo",
      "toast.full": "Favourites are full ({n})", "toast.saveFail": "Could not save: storage is full",
      "card.footer": "Oracle · orOS", "live.thinking": "The Oracle is thinking…",
      "keys": "Enter asks · / jumps to the question"
    },
    el: {
      "app.name": "Μαντείο",
      "q.ph": "Ρώτα το Μαντείο ό,τι θέλεις…", "q.label": "Η ερώτησή σου", "btn.ask": "Ρώτα το Μαντείο",
      "silence": "Το Μαντείο δεν απαντά στη σιωπή.",
      "daily": "Χρησμός της ημέρας", "you.asked": "Ρώτησες",
      "btn.star": "Προσθήκη στα αγαπημένα", "btn.unstar": "Αφαίρεση από τα αγαπημένα",
      "btn.copy": "Αντιγραφή", "btn.card": "Αποθήκευση ως εικόνα",
      "sound.on": "Γκονγκ: ανοιχτό", "sound.off": "Γκονγκ: κλειστό",
      "fav.title": "Αγαπημένα", "fav.empty": "Βάλε αστέρι σε έναν χρησμό για να τον κρατήσεις. Τα αγαπημένα σε ακολουθούν σε όλες τις συσκευές σου.",
      "log.title": "Πρόσφατες ερωτήσεις", "log.empty": "Οι ερωτήσεις σου μένουν σε αυτή τη συσκευή.",
      "log.clear": "Καθάρισμα", "item.delete": "Διαγραφή", "item.reask": "Ξανά",
      "toast.copied": "Αντιγράφηκε", "toast.copyFail": "Δεν έγινε αντιγραφή", "toast.saved": "Αποθηκεύτηκε",
      "toast.starred": "Προστέθηκε στα αγαπημένα", "toast.unstarred": "Αφαιρέθηκε από τα αγαπημένα",
      "toast.deleted": "Διαγράφηκε", "toast.cleared": "Οι πρόσφατες ερωτήσεις καθαρίστηκαν", "toast.undo": "Αναίρεση",
      "toast.full": "Τα αγαπημένα γέμισαν ({n})", "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "card.footer": "Μαντείο · orOS", "live.thinking": "Το Μαντείο σκέφτεται…",
      "keys": "Enter για ερώτηση · / στο πεδίο της ερώτησης"
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
  function clip(s, n) { return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : ""; }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("oracle.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Prophecies ----------
  function hash32(s) {                // FNV-1a
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // Lower case, no accents, final sigma as sigma, only letters and
  // digits separated by single spaces.
  function normQ(q) {
    var s = String(q || "").toLowerCase();
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s.replace(/ς/g, "σ").replace(/[^a-z0-9Ͱ-Ͽ]+/g, " ").trim();
  }

  function topicOf(q) {
    var n = " " + normQ(q) + " ";
    for (var i = 0; i < 3; i++) {
      var tp = TOPICS[i], ks = W.K[tp];
      for (var j = 0; j < ks.length; j++) {
        if (n.indexOf(" " + normQ(ks[j])) >= 0) return tp;
      }
    }
    var ys = W.K.yesno;
    for (var k = 0; k < ys.length; k++) {
      if (n.indexOf(" " + normQ(ys[k]) + " ") === 0) return "yesno";
    }
    return "general";
  }

  // Local date as YYYY-MM-DD.
  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  // The same question, the same day, the same answer. Empty → silence.
  function prophecy(q, lang, day) {
    var n = normQ(q);
    if (!n) return null;
    var tp = topicOf(q), list = W.P[lang === "el" ? "el" : "en"][tp];
    return { topic: tp, a: list[hash32(n + "|" + day + "|" + tp) % list.length] };
  }

  function dailyOracle(lang, day) {
    var P = W.P[lang === "el" ? "el" : "en"], all = [];
    TOPICS.forEach(function (tp) { all = all.concat(P[tp]); });
    return all[hash32("day:" + day) % all.length];
  }

  // ---------- 3. Favourites: merge ----------
  // fav = { id, m: mtime, q (≤ 200, may be ""), a (≤ 400), d: "YYYY-MM-DD" }
  // data = { ver: 1, favs: [fav…] sorted by id, tombs: { id: deletedAt } }
  var ID_RE  = /^o[a-z0-9]{6,30}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  function favId(q, a) {
    var k = normQ(clip(q, MAX_Q)) + "|" + clip(a, MAX_A);      // "Πότε;" and "ποτε" are one question
    return "o" + hash32(k).toString(36) + hash32("x" + k).toString(36);
  }
  function normFav(f) {
    if (!f || typeof f !== "object" || typeof f.id !== "string" || !ID_RE.test(f.id) ||
        !isInt(f.m) || f.m < 0) return null;
    var a = clip(f.a, MAX_A);
    if (!a) return null;
    return { id: f.id, m: f.m, q: clip(f.q, MAX_Q), a: a,
             d: typeof f.d === "string" && DAY_RE.test(f.d) ? f.d : "" };
  }

  // LWW per item (newer m wins; equal m: the larger canonical JSON),
  // tombstones max-merged, delete wins ties, a newer edit resurrects (R17).
  function mergeOracle(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
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

  function findFav(dat, id) {
    for (var i = 0; i < dat.favs.length; i++) if (dat.favs[i].id === id) return dat.favs[i];
    return null;
  }
  function newestFirst(list) {
    return list.slice().sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); });
  }

  // ---------- 4. Storage + prefs ----------
  var data = { ver: DATA_VER, favs: [], tombs: {} };
  var prefs = { log: [], sound: false };

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.favs)) {
          data = mergeOracle(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] oracle: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: DATA_VER, favs: [], tombs: {} };
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

  // log entry = { q, a, t: time }
  function normLog(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (x) {
      if (!x || typeof x !== "object" || !isInt(x.t) || x.t < 0) return;
      var a = clip(x.a, MAX_A);
      if (a) out.push({ q: clip(x.q, MAX_Q), a: a, t: x.t });
    });
    return out.slice(0, MAX_LOG);
  }
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    prefs = { log: normLog(p.log), sound: p.sound === true };
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 5. UI ----------
  var ICON = {
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>',
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

  var current = null;      // { q, a, d } on the stage

  function dateLabel(d) {
    try {
      return new Date(d + "T12:00:00").toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
        { weekday: "long", day: "numeric", month: "long" });
    } catch (e) { return d; }
  }
  function timeLabel(ms) {
    try {
      return new Date(ms).toLocaleString(LANG === "el" ? "el-GR" : "en-GB",
        { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  function renderDaily() {
    var d = dayKey();
    $("title-sub").textContent = dateLabel(d);
    $("daily-text").textContent = dailyOracle(LANG, d);
  }

  function renderStage() {
    var has = !!current;
    $("answer").hidden = !has;
    if (!has) return;
    $("answer-q").textContent = current.q;
    $("answer-q-wrap").hidden = !current.q;
    refreshStar();
  }
  function refreshStar() {
    if (!current) return;
    var on = !!findFav(data, favId(current.q, current.a));
    var b = $("star-btn");
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.setAttribute("aria-label", on ? t("btn.unstar") : t("btn.star"));
    b.title = b.getAttribute("aria-label");
  }

  function renderFavs() {
    var host = $("favs"), list = newestFirst(data.favs);
    host.innerHTML = "";
    $("fav-empty").hidden = list.length > 0;
    $("fav-count").textContent = list.length ? String(list.length) : "";
    list.forEach(function (f) {
      var li = el("li", "row");
      var body = el("div", "row-body");
      if (f.q) body.appendChild(el("div", "row-q", f.q));
      body.appendChild(el("div", "row-a", f.a));
      li.appendChild(body);
      var d = iconBtn("del-btn", ICON.del, t("item.delete") + ": " + f.a);
      d.addEventListener("click", function () { unstar(f.id); });
      li.appendChild(d);
      host.appendChild(li);
    });
    refreshStar();
  }

  function renderLog() {
    var host = $("log");
    host.innerHTML = "";
    $("log-empty").hidden = prefs.log.length > 0;
    $("clear-log").hidden = prefs.log.length === 0;
    prefs.log.forEach(function (x, i) {
      var li = el("li", "row");
      var body = el("button", "row-body row-open");
      body.type = "button";
      body.setAttribute("aria-label", t("item.reask") + ": " + (x.q || x.a));
      if (x.q) body.appendChild(el("div", "row-q", x.q));
      body.appendChild(el("div", "row-a", x.a));
      body.appendChild(el("div", "row-t", timeLabel(x.t)));
      body.addEventListener("click", function () {
        current = { q: x.q, a: x.a, d: dayKey(new Date(x.t)) };
        renderStage();
        $("answer-a").textContent = x.a;
        $("answer").scrollIntoView({ block: "nearest" });
      });
      li.appendChild(body);
      var d = iconBtn("del-btn", ICON.del, t("item.delete") + ": " + (x.q || x.a));
      d.addEventListener("click", function () { deleteLog(i); });
      li.appendChild(d);
      host.appendChild(li);
    });
  }

  function renderSound() {
    var b = $("sound-btn");
    b.innerHTML = prefs.sound ? ICON.bell : ICON.mute;
    b.setAttribute("aria-pressed", prefs.sound ? "true" : "false");
    b.setAttribute("aria-label", prefs.sound ? t("sound.on") : t("sound.off"));
    b.title = b.getAttribute("aria-label");
  }

  // --- favourites + log actions ---
  function toggleStar() {
    if (!current) return;
    var id = favId(current.q, current.a), cur = findFav(data, id);
    if (cur) { unstar(id); return; }
    if (data.favs.length >= MAX_FAVS) { showToast(t("toast.full", { n: MAX_FAVS })); return; }
    var m = Math.max(Date.now(), (data.tombs[id] || 0) + 1);       // past an old tomb (R17)
    data = mergeOracle(data, { favs: [{ id: id, m: m, q: current.q, a: current.a, d: current.d }], tombs: {} });
    save(); renderFavs();
    showToast(t("toast.starred"));
  }
  function unstar(id) {
    var it = findFav(data, id);
    if (!it) return;
    var snap = JSON.parse(JSON.stringify(it)), tombs = {};
    tombs[id] = Math.max(Date.now(), it.m);
    data = mergeOracle(data, { favs: [], tombs: tombs });
    save(); renderFavs();
    undoToast(t("toast.unstarred"), function () {
      snap.m = Math.max(Date.now(), (data.tombs[snap.id] || 0) + 1);   // R17
      data = mergeOracle(data, { favs: [snap], tombs: {} });
      save(); renderFavs();
    });
  }
  function addLog(q, a) {
    prefs.log.unshift({ q: q, a: a, t: Date.now() });
    if (prefs.log.length > MAX_LOG) prefs.log.length = MAX_LOG;
    savePrefs(); renderLog();
  }
  function deleteLog(i) {
    var snap = prefs.log.slice();
    prefs.log.splice(i, 1);
    savePrefs(); renderLog();
    $("q").focus();
    undoToast(t("toast.deleted"), function () { prefs.log = snap; savePrefs(); renderLog(); });
  }
  function clearLog() {
    var snap = prefs.log.slice();
    prefs.log = [];
    savePrefs(); renderLog();
    $("q").focus();
    undoToast(t("toast.cleared"), function () { prefs.log = snap; savePrefs(); renderLog(); });
  }

  // ---------- 6. Ceremony + sound ----------
  var busy = false, typeTimer = null;
  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }

  function ask() {
    if (busy) return;
    var q = clip($("q").value, MAX_Q);
    var day = dayKey();
    var p = prophecy(q, LANG, day);
    if (!p) {
      current = null; renderStage();
      showToast(t("silence"));
      live(t("silence"));
      $("q").focus();
      return;
    }
    current = { q: q, a: p.a, d: day };
    addLog(q, p.a);
    renderStage();
    reveal(p.a);
  }

  function reveal(text) {
    var out = $("answer-a"), stage = $("stage");
    clearTimeout(typeTimer);
    if (reducedMotion()) {
      out.textContent = text;
      gong();
      live(text);
      return;
    }
    busy = true;
    $("ask-btn").disabled = true;
    out.textContent = "";
    out.setAttribute("aria-busy", "true");
    live(t("live.thinking"));
    stage.classList.remove("smoke");
    void stage.offsetWidth;
    stage.classList.add("smoke");
    var i = 0;
    typeTimer = setTimeout(function step() {
      if (i === 0) gong();
      i++;
      out.textContent = text.slice(0, i);
      if (i < text.length) { typeTimer = setTimeout(step, 26); return; }
      busy = false;
      $("ask-btn").disabled = false;
      out.removeAttribute("aria-busy");
      live(text);
    }, 900);
  }

  var audioCtx = null;
  function gong() {
    if (!prefs.sound) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      var now = audioCtx.currentTime, master = audioCtx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
      master.connect(audioCtx.destination);
      [[110, 1], [164.8, 0.5], [220.5, 0.35], [297, 0.2]].forEach(function (h) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(h[0], now);
        g.gain.value = h[1];
        o.connect(g); g.connect(master);
        o.start(now); o.stop(now + 3.3);
      });
    } catch (e) {}
  }

  // ---------- 7. Copy + card ----------
  function shareText(c) {
    return (c.q ? "— " + c.q + "\n" : "") + c.a + "\n(" + t("card.footer") + ")";
  }
  function copyCurrent() {
    if (!current) return;
    var s = shareText(current);
    var p = (navigator.clipboard && navigator.clipboard.writeText)
      ? navigator.clipboard.writeText(s).then(function () { return true; }, function () { return false; })
      : Promise.resolve(false);
    p.then(function (ok) { showToast(ok ? t("toast.copied") : t("toast.copyFail")); });
  }

  function cssVar(name, fb) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; }
    catch (e) { return fb; }
  }
  // Greedy word wrap for the canvas.
  function wrapLines(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], line = "";
    words.forEach(function (w) {
      var tryL = line ? line + " " + w : w;
      if (ctx.measureText(tryL).width <= maxW || !line) line = tryL;
      else { lines.push(line); line = w; }
    });
    if (line) lines.push(line);
    return lines;
  }
  function cardBlob(c) {
    return new Promise(function (resolve, reject) {
      try {
        var S = 1080, pad = 110;
        var cv = document.createElement("canvas");
        cv.width = S; cv.height = S;
        var ctx = cv.getContext("2d");
        var bg = cssVar("--panel-bg", "#1d1a13"), ink = cssVar("--text", "#f0ead9"),
            dim = cssVar("--text-dim", "#a89f8a"), acc = cssVar("--accent", "#d4af37");
        ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
        var grd = ctx.createRadialGradient(S / 2, S * 0.18, 10, S / 2, S * 0.18, S * 0.7);
        grd.addColorStop(0, "rgba(255,255,255,0.08)"); grd.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grd; ctx.fillRect(0, 0, S, S);
        ctx.strokeStyle = acc; ctx.lineWidth = 4;
        ctx.strokeRect(40, 40, S - 80, S - 80);
        // eye
        ctx.beginPath();
        ctx.moveTo(S / 2 - 70, 170); ctx.quadraticCurveTo(S / 2, 110, S / 2 + 70, 170);
        ctx.quadraticCurveTo(S / 2, 230, S / 2 - 70, 170);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(S / 2, 170, 20, 0, Math.PI * 2); ctx.fillStyle = acc; ctx.fill();
        ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        var y = 300;
        if (c.q) {
          ctx.fillStyle = dim;
          ctx.font = "italic 34px Georgia, 'Times New Roman', serif";
          wrapLines(ctx, "«" + c.q + "»", S - pad * 2).slice(0, 3).forEach(function (l) { ctx.fillText(l, S / 2, y); y += 46; });
          y += 30;
        }
        var size = c.a.length > 140 ? 44 : (c.a.length > 80 ? 52 : 60);
        ctx.font = size + "px Georgia, 'Times New Roman', serif";
        var lines = wrapLines(ctx, c.a, S - pad * 2);
        var lh = size * 1.3, block = lines.length * lh;
        y = Math.max(y + size, (S - block) / 2 + size * 0.8);
        ctx.fillStyle = ink;
        lines.forEach(function (l) { ctx.fillText(l, S / 2, y); y += lh; });
        ctx.fillStyle = acc;
        ctx.font = "bold 28px 'Nunito', 'Segoe UI', system-ui, sans-serif";
        ctx.fillText(t("card.footer"), S / 2, S - 90);
        cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error("toBlob")); }, "image/png");
      } catch (e) { reject(e); }
    });
  }
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function saveCard() {
    if (!current) return;
    var c = current;
    cardBlob(c).then(function (blob) {
      var name = "oracle-" + (c.d || dayKey()) + ".png";
      var dlg = dialogHost();
      if (dlg && typeof dlg.saveFile === "function") {
        dlg.saveFile({ blob: blob, filename: name, mime: "image/png",
                       types: [{ description: "PNG", accept: { "image/png": [".png"] } }] })
          .then(function (r) { if (r && r.ok) showToast(t("toast.saved")); });
        return;                       // cancel (ok=false) = silent exit
      }
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      showToast(t("toast.saved"));
    }, function () { showToast(t("toast.copyFail")); });
  }

  // ---------- 8. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "oracle", title: String(text) })) return;
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
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key === "/") { e.preventDefault(); $("q").focus(); $("q").select(); }
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
    api.registerSlice("oracle", sliceGet, sliceSet, STORAGE_KEY, mergeOracle);
  }

  function sliceGet() { return mergeOracle(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.favs)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeOracle(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) !== before) renderFavs();   // no toast on merge
  }

  // ---------- 11. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app.name") + " · orOS";
    $("q").placeholder = t("q.ph");
    $("q").setAttribute("aria-label", t("q.label"));
    var ab = $("ask-btn");
    ab.innerHTML = ICON.eye;
    ab.appendChild(el("span", "", t("btn.ask")));
    [["copy-btn", ICON.copy, "btn.copy"], ["card-btn", ICON.image, "btn.card"], ["star-btn", ICON.star, "btn.star"]]
      .forEach(function (x) {
        var b = $(x[0]);
        b.innerHTML = x[1];
        b.setAttribute("aria-label", t(x[2]));
        b.title = t(x[2]);
      });
  }

  function wire() {
    $("ask-form").addEventListener("submit", function (e) { e.preventDefault(); ask(); });
    $("star-btn").addEventListener("click", toggleStar);
    $("copy-btn").addEventListener("click", copyCurrent);
    $("card-btn").addEventListener("click", saveCard);
    $("clear-log").addEventListener("click", clearLog);
    $("sound-btn").addEventListener("click", function () {
      prefs.sound = !prefs.sound;
      savePrefs(); renderSound();
      if (prefs.sound) gong();
    });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    inheritPalette();
    wire();
    registerSync();
    watchPalette();
    renderDaily();
    renderSound();
    renderStage();
    renderFavs();
    renderLog();
  }

  boot();
})();
