// ============================================================
// orOS Sound Mixer — App logic (v1.0.0)
// Ambient sounds, every one synthesized live with Web Audio: no
// audio files, no network. Ten channels (rain, thunder, wind, waves,
// stream, fireplace, café, crickets, birds, noise), each with its
// own switch and level; master play / pause, volume, mute; sleep
// timer with a 30 s fade; six ready mixes and your own (synced).
//   - small random variations everywhere, so nothing loops audibly
//   - the sound stops when the app closes (the frame unloads)
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
//   5. Sound: noise buffers, envelopes, the ten channel builders
//   6. Engine: context, channels, scheduler, play / pause, timer
//   7. UI: channels, presets, saved mixes, toolbar
//   8. Dialogs + toasts
//   9. Keyboard (Contract Β)
//  10. Sync slice + palette
//  11. Wiring & boot
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
                     "fire", "cafe", "crickets", "birds", "noise"];
  var NOISE_COLORS = ["pink", "brown", "white"];

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
      "ch.rain": "Rain", "ch.thunder": "Thunder", "ch.wind": "Wind", "ch.waves": "Waves",
      "ch.stream": "Stream", "ch.fire": "Fireplace", "ch.cafe": "Café", "ch.crickets": "Crickets",
      "ch.birds": "Birds", "ch.noise": "Noise",
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
      "ch.birds": "Πουλιά", "ch.noise": "Θόρυβος",
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
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("mixer.js v" + (m ? m[1] : "?") + " boot");
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

  // ---------- 5. Sound ----------
  // A channel builder gets (ctx, out, rnd, opts) and returns
  //   { tick(from, to), stop(at) }
  // tick schedules every event that starts in [from, to); the engine
  // calls it a little ahead of time. It works the same on an
  // OfflineAudioContext (the self-test renders each channel).
  function rr(rnd, a, b) { return a + (b - a) * rnd(); }

  function noiseBuf(ctx, kind) {
    ctx.__orosNoise = ctx.__orosNoise || {};
    if (ctx.__orosNoise[kind]) return ctx.__orosNoise[kind];
    var len = Math.floor(ctx.sampleRate * 4);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        if (kind === "white") d[i] = w * 0.5;
        else if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else {                                   // pink (Paul Kellet)
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
          b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        }
      }
    }
    ctx.__orosNoise[kind] = buf;
    return buf;
  }

  function Bag(ctx) { this.ctx = ctx; this.srcs = []; }
  Bag.prototype.loop = function (kind, at) {
    var s = this.ctx.createBufferSource();
    s.buffer = noiseBuf(this.ctx, kind);
    s.loop = true;
    s.start(at || 0, Math.random() * s.buffer.duration);
    this.srcs.push(s);
    return s;
  };
  Bag.prototype.stop = function (at) {
    this.srcs.forEach(function (s) { try { s.stop(at); } catch (e) {} });
    this.srcs = [];
  };

  function node(ctx, kind, props) {
    var n = kind === "gain" ? ctx.createGain()
          : kind === "pan" ? (ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain())
          : ctx.createBiquadFilter();
    if (kind !== "gain" && kind !== "pan") n.type = kind;
    Object.keys(props || {}).forEach(function (k) {
      if (n[k] && n[k].setValueAtTime) n[k].value = props[k];
    });
    return n;
  }

  function chain() {
    for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]);
    return arguments[arguments.length - 1];
  }

  // One short noise burst through a filter, with an envelope.
  function burst(ctx, out, at, o) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf(ctx, o.kind || "white");
    var f = node(ctx, o.type || "bandpass", { frequency: o.f, Q: o.q || 1 });
    var g = node(ctx, "gain", { gain: 0 });
    var p = node(ctx, "pan", { pan: o.pan || 0 });
    chain(s, f, g, p, out);
    var a = o.a || 0.002;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(o.peak, at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, at + a + o.d);
    s.start(at, Math.random() * (s.buffer.duration - 1));
    s.stop(at + a + o.d + 0.05);
  }

  // One tone: sine from f0 to f1, with an envelope.
  function tone(ctx, out, at, o) {
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(o.f0, at);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, at + o.d);
    var g = node(ctx, "gain", { gain: 0 });
    var p = node(ctx, "pan", { pan: o.pan || 0 });
    chain(osc, g, p, out);
    var a = o.a || 0.005;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(o.peak, at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, at + a + o.d);
    osc.start(at);
    osc.stop(at + a + o.d + 0.05);
  }

  // Poisson-ish events: calls fire(t) for every event in [from, to).
  function every(state, key, from, to, gap, fire) {
    if (state[key] === undefined || state[key] < from - 1) state[key] = from + gap();
    while (state[key] < to) {
      fire(Math.max(state[key], from));
      state[key] += gap();
    }
  }

  var BUILD = {
    rain: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {};
      var bed = chain(bag.loop("pink"), node(ctx, "highpass", { frequency: 450 }),
                      node(ctx, "lowpass", { frequency: 9000 }), node(ctx, "gain", { gain: 0.55 }));
      bed.connect(out);
      return {
        tick: function (from, to) {
          every(st, "swell", from, to, function () { return rr(rnd, 2, 5); }, function (at) {
            bed.gain.setTargetAtTime(rr(rnd, 0.42, 0.65), at, 1.5);
          });
          every(st, "drop", from, to, function () { return -Math.log(1 - rnd()) / 28; }, function (at) {
            burst(ctx, out, at, { f: rr(rnd, 2500, 7500), q: rr(rnd, 1, 4), peak: rr(rnd, 0.03, 0.12),
                                  d: rr(rnd, 0.015, 0.05), pan: rr(rnd, -0.8, 0.8) });
          });
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    thunder: function (ctx, out, rnd) {
      var st = {};
      return {
        tick: function (from, to) {
          if (st.next === undefined) st.next = from + rr(rnd, 1, 5);
          while (st.next < to) {
            var at = Math.max(st.next, from);
            var s = ctx.createBufferSource();
            s.buffer = noiseBuf(ctx, "brown");
            var lp = node(ctx, "lowpass", { frequency: rr(rnd, 180, 420), Q: 0.7 });
            var g = node(ctx, "gain", { gain: 0 });
            var p = node(ctx, "pan", { pan: rr(rnd, -0.6, 0.6) });
            chain(s, lp, g, p, out);
            var atk = rr(rnd, 0.08, 0.9), dec = rr(rnd, 3, 7), peak = rr(rnd, 0.7, 1.2);
            g.gain.setValueAtTime(0.0001, at);
            g.gain.linearRampToValueAtTime(peak, at + atk);
            g.gain.setTargetAtTime(peak * 0.5, at + atk, 0.4);
            g.gain.exponentialRampToValueAtTime(0.0001, at + atk + dec);
            lp.frequency.setTargetAtTime(80, at + atk, dec / 3);
            s.start(at, Math.random() * 3);
            s.stop(at + atk + dec + 0.1);
            if (rnd() < 0.35) burst(ctx, out, at, { f: rr(rnd, 900, 2200), q: 0.8, peak: 0.35, d: 0.18, a: 0.004 });
            st.next += rr(rnd, 12, 40);
          }
        },
        stop: function () {}
      };
    },

    wind: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {};
      var bp = node(ctx, "bandpass", { frequency: 420, Q: 0.8 });
      var g = node(ctx, "gain", { gain: 0.8 });
      chain(bag.loop("brown"), bp, g, out);
      var wbp = node(ctx, "bandpass", { frequency: 1300, Q: 6 });
      var wg = node(ctx, "gain", { gain: 0.02 });
      chain(bag.loop("pink"), wbp, wg, out);
      return {
        tick: function (from, to) {
          every(st, "gust", from, to, function () { return rr(rnd, 0.8, 2.5); }, function (at) {
            var k = rnd();
            bp.frequency.setTargetAtTime(250 + k * 500, at, 1.4);
            g.gain.setTargetAtTime(0.35 + k * 0.9, at, 1.8);
            wbp.frequency.setTargetAtTime(rr(rnd, 900, 1800), at, 2);
            wg.gain.setTargetAtTime(k * 0.06, at, 2);
          });
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    waves: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {};
      var lp = node(ctx, "lowpass", { frequency: 400 });
      var g = node(ctx, "gain", { gain: 0.15 });
      chain(bag.loop("brown"), lp, g, out);
      var hp = node(ctx, "highpass", { frequency: 1500 });
      var hg = node(ctx, "gain", { gain: 0.01 });
      chain(bag.loop("pink"), hp, hg, out);
      return {
        tick: function (from, to) {
          if (st.next === undefined) st.next = from;
          while (st.next < to) {
            var at = Math.max(st.next, from), per = rr(rnd, 6, 11), up = per * rr(rnd, 0.35, 0.45);
            var peak = rr(rnd, 0.7, 1.1);
            g.gain.setValueAtTime(0.15, at);
            g.gain.linearRampToValueAtTime(peak, at + up);
            g.gain.linearRampToValueAtTime(0.15, at + per);
            lp.frequency.setValueAtTime(350, at);
            lp.frequency.linearRampToValueAtTime(rr(rnd, 1100, 1700), at + up);
            lp.frequency.linearRampToValueAtTime(350, at + per);
            hg.gain.setValueAtTime(0.01, at);
            hg.gain.linearRampToValueAtTime(peak * 0.16, at + up + 0.3);
            hg.gain.linearRampToValueAtTime(0.01, at + per);
            st.next += per;
          }
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    stream: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {};
      chain(bag.loop("pink"), node(ctx, "bandpass", { frequency: 1700, Q: 0.6 }), node(ctx, "gain", { gain: 0.45 }), out);
      chain(bag.loop("white"), node(ctx, "highpass", { frequency: 3500 }), node(ctx, "gain", { gain: 0.04 }), out);
      return {
        tick: function (from, to) {
          every(st, "bub", from, to, function () { return -Math.log(1 - rnd()) / 11; }, function (at) {
            var f0 = rr(rnd, 500, 1400);
            tone(ctx, out, at, { f0: f0, f1: f0 * rr(rnd, 1.3, 2.1), d: rr(rnd, 0.025, 0.07),
                                 peak: rr(rnd, 0.01, 0.045), pan: rr(rnd, -0.7, 0.7), a: 0.003 });
          });
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    fire: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {};
      var roar = node(ctx, "gain", { gain: 0.4 });
      chain(bag.loop("brown"), node(ctx, "lowpass", { frequency: 420 }), roar, out);
      return {
        tick: function (from, to) {
          every(st, "roar", from, to, function () { return rr(rnd, 1, 3); }, function (at) {
            roar.gain.setTargetAtTime(rr(rnd, 0.28, 0.5), at, 0.8);
          });
          every(st, "crk", from, to, function () {
            return rnd() < 0.3 ? rr(rnd, 0.01, 0.05) : -Math.log(1 - rnd()) / 6;    // clusters
          }, function (at) {
            burst(ctx, out, at, { type: "highpass", f: rr(rnd, 1500, 5000), q: 0.7, peak: rr(rnd, 0.1, 0.5),
                                  d: rr(rnd, 0.004, 0.03), a: 0.0008, pan: rr(rnd, -0.4, 0.4) });
          });
          every(st, "pop", from, to, function () { return rr(rnd, 0.6, 2.5); }, function (at) {
            burst(ctx, out, at, { f: rr(rnd, 300, 900), q: 3, peak: rr(rnd, 0.15, 0.35), d: 0.08, a: 0.001,
                                  pan: rr(rnd, -0.3, 0.3) });
          });
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    cafe: function (ctx, out, rnd) {
      var bag = new Bag(ctx), st = {}, voices = [];
      chain(bag.loop("pink"), node(ctx, "lowpass", { frequency: 600 }), node(ctx, "gain", { gain: 0.12 }), out);
      for (var i = 0; i < 5; i++) {
        var f = node(ctx, "bandpass", { frequency: rr(rnd, 250, 950), Q: rr(rnd, 2, 5) });
        var g = node(ctx, "gain", { gain: 0 });
        chain(bag.loop("pink"), f, g, node(ctx, "pan", { pan: rr(rnd, -0.7, 0.7) }), out);
        voices.push({ f: f, g: g });
      }
      return {
        tick: function (from, to) {
          voices.forEach(function (v, i) {
            every(st, "v" + i, from, to, function () { return rr(rnd, 0.12, 0.45); }, function (at) {
              var talking = rnd() < 0.7;
              v.g.gain.setTargetAtTime(talking ? rr(rnd, 0.25, 0.7) : 0, at, 0.05);
              v.f.frequency.setTargetAtTime(rr(rnd, 250, 950), at, 0.1);
            });
          });
          every(st, "clink", from, to, function () { return rr(rnd, 1.5, 6); }, function (at) {
            var base = rr(rnd, 2000, 3400), pan = rr(rnd, -0.8, 0.8), d = rr(rnd, 0.15, 0.4);
            [1, 2.76, 5.4].forEach(function (k, j) {
              tone(ctx, out, at, { f0: base * k, d: d / (j + 1), peak: 0.05 / (j + 1), pan: pan, a: 0.001 });
            });
          });
        },
        stop: function (at) { bag.stop(at); }
      };
    },

    crickets: function (ctx, out, rnd) {
      var st = {}, bugs = [], oscs = [];
      for (var i = 0; i < 3; i++) {
        var osc = ctx.createOscillator();
        osc.frequency.value = rr(rnd, 4200, 5200);
        var g = node(ctx, "gain", { gain: 0 });
        chain(osc, g, node(ctx, "pan", { pan: rr(rnd, -0.8, 0.8) }), out);
        osc.start(0);
        oscs.push(osc);
        bugs.push({ g: g, amp: rr(rnd, 0.05, 0.12) });
      }
      return {
        tick: function (from, to) {
          bugs.forEach(function (b, i) {
            every(st, "c" + i, from, to, function () { return rnd() < 0.12 ? rr(rnd, 2, 5) : rr(rnd, 0.6, 1.2); }, function (at) {
              var n = 3 + Math.floor(rnd() * 2);
              for (var k = 0; k < n; k++) {
                var p = at + k * 0.04;
                b.g.gain.setValueAtTime(0, p);
                b.g.gain.linearRampToValueAtTime(b.amp, p + 0.004);
                b.g.gain.setValueAtTime(b.amp, p + 0.014);
                b.g.gain.linearRampToValueAtTime(0, p + 0.019);
              }
            });
          });
        },
        stop: function (at) { oscs.forEach(function (o) { try { o.stop(at); } catch (e) {} }); }
      };
    },

    birds: function (ctx, out, rnd) {
      var st = {};
      return {
        tick: function (from, to) {
          every(st, "song", from, to, function () { return rr(rnd, 1, 4); }, function (at) {
            var n = 2 + Math.floor(rnd() * 5), pan = rr(rnd, -0.8, 0.8), p = at;
            var base = rr(rnd, 2500, 5000);
            for (var k = 0; k < n; k++) {
              var d = rr(rnd, 0.05, 0.15), f0 = base * rr(rnd, 0.85, 1.2);
              tone(ctx, out, p, { f0: f0, f1: f0 * rr(rnd, 0.7, 1.45), d: d, peak: rr(rnd, 0.08, 0.18), pan: pan, a: 0.008 });
              p += d + rr(rnd, 0.02, 0.09);
            }
          });
        },
        stop: function () {}
      };
    },

    noise: function (ctx, out, rnd, o) {
      var bag = new Bag(ctx);
      var kind = (o && NOISE_COLORS.indexOf(o.nc) >= 0) ? o.nc : "pink";
      chain(bag.loop(kind), node(ctx, "gain", { gain: kind === "white" ? 0.35 : 0.6 }), out);
      return { tick: function () {}, stop: function (at) { bag.stop(at); } };
    }
  };

  // ---------- 6. Engine ----------
  var ctx = null, master = null, live = {}, playing = false, schedTimer = null, endAt = 0, uiTimer = null;

  function audioCtor() { return window.AudioContext || window.webkitAudioContext || null; }

  function ensureCtx() {
    if (ctx) return true;
    var C = audioCtor();
    if (!C) return false;
    try {
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0;
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.3;
      master.connect(comp);
      comp.connect(ctx.destination);
      return true;
    } catch (e) { ctx = null; return false; }
  }

  function masterTarget() {
    if (prefs.mute) return 0;
    var g = levelGain(prefs.vol);
    if (endAt) g *= fadeFactor(endAt - Date.now());
    return g;
  }
  function applyMaster(tc) {
    if (!ctx) return;
    master.gain.setTargetAtTime(playing ? masterTarget() : 0, ctx.currentTime, tc || 0.15);
  }

  function chanTarget(id) { return levelGain(prefs.mix.ch[id].v); }

  function startChannel(id) {
    var g = ctx.createGain();
    g.gain.value = 0;
    g.connect(master);
    var inst = BUILD[id](ctx, g, Math.random, { nc: prefs.mix.nc });
    inst.out = g;
    inst.until = ctx.currentTime;
    inst.nc = prefs.mix.nc;
    live[id] = inst;
    g.gain.setTargetAtTime(chanTarget(id), ctx.currentTime, 0.25);
    inst.tick(inst.until, ctx.currentTime + 0.4);
    inst.until = ctx.currentTime + 0.4;
  }

  function stopChannel(id) {
    var inst = live[id];
    if (!inst) return;
    delete live[id];
    var now = ctx.currentTime;
    inst.out.gain.setTargetAtTime(0, now, 0.2);
    inst.stop(now + 1.5);
    setTimeout(function () { try { inst.out.disconnect(); } catch (e) {} }, 2000);
  }

  // Bring the running channels in line with prefs.mix.
  function syncChannels() {
    if (!ctx || !playing) return;
    CHANNELS.forEach(function (id) {
      var on = prefs.mix.ch[id].o === 1 && prefs.mix.ch[id].v > 0;
      if (on && live[id] && id === "noise" && live[id].nc !== prefs.mix.nc) stopChannel(id);
      if (on && !live[id]) startChannel(id);
      else if (!on && live[id]) stopChannel(id);
      else if (on) live[id].out.gain.setTargetAtTime(chanTarget(id), ctx.currentTime, 0.15);
    });
  }

  function schedule() {
    if (!ctx || !playing) return;
    var to = ctx.currentTime + 0.4;
    Object.keys(live).forEach(function (id) {
      var inst = live[id];
      if (inst.until < to) {
        try { inst.tick(Math.max(inst.until, ctx.currentTime), to); } catch (e) { console.error("[orOS] mixer " + id, e); }
        inst.until = to;
      }
    });
  }

  function play() {
    if (!anyOn(prefs.mix)) { showToast(t("toast.needOne")); return; }
    if (!ensureCtx()) { showToast(t("toast.noAudio")); return; }
    playing = true;
    if (ctx.state === "suspended" && ctx.resume) ctx.resume();
    if (prefs.timer && !endAt) endAt = Date.now() + prefs.timer * 60000;
    syncChannels();
    applyMaster(0.3);
    clearInterval(schedTimer);
    schedTimer = setInterval(schedule, 100);
    clearInterval(uiTimer);
    uiTimer = setInterval(tickUi, 1000);
    mediaSession();
    renderTransport();
    live2(t("live.playing"));
  }

  function pause(reason) {
    if (!playing) return;
    playing = false;
    endAt = 0;
    clearInterval(schedTimer); schedTimer = null;
    clearInterval(uiTimer); uiTimer = null;
    if (ctx) {
      applyMaster(0.12);
      var c = ctx;
      setTimeout(function () {
        if (playing || c !== ctx) return;
        Object.keys(live).forEach(stopChannel);
        if (c.suspend) c.suspend();
      }, 600);
    }
    renderTransport();
    if (reason !== "timer") live2(t("live.paused"));
  }

  function togglePlay() { if (playing) pause(); else play(); }

  function tickUi() {
    if (playing && endAt) {
      var left = endAt - Date.now();
      if (left <= 0) { pause("timer"); showToast(t("toast.timerEnd")); return; }
      if (left < FADE_MS + 1000) applyMaster(0.5);
    }
    renderTimerLeft();
  }

  function mediaSession() {
    try {
      var ms = navigator.mediaSession;
      if (!ms || typeof window.MediaMetadata !== "function") return;
      ms.metadata = new window.MediaMetadata({ title: mixLabel(), artist: "orOS · Sound Mixer" });
      ms.setActionHandler("play", play);
      ms.setActionHandler("pause", function () { pause(); });
      ms.playbackState = playing ? "playing" : "paused";
    } catch (e) {}
  }

  // Self-test for the harness: renders one channel offline and
  // reports its level. Not used by the app itself.
  window.__orosMixerSelfTest = function (id, seconds, nc) {
    var O = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!O || !BUILD[id]) return Promise.resolve(null);
    var sr = 22050, oc = new O(2, Math.floor(sr * seconds), sr);
    var g = oc.createGain();
    g.connect(oc.destination);
    var inst = BUILD[id](oc, g, Math.random, { nc: nc || "pink" });
    inst.tick(0, seconds);
    return oc.startRendering().then(function (buf) {
      var sum = 0, peak = 0, nan = 0, n = 0;
      for (var c = 0; c < buf.numberOfChannels; c++) {
        var d = buf.getChannelData(c);
        for (var i = 0; i < d.length; i++) {
          var v = d[i];
          if (v !== v) { nan++; continue; }
          sum += v * v; n++;
          if (Math.abs(v) > peak) peak = Math.abs(v);
        }
      }
      return { rms: Math.sqrt(sum / Math.max(1, n)), peak: peak, nan: nan };
    });
  };

  // ---------- 7. UI ----------
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
    noise:    '<path d="M2 12h2l1.5-5 2 10 2-12 2 14 2-10 2 7 1.5-4H22"/>'
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
      sw.innerHTML = '<span class="ch-ic">' + chIcon(id) + '</span><span class="ch-name"></span><span class="ch-key">' + ((i + 1) % 10) + "</span>";
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
    try { if (navigator.mediaSession) navigator.mediaSession.playbackState = playing ? "playing" : "paused"; } catch (e) {}
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
    mediaSession();
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

  // ---------- 8. Dialogs + toasts ----------
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

  // ---------- 11. Wiring & boot ----------
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
      endAt = (playing && prefs.timer) ? Date.now() + prefs.timer * 60000 : 0;
      savePrefs();
      applyMaster(0.3);
      renderTransport();
    });
    $("save-btn").addEventListener("click", function () { nameDialog(null); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") savePrefsNow();
    });
    window.addEventListener("pagehide", function () {
      savePrefsNow();
      try { if (ctx) ctx.close(); } catch (e) {}
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
  }

  boot();
})();
