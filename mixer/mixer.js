// ============================================================
// orOS Sound Mixer — App logic (v1.0.0)
// Ambient sounds, every one synthesized live with Web Audio: no
// audio files, no network. Thirteen channels (rain, thunder, wind,
// waves, stream, fireplace, café, crickets, birds, noise, train,
// keyboard, clock), each with its own switch and level; master play /
// pause, volume, mute; sleep timer with a 30 s fade; six ready mixes
// and your own (synced).
//   - small random variations everywhere, so nothing loops audibly
//   - the engine (mixer/engine.js) runs in the shell window: the sound
//     keeps playing after the app closes, with a taskbar chip (play /
//     pause, stop, volume, sleep timer; shell mixerTrayTick)
// Data:
//   - synced slice "mixer" (oros-mixer-data): saved mixes LWW +
//     tombstones (R5, R17, R26)
//   - device-local (R10): oros-mixer-prefs (current mix, master
//     volume, mute, timer)
// Sections:
//   1. Constants, i18n, helpers
//   2. Mix model: normalize, compare, presets
//   3. Saved mixes: normalize, merge
//   4. Storage + prefs
//   5. Engine: loads mixer/engine.js into the shell, play / pause, sync
//   6. UI: channels, presets, saved mixes, toolbar
//   7. Dialogs + toasts
//   8. Keyboard (Contract Β)
//   9. Sync slice + palette
//  10. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-mixer-data";
  var PREFS_KEY   = "oros-mixer-prefs";
  var DATA_VER    = 1;
  var MAX_MIXES   = 40;
  var NAME_LEN    = 40;
  var FADE_MS     = 30000;          // sleep-timer fade-out
  var TIMERS      = [0, 15, 30, 60, 90];
  var CHANNELS    = ["rain", "thunder", "wind", "waves", "stream",
                     "fire", "cafe", "crickets", "birds", "noise",
                     "train", "keyboard", "clock"];
  var NOISE_COLORS = ["pink", "brown", "white"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();

  var STRINGS = {
    en: {
      "ch.rain": "Rain", "ch.thunder": "Thunder", "ch.wind": "Wind", "ch.waves": "Waves",
      "ch.stream": "Stream", "ch.fire": "Fireplace", "ch.cafe": "Café", "ch.crickets": "Crickets",
      "ch.birds": "Birds", "ch.noise": "Noise",
      "ch.train": "Train", "ch.keyboard": "Keyboard", "ch.clock": "Clock",
      "nc.pink": "Pink", "nc.brown": "Brown", "nc.white": "White", "nc.label": "Noise colour: {c}",
      "sec.sounds": "Sounds", "sec.presets": "Ready mixes", "sec.mine": "My mixes",
      "pr.rainnight": "Rainy night", "pr.cafe": "Café", "pr.forest": "Forest",
      "pr.seaside": "Seaside", "pr.storm": "Storm", "pr.focus": "Focus",
      "btn.play": "Play (Space)", "btn.pause": "Pause (Space)", "btn.mute": "Mute (M)", "btn.unmute": "Unmute (M)",
      "btn.save": "Save mix", "vol": "Volume", "level": "{ch} level",
      "timer": "Sleep timer", "timer.off": "Timer off", "timer.min": "{n} min",
      "mix.custom": "Your mix", "mix.none": "Nothing on",
      "mine.empty": "Save a mix to keep it here.",
      "mine.rename": "Rename {name}", "mine.del": "Delete {name}",
      "dlg.saveTitle": "Save mix", "dlg.renameTitle": "Rename mix", "dlg.name": "Name",
      "dlg.save": "Save", "dlg.cancel": "Cancel",
      "toast.needOne": "Turn on a sound first", "toast.saved": "Mix saved", "toast.deleted": "Mix deleted",
      "toast.undo": "Undo", "toast.maxMixes": "Up to {n} saved mixes",
      "toast.save": "Could not save: storage is full", "toast.timerEnd": "Sleep timer ended",
      "toast.noAudio": "This browser cannot play sound here",
      "toast.needName": "Give the mix a name",
      "live.on": "{ch} on", "live.off": "{ch} off", "live.playing": "Playing", "live.paused": "Paused"
    },
    el: {
      "ch.rain": "Βροχή", "ch.thunder": "Βροντές", "ch.wind": "Άνεμος", "ch.waves": "Κύματα",
      "ch.stream": "Ρυάκι", "ch.fire": "Τζάκι", "ch.cafe": "Καφέ", "ch.crickets": "Τριζόνια",
      "ch.birds": "Πουλιά", "ch.noise": "Θόρυβος", "ch.train": "Τρένο", "ch.keyboard": "Πληκτρολόγιο", "ch.clock": "Ρολόι",
      "nc.pink": "Ροζ", "nc.brown": "Καφέ", "nc.white": "Λευκός", "nc.label": "Χρώμα θορύβου: {c}",
      "sec.sounds": "Ήχοι", "sec.presets": "Έτοιμοι συνδυασμοί", "sec.mine": "Οι συνδυασμοί μου",
      "pr.rainnight": "Βροχερή νύχτα", "pr.cafe": "Καφέ", "pr.forest": "Δάσος",
      "pr.seaside": "Παραλία", "pr.storm": "Καταιγίδα", "pr.focus": "Συγκέντρωση",
      "btn.play": "Αναπαραγωγή (Space)", "btn.pause": "Παύση (Space)", "btn.mute": "Σίγαση (M)", "btn.unmute": "Ήχος (M)",
      "btn.save": "Αποθήκευση συνδυασμού", "vol": "Ένταση", "level": "Ένταση: {ch}",
      "timer": "Χρονόμετρο ύπνου", "timer.off": "Χωρίς χρονόμετρο", "timer.min": "{n} λεπτά",
      "mix.custom": "Δικός σου συνδυασμός", "mix.none": "Τίποτα ανοιχτό",
      "mine.empty": "Αποθήκευσε έναν συνδυασμό για να τον κρατήσεις εδώ.",
      "mine.rename": "Μετονομασία: {name}", "mine.del": "Διαγραφή: {name}",
      "dlg.saveTitle": "Αποθήκευση συνδυασμού", "dlg.renameTitle": "Μετονομασία συνδυασμού", "dlg.name": "Όνομα",
      "dlg.save": "Αποθήκευση", "dlg.cancel": "Άκυρο",
      "toast.needOne": "Άνοιξε πρώτα έναν ήχο", "toast.saved": "Ο συνδυασμός αποθηκεύτηκε", "toast.deleted": "Ο συνδυασμός διαγράφηκε",
      "toast.undo": "Αναίρεση", "toast.maxMixes": "Έως {n} αποθηκευμένοι συνδυασμοί",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.timerEnd": "Το χρονόμετρο ύπνου τελείωσε",
      "toast.noAudio": "Αυτός ο browser δεν μπορεί να παίξει ήχο εδώ",
      "toast.needName": "Δώσε ένα όνομα στον συνδυασμό",
      "live.on": "{ch}: ανοιχτό", "live.off": "{ch}: κλειστό", "live.playing": "Παίζει", "live.paused": "Σε παύση"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "mixer", LANG);

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
  function clampInt(v, lo, hi, dflt) {
    if (typeof v !== "number" || !isFinite(v)) return dflt;
    v = Math.round(v);
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("mixer.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Mix model ----------
  // mix = { ch: { <channel>: { o: 0|1, v: 0–100 } } (every channel,
  //         fixed order), nc: pink|brown|white (noise colour) }
  function normMix(m) {
    m = (m && typeof m === "object") ? m : {};
    var src = (m.ch && typeof m.ch === "object") ? m.ch : {};
    var ch = {};
    CHANNELS.forEach(function (id) {
      var c = (src[id] && typeof src[id] === "object") ? src[id] : {};
      ch[id] = { o: c.o === 1 || c.o === true ? 1 : 0, v: clampInt(c.v, 0, 100, 50) };
    });
    return { ch: ch, nc: NOISE_COLORS.indexOf(m.nc) >= 0 ? m.nc : "pink" };
  }

  function mixOf(levels, nc) {            // { rain: 60, … } → mix
    var ch = {};
    CHANNELS.forEach(function (id) {
      ch[id] = levels[id] !== undefined ? { o: 1, v: levels[id] } : { o: 0, v: 50 };
    });
    return normMix({ ch: ch, nc: nc });
  }

  function sameMix(a, b) { return JSON.stringify(normMix(a)) === JSON.stringify(normMix(b)); }
  function anyOn(m) { m = normMix(m); return CHANNELS.some(function (id) { return m.ch[id].o === 1; }); }

  var PRESET_IDS = ["rainnight", "cafe", "forest", "seaside", "storm", "focus"];
  var PRESETS = {
    rainnight: mixOf({ rain: 65, thunder: 30, crickets: 20 }),
    cafe:      mixOf({ cafe: 70, rain: 25 }),
    forest:    mixOf({ birds: 60, wind: 30, stream: 45 }),
    seaside:   mixOf({ waves: 75, wind: 25, birds: 15 }),
    storm:     mixOf({ rain: 80, thunder: 70, wind: 55 }),
    focus:     mixOf({ noise: 45, rain: 30 }, "brown")
  };

  // Perceived loudness: level² (a slider at half sounds about half).
  function levelGain(v) { var x = clampInt(v, 0, 100, 0) / 100; return x * x; }

  // Sleep-timer fade: 1 until the last 30 s, then linear to 0.
  function fadeFactor(remainingMs) {
    if (!(remainingMs > 0)) return 0;
    return remainingMs >= FADE_MS ? 1 : remainingMs / FADE_MS;
  }

  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    var mm = (h ? (m < 10 ? "0" : "") : "") + m;
    return (h ? h + ":" : "") + mm + ":" + (r < 10 ? "0" : "") + r;
  }

  // ---------- 3. Saved mixes ----------
  // saved = { id, m (mtime, ms), name, mix }
  // data  = { ver: 1, mixes: [saved…] sorted by id, tombs: { id: deletedAt } }
  var ID_RE = /^[a-z0-9]{6,40}$/;

  function normName(s) {
    return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, NAME_LEN) : "";
  }

  function normSaved(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    var name = normName(x.name);
    if (!name) return null;
    return { id: x.id, m: x.m, name: name, mix: normMix(x.mix) };
  }

  // LWW per mix (newer m wins; equal m: the larger canonical JSON),
  // tombstones max-merged, delete wins ties, a newer edit resurrects
  // (R17). Symmetric and canonical (R5, R26).
  function mergeMixer(A, B) {
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
    [a.mixes, b.mixes].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normSaved(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m ||
            (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    var mixes = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      mixes.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, mixes: mixes, tombs: sortedTombs };
  }

  // ---------- 4. Storage + prefs ----------
  var data = null, prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.mixes)) {
          data = mergeMixer(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] mixer: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: DATA_VER, mixes: [], tombs: {} };
  }

  var saveFailShown = false;
  function saveNow() {
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
      mix: p.mix ? normMix(p.mix) : normMix(PRESETS.rainnight),
      vol: clampInt(p.vol, 0, 100, 70),
      mute: p.mute === 1 ? 1 : 0,
      timer: TIMERS.indexOf(p.timer) >= 0 ? p.timer : 0
    };
  }

  var prefsTimer = null;
  function savePrefs() {
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(savePrefsNow, 300);
  }
  function savePrefsNow() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 5. Engine (mixer/engine.js, in the shell window) ----------
  // The sound lives in the shell window, so it keeps playing after this
  // app closes; the taskbar chip drives the same engine. This app only
  // sends it the mix and reads its state back (plain JSON both ways).
  var eng = null, playing = false, endAt = 0, unsub = null, uiTimer = null;

  function engineWin() {
    try { return (window.parent && window.parent !== window) ? window.parent : window; }
    catch (e) { return window; }
  }
  function loadEngine(done) {
    var w = engineWin();
    try {
      if (w.__orosMixerHost) { done(w.__orosMixerHost); return; }
      var tag = w.document.querySelector("script[data-oros-mixer]");
      var s = tag || w.document.createElement("script");
      s.addEventListener("load", function () { done(w.__orosMixerHost || null); });
      s.addEventListener("error", function () { done(null); });
      if (!tag) {
        s.setAttribute("data-oros-mixer", "1");
        s.src = new URL("engine.js" + (SCRIPT_V ? "?v=" + SCRIPT_V : ""), location.href).href;
        w.document.head.appendChild(s);
      }
    } catch (e) { done(null); }
  }

  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function pull() {
    var st = null;
    try { st = eng ? eng.state() : null; } catch (e) { st = null; }
    playing = !!(st && st.playing);
    endAt = st ? st.endAt : 0;
    clearInterval(uiTimer);
    uiTimer = playing && endAt ? setInterval(renderTimerLeft, 1000) : null;
    return st;
  }
  // The engine changed from elsewhere (taskbar chip, media keys, the
  // timer): take its volume, mute and timer into this device's prefs.
  function onEngine(ev) {
    var st = pull();
    if (st) {
      if (st.vol !== prefs.vol || st.mute !== prefs.mute || st.timer !== prefs.timer) {
        prefs.vol = st.vol; prefs.mute = st.mute; prefs.timer = st.timer;
        savePrefs();
      }
    }
    if (ev === "timer") showToast(t("toast.timerEnd"));
    if (ev !== "tick") renderTransport();
  }
  function payload() {
    return copy({ mix: prefs.mix, vol: prefs.vol, mute: prefs.mute, timer: prefs.timer, label: mixLabel() });
  }

  function play() {
    if (!anyOn(prefs.mix)) { showToast(t("toast.needOne")); return; }
    var r = "noaudio";
    try { if (eng) r = eng.play(payload()); } catch (e) { r = "noaudio"; }
    if (r === "none") { showToast(t("toast.needOne")); return; }
    if (r !== "ok") { showToast(t("toast.noAudio")); return; }
    pull();
    renderTransport();
    live2(t("live.playing"));
  }

  function pause(reason) {
    if (!playing || !eng) return;
    try { eng.pause(reason || ""); } catch (e) {}
    pull();
    renderTransport();
    if (reason !== "timer") live2(t("live.paused"));
  }

  function togglePlay() { if (playing) pause(); else play(); }

  // The mix (and its name) changed here.
  function syncChannels() {
    if (!eng) return;
    try { eng.update({ mix: copy(prefs.mix), label: mixLabel() }); } catch (e) {}
    pull();
  }
  // Volume or mute changed here.
  function applyMaster() {
    if (!eng) return;
    try { eng.update({ vol: prefs.vol, mute: prefs.mute }); } catch (e) {}
  }

  // Self-test for the harness: renders one channel offline.
  window.__orosMixerSelfTest = function (id, seconds, nc) {
    return eng && eng.selfTest ? eng.selfTest(id, seconds, nc) : Promise.resolve(null);
  };

  // ---------- 6. UI ----------
  var ICONS = {
    rain:     '<path d="M7 15a4 4 0 0 1 .5-8A5.5 5.5 0 0 1 18 8a3.5 3.5 0 0 1 0 7z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
    thunder:  '<path d="M7 14a4 4 0 0 1 .5-8A5.5 5.5 0 0 1 18 7a3.5 3.5 0 0 1 0 7"/><path d="M13 12l-3 5h4l-3 5"/>',
    wind:     '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
    waves:    '<path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 14c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>',
    stream:   '<path d="M6 3c0 4 6 5 6 9s-6 5-6 9"/><path d="M14 3c0 4 6 5 6 9s-6 5-6 9"/>',
    fire:     '<path d="M12 22c4 0 7-2.7 7-6.5 0-3.5-2.5-5.5-4-8-.6 2-1.6 3-3 3.5.5-3-1-6-4-8 0 4-4 6.5-4 12.5C4 19.3 8 22 12 22z"/><path d="M12 22c-1.7 0-3-1.2-3-3 0-2 2-3 2.5-5 1 1.5 3.5 2.5 3.5 5 0 1.8-1.3 3-3 3z"/>',
    cafe:     '<path d="M4 9h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 2.5c0 1.5 1 1.5 1 3M12 2.5c0 1.5 1 1.5 1 3"/>',
    crickets: '<path d="M12 19c-4 0-7-3-7-6s2.5-5 7-5 7 2 7 5-3 6-7 6z"/><path d="M9 8L6 3M15 8l3-5M5 13H2M22 13h-3M6 17l-3 3M18 17l3 3"/>',
    birds:    '<path d="M2 12c3-3 6-3 8 0 2-3 5-3 8 0"/><path d="M8 18c2-2 4-2 5 0 1-2 3-2 5 0"/><path d="M12 6c1.5-1.5 3-1.5 4 0 1-1.5 2.5-1.5 4 0"/>',
    noise:    '<path d="M2 12h2l1.5-5 2 10 2-12 2 14 2-10 2 7 1.5-4H22"/>',
    train:    '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M9 14h.01M15 14h.01M8 21l2-4M16 21l-2-4"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  var UI = {
    play:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
    vol:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    mute:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
    save:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/></svg>',
    edit:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'
  };
  function chIcon(id) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[id] + "</svg>";
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // What the current mix is called: a ready mix, a saved one, or yours.
  function mixLabel() {
    if (!anyOn(prefs.mix)) return t("mix.none");
    for (var i = 0; i < PRESET_IDS.length; i++) {
      if (sameMix(PRESETS[PRESET_IDS[i]], prefs.mix)) return t("pr." + PRESET_IDS[i]);
    }
    for (var j = 0; j < data.mixes.length; j++) {
      if (sameMix(data.mixes[j].mix, prefs.mix)) return data.mixes[j].name;
    }
    return t("mix.custom");
  }

  function buildChannels() {
    var host = $("channels");
    host.innerHTML = "";
    CHANNELS.forEach(function (id, i) {
      var card = el("div", "ch");
      card.setAttribute("data-ch", id);
      var sw = el("button", "ch-sw");
      sw.type = "button";
      sw.setAttribute("aria-pressed", "false");
      sw.innerHTML = '<span class="ch-ic">' + chIcon(id) + '</span><span class="ch-name"></span>' +
        (i < 10 ? '<span class="ch-key">' + ((i + 1) % 10) + "</span>" : "");
      sw.querySelector(".ch-name").textContent = t("ch." + id);
      sw.addEventListener("click", function () { toggleChannel(id); });
      var lvl = el("input", "ch-lvl");
      lvl.type = "range"; lvl.min = "0"; lvl.max = "100"; lvl.step = "1";
      lvl.setAttribute("aria-label", t("level", { ch: t("ch." + id) }));
      lvl.addEventListener("input", function () {
        prefs.mix.ch[id].v = parseInt(lvl.value, 10);
        if (!prefs.mix.ch[id].o && prefs.mix.ch[id].v > 0) prefs.mix.ch[id].o = 1;
        mixChanged();
      });
      card.appendChild(sw);
      card.appendChild(lvl);
      if (id === "noise") {
        var nc = el("button", "nc-btn");
        nc.type = "button";
        nc.addEventListener("click", function () {
          prefs.mix.nc = NOISE_COLORS[(NOISE_COLORS.indexOf(prefs.mix.nc) + 1) % NOISE_COLORS.length];
          mixChanged();
        });
        card.appendChild(nc);
      }
      host.appendChild(card);
    });
  }

  function renderChannels() {
    CHANNELS.forEach(function (id) {
      var card = document.querySelector('.ch[data-ch="' + id + '"]');
      var c = prefs.mix.ch[id];
      card.classList.toggle("on", c.o === 1);
      card.classList.toggle("live", playing && c.o === 1 && c.v > 0);
      card.querySelector(".ch-sw").setAttribute("aria-pressed", c.o ? "true" : "false");
      var lvl = card.querySelector(".ch-lvl");
      if (document.activeElement !== lvl) lvl.value = c.v;
      if (id === "noise") {
        var nc = card.querySelector(".nc-btn");
        nc.textContent = t("nc." + prefs.mix.nc);
        nc.setAttribute("aria-label", t("nc.label", { c: t("nc." + prefs.mix.nc) }));
        nc.title = nc.getAttribute("aria-label");
      }
    });
  }

  function buildPresets() {
    var host = $("presets");
    host.innerHTML = "";
    PRESET_IDS.forEach(function (pid) {
      var b = el("button", "chip", t("pr." + pid));
      b.type = "button";
      b.setAttribute("data-p", pid);
      b.addEventListener("click", function () { applyMix(PRESETS[pid]); });
      host.appendChild(b);
    });
  }

  function renderPresets() {
    [].forEach.call(document.querySelectorAll("#presets .chip"), function (b) {
      var on = sameMix(PRESETS[b.getAttribute("data-p")], prefs.mix);
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function renderMine() {
    var host = $("mine");
    host.innerHTML = "";
    $("mine-empty").hidden = data.mixes.length > 0;
    data.mixes.slice().sort(function (a, b) { return cmpStr(a.name.toLowerCase(), b.name.toLowerCase()) || cmpStr(a.id, b.id); })
      .forEach(function (x) {
        var row = el("div", "mine-row");
        var b = el("button", "chip mine-chip", x.name);
        b.type = "button";
        var on = sameMix(x.mix, prefs.mix);
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.addEventListener("click", function () { applyMix(x.mix); });
        var ren = el("button", "mini");
        ren.type = "button";
        ren.innerHTML = UI.edit;
        ren.setAttribute("aria-label", t("mine.rename", { name: x.name }));
        ren.title = ren.getAttribute("aria-label");
        ren.addEventListener("click", function () { nameDialog(x); });
        var del = el("button", "mini danger");
        del.type = "button";
        del.innerHTML = UI.x;
        del.setAttribute("aria-label", t("mine.del", { name: x.name }));
        del.title = del.getAttribute("aria-label");
        del.addEventListener("click", function () { deleteMix(x.id); });
        row.appendChild(b); row.appendChild(ren); row.appendChild(del);
        host.appendChild(row);
      });
  }

  function renderTransport() {
    var b = $("play-btn");
    b.innerHTML = playing ? UI.pause : UI.play;
    b.setAttribute("aria-label", t(playing ? "btn.pause" : "btn.play"));
    b.title = b.getAttribute("aria-label");
    b.classList.toggle("on", playing);
    var m = $("mute-btn");
    m.innerHTML = prefs.mute ? UI.mute : UI.vol;
    m.setAttribute("aria-label", t(prefs.mute ? "btn.unmute" : "btn.mute"));
    m.title = m.getAttribute("aria-label");
    m.classList.toggle("on", !!prefs.mute);
    var v = $("vol");
    if (document.activeElement !== v) v.value = prefs.vol;
    $("timer").value = String(prefs.timer);
    $("now").textContent = mixLabel();
    renderTimerLeft();
    renderChannels();
  }

  function renderTimerLeft() {
    var n = $("timer-left");
    if (playing && endAt) { n.textContent = fmtClock(endAt - Date.now()); n.hidden = false; }
    else { n.textContent = ""; n.hidden = true; }
  }

  function renderAll() {
    renderTransport();
    renderPresets();
    renderMine();
  }

  function mixChanged() {
    savePrefs();
    syncChannels();
    renderTransport();
    renderPresets();
    renderMine();
  }

  function toggleChannel(id) {
    var c = prefs.mix.ch[id];
    c.o = c.o ? 0 : 1;
    if (c.o && c.v === 0) c.v = 50;
    live2(t(c.o ? "live.on" : "live.off", { ch: t("ch." + id) }));
    mixChanged();
    if (c.o && !playing) play();              // turning a sound on means "let me hear it"
    else if (playing && !anyOn(prefs.mix)) pause();
  }

  function applyMix(m) {
    prefs.mix = normMix(JSON.parse(JSON.stringify(m)));
    mixChanged();
    if (!playing) play();
  }

  // Saved mixes
  function nameDialog(existing) {
    if (!existing && data.mixes.length >= MAX_MIXES) { showToast(t("toast.maxMixes", { n: MAX_MIXES })); return; }
    if (!existing && !anyOn(prefs.mix)) { showToast(t("toast.needOne")); return; }
    var dlg = makeDialog("mx-name");
    dlg.appendChild(el("div", "dlg-title", t(existing ? "dlg.renameTitle" : "dlg.saveTitle")));
    var form = el("form");
    form.method = "dialog";
    var lab = el("label", "dlg-lbl", t("dlg.name"));
    lab.setAttribute("for", "mx-name-in");
    var inp = el("input");
    inp.id = "mx-name-in";
    inp.maxLength = NAME_LEN;
    inp.value = existing ? existing.name : (mixLabel() === t("mix.custom") ? "" : mixLabel());
    inp.autocomplete = "off";
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(lab); form.appendChild(inp); form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = normName(inp.value);
      if (!name) { showToast(t("toast.needName")); inp.focus(); return; }
      if (existing) {
        var x = null;
        data.mixes.forEach(function (y) { if (y.id === existing.id) x = y; });
        if (x) { x.name = name; x.m = Math.max(Date.now(), x.m + 1); }
      } else {
        data.mixes.push({ id: newId(), m: Date.now(), name: name, mix: normMix(prefs.mix) });
        showToast(t("toast.saved"));
      }
      data = mergeMixer(data, data);
      saveNow();
      dlg.close();
      renderAll();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    inp.focus();
    inp.select();
  }

  function deleteMix(id) {
    var x = null;
    data.mixes.forEach(function (y) { if (y.id === id) x = y; });
    if (!x) return;
    var snapshot = JSON.parse(JSON.stringify(x));
    data.tombs[id] = Math.max(Date.now(), x.m);
    data = mergeMixer(data, data);
    saveNow();
    renderAll();
    undoToast(t("toast.deleted"), function () {
      // R17: a fresh mtime beats the tombstone
      snapshot.m = Math.max(Date.now(), (data.tombs[snapshot.id] || 0) + 1);
      data.mixes.push(snapshot);
      data = mergeMixer(data, data);
      saveNow();
      renderAll();
    });
  }

  // ---------- 7. Dialogs + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "mixer", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
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
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }

  function live2(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 8. Keyboard ----------
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
    // Space play/pause, M mute, 1–0 channels (not while typing, not in a dialog)
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      var tg = e.target, tag = tg && tg.tagName;
      if ((tag === "INPUT" && tg.type !== "range") || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === " " || e.code === "Space") {
        if (tag === "BUTTON") return;          // Space presses the focused button
        e.preventDefault(); togglePlay(); return;
      }
      if (e.key === "m" || e.key === "M") { e.preventDefault(); toggleMute(); return; }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        toggleChannel(CHANNELS[(parseInt(e.key, 10) + 9) % 10]);
      }
    });
  }

  function toggleMute() {
    prefs.mute = prefs.mute ? 0 : 1;
    savePrefs();
    applyMaster(0.08);
    renderTransport();
  }

  // ---------- 9. Sync slice + palette ----------
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
    api.registerSlice("mixer", sliceGet, sliceSet, STORAGE_KEY, mergeMixer);
  }

  function sliceGet() {
    return mergeMixer(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.mixes)) return;
    var before = JSON.stringify(data.mixes);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeMixer(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data.mixes) !== before) {   // no toast on merge (sync feedback = taskbar dot)
      renderMine();
      $("now").textContent = mixLabel();
    }
  }

  // ---------- 10. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    $("vol").setAttribute("aria-label", t("vol"));
    $("timer").setAttribute("aria-label", t("timer"));
    var sel = $("timer");
    sel.innerHTML = "";
    TIMERS.forEach(function (m) {
      var o = el("option", "", m ? t("timer.min", { n: m }) : t("timer.off"));
      o.value = String(m);
      sel.appendChild(o);
    });
    var sv = $("save-btn");
    sv.innerHTML = UI.save + "<span>" + t("btn.save") + "</span>";
  }

  function wire() {
    $("play-btn").addEventListener("click", togglePlay);
    $("mute-btn").addEventListener("click", toggleMute);
    $("vol").addEventListener("input", function () {
      prefs.vol = parseInt($("vol").value, 10);
      if (prefs.mute && prefs.vol > 0) prefs.mute = 0;
      savePrefs();
      applyMaster(0.08);
      renderTransport();
    });
    $("timer").addEventListener("change", function () {
      prefs.timer = parseInt($("timer").value, 10) || 0;
      savePrefs();
      try { if (eng) eng.setTimer(prefs.timer); } catch (e) {}
      pull();
      renderTransport();
    });
    $("save-btn").addEventListener("click", function () { nameDialog(null); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") savePrefsNow();
    });
    // closing the app leaves the sound playing (the engine lives in
    // the shell); only this frame's listener goes
    window.addEventListener("pagehide", function () {
      savePrefsNow();
      if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    buildChannels();
    buildPresets();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderAll();
    loadEngine(function (h) {
      eng = h;
      if (!eng) return;
      try { unsub = eng.subscribe(onEngine); } catch (e) {}
      // already playing (or paused from the taskbar): show that sound
      var st = pull();
      if (st && st.active) {
        prefs.mix = normMix(st.mix);
        prefs.vol = st.vol; prefs.mute = st.mute; prefs.timer = st.timer;
        savePrefs();
      }
      renderAll();
    });
  }

  boot();
})();
