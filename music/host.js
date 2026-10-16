// ============================================================
// orOS Music — host.js (player + data owner, v1.0.0)
// Runs in the SHELL window (loaded by index.html after core.js and
// store.js, or injected by the app on first open), so the music,
// the queue and sync keep going while the Music window is closed.
// The app is only a screen over this host:
//   window.__orosMusicHost.api   (see the object at the end)
//
// It owns:
//   - the one <audio data-oros-music> in the shell document;
//   - the sync slice "music" (oros-music-data: likes + playlists)
//     WITH its merge, registered here and only here;
//   - device-local state "oros-music-local": the queue (what was
//     started, shuffle order, "next up", repeat), the position of
//     the current song, the volume and the listening history;
//   - Media Session (lock screen, headphones, media keys: play,
//     pause, previous, next, seek);
//   - the tray chip (play/pause) on the shell bar;
//   - audio focus: Radio or Podcasts starting pauses the music, and
//     music starting pauses them.
// Songs on the orOS disk play from a blob: URL read through
// window.orosFS, so they play offline. The slice changes only when
// the user likes a song or edits a playlist: playing never uploads.
// ============================================================
(function (w) {
  "use strict";
  if (w.__orosMusicHost && w.__orosMusicHost.v >= 1) return;
  var C = w.OrosMusicCore, ST = w.OrosMusicStore;
  if (!C) return;

  var KEY = "oros-music-data", LOCAL_KEY = "oros-music-local";
  var doc = w.document;
  function isEl() { return w.orosLang === "el"; }

  // ---------- Data (synced slice) ----------
  function readData() {
    try {
      var raw = w.localStorage.getItem(KEY);
      return raw ? C.mergeMusic(JSON.parse(raw), null) : C.emptyData();
    } catch (e) { return C.emptyData(); }
  }
  var data = readData();
  var quotaWarned = false;
  function writeData() {
    try { w.localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) {
      // R30: never swallow a failed write; one notice per session.
      if (!quotaWarned) {
        quotaWarned = true;
        note(isEl() ? "Ο χώρος αποθήκευσης γέμισε: οι αλλαγές στη Μουσική δεν αποθηκεύτηκαν." : "Storage is full: Music changes were not saved.");
      }
    }
  }
  function sliceGet() { return data; }
  function sliceSet(next) {
    if (!next) return;
    data = C.mergeMusic(next, null);
    writeData();
    host.notify("data");
  }
  function sync() { return w.orosSync || null; }
  function markDirty() {
    var s = sync();
    if (s && typeof s.markDirty === "function") { try { s.markDirty(); } catch (e) {} }
  }
  // fn(data, now) → new data. true when something changed.
  function mutate(fn) {
    var next;
    try { next = fn(data, Date.now()); } catch (e) { return false; }
    if (!next || next === data) return false;
    // Re-made with this realm's core: the caller may be the app frame.
    next = C.mergeMusic(JSON.parse(JSON.stringify(next)), null);
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
    s.registerSlice("music", sliceGet, sliceSet, KEY, C.mergeMusic);
    return true;
  }

  // ---------- Device-local state ----------
  function readLocal() {
    var o = null;
    try { o = JSON.parse(w.localStorage.getItem(LOCAL_KEY) || "null"); } catch (e) { o = null; }
    o = o && typeof o === "object" ? o : {};
    return { q: C.normQueue(o.q), pos: +o.pos > 0 ? +o.pos : 0, vol: typeof o.vol === "number" && o.vol >= 0 && o.vol <= 1 ? o.vol : 1,
      hist: o.hist && typeof o.hist === "object" ? o.hist : { c: {}, r: [], l: {} } };
  }
  var local = readLocal();
  var localTimer = null;
  function saveLocal(now) {
    var run = function () {
      localTimer = null;
      try { w.localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); }
      catch (e) {
        // A huge queue must not block the rest: keep what is around the current song.
        try {
          var q = C.normQueue(local.q), lo = Math.max(0, q.at - 200);
          var keep = q.ord.slice(lo, q.at + 800).map(function (i) { return q.ctx[i]; });
          local.q = C.qStart(null, keep, keep.indexOf(q.cur), { shf: 0, src: q.src });
          local.q.rep = q.rep; local.q.up = q.up.slice(0, 100);
          w.localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
        } catch (e2) {}
      }
    };
    if (now) { if (localTimer) w.clearTimeout(localTimer); run(); }
    else if (!localTimer) localTimer = w.setTimeout(run, 4000);
  }

  // ---------- Audio ----------
  var audio = doc.querySelector("audio[data-oros-music]");
  if (!audio) {
    audio = doc.createElement("audio");
    audio.setAttribute("data-oros-music", "1");
    audio.preload = "auto";
    audio.style.display = "none";
    try { doc.body.appendChild(audio); } catch (e) {}
  }
  audio.volume = local.vol;
  var cur = null;            // item loaded
  var loadSeq = 0;           // a newer load wins
  var blobUrl = "", artUrl = "", artFor = "";
  var flags = { buffering: false, error: "" };
  var counted = false;       // this play is in the history already
  var fails = 0;             // songs in a row that could not play
  var wantPlay = false;      // the user asked for sound (an error then skips on)

  function fs() { return w.orosFS || null; }
  function releaseBlob() { if (blobUrl) { try { w.URL.revokeObjectURL(blobUrl); } catch (e) {} blobUrl = ""; } }
  function sourceFor(item) {
    if (item.p) {
      var F = fs();
      if (!F || typeof F.read !== "function") return Promise.reject(new Error("nofs"));
      return F.read(item.p).then(function (blob) {
        releaseBlob();
        blobUrl = w.URL.createObjectURL(blob);
        return blobUrl;
      });
    }
    if (item.u && /^https:\/\//i.test(item.u)) {
      // A song from an open catalogue: its offline copy when there is
      // one, else it streams straight from the source.
      if (!ST || typeof ST.getOff !== "function") return Promise.resolve(item.u);
      return ST.getOff(item.k).then(function (blob) {
        if (!blob) return item.u;
        releaseBlob();
        blobUrl = w.URL.createObjectURL(blob);
        return blobUrl;
      }, function () { return item.u; });
    }
    if (item.s === "sv") {
      // A song of the user's own server (servers.js knows the login).
      return servers().then(function (SV) { return SV.source(item); }).then(function (src) {
        if (typeof src === "string") return src;
        releaseBlob();
        blobUrl = w.URL.createObjectURL(src);
        return blobUrl;
      });
    }
    return Promise.reject(new Error("nosrc"));
  }
  // servers.js, loaded into this window on the first server song,
  // from next to this file (same ?v=).
  var svWait = null;
  var hostSrc = (function () {
    var s = doc.currentScript && doc.currentScript.src;
    if (s) return s;
    var all = doc.querySelectorAll("script[src*='host.js']");
    return all.length ? all[all.length - 1].src : "";
  })();
  function servers() {
    if (w.OrosMusicServers) return Promise.resolve(w.OrosMusicServers);
    if (svWait) return svWait;
    svWait = new Promise(function (resolve, reject) {
      var s = doc.createElement("script");
      s.src = hostSrc ? hostSrc.replace(/host\.js(\?|$)/, "servers.js$1") : "music/servers.js";
      s.onload = function () { if (w.OrosMusicServers) resolve(w.OrosMusicServers); else { svWait = null; reject(new Error("servers")); } };
      s.onerror = function () { svWait = null; s.remove(); reject(new Error("servers")); };
      doc.head.appendChild(s);
    });
    return svWait;
  }
  function load(item, start, autoplay) {
    if (!item) return Promise.resolve(false);
    var my = ++loadSeq;
    cur = item;
    counted = false;
    flags.error = ""; flags.buffering = true;
    try { audio.pause(); } catch (e) {}
    media();
    host.notify("load");
    return sourceFor(item).then(function (src) {
      if (my !== loadSeq) return false;
      audio.src = src;
      var at = +start > 0 ? +start : 0;
      if (at) {
        var seek = function () { audio.removeEventListener("loadedmetadata", seek); if (!isFinite(audio.duration) || at < audio.duration - 2) { try { audio.currentTime = at; } catch (e) {} } };
        audio.addEventListener("loadedmetadata", seek);
      }
      saveLocal(true);
      return autoplay ? play() : true;
    }, function () {
      if (my !== loadSeq) return false;
      flags.error = "missing"; flags.buffering = false;
      host.notify("error");
      chip();
      if (autoplay) skipBroken();
      return false;
    });
  }
  // A song that cannot play is skipped, like other players do; after
  // five in a row (or the whole list) it stops and says so.
  function skipBroken() {
    fails++;
    var n = C.normQueue(local.q).ctx.length;
    if (fails >= 5 || fails > n) { fails = 0; note(isEl() ? "Αυτά τα τραγούδια δεν παίζουν σε αυτή τη συσκευή." : "These songs cannot play on this device."); return; }
    w.setTimeout(function () { advance(true, true); }, 600);
  }
  function play() {
    if (!cur) return Promise.resolve(false);
    wantPlay = true;
    focusTake();
    var p;
    try { p = audio.play(); } catch (e) { p = null; }
    return Promise.resolve(p).then(function () { return true; }, function (err) {
      flags.error = (err && err.name) || "play";
      host.notify("error");
      return false;
    });
  }
  function pause() { wantPlay = false; try { audio.pause(); } catch (e) {} }
  function seekTo(t) {
    if (!cur) return;
    var d = isFinite(audio.duration) ? audio.duration : cur.d || 0;
    t = Math.max(0, d ? Math.min(t, d - 0.5) : t);
    try { audio.currentTime = t; } catch (e) {}
    local.pos = t;
    saveLocal();
    posState();
    host.notify("time");
  }
  function setQueue(q) { local.q = C.normQueue(q); saveLocal(); }
  // Next song: manual = the Next button (moves on even on repeat one).
  function advance(manual, auto) {
    var r = C.qNext(local.q, manual);
    setQueue(r.q);
    if (!r.item) { stopAtEnd(); return; }
    local.pos = 0;
    load(r.item, 0, true).then(function (ok) { if (ok) fails = 0; });
    if (!auto) fails = 0;
  }
  function prev() {
    if (!cur) return;
    if ((audio.currentTime || 0) > 3) { seekTo(0); return; }
    var r = C.qPrev(local.q);
    setQueue(r.q);
    if (r.item) { local.pos = 0; load(r.item, 0, true); }
  }
  // The list ran out: the last song stays loaded, at its start, paused.
  function stopAtEnd() {
    pause();
    try { audio.currentTime = 0; } catch (e) {}
    local.pos = 0;
    var q = C.normQueue(local.q);
    q.at = Math.max(0, q.ctx.length - 1);
    q.cur = cur;
    local.q = q;
    saveLocal(true);
    chip();
    host.notify("end");
  }
  function stop() {
    loadSeq++;
    pause();
    try { audio.removeAttribute("src"); audio.load(); } catch (e) {}
    releaseBlob();
    cur = null;
    local.q = C.emptyQueue();
    local.pos = 0;
    saveLocal(true);
    try { if (w.navigator.mediaSession) w.navigator.mediaSession.metadata = null; } catch (e) {}
    chip();
    host.notify("stop");
  }
  function countPlay() {
    if (counted || !cur) return;
    counted = true;
    local.hist = C.addPlay(local.hist, cur, Date.now());
    saveLocal();
  }
  audio.addEventListener("timeupdate", function () {
    if (!cur) return;
    local.pos = audio.currentTime || 0;
    if (!counted && local.pos >= 30) countPlay();
    saveLocal();
    posState();
    host.notify("time");
  });
  audio.addEventListener("loadedmetadata", function () {
    if (cur && cur.p && !cur.d && isFinite(audio.duration) && audio.duration > 0 && ST) {
      cur.d = Math.round(audio.duration);
      ST.setDuration(cur.p, audio.duration).then(function (ch) { if (ch) host.notify("index"); });
    }
    posState();
  });
  audio.addEventListener("pause", function () { saveLocal(true); chip(); host.notify("pause"); });
  audio.addEventListener("playing", function () { flags.buffering = false; flags.error = ""; fails = 0; chip(); host.notify("play"); });
  audio.addEventListener("play", hookOthers);
  audio.addEventListener("waiting", function () { flags.buffering = true; host.notify("buffer"); });
  audio.addEventListener("canplay", function () { flags.buffering = false; host.notify("buffer"); });
  audio.addEventListener("volumechange", function () { local.vol = audio.volume; saveLocal(); host.notify("volume"); });
  audio.addEventListener("error", function () {
    if (!cur || !audio.getAttribute("src")) return;
    flags.error = "media"; flags.buffering = false;
    chip(); host.notify("error");
    if (wantPlay) skipBroken();
  });
  audio.addEventListener("ended", function () { countPlay(); advance(false); });

  // ---------- Audio focus (Radio, Podcasts ↔ Music) ----------
  var hooked = [];
  function others() {
    var list = [], r = w.__orosRadioHost, p = w.__orosPodcastsHost;
    list.push(r && r.audio && r.audio.isConnected ? r.audio : doc.querySelector("audio[data-oros-radio]"));
    list.push(p && p.audio && p.audio.isConnected ? p.audio : doc.querySelector("audio[data-oros-podcasts]"));
    return list.filter(Boolean);
  }
  function hookOthers() {
    others().forEach(function (a) {
      if (hooked.indexOf(a) >= 0) return;
      hooked.push(a);
      a.addEventListener("play", function () { if (!audio.paused) pause(); });
    });
  }
  function focusTake() {
    hookOthers();
    others().forEach(function (a) { if (!a.paused) { try { a.pause(); } catch (e) {} } });
  }

  // ---------- Media Session ----------
  function setArt(item) {
    var id = item && item.art;
    if (item && item.s === "sv") id = w.OrosMusicServers ? w.OrosMusicServers.coverUrl(item) : "";
    // Covers of open-catalogue songs are https addresses.
    if (id && /^https?:\/\//i.test(id)) { artFor = ""; if (artUrl) { try { w.URL.revokeObjectURL(artUrl); } catch (e) {} artUrl = ""; } return Promise.resolve(id); }
    if (!id || !ST) { artFor = ""; if (artUrl) { try { w.URL.revokeObjectURL(artUrl); } catch (e) {} artUrl = ""; } return Promise.resolve(""); }
    if (id === artFor && artUrl) return Promise.resolve(artUrl);
    return ST.getArt(id).then(function (blob) {
      if (artUrl) { try { w.URL.revokeObjectURL(artUrl); } catch (e) {} artUrl = ""; }
      artFor = id;
      if (blob) artUrl = w.URL.createObjectURL(blob);
      return artUrl;
    }, function () { return ""; });
  }
  function media() {
    var ms = w.navigator.mediaSession, item = cur;
    if (!ms || !item) return;
    setArt(item).then(function (url) {
      if (item !== cur) return;
      try {
        if (typeof w.MediaMetadata === "function") {
          ms.metadata = new w.MediaMetadata({ title: item.t || "", artist: item.a || "", album: item.al || "",
            artwork: url ? [/^blob:/.test(url) ? { src: url, sizes: "300x300", type: "image/jpeg" } : { src: url }] : [] });
        }
      } catch (e) {}
    });
  }
  function posState() {
    var ms = w.navigator.mediaSession;
    if (!ms || typeof ms.setPositionState !== "function" || !isFinite(audio.duration) || !audio.duration) return;
    try { ms.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime || 0, audio.duration) }); } catch (e) {}
  }
  // The handlers belong to whoever played last: Radio and Podcasts
  // set their own when they start, so music takes them back on play.
  function handlers() {
    var ms = w.navigator.mediaSession;
    if (!ms) return;
    var set = function (a, fn) { try { ms.setActionHandler(a, fn); } catch (e) {} };
    set("play", function () { play(); });
    set("pause", pause);
    set("previoustrack", prev);
    set("nexttrack", function () { advance(true); });
    set("seekbackward", function (d) { seekTo((audio.currentTime || 0) - ((d && d.seekOffset) || 10)); });
    set("seekforward", function (d) { seekTo((audio.currentTime || 0) + ((d && d.seekOffset) || 10)); });
    set("seekto", function (d) { if (d && typeof d.seekTime === "number") seekTo(d.seekTime); });
  }
  audio.addEventListener("play", handlers);

  // ---------- Tray chip ----------
  var ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/>' +
    '<circle cx="18" cy="16" r="3"/></svg>';
  function chip() {
    var el = doc.getElementById("mu-tray-chip");
    var bar = doc.querySelector(".bar-right");
    if (!cur || !bar) { if (el) el.remove(); return; }
    if (!doc.getElementById("mu-host-css")) {
      var st = doc.createElement("style");
      st.id = "mu-host-css";
      st.textContent = "#mu-tray-chip{display:inline-flex;align-items:center;min-height:44px;background:transparent;" +
        "border:none;color:var(--text-dim);padding:0 10px;cursor:pointer}#mu-tray-chip[data-state=on]{color:var(--accent)}" +
        "#mu-tray-chip[data-state=err]{color:var(--danger)}";
      doc.head.appendChild(st);
    }
    if (!el) {
      el = doc.createElement("button");
      el.id = "mu-tray-chip";
      el.type = "button";
      el.innerHTML = ICON;                    // constant markup, no data in it
      el.addEventListener("click", function (e) { e.stopPropagation(); if (audio.paused) play(); else pause(); });
      bar.insertBefore(el, doc.getElementById("pc-tray-chip") || doc.getElementById("rx-tray-chip") || doc.getElementById("btn-lang"));
    }
    var on = !audio.paused, err = !!flags.error;
    var title = (on ? (isEl() ? "Παύση: " : "Pause: ") : (isEl() ? "Αναπαραγωγή: " : "Play: ")) + (cur.t || "") + (cur.a ? " · " + cur.a : "");
    el.setAttribute("data-state", err ? "err" : on ? "on" : "off");
    el.title = title;                         // property: plain text, safe
    el.setAttribute("aria-label", title);
  }

  // ---------- Notices ----------
  function note(text) {
    try { if (w.orosNotifs && typeof w.orosNotifs.transient === "function") w.orosNotifs.transient({ ns: "music", title: text }); }
    catch (e) {}
  }

  // ---------- Subscribers (the app window; may close any time) ----------
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
  // Items cross from the app frame: copy them into this realm.
  function own(x) { try { return JSON.parse(JSON.stringify(x)); } catch (e) { return null; } }
  host.api = {
    data: function () { return data; },
    mutate: mutate,
    playList: function (items, idx, opts) {
      items = own(items) || [];
      if (!items.length) return Promise.resolve(false);
      var q = C.qStart(local.q, items, typeof idx === "number" ? idx : -1, own(opts) || {});
      setQueue(q);
      local.pos = 0;
      fails = 0;
      return load(q.cur, 0, true);
    },
    toggle: function () { if (!cur) return; if (audio.paused) play(); else pause(); },
    pause: pause,
    resume: play,
    next: function () { if (cur || C.normQueue(local.q).ctx.length) advance(true); },
    prev: prev,
    seekTo: seekTo,
    seekBy: function (dt) { seekTo((audio.currentTime || 0) + dt); },
    setShuffle: function (on) { setQueue(C.qShuffle(local.q, !!on)); host.notify("queue"); },
    cycleRepeat: function () { setQueue(C.qCycleRepeat(local.q)); host.notify("queue"); },
    setVolume: function (v) { v = +v; if (v >= 0 && v <= 1) audio.volume = v; },
    addNext: function (items) { setQueue(C.qAddNext(local.q, own(items) || [])); host.notify("queue"); },
    addLast: function (items) { setQueue(C.qAddLast(local.q, own(items) || [])); host.notify("queue"); },
    removeUp: function (i) { setQueue(C.qRemoveUp(local.q, i)); host.notify("queue"); },
    clearUp: function () { setQueue(C.qClearUp(local.q)); host.notify("queue"); },
    jump: function (n) {
      var r = C.qJump(local.q, n);
      setQueue(r.q);
      if (r.item) { local.pos = 0; load(r.item, 0, true); }
      host.notify("queue");
    },
    // Library changed (a file deleted or renamed): fix the paths of the
    // queued songs; songs with no file left are dropped.
    relink: function (fn) {
      var q = C.normQueue(local.q), map = function (it) { var p = fn(own(it)); return p ? own(p) : null; };
      var ctx = [], ord = [], keepIdx = {};
      q.ctx.forEach(function (it, i) { var x = map(it); if (x) { keepIdx[i] = ctx.length; ctx.push(x); } });
      q.ord.forEach(function (i) { if (i in keepIdx) ord.push(keepIdx[i]); });
      var curIdx = q.at >= 0 && q.at < q.ord.length ? q.ord[q.at] : -1;
      q.ctx = ctx; q.ord = ord; q.at = curIdx in keepIdx ? ord.indexOf(keepIdx[curIdx]) : Math.min(q.at, ord.length - 1);
      q.up = q.up.map(map).filter(Boolean);
      setQueue(q);
      host.notify("queue");
    },
    stop: stop,
    upcoming: function (max) { return own(C.qUpcoming(local.q, max || 100)); },
    history: function () { return own(local.hist); },
    getState: function () {
      var q = C.normQueue(local.q);
      return {
        cur: cur, playing: !!cur && !audio.paused, paused: audio.paused,
        pos: audio.currentTime || 0, dur: isFinite(audio.duration) && audio.duration ? audio.duration : (cur ? cur.d || 0 : 0),
        buffering: flags.buffering, error: flags.error, shf: q.shf, rep: q.rep, vol: audio.volume, src: q.src,
        hasNext: !!(q.up.length || q.at + 1 < q.ctx.length || q.rep !== "off")
      };
    },
    subscribe: function (fn) {
      subs.push(fn);
      return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
    }
  };
  w.__orosMusicHost = host;

  // Last session's song comes back paused, at its place.
  (function restore() {
    var q = C.normQueue(local.q);
    if (!q.cur) return;
    var tries = 0;
    var go = function () {
      if (fs() || ++tries > 20) { load(q.cur, local.pos, false).then(chip); return; }
      w.setTimeout(go, 250);
    };
    go();
  })();

  w.addEventListener("pagehide", function () { saveLocal(true); });
  doc.addEventListener("visibilitychange", function () { if (doc.visibilityState === "hidden") saveLocal(true); });

  // Shell boot order: sync.js may not have run its setup yet.
  if (!register()) {
    var tries = 0, iv = w.setInterval(function () { if (register() || ++tries > 40) w.clearInterval(iv); }, 250);
  }
})(window);
