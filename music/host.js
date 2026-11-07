// ============================================================
// orOS Music — host.js (player + data owner, v1.3.0)
// Runs in the SHELL window (loaded by index.html after core.js and
// store.js, or injected by the app on first open), so the music,
// the queue and sync keep going while the Music window is closed.
// The app is only a screen over this host:
//   window.__orosMusicHost.api   (see the object at the end)
//
// It owns:
//   - the <audio data-oros-music> decks in the shell document (the
//     song playing, the next one loaded early for gapless playback
//     and crossfades), the equalizer (Web Audio, same-origin sources
//     only), ReplayGain volume levelling and the sleep timer
//     (device-local settings "oros-music-sound");
//   - the sync slice "music" (oros-music-data: likes + playlists)
//     WITH its merge, registered here and only here;
//   - device-local state "oros-music-local": the queue (what was
//     started, shuffle order, "next up", repeat), the position of
//     the current song, the volume and the listening history, and
//     the yearly listening stats "oros-music-stats" (recap, mixes);
//   - Media Session (lock screen, headphones, media keys: play,
//     pause, previous, next, seek);
//   - the tray chip on the shell bar and its control panel (MU-PANEL:
//     the song, position, previous / play-pause / next, stop, open
//     Music, volume and mute);
//   - audio focus: Radio or Podcasts starting pauses the music, and
//     music starting pauses them;
//   - ListenBrainz listens with the person's own token (lb.js, loaded
//     only when this device has an account; wave 6d).
// Songs on the orOS disk play from a blob: URL read through
// window.orosFS, so they play offline. The slice changes only when
// the user likes a song or edits a playlist: playing never uploads.
// ============================================================
(function (w) {
  "use strict";
  if (w.__orosMusicHost && w.__orosMusicHost.v >= 1) return;
  var C = w.OrosMusicCore, ST = w.OrosMusicStore;
  if (!C) return;

  var KEY = "oros-music-data", LOCAL_KEY = "oros-music-local", STATS_KEY = "oros-music-stats";
  var doc = w.document;
  // Notices and the tray chip's label. Shares the "music" pack with
  // music.js (same key = same English).
  var STRINGS = {
    en: {
      "host.full": "Storage is full: Music changes were not saved.",
      "host.sleep": "Sleep timer: the music stopped.",
      "host.broken": "These songs cannot play on this device.",
      "host.now": "Now playing: {s}", "host.paused": "Paused: {s}",
      "host.panel": "Music controls", "host.prev": "Previous", "host.next": "Next",
      "host.playBtn": "Play", "host.pauseBtn": "Pause", "host.stop": "Stop",
      "host.open": "Open Music", "host.seek": "Position", "host.volume": "Volume",
      "host.mute": "Mute", "host.unmute": "Unmute"
    },
    el: {
      "host.full": "Ο χώρος αποθήκευσης γέμισε: οι αλλαγές στη Μουσική δεν αποθηκεύτηκαν.",
      "host.sleep": "Χρονοδιακόπτης ύπνου: η μουσική σταμάτησε.",
      "host.broken": "Αυτά τα τραγούδια δεν παίζουν σε αυτή τη συσκευή.",
      "host.now": "Παίζει τώρα: {s}", "host.paused": "Σε παύση: {s}",
      "host.panel": "Χειρισμός μουσικής", "host.prev": "Προηγούμενο", "host.next": "Επόμενο",
      "host.playBtn": "Αναπαραγωγή", "host.pauseBtn": "Παύση", "host.stop": "Διακοπή",
      "host.open": "Άνοιγμα Μουσικής", "host.seek": "Θέση", "host.volume": "Ένταση",
      "host.mute": "Σίγαση", "host.unmute": "Κατάργηση σίγασης"
    }
  };
  // orosI18n (../i18n.js, loaded by the shell): the full language
  // code, a pack language included; else the shell's "el" / "en".
  function lang() {
    var I = w.orosI18n;
    if (I) { try { return I.lang(); } catch (x) {} }
    return w.orosLang === "el" ? "el" : "en";
  }
  // A pack language: English + the music pack. The shell loads only its
  // own pack, so this one is fetched on first need (the Today and search
  // providers read it too); once it is in, the table is rebuilt.
  var packAsked = {};
  function strings(l) {
    if (STRINGS[l]) return STRINGS[l];
    var I = w.orosI18n;
    if (!I) return STRINGS.en;
    var tab = I.table(STRINGS, "music", l);
    if (!packAsked[l] && typeof I.ensure === "function") {
      packAsked[l] = true;
      try { I.ensure(l, "music", function () { if (l !== "en" && l !== "el") delete STRINGS[l]; }); } catch (x) {}
    }
    return tab;
  }
  function T(k, v) {
    var tab = strings(lang()) || STRINGS.en;
    var s = tab[k] !== undefined ? tab[k] : (STRINGS.en[k] !== undefined ? STRINGS.en[k] : k);
    if (v) Object.keys(v).forEach(function (n) { s = s.split("{" + n + "}").join(String(v[n])); });
    return s;
  }

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
        note(T("host.full"));
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

  // ---------- Audio: decks ----------
  // Up to four <audio data-oros-music> elements ("decks"): `audio` is
  // the one playing; another holds the next song loaded early (gapless)
  // or fading in (crossfade). A deck routed through Web Audio (the
  // equalizer, a ReplayGain boost) only ever gets same-origin sources
  // (blob: files and offline copies): a routed element plays a stream
  // from another site without CORS as silence. Streams play on plain
  // decks, where only volume changes apply.
  var decks = [], evs = [];
  function mkDeck() {
    var el = doc.createElement("audio");
    el.setAttribute("data-oros-music", "1");
    el.preload = "auto";
    el.style.display = "none";
    el._blob = ""; el._same = false; el._rg = 1; el._fade = 1; el._node = null; el._gain = null;
    try { doc.body.appendChild(el); } catch (e) {}
    evs.forEach(function (x) { el.addEventListener(x[0], x[1]); });
    // The next song, loaded early, that cannot load: it is never moved
    // on to (that stopped the music), and not loaded again; the queue
    // then loads it the normal way, which recovers or skips it.
    el.addEventListener("error", function () { if (nx && nx.el === el && el !== audio) badNext(); });
    decks.push(el);
    return el;
  }
  // Events count only from the deck that is playing now.
  function on(type, fn) {
    var h = function (e) { if (e.target === audio) fn(e); };
    evs.push([type, h]);
    decks.forEach(function (el) { el.addEventListener(type, h); });
  }
  var audio = mkDeck();
  var cur = null;            // item loaded
  var live = false;          // played since this page opened (the tray chip shows only then)
  var loadSeq = 0;           // a newer load wins
  var artUrl = "", artFor = "";
  var flags = { buffering: false, error: "" };
  var counted = false;       // this play is in the history already
  var fails = 0;             // songs in a row that could not play
  var wantPlay = false;      // the user asked for sound (an error then skips on)
  var rec = { k: "", n: 0 }; // tries used on the song that stopped with an error
  var failSeq = -1;          // the load an error was handled for (one per load)
  var offWait = "";          // key of the stream waiting for the network

  function fs() { return w.orosFS || null; }
  function sameOrigin(u) { return /^blob:/.test(u) || u.indexOf(w.location.origin + "/") === 0; }
  function revoke(u) { if (/^blob:/.test(u || "")) { try { w.URL.revokeObjectURL(u); } catch (e) {} } }
  function setSrc(el, u) {
    if (el._blob && el._blob !== u) revoke(el._blob);
    el._blob = /^blob:/.test(u) ? u : "";
    el._same = sameOrigin(u);
    el.src = u;
  }
  function clearDeck(el) {
    try { el.pause(); } catch (e) {}
    try { el.removeAttribute("src"); el.load(); } catch (e) {}
    revoke(el._blob); el._blob = ""; el._same = false; el._fade = 1;
  }
  function releaseBlob() { decks.forEach(function (el) { if (el !== audio) clearDeck(el); }); revoke(audio._blob); audio._blob = ""; }
  // A deck that can take this source: `prefer` when it can, else a
  // free one (never the one fading out), else a new one.
  function deckFor(u, prefer) {
    var ok = function (el) { return el !== fade.el && (!el._node || sameOrigin(u)); };
    if (prefer && ok(prefer)) return prefer;
    var free = decks.filter(function (el) { return el !== audio && ok(el) && (!nx || el !== nx.el); });
    // Same-origin sources go to a routed deck first, so plain decks stay free for streams.
    free.sort(function (a, b) { return (b._node ? 1 : 0) - (a._node ? 1 : 0); });
    if (sameOrigin(u) && free.length) return free[0];
    var plain = free.filter(function (el) { return !el._node; })[0];
    if (plain) return plain;
    if (decks.length < 4) return mkDeck();
    return free[0] || prefer || audio;
  }
  // → Promise<address> (a blob: address belongs to the caller).
  function sourceFor(item) {
    if (item.p) {
      var F = fs();
      if (!F || typeof F.read !== "function") return Promise.reject(new Error("nofs"));
      return F.read(item.p).then(function (blob) { return w.URL.createObjectURL(blob); });
    }
    if (item.u && /^https:\/\//i.test(item.u)) {
      // A song from an open catalogue: its offline copy when there is
      // one, else it streams straight from the source.
      if (!ST || typeof ST.getOff !== "function") return Promise.resolve(item.u);
      return ST.getOff(item.k).then(function (blob) { return blob ? w.URL.createObjectURL(blob) : item.u; }, function () { return item.u; });
    }
    if (item.s === "sv") {
      // A song of the user's own server (servers.js knows the login).
      return servers().then(function (SV) { return SV.source(item); }).then(function (src) {
        return typeof src === "string" ? src : w.URL.createObjectURL(src);
      });
    }
    return Promise.reject(new Error("nosrc"));
  }
  // ReplayGain tags of a song on this device (the index has them).
  function rgFor(item) {
    if (!item.p || !ST || typeof ST.getTrack !== "function") return Promise.resolve(null);
    return ST.getTrack(item.p).then(function (r) { return (r && r.rg) || null; }, function () { return null; });
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

  // ListenBrainz with my own account (lb.js, wave 6d): loaded only
  // when this device has an account set; "playing now" when a song
  // starts, a listen after half of it or four minutes.
  var LB_PREF = "oros-music-lb", lbWait = null, lbNow = false, lbDone = false, lbAt = 0;
  var lbSet = (function () { try { return !!w.localStorage.getItem(LB_PREF); } catch (e) { return false; } })();
  try { w.addEventListener("storage", function (e) { if (!e || e.key === LB_PREF || e.key === null) { try { lbSet = !!w.localStorage.getItem(LB_PREF); } catch (x) { lbSet = false; } } }); } catch (e) {}
  function lbLib() {
    if (w.OrosMusicLB) return Promise.resolve(w.OrosMusicLB);
    if (lbWait) return lbWait;
    lbWait = new Promise(function (resolve, reject) {
      var s = doc.createElement("script");
      s.src = hostSrc ? hostSrc.replace(/host\.js(\?|$)/, "lb.js$1") : "music/lb.js";
      s.onload = function () {
        var L = w.OrosMusicLB;
        if (!L) { lbWait = null; reject(new Error("lb")); return; }
        var m = /[?&]v=([0-9.]{1,20})/.exec(hostSrc || "");
        L.setVersion(m ? m[1] : "");
        resolve(L);
      };
      s.onerror = function () { lbWait = null; s.remove(); reject(new Error("lb")); };
      doc.head.appendChild(s);
    });
    return lbWait;
  }
  function lbReset() { lbNow = false; lbDone = false; lbAt = Date.now(); }
  function lbTick() {
    if (!lbSet || !cur || lbDone) return;
    var item = cur;
    if (!lbNow) { lbNow = true; lbLib().then(function (L) { return L.send("playing_now", item); }).catch(function () {}); }
    var d = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : item.d || 0;
    if (!w.OrosMusicLB || local.pos < w.OrosMusicLB.listenAt(d)) return;
    lbDone = true;
    var at = lbAt;
    lbLib().then(function (L) { return L.send("single", Object.assign({}, item, { d: item.d || Math.round(d) }), at); }).catch(function () {});
  }

  // ---------- Sound: equalizer, ReplayGain, volume ----------
  var SOUND_KEY = "oros-music-sound";
  var sound = (function () { try { return C.normSound(JSON.parse(w.localStorage.getItem(SOUND_KEY) || "null")); } catch (e) { return C.normSound(null); } })();
  var ctx = null, eqNodes = [], master = null;
  function graph() {
    if (ctx) return ctx;
    var AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      eqNodes = C.EQ_HZ.map(function (hz, i) {
        var f = ctx.createBiquadFilter();
        f.type = i === 0 ? "lowshelf" : i === C.EQ_HZ.length - 1 ? "highshelf" : "peaking";
        f.frequency.value = hz;
        f.Q.value = 1.1;
        return f;
      });
      for (var i = 0; i < eqNodes.length - 1; i++) eqNodes[i].connect(eqNodes[i + 1]);
      eqNodes[eqNodes.length - 1].connect(master);
      master.connect(ctx.destination);
      paintEq();
    } catch (e) { ctx = null; }
    return ctx;
  }
  function paintEq() {
    if (!ctx) return;
    var g = sound.eq.on ? sound.eq.g : [];
    eqNodes.forEach(function (f, i) { f.gain.value = +g[i] || 0; });
    master.gain.value = Math.pow(10, (sound.eq.on ? C.eqPreamp(sound.eq.g) : 0) / 20);
  }
  // Route a deck through the graph (once; it stays routed).
  function route(el) {
    if (el._node || !el._same || !graph()) return !!el._node;
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    try {
      el._node = ctx.createMediaElementSource(el);
      el._gain = ctx.createGain();
      el._node.connect(el._gain);
      el._gain.connect(eqNodes[0]);
    } catch (e) { el._node = null; el._gain = null; }
    return !!el._node;
  }
  function fromAlbum() { var q = C.normQueue(local.q); return !!(q.src && /^(album|ia|jm|sva)$/.test(q.src.kind)); }
  // The ReplayGain factor of the deck's song, then the deck's volume.
  function gainFor(el, rgd) {
    el._rgd = rgd || null;
    el._rg = C.rgFactor(el._rgd, sound.rg, fromAlbum(), sound.pre);
    if ((sound.eq.on || el._rg > 1) && el._same) route(el);
    vol(el);
  }
  function vol(el) {
    var f = el._fade * sleepFade;
    if (el._node && el._gain) { el._gain.gain.value = el._rg; el.volume = Math.max(0, Math.min(1, local.vol * f)); }
    else el.volume = Math.max(0, Math.min(1, local.vol * Math.min(1, el._rg) * f));
  }
  function volAll() { decks.forEach(vol); }
  function setSound(patch) {
    var next = C.normSound(Object.assign({}, sound, own(patch) || {}));
    if (patch && patch.eq) next.eq = C.normSound({ eq: Object.assign({}, sound.eq, own(patch.eq)) }).eq;
    sound = next;
    try { w.localStorage.setItem(SOUND_KEY, JSON.stringify(sound)); } catch (e) {}
    paintEq();
    decks.forEach(function (el) { if (el.getAttribute("src")) gainFor(el, el._rgd); });
    if (!sound.xf && !sound.gap) dropNext();
    host.notify("sound");
  }

  // ---------- Crossfade, gapless, sleep timer ----------
  var nx = null;             // { el, item, seq, ready } the next song, loaded early
  var nxSeq = 0;
  var fade = { el: null, iv: 0 };
  var sleep = { at: 0, end: 0 }, sleepFade = 1, sleepIv = 0;
  function badNext() {
    if (!nx) return;
    var el = nx.el;
    nx.el = null; nx.ready = false; nx.bad = true;
    if (el && el !== audio && el !== fade.el) clearDeck(el);
  }
  function dropNext() {
    if (!nx) return;
    nxSeq++;
    if (nx.el && nx.el !== audio) clearDeck(nx.el);
    nx = null;
  }
  function stopFade() {
    if (!fade.el) return;
    w.clearInterval(fade.iv);
    var el = fade.el;
    fade.el = null; fade.iv = 0;
    if (el !== audio) clearDeck(el);
    audio._fade = 1;
    vol(audio);
  }
  function peekNext() {
    var q = C.normQueue(local.q);
    if (q.rep === "one" || sleep.end) return null;
    return C.qNext(local.q, false).item;
  }
  // Load the next song on a free deck, paused, a little before the end.
  function prepareNext() {
    var item = peekNext();
    if (!item || (nx && nx.item.k === item.k)) return;
    dropNext();
    var my = ++nxSeq;
    nx = { el: null, item: item, seq: my, ready: false };
    Promise.all([sourceFor(item), rgFor(item)]).then(function (r) {
      if (!nx || nx.seq !== my) { revoke(r[0]); return; }
      var el = deckFor(r[0], null);
      if (el === audio || el === fade.el) { revoke(r[0]); nx = null; return; }
      nx.el = el;
      el._fade = sound.xf ? 0 : 1;
      setSrc(el, r[0]);
      gainFor(el, r[1]);
      try { el.load(); } catch (e) {}
      nx.ready = true;
    }, function () { if (nx && nx.seq === my) nx = null; });
  }
  // Move on to the loaded next song: at once (gapless), or fading over
  // `sec` seconds while the current one fades out. → false when the
  // queue's next song is not the loaded one.
  function useNext(sec) {
    var n = nx;
    if (!n || !n.ready) return false;
    if (n.el.error) { badNext(); return false; }
    var r = C.qNext(local.q, false);
    if (!r.item || r.item.k !== n.item.k) { dropNext(); return false; }
    nx = null;
    stopFade();
    loadSeq++;
    var old = audio;
    audio = n.el;
    setQueue(r.q);
    cur = r.item;
    counted = false;
    lbReset();
    fails = 0;
    flags.error = ""; flags.buffering = false;
    local.pos = 0;
    if (sec > 0) {
      fade.el = old;
      var t0 = Date.now(), ms = sec * 1000;
      audio._fade = 0; vol(audio);
      fade.iv = w.setInterval(function () {
        var x = (Date.now() - t0) / ms;
        if (fade.el) { fade.el._fade = C.fadeOut(x); vol(fade.el); }
        audio._fade = C.fadeIn(x); vol(audio);
        if (x >= 1) stopFade();
      }, 50);
    } else {
      clearDeck(old);
      audio._fade = 1; vol(audio);
    }
    saveLocal(true);
    media();
    var p;
    try { p = audio.play(); } catch (e) { p = null; }
    Promise.resolve(p).catch(function (err) { playFailed(err); });
    chip();
    host.notify("load");
    return true;
  }
  // Called on every time update of the playing deck.
  function nearEnd() {
    if (!wantPlay || audio.paused || fade.el) return;
    var d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    var left = d - (audio.currentTime || 0), xf = sound.xf;
    if ((sound.gap || xf) && left < Math.max(15, xf + 6)) prepareNext();
    // No crossfade into or out of very short songs (jingles, intros).
    if (xf && nx && nx.ready && left <= xf && d > xf * 2 + 5 && !sleep.end) useNext(Math.min(xf, left));
  }
  function sleepTick() {
    if (!sleep.at) return;
    var left = sleep.at - Date.now();
    sleepFade = left < 10000 ? Math.max(0, left / 10000) : 1;
    volAll();
    if (left <= 0) sleepDone();
  }
  function sleepDone() {
    sleepSet(0);
    pause();
    note(T("host.sleep"));
  }
  // v: minutes, "end" (end of this song) or 0 (off).
  function sleepSet(v) {
    w.clearInterval(sleepIv); sleepIv = 0;
    sleep = { at: 0, end: 0 };
    if (v === "end") sleep.end = 1;
    else if (+v > 0) { sleep.at = Date.now() + Math.min(600, +v) * 60000; sleepIv = w.setInterval(sleepTick, 1000); }
    sleepFade = 1;
    if (sleep.end) dropNext();
    volAll();
    host.notify("sleep");
  }

  function load(item, start, autoplay) {
    if (!item) return Promise.resolve(false);
    var my = ++loadSeq;
    stopFade();
    dropNext();
    cur = item;
    counted = false;
    lbReset();
    flags.error = ""; flags.buffering = true;
    try { audio.pause(); } catch (e) {}
    media();
    host.notify("load");
    return Promise.all([sourceFor(item), rgFor(item)]).then(function (r) {
      var src = r[0];
      if (my !== loadSeq) { revoke(src); return false; }
      var el = deckFor(src, audio);
      if (el !== audio) { clearDeck(audio); audio = el; }
      audio._fade = 1;
      setSrc(audio, src);
      gainFor(audio, r[1]);
      var at = +start > 0 ? +start : 0;
      if (at) {
        var a = audio, seek = function () { a.removeEventListener("loadedmetadata", seek); if (!isFinite(a.duration) || at < a.duration - 2) { try { a.currentTime = at; } catch (e) {} } };
        a.addEventListener("loadedmetadata", seek);
      }
      saveLocal(true);
      return autoplay ? play() : true;
    }, function () {
      if (my !== loadSeq) return false;
      if (autoplay) wantPlay = true;
      fail("missing");
      return false;
    });
  }
  // A song that cannot play is skipped, like other players do; after
  // five in a row (or the whole list) it stops and says so.
  // → true when it moves on (the notice then names the skipped song).
  function skipBroken() {
    fails++;
    var n = C.normQueue(local.q).ctx.length;
    if (fails >= 5 || fails > n) { fails = 0; note(T("host.broken")); return false; }
    w.setTimeout(function () { advance(true, true); }, 600);
    return true;
  }
  function play() {
    if (!cur) return Promise.resolve(false);
    wantPlay = true;
    failSeq = -1;   // a tap on play is a new try, also after an error
    focusTake();
    if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    var p;
    try { p = audio.play(); } catch (e) { p = null; }
    return Promise.resolve(p).then(function () { return true; }, function (err) {
      playFailed(err);
      return false;
    });
  }
  // play() refused: NotAllowedError = no sound allowed without a tap
  // (the app shows the play button); AbortError = a newer load took
  // over; anything else = the song cannot play (its "error" event
  // usually comes too: fail() handles one load only once).
  function playFailed(err) {
    var name = (err && err.name) || "play";
    if (name === "AbortError") return;
    if (name === "NotAllowedError") { flags.error = name; flags.buffering = false; chip(); host.notify("error"); return; }
    fail(name);
  }
  // ---------- Recovery: the song stopped with an error ----------
  // A stream gets two more tries (Jamendo with a fresh address, since
  // its addresses go stale), from where it stopped; offline it waits
  // for the network; else it is skipped, like other players do. The
  // notice ("cannot play here") shows only when it gives up.
  function fail(kind) {
    if (!cur || failSeq === loadSeq) return;
    failSeq = loadSeq;
    var item = cur, my = loadSeq;
    flags.buffering = false;
    if (!wantPlay) { flags.error = kind; chip(); host.notify("error"); return; }
    if (rec.k !== item.k) rec = { k: item.k, n: 0 };
    var step = C.failStep(item, rec.n, w.navigator.onLine);
    if (step === "wait") { offWait = item.k; flags.buffering = true; chip(); host.notify("buffer"); return; }
    if (step === "retry") {
      rec.n++;
      flags.buffering = true; host.notify("buffer");
      var at = local.pos || 0;
      freshUrl(item).then(function (u) {
        if (my !== loadSeq || cur !== item || !wantPlay) return;
        if (u && u !== item.u) { item.u = u; saveLocal(); }
        load(item, at, true);
      });
      return;
    }
    flags.error = kind; chip();
    var on = skipBroken();
    host.notify("error", on ? { skip: String(item.t || "") } : null);
  }
  // Same public client id as open.js (Chris's, registered 2026-10-16).
  var JM_CLIENT = "e04c6e83";
  function freshUrl(item) {
    var id = C.jmTrackId(item);
    if (!id || typeof w.fetch !== "function") return Promise.resolve(item.u);
    var ac = typeof w.AbortController === "function" ? new w.AbortController() : null;
    var tm = ac ? w.setTimeout(function () { ac.abort(); }, 8000) : 0;
    var url = "https://api.jamendo.com/v3.0/tracks/?client_id=" + JM_CLIENT + "&format=json&audioformat=mp32&id=" + id;
    return w.fetch(url, ac ? { signal: ac.signal, credentials: "omit" } : { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { w.clearTimeout(tm); return C.jmFreshAudio(j, id) || item.u; }, function () { w.clearTimeout(tm); return item.u; });
  }
  // A stream that waits for data for 30 s while online (the server or
  // the connection hung without an error) is handled like an error.
  var stallT = 0;
  function stallClear() { if (stallT) { w.clearTimeout(stallT); stallT = 0; } }
  function stallArm() {
    stallClear();
    var my = loadSeq;
    stallT = w.setTimeout(function () {
      stallT = 0;
      if (my === loadSeq && cur && wantPlay && flags.buffering && !audio.paused) fail("stall");
    }, 30000);
  }
  w.addEventListener("online", function () {
    if (!offWait || !cur || cur.k !== offWait || !wantPlay) { offWait = ""; return; }
    offWait = "";
    load(cur, local.pos || 0, true);
  });
  function pause() { wantPlay = false; stopFade(); try { audio.pause(); } catch (e) {} }
  function seekTo(t) {
    if (!cur) return;
    stopFade();
    var d = isFinite(audio.duration) ? audio.duration : cur.d || 0;
    t = Math.max(0, d ? Math.min(t, d - 0.5) : t);
    try { audio.currentTime = t; } catch (e) {}
    local.pos = t;
    saveLocal();
    posState();
    host.notify("time");
  }
  function setQueue(q) { dropNext(); local.q = C.normQueue(q); saveLocal(); }
  // Next song: manual = the Next button (moves on even on repeat one).
  function advance(manual, auto) {
    if (!manual && (sound.gap || sound.xf) && useNext(0)) return;
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
    live = false;            // nothing left to play: the bar lets go of the chip
    chip();
    host.notify("end");
  }
  // Sleep timer "end of this song": the next song waits, paused.
  function sleepAtEnd() {
    sleepSet(0);
    var r = C.qNext(local.q, false);
    setQueue(r.q);
    wantPlay = false;
    if (!r.item) { stopAtEnd(); return; }
    local.pos = 0;
    load(r.item, 0, false).then(chip);
    note(T("host.sleep"));
  }
  function stop() {
    loadSeq++;
    stopFade();
    dropNext();
    pause();
    clearDeck(audio);
    releaseBlob();
    cur = null;
    live = false;
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
    var now = Date.now();
    local.hist = C.addPlay(local.hist, cur, now);
    saveLocal();
    // Yearly listening stats (recap, mixes, the Today line).
    if (typeof C.addStat === "function") {
      try {
        var d = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : cur.d || 0;
        var st = C.addStat(C.normStats(JSON.parse(w.localStorage.getItem(STATS_KEY) || "null")), cur, d, now);
        w.localStorage.setItem(STATS_KEY, JSON.stringify(st));
      } catch (e) {}
    }
  }
  on("timeupdate", function () {
    if (!cur) return;
    local.pos = audio.currentTime || 0;
    if (!counted && local.pos >= 30) countPlay();
    lbTick();
    saveLocal();
    posState();
    nearEnd();
    host.notify("time");
  });
  on("loadedmetadata", function () {
    if (cur && cur.p && !cur.d && isFinite(audio.duration) && audio.duration > 0 && ST) {
      cur.d = Math.round(audio.duration);
      ST.setDuration(cur.p, audio.duration).then(function (ch) { if (ch) host.notify("index"); });
    }
    posState();
  });
  on("pause", function () { stallClear(); saveLocal(true); chip(); host.notify("pause"); });
  on("playing", function () { live = true; stallClear(); flags.buffering = false; flags.error = ""; fails = 0; offWait = ""; chip(); host.notify("play"); });
  on("play", function () { hookOthers(); });
  on("waiting", function () { flags.buffering = true; stallArm(); host.notify("buffer"); });
  on("canplay", function () { flags.buffering = false; host.notify("buffer"); });
  on("error", function () {
    if (!cur || !audio.getAttribute("src")) return;
    fail("media");
  });
  on("ended", function () {
    rec = { k: "", n: 0 };
    countPlay();
    if (sleep.end) { sleepAtEnd(); return; }
    advance(false);
  });

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
  on("play", handlers);

  // ---------- Tray chip ----------
  var ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/>' +
    '<circle cx="18" cy="16" r="3"/></svg>';
  function chip() {
    var el = doc.getElementById("mu-tray-chip");
    var bar = doc.querySelector(".bar-right");
    // Shown while a song plays, or pauses after it played here. The
    // song last session left comes back paused but shows no chip until
    // it plays again, so an idle bar carries no music icon.
    if (!cur || !live || !bar) { if (el) el.remove(); popClose(); return; }
    if (!doc.getElementById("mu-host-css")) {
      var st = doc.createElement("style");
      st.id = "mu-host-css";
      st.textContent = "#mu-tray-chip{display:inline-flex;align-items:center;min-height:44px;background:transparent;" +
        "border:none;color:var(--text-dim);padding:0 10px;cursor:pointer}#mu-tray-chip[data-state=on]{color:var(--accent)}" +
        "#mu-tray-chip[data-state=err]{color:var(--danger)}" +
        "#mu-tray-pop{position:fixed;top:calc(48px + env(safe-area-inset-top,0px));right:8px;z-index:1460;" +
        "width:300px;max-width:calc(100vw - 16px);box-sizing:border-box;background:var(--panel-bg);color:var(--text);" +
        "border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 24px var(--shadow);padding:12px;" +
        "display:flex;flex-direction:column;gap:10px}" +
        "#mu-tray-pop .mu-p-t{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        "#mu-tray-pop .mu-p-a{font-size:12px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}" +
        "#mu-tray-pop .mu-p-row{display:flex;align-items:center;gap:6px}" +
        "#mu-tray-pop .mu-p-row.c{justify-content:space-between}" +
        "#mu-tray-pop .mu-p-tm{font-size:11px;color:var(--text-dim);min-width:36px;font-variant-numeric:tabular-nums}" +
        "#mu-tray-pop .mu-p-tm.r{text-align:right}" +
        "#mu-tray-pop input[type=range]{flex:1;min-width:0;accent-color:var(--accent);cursor:pointer;margin:0;height:32px}" +
        "#mu-tray-pop button{min-width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;" +
        "border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--text);cursor:pointer;padding:0}" +
        "#mu-tray-pop button.pp{background:var(--accent);color:var(--accent-ink,#fff);border-color:var(--accent)}" +
        "#mu-tray-pop button:disabled{opacity:.4;cursor:default}";
      doc.head.appendChild(st);
    }
    if (!el) {
      el = doc.createElement("button");
      el.id = "mu-tray-chip";
      el.type = "button";
      el.innerHTML = ICON;                    // constant markup, no data in it
      el.setAttribute("aria-haspopup", "true");
      el.setAttribute("aria-expanded", "false");
      // MU-PANEL: a tap opens the control panel (play/pause is inside).
      el.addEventListener("click", function (e) { e.stopPropagation(); popToggle(); });
      bar.insertBefore(el, doc.getElementById("pc-tray-chip") || doc.getElementById("rx-tray-chip") || doc.getElementById("btn-lang"));
    }
    var on = !audio.paused, err = !!flags.error;
    var title = T(on ? "host.now" : "host.paused", { s: (cur.t || "") + (cur.a ? " · " + cur.a : "") });
    el.setAttribute("data-state", err ? "err" : on ? "on" : "off");
    el.title = title;                         // property: plain text, safe
    el.setAttribute("aria-label", title);
    popPaint();
  }

  // ---------- Tray panel (MU-PANEL) ----------
  // The chip opens a small panel under the bar: the song, its position,
  // previous / play-pause / next, stop, open Music, volume and mute.
  // Every control calls the same functions as the app and the lock
  // screen, so nothing new is stored: the volume is local.vol, a mute
  // keeps the volume it had in memory to come back to. While the panel
  // is open it repaints twice a second (decks swap on crossfades, so it
  // reads the state rather than listening to one audio element).
  var POP_ID = "mu-tray-pop";
  var popTimer = 0, popWired = false, muteFrom = 0;
  var SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var IC = {
    prev: SVG + '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>',
    next: SVG + '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>',
    play: SVG + '<polygon points="6 4 20 12 6 20 6 4"/></svg>',
    pause: SVG + '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    stop: SVG + '<rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    open: SVG + '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/>' +
      '<line x1="10" y1="14" x2="21" y2="3"/></svg>',
    vol: SVG + '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>' +
      '<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
    mute: SVG + '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/>' +
      '<line x1="17" y1="9" x2="23" y2="15"/></svg>'
  };
  function popEl() { return doc.getElementById(POP_ID); }
  function popClose() {
    var p = popEl();
    if (p) p.remove();
    if (popTimer) { w.clearInterval(popTimer); popTimer = 0; }
    var c = doc.getElementById("mu-tray-chip");
    if (c) c.setAttribute("aria-expanded", "false");
  }
  function popWire() {
    if (popWired) return;
    popWired = true;
    doc.addEventListener("click", function (e) {
      var p = popEl();
      if (!p || p.contains(e.target)) return;
      var c = doc.getElementById("mu-tray-chip");
      if (c && c.contains(e.target)) return;
      popClose();
    });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && popEl()) popClose(); });
    // A tap inside an app frame never reaches this document: the shell
    // window losing focus to it closes the panel instead.
    w.addEventListener("blur", function () {
      w.setTimeout(function () { var a = doc.activeElement; if (a && a.tagName === "IFRAME") popClose(); }, 0);
    });
  }
  function popBtn(cls, fn) {
    var b = doc.createElement("button");
    b.type = "button";
    b.className = cls;
    b.addEventListener("click", fn);
    return b;
  }
  function popToggle() {
    if (popEl()) { popClose(); return; }
    if (!cur) return;
    popWire();
    var p = doc.createElement("div");
    p.id = POP_ID;
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", T("host.panel"));
    // Clicks inside stay inside (the buttons repaint their own icons).
    p.addEventListener("click", function (e) { e.stopPropagation(); });

    var head = doc.createElement("div");
    var t = doc.createElement("div"); t.className = "mu-p-t";
    var a = doc.createElement("div"); a.className = "mu-p-a";
    head.appendChild(t); head.appendChild(a);
    p.appendChild(head);

    var sr = doc.createElement("div"); sr.className = "mu-p-row";
    var at = doc.createElement("span"); at.className = "mu-p-tm";
    var sk = doc.createElement("input");
    sk.type = "range"; sk.min = "0"; sk.step = "1"; sk.className = "mu-p-seek";
    sk.setAttribute("aria-label", T("host.seek"));
    var dt = doc.createElement("span"); dt.className = "mu-p-tm r";
    sk.addEventListener("input", function () { at.textContent = C.fmtTime(+sk.value); });
    sk.addEventListener("change", function () { seekTo(+sk.value); popPaint(); });
    sr.appendChild(at); sr.appendChild(sk); sr.appendChild(dt);
    p.appendChild(sr);

    var cr = doc.createElement("div"); cr.className = "mu-p-row c";
    cr.appendChild(popBtn("prv", function () { prev(); popPaint(); }));
    cr.appendChild(popBtn("pp", function () { if (!cur) return; if (audio.paused) play(); else pause(); popPaint(); }));
    cr.appendChild(popBtn("nxt", function () { if (cur || C.normQueue(local.q).ctx.length) advance(true); popPaint(); }));
    cr.appendChild(popBtn("stp", function () { popClose(); stop(); }));
    cr.appendChild(popBtn("opn", function () {
      popClose();
      if (typeof w.__orosOpenApp === "function") { try { w.__orosOpenApp("music"); } catch (e) {} }
    }));
    p.appendChild(cr);

    var vr = doc.createElement("div"); vr.className = "mu-p-row";
    vr.appendChild(popBtn("mut", function () {
      if (local.vol > 0) { muteFrom = local.vol; host.api.setVolume(0); }
      else host.api.setVolume(muteFrom > 0 ? muteFrom : 1);
      popPaint();
    }));
    var vo = doc.createElement("input");
    vo.type = "range"; vo.min = "0"; vo.max = "100"; vo.step = "1"; vo.className = "mu-p-vol";
    vo.setAttribute("aria-label", T("host.volume"));
    var pc = doc.createElement("span"); pc.className = "mu-p-tm r";
    vo.addEventListener("input", function () {
      var v = Math.max(0, Math.min(100, parseInt(vo.value, 10) || 0));
      host.api.setVolume(v / 100);
      pc.textContent = v + "%";
      popPaint();
    });
    vr.appendChild(vo); vr.appendChild(pc);
    p.appendChild(vr);

    doc.body.appendChild(p);
    var c = doc.getElementById("mu-tray-chip");
    if (c) c.setAttribute("aria-expanded", "true");
    popPaint();
    popTimer = w.setInterval(popPaint, 500);
  }
  // Labels go in through textContent / title / aria-label only.
  function setTip(b, ic, tip) {
    if (b.getAttribute("data-ic") !== ic) {
      b.innerHTML = IC[ic];                   // constant icon markup
      b.setAttribute("data-ic", ic);
    }
    if (b.title !== tip) { b.title = tip; b.setAttribute("aria-label", tip); }
  }
  function popPaint() {
    var p = popEl();
    if (!p) return;
    if (!cur) { popClose(); return; }
    var q = C.normQueue(local.q);
    var t = p.querySelector(".mu-p-t"), a = p.querySelector(".mu-p-a");
    var tt = cur.t || "", aa = [cur.a, cur.al].filter(Boolean).join(" · ");
    if (t.textContent !== tt) t.textContent = tt;
    if (a.textContent !== aa) a.textContent = aa;
    var pos = audio.currentTime || 0;
    var dur = isFinite(audio.duration) && audio.duration ? audio.duration : (cur.d || 0);
    var sk = p.querySelector(".mu-p-seek"), tms = p.querySelectorAll(".mu-p-tm");
    sk.disabled = !dur;
    sk.max = String(Math.max(1, Math.floor(dur)));
    if (doc.activeElement !== sk) {
      sk.value = String(Math.floor(Math.min(pos, dur || pos)));
      tms[0].textContent = C.fmtTime(pos);
    }
    tms[1].textContent = dur ? C.fmtTime(dur) : "";
    var paused = audio.paused;
    setTip(p.querySelector(".prv"), "prev", T("host.prev"));
    setTip(p.querySelector(".pp"), paused ? "play" : "pause", T(paused ? "host.playBtn" : "host.pauseBtn"));
    var nx = p.querySelector(".nxt");
    setTip(nx, "next", T("host.next"));
    nx.disabled = !(q.up.length || q.at + 1 < q.ctx.length || q.rep !== "off");
    setTip(p.querySelector(".stp"), "stop", T("host.stop"));
    setTip(p.querySelector(".opn"), "open", T("host.open"));
    var muted = !(local.vol > 0);
    setTip(p.querySelector(".mut"), muted ? "mute" : "vol", T(muted ? "host.unmute" : "host.mute"));
    var vo = p.querySelector(".mu-p-vol"), v = Math.round((local.vol || 0) * 100);
    if (doc.activeElement !== vo && +vo.value !== v) vo.value = String(v);
    tms[2].textContent = v + "%";
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
    get audio() { return audio; },
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
    setVolume: function (v) { v = +v; if (v >= 0 && v <= 1) { local.vol = v; volAll(); saveLocal(); host.notify("volume"); } },
    sound: function () { return own(sound); },
    setSound: setSound,
    sleep: function (v) { sleepSet(v === "end" ? "end" : +v || 0); },
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
        buffering: flags.buffering, error: flags.error, shf: q.shf, rep: q.rep, vol: local.vol, src: q.src,
        sleep: { at: sleep.at, end: sleep.end }, eq: sound.eq.on && !!audio._node,
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

  // A pack language: fetch the music pack now, before the first notice
  // (the Today and search providers read it from the shell too).
  try { strings(lang()); } catch (e) {}

  // Shell boot order: sync.js may not have run its setup yet.
  if (!register()) {
    var tries = 0, iv = w.setInterval(function () { if (register() || ++tries > 40) w.clearInterval(iv); }, 250);
  }
})(window);
