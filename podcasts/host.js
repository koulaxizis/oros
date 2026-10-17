// ============================================================
// orOS Podcasts — host.js (player + data owner, v1.2.0)
// Runs in the SHELL window (loaded by index.html after core.js and
// store.js, or injected by the app on first open), so playback, the
// position, the queue and sync keep working while the Podcasts
// window is closed. The app is only a screen over this host:
//   window.__orosPodcastsHost.api   (see the object at the end)
//
// It owns:
//   - the one <audio data-oros-podcasts> in the shell document;
//   - the sync slice "podcasts" (oros-podcasts-data) WITH its merge,
//     registered here and only here (no closed-app proxy needed);
//   - device-local state "oros-podcasts-local": the exact position
//     of every touched episode, the episode details of the queue
//     and of what is playing (to play on with the window closed);
//   - Media Session (lock screen, headphones, media keys);
//   - the tray chip (play/pause) on the shell bar;
//   - audio focus: Radio starting pauses a podcast and vice versa;
//   - new-episode notices for shows with notices on, also with the
//     Podcasts window closed (a check every 3 hours while orOS runs).
// Writes to the slice follow core.shouldCommit: an hour of
// listening is at most ~12 uploads, a paused player none.
// ============================================================
(function (w) {
  "use strict";
  if (w.__orosPodcastsHost && w.__orosPodcastsHost.v >= 1) return;
  var C = w.OrosPodcastsCore, ST = w.OrosPodcastsStore;
  if (!C) return;

  var KEY = "oros-podcasts-data", LOCAL_KEY = "oros-podcasts-local";
  var LOCAL_SAVE_MS = 5000;
  var doc = w.document;

  // ---------- Texts (this file runs in the shell window) ----------
  // Shares the "podcasts" pack with podcasts.js (same key = same
  // English). The shell loads only its own pack, so a pack language
  // fetches this one on first need (orosI18n.ensure); until then English.
  var HS = {
    en: {
      "host.full": "Storage is full: podcast changes were not saved.",
      "host.pause": "Pause: {t}", "host.play": "Play: {t}"
    },
    el: {
      "host.full": "Ο χώρος αποθήκευσης γέμισε: τα podcasts δεν αποθηκεύτηκαν.",
      "host.pause": "Παύση: {t}", "host.play": "Αναπαραγωγή: {t}"
    }
  };
  function hlang() {
    var I = w.orosI18n;
    if (I) { try { return I.lang(); } catch (x) {} }
    return w.orosLang === "el" ? "el" : "en";
  }
  var packAsked = {};
  function ht(k, v) {
    var l = hlang(), I = w.orosI18n, tab = HS[l];
    if (!tab && I) {
      tab = I.table(HS, "podcasts", l);
      if (!packAsked[l] && typeof I.ensure === "function") {
        packAsked[l] = true;
        try { I.ensure(l, "podcasts", function () { if (l !== "en" && l !== "el") delete HS[l]; }); } catch (x) {}
      }
    }
    var s = (tab && tab[k]) || HS.en[k] || k;
    if (v) Object.keys(v).forEach(function (n) { s = s.split("{" + n + "}").join(String(v[n])); });
    return s;
  }

  // ---------- Data (synced slice) ----------
  function readData() {
    try {
      var raw = w.localStorage.getItem(KEY);
      return raw ? C.mergePodcasts(JSON.parse(raw), null) : C.emptyData();
    } catch (e) { return C.emptyData(); }
  }
  var data = readData();
  var quotaWarned = false;
  function writeData() {
    try { w.localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) {
      // R30: never swallow a failed write; one toast per session.
      if (!quotaWarned) {
        quotaWarned = true;
        note(ht("host.full"));
      }
    }
  }
  function sliceGet() { return data; }
  function sliceSet(next) {
    if (!next) return;
    data = C.mergePodcasts(next, null);
    writeData();
    fxSync();
    host.notify("data");
  }
  function sync() { return w.orosSync || null; }
  function markDirty() {
    var s = sync();
    if (s && typeof s.markDirty === "function") { try { s.markDirty(); } catch (e) {} }
  }
  // fn(data, now) → new data (core mutation). Returns true if changed.
  function mutate(fn) {
    var next;
    try { next = fn(data, Date.now()); } catch (e) { return false; }
    if (!next || next === data) return false;
    // Re-made with this realm's core: the caller may be the app frame,
    // and its objects must not outlive the frame inside the host.
    next = C.mergePodcasts(JSON.parse(JSON.stringify(next)), null);
    if (JSON.stringify(next) === JSON.stringify(data)) return false;
    data = next;
    writeData();
    markDirty();
    fxSync();
    host.notify("data");
    return true;
  }
  function register() {
    var s = sync();
    if (!s || typeof s.registerSlice !== "function") return false;
    s.registerSlice("podcasts", sliceGet, sliceSet, KEY, C.mergePodcasts);
    return true;
  }

  // ---------- Device-local state ----------
  //   pos:  { epId: [pos, dur, ts] }   exact positions (pruned to 400)
  //   meta: { epId: episode details }  current + queue (pruned)
  //   cur:  epId playing or paused     last: { p, at } of the last commit
  //   stats: { d: {day: [wallSec, mediaSec]}, s: {showId: mediaSec} }
  //          listening time on this device (core.addListen)
  //   nt:   { showId: newest publish time announced here }  bg: last
  //          background check (ms)
  //   cors: { origin: [ok 0|1, at ms] } may this audio host be read by
  //          Web Audio (skip silence / voice boost)? core.fxRemember
  function readLocal() {
    try {
      var o = JSON.parse(w.localStorage.getItem(LOCAL_KEY) || "null");
      if (o && typeof o === "object") return { pos: o.pos || {}, meta: o.meta || {}, cur: o.cur || "", last: o.last || null, spd: o.spd || 0,
        stats: o.stats && typeof o.stats === "object" ? o.stats : { d: {}, s: {} },
        nt: o.nt && typeof o.nt === "object" ? o.nt : {}, bg: +o.bg || 0,
        cors: o.cors && typeof o.cors === "object" ? o.cors : {} };
    } catch (e) {}
    return { pos: {}, meta: {}, cur: "", last: null, spd: 0, stats: { d: {}, s: {} }, nt: {}, bg: 0, cors: {} };
  }
  var local = readLocal();
  var localTimer = null;
  function saveLocal(now) {
    if (localTimer && !now) return;
    var run = function () {
      localTimer = null;
      var keep = {}, ids = Object.keys(local.pos).sort(function (a, b) { return local.pos[b][2] - local.pos[a][2]; });
      ids.slice(0, 400).forEach(function (id) { keep[id] = local.pos[id]; });
      local.pos = keep;
      var meta = {};
      data.queue.ids.concat(local.cur ? [local.cur] : []).forEach(function (id) { if (local.meta[id]) meta[id] = local.meta[id]; });
      local.meta = meta;
      var nt = {};
      data.shows.forEach(function (s) { if (s.ntf && local.nt[s.id] > 0) nt[s.id] = local.nt[s.id]; });
      local.nt = nt;
      try { w.localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch (e) {}
    };
    if (now) { if (localTimer) { w.clearTimeout(localTimer); } run(); }
    else localTimer = w.setTimeout(run, LOCAL_SAVE_MS);
  }
  // Episode details the host needs to play without the app:
  //   { id, s, title, show, img, audio, pd, dur, video }
  function cleanMeta(m) {
    if (!m || typeof m !== "object") return null;
    var audio = C.safeUrl(m.audio);
    if (!/^e[0-9a-z]{12,14}$/.test(m.id) || !/^s[0-9a-z]{12,14}$/.test(m.s) || !audio) return null;
    return { id: m.id, s: m.s, title: C.clean(m.title, 200), show: C.clean(m.show, 200), img: C.safeUrl(m.img),
      audio: audio, pd: +m.pd > 0 ? +m.pd : 0, dur: +m.dur > 0 ? Math.round(+m.dur) : 0, video: !!m.video };
  }

  // ---------- Audio ----------
  function makeAudio() {
    var a = doc.createElement("audio");
    a.setAttribute("data-oros-podcasts", "1");
    a.preload = "metadata";
    a.style.display = "none";
    try { doc.body.appendChild(a); } catch (e) {}
    return a;
  }
  var audio = doc.querySelector("audio[data-oros-podcasts]") || makeAudio();
  // Listeners go through on(): when the element is replaced (see
  // fxFresh), the old one's late events do nothing.
  function on(ev, fn) {
    var a = audio;
    a.addEventListener(ev, function (e) { if (a === audio) fn(e); });
  }
  var cur = null;          // meta of the loaded episode
  var loading = false;     // switching episodes: the old element's pause is not a "pause"
  var blobUrl = "";
  var flags = { buffering: false, error: "" };
  var sleep = { until: 0, end: false, iv: null };
  // Web Audio effects (see "Skip silence + voice boost").
  var fx = { ctx: null, el: null, src: null, an: null, buf: null, chain: null, vbOn: null, iv: null, lastT: 0,
    st: { q: 0, silent: false }, zero: 0, fastOn: false, base: 1, told: 1, state: "off", origin: "", saved: 0, retried: "" };

  function showOf(sid) { return C.findShow(data, sid); }
  function speedFor(m) {
    var s = m && showOf(m.s);
    return (s && s.spd) || C.prefOf(data, "spd") || 1;
  }
  function posOf(id) {
    var l = local.pos[id], synced = null;
    for (var i = 0; i < data.eps.length; i++) if (data.eps[i].id === id) { synced = data.eps[i]; break; }
    // Newest of the exact local position and the synced one (another
    // device may have listened further since).
    if (l && (!synced || l[2] >= synced.m)) return l[0];
    return synced && !synced.x ? synced.p : 0;
  }
  function releaseBlob() {
    if (blobUrl) { try { w.URL.revokeObjectURL(blobUrl); } catch (e) {} blobUrl = ""; }
  }
  function sourceFor(m) {
    // A download plays offline; otherwise stream (no CORS needed).
    if (!ST) return Promise.resolve(m.audio);
    return ST.getFile(m.id).then(function (f) {
      if (f && f.blob) { releaseBlob(); blobUrl = w.URL.createObjectURL(f.blob); return blobUrl; }
      return m.audio;
    }, function () { return m.audio; });
  }
  function load(m, start, autoplay) {
    m = cleanMeta(m);
    if (!m) return Promise.resolve(false);
    if (cur && cur.id !== m.id) commit("close");
    loading = true;
    cur = m;
    local.cur = m.id;
    local.meta[m.id] = m;
    local.last = null;
    flags.error = ""; flags.buffering = true;
    var at = typeof start === "number" ? start : posOf(m.id);
    var show = showOf(m.s);
    if (!at && show && show.skA) at = show.skA;           // skip the intro
    try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch (e) {}
    // What starts playing leaves the queue ("Up next" is what follows).
    if (data.queue.ids.indexOf(m.id) >= 0) mutate(function (dt, now) { return C.queueRemove(dt, m.id, now); });
    return sourceFor(m).then(function (src) {
      if (!cur || cur.id !== m.id) return false;          // another play() won meanwhile
      return fxPrepare(src).then(function () {
      if (!cur || cur.id !== m.id) return false;
      audio.src = src;
      loading = false;
      setBase(speedFor(m));
      try { audio.preservesPitch = true; } catch (e) {}
      var seekTo = function () {
        audio.removeEventListener("loadedmetadata", seekTo);
        if (at > 0 && (!isFinite(audio.duration) || at < audio.duration - 5)) { try { audio.currentTime = at; } catch (e) {} }
      };
      audio.addEventListener("loadedmetadata", seekTo);
      media();
      saveLocal(true);
      host.notify("load");
      return autoplay ? play() : true;
      });
    });
  }
  function play() {
    if (!cur) return Promise.resolve(false);
    focusTake();
    if (fx.ctx && fx.el === audio && fx.ctx.state === "suspended") { try { fx.ctx.resume().catch(function () {}); } catch (e) {} }
    var p;
    try { p = audio.play(); } catch (e) { p = null; }
    return Promise.resolve(p).then(function () { return true; }, function (err) {
      flags.error = (err && err.name) || "play";
      host.notify("error");
      return false;
    });
  }
  function pause() { try { audio.pause(); } catch (e) {} }
  function seekTo(t) {
    if (!cur) return;
    var d = isFinite(audio.duration) ? audio.duration : cur.dur || 0;
    t = Math.max(0, d ? Math.min(t, d - 1) : t);
    try { audio.currentTime = t; } catch (e) {}
    local.pos[cur.id] = [Math.floor(t), Math.round(d) || 0, Date.now()];
    saveLocal();
    host.notify("time");
  }
  function seekBy(dt) { seekTo((audio.currentTime || 0) + dt); }
  function stop() {
    commit("close");
    pause();
    try { audio.removeAttribute("src"); audio.load(); } catch (e) {}
    releaseBlob();
    cancelSleep();
    fxLoopStop();
    cur = null; local.cur = "";
    saveLocal(true);
    try { if (w.navigator.mediaSession) w.navigator.mediaSession.metadata = null; } catch (e) {}
    host.notify("stop");
  }

  // ---------- Position → slice ----------
  function commit(ev) {
    if (!cur || loading) return;
    var p = Math.floor(audio.currentTime || 0), d = isFinite(audio.duration) ? Math.round(audio.duration) : (cur.dur || 0);
    var nowSec = Math.floor(Date.now() / 1000);
    if (ev !== "ended" && !C.shouldCommit(ev, p, local.last, nowSec)) return;
    var m = cur;
    local.last = { p: p, at: nowSec };
    // A show only being tried (Discover preview) stays out of the slice:
    // its place is kept on this device only.
    if (!showOf(m.s)) { saveLocal(); return; }
    mutate(function (dt, now) {
      return C.setProgress(dt, { id: m.id, s: m.s, pd: m.pd }, p, d, ev === "ended" ? 1 : undefined, now);
    });
    saveLocal();
  }
  function bindAudio() {
  on("timeupdate", function () {
    if (!cur || loading) return;
    var p = Math.floor(audio.currentTime || 0), d = isFinite(audio.duration) ? Math.round(audio.duration) : (cur.dur || 0);
    var old = local.pos[cur.id];
    if (!old || old[0] !== p) { local.pos[cur.id] = [p, d, Date.now()]; saveLocal(); }
    // Skip the outro: the show's last N seconds count as the end.
    var show = showOf(cur.s);
    if (show && show.skB && d > show.skB + 30 && p >= d - show.skB && !audio.paused) { ended(); return; }
    if (sleep.until && Date.now() >= sleep.until) { cancelSleep(); pause(); host.notify("sleep"); }
    if (!audio.paused) { commit("tick"); countListen(); }
    posState();
    host.notify("time");
  });
  on("seeking", function () { lastWall = 0; fx.st = { q: 0, silent: false }; });
  on("pause", function () { lastWall = 0; fxLoopStop(); if (loading) return; commit("pause"); saveLocal(true); chip(); host.notify("pause"); });
  on("playing", function () { flags.buffering = false; flags.error = ""; fxLoopStart(); chip(); host.notify("play"); });
  on("waiting", function () { flags.buffering = true; host.notify("buffer"); });
  on("canplay", function () { flags.buffering = false; host.notify("buffer"); });
  on("ratechange", function () {
    posState();
    // The silence speed-up changes the element's rate many times a
    // minute; the screen only hears about the listening speed.
    if (fx.base !== fx.told) { fx.told = fx.base; host.notify("rate"); }
  });
  on("error", function () {
    if (!cur) return;
    if (fxFailed()) return;
    flags.error = "media"; flags.buffering = false;
    chip(); host.notify("error");
  });
  on("ended", ended);
  // The radio element may appear later: look again whenever ours plays.
  on("play", hookRadio);
  }
  // Listening time: wall-clock seconds between ticks while playing
  // (a gap over 30 s, e.g. a frozen tab, is not counted).
  var lastWall = 0;
  function countListen() {
    var t = Date.now();
    if (lastWall && cur) local.stats = C.addListen(local.stats, t, cur.s, (t - lastWall) / 1000, fx.base || 1);
    lastWall = t;
  }
  function ended() {
    if (!cur) return;
    var done = cur;
    try { audio.currentTime = isFinite(audio.duration) ? audio.duration : audio.currentTime; } catch (e) {}
    commit("ended");
    delete local.pos[done.id];
    var next = C.queueNext(data, done.id);
    mutate(function (dt, now) { return C.queueRemove(dt, done.id, now); });
    host.notify("ended", done);
    if (sleep.end) { cancelSleep(); stop(); return; }
    if (next && C.prefOf(data, "autoNext") && local.meta[next]) { load(local.meta[next], undefined, true); return; }
    stop();
  }

  // ---------- Sleep timer ----------
  function setSleep(min) {
    cancelSleep();
    if (min === "end") sleep.end = true;
    else if (+min > 0) sleep.until = Date.now() + +min * 60000;
    host.notify("sleep");
  }
  function cancelSleep() { sleep.until = 0; sleep.end = false; }

  // ---------- Skip silence + voice boost (Web Audio, wave 42) ----------
  // The element goes through an AudioContext only when the audio may be
  // read: a download (blob:), or a host that answers CORS (probed once
  // per origin with a plain GET, kept a day in local.cors). Such media
  // is loaded with crossOrigin="anonymous". Anything else plays on a
  // plain element exactly as before, and the screen says why the
  // effects are off ("blocked"): routing a non-CORS file through Web
  // Audio would only give silence. Once wired, an element stays wired
  // (the browser allows one source node per element), so a later
  // non-CORS episode gets a fresh element (fxFresh).
  //   graph: source → analyser (tap) and source → [highpass → presence
  //   EQ → compressor → makeup gain] → speakers (voice boost) or
  //   source → speakers (bypass).
  // Skip silence polls the analyser every 100 ms while playing; quiet
  // stretches play at core.silenceRate (the screen keeps showing the
  // listening speed, fx.base). Saved time goes to the statistics.
  function fxWanted() { return !!(C.prefOf(data, "sil") || C.prefOf(data, "vb")); }
  function setBase(r) {
    fx.base = +r > 0 ? +r : 1;
    try { audio.playbackRate = fx.fastOn ? C.silenceRate(fx.base) : fx.base; } catch (e) {}
  }
  function fxContext() {
    if (fx.ctx) return fx.ctx;
    var AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return null;
    try { fx.ctx = new AC(); } catch (e) { fx.ctx = null; }
    return fx.ctx;
  }
  function fxWire() {
    if (fx.el === audio) return true;
    var ctx = fxContext();
    if (!ctx) { fx.state = "unsupported"; return false; }
    try {
      fx.src = ctx.createMediaElementSource(audio);
      if (!fx.an) {
        fx.an = ctx.createAnalyser(); fx.an.fftSize = 2048;
        fx.buf = new Float32Array(fx.an.fftSize);
        var hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 80;
        var eq = ctx.createBiquadFilter(); eq.type = "peaking"; eq.frequency.value = 2800; eq.Q.value = 0.9; eq.gain.value = 5;
        var comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -30; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
        var gain = ctx.createGain(); gain.gain.value = 1.7;
        hp.connect(eq); eq.connect(comp); comp.connect(gain); gain.connect(ctx.destination);
        fx.chain = hp;
      }
      fx.el = audio;
      fx.vbOn = null;
      fxConnect();
      return true;
    } catch (e) { fx.state = "unsupported"; return false; }
  }
  function fxConnect() {
    if (!fx.src || fx.el !== audio) return;
    var vb = !!C.prefOf(data, "vb");
    if (fx.vbOn === vb) return;
    fx.vbOn = vb;
    try { fx.src.disconnect(); } catch (e) {}
    try {
      fx.src.connect(fx.an);
      fx.src.connect(vb ? fx.chain : fx.ctx.destination);
    } catch (e) {}
  }
  // A new, plain element in place of a wired one (same attributes,
  // fresh listeners). The old one is silenced and removed.
  function fxFresh() {
    var old = audio;
    fxLoopStop();
    audio = makeAudio();
    host.audio = audio;
    bindAudio();
    try { old.pause(); old.removeAttribute("src"); old.load(); } catch (e) {}
    try { old.remove(); } catch (e) {}
    fx.el = null; fx.src = null; fx.vbOn = null;
  }
  // Plain GET with CORS: the answer's headers are enough, the body is
  // dropped at once. true = Web Audio may read this host's files.
  function fxProbe(src) {
    if (typeof w.fetch !== "function" || typeof w.AbortController !== "function") return Promise.resolve(false);
    var ctl = new w.AbortController();
    var timer = w.setTimeout(function () { ctl.abort(); }, 8000);
    return w.fetch(src, { method: "GET", mode: "cors", credentials: "omit", cache: "no-store",
      referrerPolicy: "no-referrer", redirect: "follow", signal: ctl.signal }).then(function (r) {
      w.clearTimeout(timer);
      try { ctl.abort(); } catch (e) {}
      return r.ok || r.status === 206;
    }, function () { w.clearTimeout(timer); return false; });
  }
  // Before a source is set: wire or unwire the element for it.
  function fxPrepare(src) {
    fx.st = { q: 0, silent: false }; fx.zero = 0; fx.fastOn = false;
    fx.origin = C.mediaOrigin(src, w.location.origin);
    if (!fxWanted()) {
      if (fx.el === audio) fxFresh();
      try { audio.removeAttribute("crossorigin"); } catch (e) {}
      fx.state = "off";
      return Promise.resolve(false);
    }
    var route = C.fxRoute(fx.origin, local.cors, Date.now());
    var ask = route === "probe" ? (fx.state = "probing", host.notify("fx"), fxProbe(src).then(function (ok) {
      local.cors = C.fxRemember(local.cors, fx.origin, ok, Date.now());
      saveLocal();
      return ok;
    })) : Promise.resolve(route === "yes");
    return ask.then(function (ok) {
      if (!ok) {
        if (fx.el === audio) fxFresh();
        try { audio.removeAttribute("crossorigin"); } catch (e) {}
        fx.state = "blocked";
        host.notify("fx");
        return false;
      }
      if (fx.el !== audio && audio.getAttribute("src")) fxFresh();
      audio.crossOrigin = "anonymous";
      fx.state = fxWire() ? "on" : "unsupported";
      if (fx.state !== "on") { fxFresh(); }
      host.notify("fx");
      return fx.state === "on";
    });
  }
  // The media failed to load with crossOrigin set (a redirect to a host
  // without CORS, say): remember the host and play it plain.
  function fxFailed() {
    if (!cur || fx.el !== audio || fx.origin === "local" || fx.origin === "same" || fx.retried === cur.id) return false;
    fx.retried = cur.id;
    local.cors = C.fxRemember(local.cors, fx.origin, false, Date.now());
    saveLocal();
    fxReload(true);
    return true;
  }
  // Reload the current episode where it is (prefs changed, or the
  // effects had to go): plays on if it was playing.
  function fxReload(forcePlay) {
    if (!cur) return;
    var at = Math.floor(audio.currentTime || posOf(cur.id) || 0), was = forcePlay || !audio.paused;
    load(cur, at, was);
  }
  // Prefs changed (here or from another device).
  function fxSync() {
    var want = fxWanted();
    if (fx.el === audio) fxConnect();
    if (!C.prefOf(data, "sil")) fxFast(false);
    if (!cur || loading) { if (!want && fx.state !== "unsupported") fx.state = "off"; return; }
    if (want && fx.el !== audio && fx.state !== "blocked" && fx.state !== "unsupported" && fx.state !== "probing") fxReload(false);
    else if (!want && fx.state !== "off") { fx.state = "off"; fxLoopStop(); }
    else if (want && fx.el === audio) { fx.state = "on"; if (!audio.paused) fxLoopStart(); }
  }
  function fxFast(onOff) {
    if (fx.fastOn === onOff) return;
    fx.fastOn = onOff;
    try { audio.playbackRate = onOff ? C.silenceRate(fx.base) : fx.base; } catch (e) {}
  }
  function fxLoopStart() {
    if (fx.iv || fx.el !== audio || !fx.an || !fxWanted()) return;
    if (fx.ctx && fx.ctx.state === "suspended") { try { fx.ctx.resume().catch(function () {}); } catch (e) {} }
    fx.lastT = 0;
    fx.iv = w.setInterval(fxTick, 100);
  }
  function fxLoopStop() {
    if (fx.iv) { w.clearInterval(fx.iv); fx.iv = null; }
    fxFast(false);
    fx.st = { q: 0, silent: false };
  }
  function fxTick() {
    if (fx.el !== audio || !fx.an || audio.paused || !cur) { fxLoopStop(); return; }
    var t = Date.now(), dt = fx.lastT ? t - fx.lastT : 0;
    fx.lastT = t;
    if (fx.ctx.state !== "running") { fxFast(false); try { fx.ctx.resume().catch(function () {}); } catch (e) {} return; }
    try { fx.an.getFloatTimeDomainData(fx.buf); } catch (e) { return; }
    var zero = C.allZero(fx.buf);
    fx.zero = C.zeroWatch(fx.zero, zero, !flags.buffering && fx.ctx.state === "running", dt);
    if (fx.zero >= C.FX.zeroMs && fx.origin !== "local" && fx.origin !== "same") {
      // Only exact zeros for 10 s while playing: the browser hides this
      // audio from Web Audio after all. Play it plain.
      local.cors = C.fxRemember(local.cors, fx.origin, false, Date.now());
      saveLocal();
      fxReload(true);
      return;
    }
    if (!C.prefOf(data, "sil")) { fxFast(false); return; }
    fx.st = C.silenceStep(fx.st, zero ? 0 : C.rms(fx.buf), dt);
    // A long run of pure zeros is suspect (see above): never speed it.
    var fast = fx.st.silent && fx.zero < 1500;
    if (fx.fastOn && dt) {
      var sv = C.silenceSaved(dt / 1000, fx.base, C.silenceRate(fx.base));
      fx.saved += sv;
      local.stats = C.addSaved(local.stats, t, sv);
    }
    fxFast(fast);
  }

  // ---------- Audio focus (Radio ↔ Podcasts) ----------
  var radioHooked = null;
  function radioAudio() {
    var h = w.__orosRadioHost;
    return h && h.audio && h.audio.isConnected ? h.audio : doc.querySelector("audio[data-oros-radio]");
  }
  function hookRadio() {
    var ra = radioAudio();
    if (!ra || ra === radioHooked) return;
    radioHooked = ra;
    ra.addEventListener("play", function () { if (!audio.paused) pause(); });
  }
  function focusTake() {
    hookRadio();
    var ra = radioAudio();
    if (ra && !ra.paused) { try { ra.pause(); } catch (e) {} }
  }

  // ---------- Media Session ----------
  function media() {
    var ms = w.navigator.mediaSession;
    if (!ms || !cur) return;
    try {
      if (typeof w.MediaMetadata === "function") {
        ms.metadata = new w.MediaMetadata({
          title: cur.title, artist: cur.show, album: "orOS Podcasts",
          artwork: cur.img ? [{ src: cur.img, sizes: "512x512" }] : []
        });
      }
    } catch (e) {}
  }
  function posState() {
    var ms = w.navigator.mediaSession;
    if (!ms || typeof ms.setPositionState !== "function" || !isFinite(audio.duration) || !audio.duration) return;
    try {
      ms.setPositionState({ duration: audio.duration, playbackRate: fx.base || 1,
        position: Math.min(audio.currentTime || 0, audio.duration) });
    } catch (e) {}
  }
  (function () {
    var ms = w.navigator.mediaSession;
    if (!ms) return;
    var set = function (a, fn) { try { ms.setActionHandler(a, fn); } catch (e) {} };
    set("play", function () { play(); });
    set("pause", pause);
    set("seekbackward", function (d) { seekBy(-((d && d.seekOffset) || C.prefOf(data, "back"))); });
    set("seekforward", function (d) { seekBy((d && d.seekOffset) || C.prefOf(data, "fwd")); });
    set("seekto", function (d) { if (d && typeof d.seekTime === "number") seekTo(d.seekTime); });
    set("nexttrack", function () {
      if (!cur) return;
      var next = C.queueNext(data, cur.id);
      if (next && local.meta[next]) load(local.meta[next], undefined, true);
    });
  })();

  // ---------- Tray chip ----------
  var ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/>' +
    '<path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  function chip() {
    var el = doc.getElementById("pc-tray-chip");
    var bar = doc.querySelector(".bar-right");
    if (!cur || !bar) { if (el) el.remove(); return; }
    if (!doc.getElementById("pc-host-css")) {
      var st = doc.createElement("style");
      st.id = "pc-host-css";
      st.textContent = "#pc-tray-chip{display:inline-flex;align-items:center;min-height:44px;background:transparent;" +
        "border:none;color:var(--text-dim);padding:0 10px;cursor:pointer}#pc-tray-chip[data-state=on]{color:var(--accent)}" +
        "#pc-tray-chip[data-state=err]{color:var(--danger)}";
      doc.head.appendChild(st);
    }
    if (!el) {
      el = doc.createElement("button");
      el.id = "pc-tray-chip";
      el.type = "button";
      el.innerHTML = ICON;                    // constant markup, no data in it
      el.addEventListener("click", function (e) { e.stopPropagation(); if (audio.paused) play(); else pause(); });
      bar.insertBefore(el, doc.getElementById("rx-tray-chip") || doc.getElementById("btn-lang"));
    }
    var on = !audio.paused, err = !!flags.error;
    var title = ht(on ? "host.pause" : "host.play", { t: cur.title + " · " + cur.show });
    el.setAttribute("data-state", err ? "err" : on ? "on" : "off");
    el.title = title;                         // property: plain text, safe
    el.setAttribute("aria-label", title);
  }

  // ---------- Notifications ----------
  function note(text) {
    try { if (w.orosNotifs && typeof w.orosNotifs.transient === "function") w.orosNotifs.transient({ ns: "podcasts", title: text }); }
    catch (e) {}
  }

  // ---------- New-episode notices ----------
  // announce(showId, episodes): called by the app after it fetched a
  // feed, and by the background check below. One notice per episode,
  // keyed by its id: two devices announcing the same episode write the
  // same key, so the synced bell shows it once. reset = notices were
  // just turned on: take the mark again, announce nothing.
  function announce(sid, eps, reset) {
    var s = showOf(sid);
    if (!s || !s.ntf) return 0;
    if (reset) delete local.nt[sid];
    var r = C.freshEpisodes(eps, local.nt[sid], Date.now());
    local.nt[sid] = r.mark;
    saveLocal();
    var N = w.orosNotifs;
    if (!r.list.length || !N || typeof N.emit !== "function") return 0;
    r.list.forEach(function (e) {
      try {
        N.emit({ ns: "podcasts", type: "episode", key: "e:" + e.id, title: s.title, body: C.clean(e.title, 200),
                 deepLink: "podcasts:ep:" + e.id, ttlDays: 7 });
      } catch (err) {}
    });
    return r.list.length;
  }
  // Background check: with the Podcasts window closed, every 3 hours,
  // online, only the shows with notices on (off by default). The
  // Reader's parser and fetcher (feeds/core.js, feeds/fetch.js, already
  // precached) are loaded into the shell on the first check. Nothing is
  // written to the feed cache or the slice: the app refreshes on open.
  var BG_EVERY = 3 * 3600000, bgBusy = false, libP = null;
  function feedsLib() {
    var ok = function () { return w.orosFeedsCore && w.orosFeedsFetch ? { FC: w.orosFeedsCore, F: w.orosFeedsFetch } : null; };
    if (ok()) return Promise.resolve(ok());
    if (libP) return libP;
    var me = doc.querySelector('script[src*="podcasts/host.js"]');
    var base = (me && me.src) || (w.location.href.replace(/[^/]*$/, "") + "podcasts/host.js");
    var q = base.indexOf("?") >= 0 ? base.slice(base.indexOf("?")) : "";
    var load = function (rel) {
      return new Promise(function (res) {
        var sc = doc.createElement("script");
        try { sc.src = new URL(rel, base).href + q; } catch (e) { res(false); return; }
        sc.onload = function () { res(true); };
        sc.onerror = function () { res(false); };
        doc.head.appendChild(sc);
      });
    };
    libP = (w.orosFeedsCore ? Promise.resolve(true) : load("../feeds/core.js"))
      .then(function () { return w.orosFeedsFetch ? true : load("../feeds/fetch.js"); })
      .then(function () { var r = ok(); if (!r) libP = null; return r; });
    return libP;
  }
  function bgCheck(force) {
    if (force !== true) force = false;
    if (bgBusy || subs.length) return;                       // the open app refreshes by itself
    if (w.navigator && w.navigator.onLine === false) return;
    var shows = data.shows.filter(function (s) { return s.ntf; });
    if (!shows.length || (!force && Date.now() - (local.bg || 0) < BG_EVERY)) return;
    bgBusy = true;
    local.bg = Date.now();
    saveLocal();
    var done = function () { bgBusy = false; };
    feedsLib().then(function (lib) {
      if (!lib) return;
      return lib.F.fetchFeeds(shows.map(function (s) { return { url: s.url }; })).then(function (res) {
        res.forEach(function (r, i) {
          if (!r || r.err || r.status < 200 || r.status > 299 || !r.bytes) return;
          var text = lib.FC.decodeBytes(r.bytes, r.type);
          if (lib.FC.looksLikeFeed && !lib.FC.looksLikeFeed(text)) return;
          var parsed = null;
          try { parsed = C.parseFeed(lib.FC.parseXml(text), shows[i].url); } catch (e) { parsed = null; }
          if (parsed) announce(shows[i].id, parsed.eps);
        });
      });
    }).then(done, done);
  }

  // ---------- Subscribers (the app window; may be closed any time) ----------
  var subs = [];
  var host = {
    v: 1,
    audio: audio,
    notify: function (ev, arg) {
      for (var i = subs.length - 1; i >= 0; i--) {
        try { subs[i](ev, arg); } catch (e) { subs.splice(i, 1); }   // dead frame
      }
    }
  };
  host.api = {
    data: function () { return data; },
    mutate: mutate,
    // Episode details for the queue (so it plays on with the window closed).
    remember: function (metas) {
      (metas || []).forEach(function (m) { var c = cleanMeta(m); if (c) local.meta[c.id] = c; });
      saveLocal();
    },
    play: function (meta, start) { return load(meta, start, true); },
    load: function (meta, start) { return load(meta, start, false); },
    toggle: function () { if (!cur) return; if (audio.paused) play(); else pause(); },
    pause: pause,
    resume: play,
    seekTo: seekTo,
    seekBy: seekBy,
    back: function () { seekBy(-C.prefOf(data, "back")); },
    fwd: function () { seekBy(C.prefOf(data, "fwd")); },
    next: function () { if (cur) ended(); },
    setSpeed: function (r) {
      r = +r;
      if (!(r >= C.LIM.spdMin && r <= C.LIM.spdMax)) return;
      setBase(r);
      if (cur) {
        var sid = cur.s;
        // A per-show speed stays per show; otherwise it is the default.
        var show = showOf(sid);
        if (show && show.spd) mutate(function (dt, now) { return C.editShow(dt, sid, { spd: r }, now); });
        else mutate(function (dt, now) { return C.setPref(dt, "spd", r, now); });
      }
    },
    setSleep: setSleep,
    cancelSleep: function () { cancelSleep(); host.notify("sleep"); },
    stop: stop,
    position: posOf,
    stats: function () { return JSON.parse(JSON.stringify(local.stats || { d: {}, s: {} })); },
    // eps: [{ id, title, pub }] from a fetched feed (see announce).
    checkNew: function () { bgCheck(true); },
    announce: function (sid, eps, reset) {
      var list = [];
      (eps || []).forEach(function (e) { if (e) list.push({ id: String(e.id || ""), title: String(e.title || ""), pub: +e.pub || 0 }); });
      return announce(String(sid || ""), list, !!reset);
    },
    commit: function () { commit("close"); saveLocal(true); },
    getState: function () {
      return {
        cur: cur, playing: !!cur && !audio.paused, paused: audio.paused,
        pos: audio.currentTime || 0, dur: isFinite(audio.duration) ? audio.duration : (cur ? cur.dur : 0),
        rate: fx.base || 1, buffering: flags.buffering, error: flags.error,
        sleepUntil: sleep.until, sleepEnd: sleep.end,
        // fx: "off" | "on" | "probing" | "blocked" (the server does not
        // let the browser read the audio) | "unsupported" (no Web Audio)
        fx: { state: fx.state, sil: !!C.prefOf(data, "sil"), vb: !!C.prefOf(data, "vb"), saved: Math.round(fx.saved), fast: fx.fastOn }
      };
    },
    subscribe: function (fn) {
      subs.push(fn);
      return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
    }
  };
  w.__orosPodcastsHost = host;
  bindAudio();

  // Last session's episode comes back paused, at its place.
  if (local.cur && local.meta[local.cur]) load(local.meta[local.cur], undefined, false).then(chip);

  // The page goes away: keep the place (the engine pushes on hide).
  w.addEventListener("pagehide", function () { commit("close"); saveLocal(true); });
  doc.addEventListener("visibilitychange", function () { if (doc.visibilityState === "hidden") { commit("close"); saveLocal(true); } });

  // Background notice check (shell doctrine: no idle timers, like the
  // weather tray): 2 minutes after boot, then on tab visible, focus,
  // back online and shell gestures. Each call is a timestamp compare
  // until 3 hours have passed. Honest limit: orOS closed = no check.
  w.setTimeout(bgCheck, 120000);
  doc.addEventListener("visibilitychange", function () { if (doc.visibilityState === "visible") bgCheck(); });
  w.addEventListener("focus", bgCheck);
  w.addEventListener("online", bgCheck);
  doc.addEventListener("pointerdown", bgCheck, { capture: true, passive: true });

  // Shell boot order: sync.js may not have run its setup yet.
  if (!register()) {
    var tries = 0, iv = w.setInterval(function () { if (register() || ++tries > 40) w.clearInterval(iv); }, 250);
  }
})(window);
