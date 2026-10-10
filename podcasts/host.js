// ============================================================
// orOS Podcasts — host.js (player + data owner, v1.1.0)
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
//   - audio focus: Radio starting pauses a podcast and vice versa.
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
        note(w.orosLang === "el" ? "Ο χώρος αποθήκευσης γέμισε: τα podcasts δεν αποθηκεύτηκαν." :
          "Storage is full: podcast changes were not saved.");
      }
    }
  }
  function sliceGet() { return data; }
  function sliceSet(next) {
    if (!next) return;
    data = C.mergePodcasts(next, null);
    writeData();
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
  function readLocal() {
    try {
      var o = JSON.parse(w.localStorage.getItem(LOCAL_KEY) || "null");
      if (o && typeof o === "object") return { pos: o.pos || {}, meta: o.meta || {}, cur: o.cur || "", last: o.last || null, spd: o.spd || 0,
        stats: o.stats && typeof o.stats === "object" ? o.stats : { d: {}, s: {} } };
    } catch (e) {}
    return { pos: {}, meta: {}, cur: "", last: null, spd: 0, stats: { d: {}, s: {} } };
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
  var audio = doc.querySelector("audio[data-oros-podcasts]");
  if (!audio) {
    audio = doc.createElement("audio");
    audio.setAttribute("data-oros-podcasts", "1");
    audio.preload = "metadata";
    audio.style.display = "none";
    try { doc.body.appendChild(audio); } catch (e) {}
  }
  var cur = null;          // meta of the loaded episode
  var loading = false;     // switching episodes: the old element's pause is not a "pause"
  var blobUrl = "";
  var flags = { buffering: false, error: "" };
  var sleep = { until: 0, end: false, iv: null };

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
      audio.src = src;
      loading = false;
      audio.playbackRate = speedFor(m);
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
  }
  function play() {
    if (!cur) return Promise.resolve(false);
    focusTake();
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
    mutate(function (dt, now) {
      return C.setProgress(dt, { id: m.id, s: m.s, pd: m.pd }, p, d, ev === "ended" ? 1 : undefined, now);
    });
    local.last = { p: p, at: nowSec };
    saveLocal();
  }
  audio.addEventListener("timeupdate", function () {
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
  // Listening time: wall-clock seconds between ticks while playing
  // (a gap over 30 s, e.g. a frozen tab, is not counted).
  var lastWall = 0;
  function countListen() {
    var t = Date.now();
    if (lastWall && cur) local.stats = C.addListen(local.stats, t, cur.s, (t - lastWall) / 1000, audio.playbackRate || 1);
    lastWall = t;
  }
  audio.addEventListener("seeking", function () { lastWall = 0; });
  audio.addEventListener("pause", function () { lastWall = 0; if (loading) return; commit("pause"); saveLocal(true); chip(); host.notify("pause"); });
  audio.addEventListener("playing", function () { flags.buffering = false; flags.error = ""; chip(); host.notify("play"); });
  audio.addEventListener("waiting", function () { flags.buffering = true; host.notify("buffer"); });
  audio.addEventListener("canplay", function () { flags.buffering = false; host.notify("buffer"); });
  audio.addEventListener("ratechange", function () { posState(); host.notify("rate"); });
  audio.addEventListener("error", function () {
    if (!cur) return;
    flags.error = "media"; flags.buffering = false;
    chip(); host.notify("error");
  });
  audio.addEventListener("ended", ended);
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
  // The radio element may appear later: look again whenever ours plays.
  audio.addEventListener("play", hookRadio);

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
      ms.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate || 1,
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
    var el2 = w.orosLang === "el";
    var title = (on ? (el2 ? "Παύση: " : "Pause: ") : (el2 ? "Αναπαραγωγή: " : "Play: ")) + cur.title + " · " + cur.show;
    el.setAttribute("data-state", err ? "err" : on ? "on" : "off");
    el.title = title;                         // property: plain text, safe
    el.setAttribute("aria-label", title);
  }

  // ---------- Notifications ----------
  function note(text) {
    try { if (w.orosNotifs && typeof w.orosNotifs.transient === "function") w.orosNotifs.transient({ ns: "podcasts", title: text }); }
    catch (e) {}
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
      audio.playbackRate = r;
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
    commit: function () { commit("close"); saveLocal(true); },
    getState: function () {
      return {
        cur: cur, playing: !!cur && !audio.paused, paused: audio.paused,
        pos: audio.currentTime || 0, dur: isFinite(audio.duration) ? audio.duration : (cur ? cur.dur : 0),
        rate: audio.playbackRate || 1, buffering: flags.buffering, error: flags.error,
        sleepUntil: sleep.until, sleepEnd: sleep.end
      };
    },
    subscribe: function (fn) {
      subs.push(fn);
      return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
    }
  };
  w.__orosPodcastsHost = host;

  // Last session's episode comes back paused, at its place.
  if (local.cur && local.meta[local.cur]) load(local.meta[local.cur], undefined, false).then(chip);

  // The page goes away: keep the place (the engine pushes on hide).
  w.addEventListener("pagehide", function () { commit("close"); saveLocal(true); });
  doc.addEventListener("visibilitychange", function () { if (doc.visibilityState === "hidden") { commit("close"); saveLocal(true); } });

  // Shell boot order: sync.js may not have run its setup yet.
  if (!register()) {
    var tries = 0, iv = w.setInterval(function () { if (register() || ++tries > 40) w.clearInterval(iv); }, 250);
  }
})(window);
