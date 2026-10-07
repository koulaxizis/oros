// ============================================================
// orOS Radio — v0.2 (Wave 2)
// Shell-hosted audio (survives app close) + Media Session API
// + Sleep Timer. Single IIFE (FIX-W2-0).
// Model: RADIO v1 { ver, favorites[], deleted{} }
// Slice: oros-radio-data · Recents: device-local
// ============================================================

var SCRIPT_V = "";
(function(){ var m=(document.currentScript && document.currentScript.src||"").match(/[?&]v=([^&#]+)/);
  SCRIPT_V=m?m[1]:""; console.log("radio.js v"+(SCRIPT_V||"?")+" boot"); })();

(function(){
"use strict";

/* ===== CONFIG ===== */

var RADIO_VERSION = 1;
var STORAGE_KEY   = "oros-radio-data";     // synced slice
var RECENTS_KEY   = "oros-radio-recents"; // device-local, never synced
var RECENTS_CAP   = 20;
var CACHE_TTL_MS  = 30 * 60 * 1000;
var CACHE_PREFIX  = "oros-radio-cache:";
var RB_MIRRORS    = [
  "https://de1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
  "https://fi1.api.radio-browser.info"
];
var SLEEP_PRESETS = [15, 30, 60, 90];
var SLEEP_TICK_MS = 15000; // battery rule: purpose-sized, self-clearing

/* ===== I18N (inline STRINGS — Bible Part VI) ===== */

var STRINGS = {
  en: {
    "tab.countries":  "Countries",
    "tab.genres":     "Genres",
    "tab.favorites":  "Favorites",
    "tab.recents":    "Recent",
    "view.countries": "Browse by Country",
    "view.genres":    "Browse by Genre",
    "view.favorites": "Your Favorites",
    "view.recents":   "Recently Played",
    "search.ph":      "Search stations…",
    "search.results": "Results for",
    "noresults":      "No stations found",
    "nofavorites":    "No favorites yet — tap the heart on any station",
    "norecents":      "Nothing here yet — start listening",
    "stations":       "stations",
    "play":           "Play",
    "pause":          "Pause",
    "favorite":       "Add to favorites",
    "unfavorite":    "Remove from favorites",
    "fav.added":      "Added to favorites",
    "fav.removed":    "Removed from favorites",
    "err.stream":     "Stream unavailable",
    "buffering":      "Buffering…",
    "offline.hint":   "Offline — showing last known data. Playback needs a connection.",
    "sleep.title":    "Sleep timer",
    "sleep.off":      "Turn off",
    "sleep.set":      "Playback stops after {n} min",
    "sleep.remaining":"{n} min left",
    "sleep.stopped":  "Playback stopped — sleep timer",
    "stop":           "Stop",
    "tab.discover":   "Discover",
    "view.discover":  "Top Stations Worldwide",
    "random":         "Surprise me",
    "random.hint":    "Play a random top station",
    "catalog.err":    "Couldn't reach the station directory — check your connection or blockers.",
    "sleep.min":      "{n} min",
    "recents.clear":  "Clear recent stations",
    "recents.cleared":"Recent stations cleared",
    "undo":           "Undo"
  },
  el: {
    "tab.countries":  "Χώρες",
    "tab.genres":     "Είδη",
    "tab.favorites":  "Αγαπημένα",
    "tab.recents":    "Πρόσφατα",
    "view.countries": "Αναζήτηση ανά Χώρα",
    "view.genres":    "Αναζήτηση ανά Είδος",
    "view.favorites": "Τα Αγαπημένα σου",
    "view.recents":   "Πρόσφατα",
    "search.ph":      "Αναζήτηση σταθμών…",
    "search.results": "Αποτελέσματα για",
    "noresults":      "Δεν βρέθηκαν σταθμοί",
    "nofavorites":    "Δεν υπάρχουν αγαπημένα — πάτα την καρδιά σε κάποιο σταθμό",
    "norecents":      "Τίποτα εδώ ακόμα — άρχισε να ακούς",
    "stations":       "σταθμοί",
    "play":           "Αναπαραγωγή",
    "pause":          "Παύση",
    "favorite":       "Προσθήκη στα αγαπημένα",
    "unfavorite":     "Αφαίρεση από τα αγαπημένα",
    "fav.added":      "Προστέθηκε στα αγαπημένα",
    "fav.removed":    "Αφαιρέθηκε από τα αγαπημένα",
    "err.stream":     "Μη διαθέσιμο stream",
    "buffering":      "Φόρτωση…",
    "offline.hint":   "Εκτός σύνδεσης — εμφανίζονται τα τελευταία γνωστά. Η αναπαραγωγή απαιτεί σύνδεση.",
    "sleep.title":    "Χρονοδιακόπτης ύπνου",
    "sleep.off":      "Απενεργοποίηση",
    "sleep.set":      "Η αναπαραγωγή σταματά σε {n} λεπτά",
    "sleep.remaining":"απομένουν {n} λεπτά",
    "sleep.stopped":  "Η αναπαραγωγή σταμάτησε — χρονοδιακόπτης ύπνου",
    "stop":           "Διακοπή",
    "tab.discover":   "Ανακάλυψη",
    "view.discover":  "Κορυφαίοι σταθμοί παγκοσμίως",
    "random":         "Τυχαίος σταθμός",
    "random.hint":    "Παίξε έναν τυχαίο κορυφαίο σταθμό",
    "catalog.err":    "Αποτυχία σύνδεσης με τον κατάλογο σταθμών — έλεγξε τη σύνδεση ή τυχόν blockers.",
    "sleep.min":      "{n} λεπτά",
    "recents.clear":  "Εκκαθάριση πρόσφατων σταθμών",
    "recents.cleared":"Οι πρόσφατοι σταθμοί εκκαθαρίστηκαν",
    "undo":           "Αναίρεση"
  }
};

function activeLang(){
  try{ return (window.parent && window.parent.orosLang) || window.orosLang || "en"; }
  catch(e){ return window.orosLang || "en"; }
}

function t(key){
  var pack = STRINGS[activeLang()] || STRINGS.en;
  return pack[key] !== undefined ? pack[key]
       : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
}

function fmt(key, n){
  return String(t(key)).replace("{n}", n);
}

/* ===== HELPERS ===== */

function $(id){ return document.getElementById(id); }

function esc(str){
  if(typeof str !== "string") str = String(str == null ? "" : str);
  return str.replace(/[&<>"']/g, function(m){
    switch(m){
      case "&": return "&amp;"; case "<": return "&lt;";
      case ">": return "&gt;"; case '"': return "&quot;";
      case "'": return "&#39;";
    }
    return m;
  });
}

function normalizeStation(s){
  // Payload whitelisting: only what we ever consume crosses the host boundary
  return {
    stationuuid:  s.stationuuid || "",
    name:         s.name || "",
    url_resolved: s.url_resolved || s.url || "",
    homepage:     s.homepage || "",
    favicon:      s.favicon || "",
    codec:        (s.codec || "").toUpperCase(),
    bitrate:      s.bitrate || 0,
    country:      s.country || "",
    countrycode:  s.countrycode || "",
    votes:        s.votes || 0,
    // RX-7: kept for the country tag chips + favorites (the API cache
    // now stores normalized rows, not the ~30-field API objects)
    tags:         Array.isArray(s.tags) ? s.tags.join(",") : String(s.tags || "")
  };
}

/* ===== STATE ===== */

var state = {
  viewMode: "discover",      // discover | countries | genres | favorites | recents | stations | search
  tagFilter: "",             // active tag chip filter inside country views (W3-8)
  parent: null,             // { type:"country"|"genre", code|tag, name }
  data: null,               // full slice { ver, favorites[], deleted{} }
  recents: [],
  offline: !navigator.onLine,
  searchQuery: "",
  acItems: [],
  acSel: -1,
  acTimer: null,
  searchTimer: null,
  unsubHost: null
};

var __orosSyncApi = null; // FIX-W2-1: properly declared

// RX-11 (R36, A31): registerTrayIcon() removed — it registered with a
// shell.orosTray that does not exist (always returned early). The
// taskbar chip is the shell's radioTrayTick() over __orosRadioHost.

/* ===== SYNC CONTRACT (Bible Part V/VI, 5-arg) ===== */

function saveLocal(){
  if(state.data) normalizeState(state.data);  // RX-6: stored bytes stay canonical (the closed-app proxy sends them as-is)
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); }catch(e){}
}

function sliceGet(){
  var obj = null;
  try{ obj = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }catch(e){}
  if(!obj) obj = { ver: RADIO_VERSION, favorites: [], deleted: {} };
  normalizeState(obj);
  return JSON.parse(JSON.stringify(obj)); // deep copy getter
}

function normalizeState(obj){
  if(typeof obj.ver !== "number") obj.ver = RADIO_VERSION;
  if(!Array.isArray(obj.favorites)) obj.favorites = [];
  if(!obj.deleted || typeof obj.deleted !== "object") obj.deleted = {};
  obj.favorites = obj.favorites.filter(function(f){
    return f && f.stationuuid && typeof f.mtime === "number";
  });
  sortFavorites(obj.favorites);
  // RX-6 (R26): tombstone keys in sorted order. The merge used to emit
  // "remote keys first", so two devices that removed different
  // favorites held the same content in different byte order and
  // uploaded on every sync, forever.
  var keys = Object.keys(obj.deleted).sort(), del = {};
  keys.forEach(function(k){
    if(typeof obj.deleted[k] === "number") del[k] = obj.deleted[k];
  });
  obj.deleted = del;
}

function sortFavorites(arr){
  arr.sort(function(a, b){
    if(b.mtime !== a.mtime) return b.mtime - a.mtime;
    var an = String(a.name || ""), bn = String(b.name || "");
    if(an !== bn) return an < bn ? -1 : 1;                    // deterministic tie-break
    return a.stationuuid < b.stationuuid ? -1 : (a.stationuuid > b.stationuuid ? 1 : 0);
  });
}

function sliceSet(payload){
  // Pull path: suppress echo, write, normalize, re-render. NO toast (taskbar dot).
  var prev = __orosSyncApi ? __orosSyncApi._suppress : false;
  if(__orosSyncApi) __orosSyncApi._suppress = true;
  try{
    normalizeState(payload);
    state.data = payload;
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); }catch(e){}
  } finally {
    if(__orosSyncApi) __orosSyncApi._suppress = prev;
  }
  renderMain();
}

function commitLocal(){
  // User-action path: write + mark dirty
  saveLocal();
  if(__orosSyncApi && typeof __orosSyncApi.dirty === "function") __orosSyncApi.dirty();
}

// R5-symmetric merge: union by stationuuid, LWW by mtime,
// lexicographic JSON tie-break, tombstones (delete wins ties,
// newer edit resurrects — FIX-W2-4)
function mergeRadioStates(remote, local){
  var merged = {
    ver: Math.max(remote.ver || 1, local.ver || 1),
    favorites: [],
    deleted: {}
  };
  var dec = merged.deleted;
  var rd = remote.deleted || {}, ld = local.deleted || {};
  Object.keys(rd).forEach(function(u){ dec[u] = Math.max(dec[u] || 0, rd[u] || 0); });
  Object.keys(ld).forEach(function(u){ dec[u] = Math.max(dec[u] || 0, ld[u] || 0); });

  var map = {};
  function ins(f){
    if(!f || !f.stationuuid) return;
    var ex = map[f.stationuuid];
    if(!ex || f.mtime > ex.mtime ||
       (f.mtime === ex.mtime && JSON.stringify(f) > JSON.stringify(ex))){
      map[f.stationuuid] = f;
    }
  }
  (remote.favorites || []).forEach(ins);
  (local.favorites || []).forEach(ins);

  Object.keys(map).forEach(function(u){
    if(map[u].mtime > (dec[u] || 0)) merged.favorites.push(map[u]); // alive
  });
  normalizeState(merged);   // RX-6: same canonical shape as the getter
  return merged;
}

function registerSync(){
  var api = (window.parent && window.parent.orosSync) || window.orosSync;
  __orosSyncApi = {
    _suppress: false,
    dirty: function(){
      if(this._suppress) return;
      if(api && typeof api.markDirty === "function") api.markDirty();
    }
  };
  if(!api || typeof api.registerSlice !== "function") return;
  api.registerSlice("radio", sliceGet, sliceSet, STORAGE_KEY, mergeRadioStates);
}

/* ===== CONTRACT Β — shortcut forwarding ===== */

document.addEventListener("keydown", function(e){
  if(!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
  var p = window.parent;
  if(!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
  if(p.orosShortcuts.handle(e)) e.stopPropagation();
}, true);

/* ===== TRANSIENT NOTE (canonical helper + local fallback) ===== */

var toastEl = null, toastTimer = null;

// actionLabel/actionFn: Undo-bearing toast (stays local, 8 s — Part VI)
function localToast(text, actionLabel, actionFn){
  if(!toastEl){
    toastEl = document.createElement("div");
    toastEl.className = "rx-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  if(actionLabel && typeof actionFn === "function"){
    var b = document.createElement("button");
    b.type = "button";
    b.className = "rx-toast-act";
    b.textContent = actionLabel;
    b.addEventListener("click", function(){
      toastEl.classList.remove("show");
      actionFn();
    });
    toastEl.appendChild(b);
  }
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.classList.remove("show"); },
    actionLabel ? 8000 : 5000);
}

function transientNote(text){
  var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
  if(n && typeof n.transient === "function"){
    n.transient({ ns: "radio", title: text });
    return;
  }
  localToast(text); // stale-bundle / standalone fallback
}

/* ===== AUDIO HOST (Wave 2 — lives in the SHELL) ===== */

function hostWin(){
  try{ return (window.parent && window.parent !== window) ? window.parent : window; }
  catch(e){ return window; }
}

function ensureHost(){
  var w = hostWin();
  if(w.__orosRadioHost && w.__orosRadioHost.audio &&
     w.__orosRadioHost.audio.isConnected) return w.__orosRadioHost;

  // FIX-RX-5: reuse ANY existing tagged audio element from a
  // previous generation instead of appending a second one
  // (duplicate element = simultaneous playback). An audio element
  // REMOVED from the DOM keeps playing — it must be reused, not
  // replaced.
  var audio = w.document.querySelector("audio[data-oros-radio]");
  if(!audio){
    audio = w.document.createElement("audio");
    audio.preload = "none";
    audio.style.display = "none";
    try{ w.document.body.appendChild(audio); }catch(e){}
  }
  audio.setAttribute("data-oros-radio", "1");

  var host = {
    audio: audio,
    current: null,
    flags: { buffering: false, error: false },
    sleep: { until: null, iv: null },
    lastEvent: null,   // "sleep-set" | "sleep-cancel" | "sleep-expired" | null
    subs: []
  };

  host.notify = function(){
    for(var i = host.subs.length - 1; i >= 0; i--){
      try{ host.subs[i](host); }
      catch(e){ host.subs.splice(i, 1); } // dead subscriber (closed frame)
    }
  };

  audio.addEventListener("playing", function(){
    host.flags.buffering = false; host.flags.error = false; host.notify();
  });
  audio.addEventListener("pause", function(){ host.notify(); });
  audio.addEventListener("waiting", function(){
    host.flags.buffering = true; host.notify();
  });
  audio.addEventListener("canplay", function(){
    host.flags.buffering = false; host.notify();
  });
  audio.addEventListener("error", function(){
    host.flags.error = true; host.flags.buffering = false; host.notify();
  });

  host.api = {
    play: function(station){
      if(!station || !station.url_resolved) return false;
      // FIX-RX-4: force-abort the previous stream BEFORE switching.
      // Simply overwriting .src can leave the old connection live
      // while the new one starts (overlapping audio).
      if(host.current){
        audio.pause();
        audio.removeAttribute("src");
        audio.load(); // abort the previous network connection
      }
      host.current = station;
      host.flags.buffering = true;
      host.flags.error = false;
      host.lastEvent = null;
      audio.src = station.url_resolved;
      applyMediaSession(w, station);
      var p = audio.play();
      if(p && p.catch) p.catch(function(err){
        console.warn("[radio] play rejected:", err && err.name);
        host.notify();
      });
      host.notify();
      
      return true;
    },
    toggle: function(){
      if(!host.current) return;
      if(audio.paused){
        var p = audio.play();
        if(p && p.catch) p.catch(function(){});
      }else{
        audio.pause();
      }
    },
    stop: function(){
      audio.pause();
      audio.removeAttribute("src");
      audio.load();          // releases the live stream connection
      host.current = null;   // tray chip disappears (zero-DOM rule)
      host.api.cancelSleep(true);
      host.notify();
    },
    getState: function(){
      return {
        current: host.current,
        paused: audio.paused,
        playing: !!host.current && !audio.paused,
        flags: { buffering: host.flags.buffering, error: host.flags.error },
        sleepUntil: host.sleep.until
      };
    },
    setSleep: function(minutes){
      host.api.cancelSleep(true);
      if(!minutes || minutes <= 0) return;
      host.sleep.until = Date.now() + minutes * 60000;
      host.sleep.iv = w.setInterval(function(){
        if(Date.now() >= host.sleep.until){
          host.api.cancelSleep(true);
          audio.pause();
          host.lastEvent = "sleep-expired";
          host.notify();
        }else{
          host.notify(); // live countdown on chip
        }
      }, SLEEP_TICK_MS);
      host.lastEvent = "sleep-set";
      host.notify();
    },
    cancelSleep: function(silent){
      if(host.sleep.iv){ w.clearInterval(host.sleep.iv); host.sleep.iv = null; }
      host.sleep.until = null;
      if(!silent){
        host.lastEvent = "sleep-cancel";
        host.notify();
      }
    },
    favoriteToggle: function(){
      if(!host.current) return;
      favoriteToggle(host.current);
    },
    subscribe: function(fn){
      host.subs.push(fn);
      return function(){
        var i = host.subs.indexOf(fn);
        if(i >= 0) host.subs.splice(i, 1);
      };
    }
  };

  // Media Session action handlers — shell document owns the audio
  try{
    var ms = w.navigator.mediaSession;
    if(ms){
      ms.setActionHandler("play",  function(){
        if(!audio.paused || !host.current) return;
        var p = audio.play();
        if(p && p.catch) p.catch(function(){});
      });
      ms.setActionHandler("pause", function(){ audio.pause(); });
    }
  }catch(e){ /* no Media Session support — degrade gracefully */ }

  // FIX: the host was built and returned, but never ATTACHED to
  // the shell window — w.__orosRadioHost stayed undefined forever,
  // so radioTrayTick() found no host and the tray chip never
  // appeared. Guarded: a previous generation may still hold the
  // same live host (early-return above handles that case anyway).
  if(!w.__orosRadioHost) w.__orosRadioHost = host;
  return host;
}

// FIX-RX-1: was called in host.api.play() but never defined —
// ReferenceError killed playback before audio.play().
function applyMediaSession(w, station){
  try{
    var ms = w.navigator.mediaSession;
    if(!ms || typeof w.MediaMetadata !== "function") return;
    var artwork = [];
    if(station.favicon){
      artwork = [{ src: station.favicon, sizes: "192x192" }];
    }
    ms.metadata = new w.MediaMetadata({
      title: station.name || "",
      artist: station.country || station.countrycode || "",
      artwork: artwork
    });
  }catch(e){ /* no Media Session support — degrade gracefully */ }
}

var host = ensureHost();

function getHostState(){
  return host.api.getState();
}

/* ===== RECENTS (device-local) ===== */

function loadRecents(){
  try{
    var raw = localStorage.getItem(RECENTS_KEY);
    state.recents = raw ? JSON.parse(raw) : [];
    if(!Array.isArray(state.recents)) state.recents = [];
  }catch(e){ state.recents = []; }
}

function saveRecents(){
  try{
    localStorage.setItem(RECENTS_KEY, JSON.stringify(state.recents.slice(0, RECENTS_CAP)));
  }catch(e){}
}

// RX-9: no native confirm (R14) and no Greek-only text: clear at once,
// Undo puts the list back (recents are device-local).
function clearRecents(){
  var prev = state.recents.slice();
  state.recents = [];
  saveRecents();
  renderMain();
  localToast(t("recents.cleared"), t("undo"), function(){
    state.recents = prev;
    saveRecents();
    renderMain();
  });
}

function addRecent(station){
  // Dedup by stationuuid
  state.recents = state.recents.filter(function(s){
    return s.stationuuid !== station.stationuuid;
  });
  state.recents.unshift(normalizeStation(station));
  if(state.recents.length > RECENTS_CAP) state.recents = state.recents.slice(0, RECENTS_CAP);
  saveRecents();
}

/* ===== CACHING ===== */

function getCached(key){
  try{
    var raw = localStorage.getItem(CACHE_PREFIX + key);
    if(!raw) return null;
    var data = JSON.parse(raw);
    if(Date.now() - data.ts > CACHE_TTL_MS) return null;
    return data.value;
  }catch(e){ return null; }
}

// RX-7 (R30): the API cache shares the ONE origin localStorage with
// every app's data. It used to store the raw ~30-field API objects and
// never removed an expired entry: ten country lists filled ~2.2M chars
// (about half the quota), after which other apps' saves start to fail.
// Now: station rows are normalized, expired entries are swept, the
// whole cache is capped, and a quota error empties the cache instead
// of leaving it full.
var CACHE_CAP_CHARS = 600000;

function sweepCache(keepKey){
  var now = Date.now(), live = [], total = 0, i, k, raw, ts;
  try{
    for(i = localStorage.length - 1; i >= 0; i--){
      k = localStorage.key(i);
      if(!k || k.indexOf(CACHE_PREFIX) !== 0) continue;
      raw = localStorage.getItem(k) || "";
      ts = 0;
      try{ ts = JSON.parse(raw).ts || 0; }catch(e1){}
      if(now - ts > CACHE_TTL_MS){ localStorage.removeItem(k); continue; }
      live.push({ k: k, ts: ts, n: raw.length });
      total += raw.length;
    }
    live.sort(function(a, b){ return a.ts - b.ts; });   // oldest first
    for(i = 0; i < live.length && total > CACHE_CAP_CHARS; i++){
      if(live[i].k === keepKey) continue;
      localStorage.removeItem(live[i].k);
      total -= live[i].n;
    }
  }catch(e){}
}

function slimRows(value){
  if(!Array.isArray(value)) return value;
  return value.map(function(s){
    return (s && s.stationuuid) ? normalizeStation(s) : s;
  });
}

function setCached(key, value){
  var raw = JSON.stringify({ ts: Date.now(), value: slimRows(value) });
  try{
    localStorage.setItem(CACHE_PREFIX + key, raw);
  }catch(e){
    purgeCache();   // quota: the cache goes first, never someone's data
    try{ localStorage.setItem(CACHE_PREFIX + key, raw); }catch(e2){ return; }
  }
  sweepCache(CACHE_PREFIX + key);
}

function purgeCache(){
  try{
    for(var i = localStorage.length - 1; i >= 0; i--){
      var k = localStorage.key(i);
      if(k && k.indexOf(CACHE_PREFIX) === 0) localStorage.removeItem(k);
    }
  }catch(e){}
}

/* ===== OFFLINE TRACKING ===== */

function updateOnlineState(){
  state.offline = !navigator.onLine;   // RX-N3: unused wasOffline removed
  
  var banner = $("rx-banner");
  if(banner){
    var txt = $("rx-banner-text");
    if(state.offline){
      if(txt) txt.textContent = t("offline.hint");
      banner.removeAttribute("hidden");
    }else{
      banner.setAttribute("hidden", "");
    }
  }
}

/* FIX-RX-2: honest banner when the directory is unreachable while
   "online" (dead mirrors / blocker / DNS). Does NOT overwrite the
   offline banner — updateOnlineState() still owns that state. */
function showCatalogBanner(){
  var banner = $("rx-banner"), txt = $("rx-banner-text");
  if(banner && !banner.hasAttribute("hidden")) return; // already speaking
  if(txt) txt.textContent = t("catalog.err");
  if(banner) banner.removeAttribute("hidden");
}
function hideCatalogBanner(){
  var banner = $("rx-banner");
  if(banner) banner.setAttribute("hidden", "");
}

window.addEventListener("online", updateOnlineState);
window.addEventListener("offline", updateOnlineState);

/* ===== API LAYER (Radio Browser) ===== */

var rbMirrorIdx = 0; // sticky index of the last healthy mirror

// W3-6: sequential mirror fallback. The healthy mirror is STICKY —
// a dead mirror costs at most one failed request (3s abort
// ceiling), then we rotate and stick to the next healthy one.
// The offline flag short-circuits honestly (no doomed requests).
function rbRequest(path){
  if(state.offline) return Promise.reject(new Error("offline"));
  var tries = 0;
  function attempt(){
    var mirror = RB_MIRRORS[rbMirrorIdx];
    var ctl = (typeof AbortController === "function") ? new AbortController() : null;
    var timer = ctl ? setTimeout(function(){ ctl.abort(); }, 3000) : null;
    var opts = { cache: "no-store" };
    if(ctl) opts.signal = ctl.signal;
    return fetch(mirror + path, opts).then(function(res){
      if(timer) clearTimeout(timer);
      if(!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function(data){
      hideCatalogBanner(); // FIX-RX-2: healthy request clears the notice
      return data;
    }).catch(function(err){
      if(timer) clearTimeout(timer);
      tries++;
      if(tries >= RB_MIRRORS.length){
        showCatalogBanner(); // FIX-RX-2: honest "directory unreachable" banner
        throw err;
      }
      rbMirrorIdx = (rbMirrorIdx + 1) % RB_MIRRORS.length;
      return attempt();
    });
  }
  return attempt();
}

function fetchCountries(){
  var cached = getCached("countries");
  if(cached) return Promise.resolve(cached);
  
  return rbRequest("/json/countries").then(function(data){
    var filtered = data.filter(function(c){ return c.stationcount > 0; });
    filtered.sort(function(a,b){ return b.stationcount - a.stationcount; });
    setCached("countries", filtered);
    return filtered;
  }).catch(function(err){
    console.warn("[radio] countries fetch failed:", err.message);
    return []; // honest offline response (banner handled by FIX-RX-2)
  });
}

function fetchGenres(){
  var cached = getCached("genres");
  if(cached) return Promise.resolve(cached);
  
  // Diagnostic-proven: plain /json/tags surfaced decade tags at
  // the top. Explicit server-side ordering (order=stationcount,
  // reverse, hidebroken) returns real genres (pop, rock, news…).
  return rbRequest("/json/tags?order=stationcount&reverse=true&hidebroken=true&limit=100").then(function(data){
    var filtered = data.filter(function(g){ return g.stationcount >= 50; });
    filtered.sort(function(a,b){ return b.stationcount - a.stationcount; });
    setCached("genres", filtered);
    return filtered;
  }).catch(function(err){
    console.warn("[radio] genres fetch failed:", err.message);
    return [];
  });
}

function fetchStationsByCountry(code, limit){
  var cached = getCached("stations_country_" + code);
  if(cached) return Promise.resolve(cached);
  
  return rbRequest("/json/stations/bycountryexact/" + encodeURIComponent(code) +
    "?limit=" + (limit || 200)).then(function(data){
    var filtered = data.filter(function(s){
      var codec = (s.codec || "").toLowerCase();
      return codec.match(/mp3|aac|ogg|opus/) && s.url_resolved;
    });
    filtered.sort(function(a,b){ return (b.votes||0) - (a.votes||0); });
    filtered = filtered.slice(0, limit || 200);
    setCached("stations_country_" + code, filtered);
    return filtered;
  }).catch(function(err){
    console.warn("[radio] stations fetch failed:", err.message);
    return [];
  });
}

function fetchStationsByTag(tag, limit){
  var cached = getCached("stations_tag_" + tag);
  if(cached) return Promise.resolve(cached);
  
  return rbRequest("/json/stations/bytag/" + encodeURIComponent(tag) +
    "?limit=" + (limit || 200)).then(function(data){
    var filtered = data.filter(function(s){
      var codec = (s.codec || "").toLowerCase();
      return codec.match(/mp3|aac|ogg|opus/) && s.url_resolved;
    });
    filtered.sort(function(a,b){ return (b.votes||0) - (a.votes||0); });
    filtered = filtered.slice(0, limit || 200);
    setCached("stations_tag_" + tag, filtered);
    return filtered;
  }).catch(function(err){
    console.warn("[radio] tag fetch failed:", err.message);
    return [];
  });
}

function searchStations(query, limit){
  if(!query || query.trim().length < 3) return Promise.resolve([]);
  
  var q = query.toLowerCase();
  var cached = getCached("search_" + q);
  if(cached) return Promise.resolve(cached);
  
  return rbRequest("/json/stations/search?name=" + encodeURIComponent(query) +
    "&limit=" + (limit || 50)).then(function(data){
    var filtered = data.filter(function(s){
      var codec = (s.codec || "").toLowerCase();
      return codec.match(/mp3|aac|ogg|opus/) && s.url_resolved;
    });
    filtered.sort(function(a,b){ return (b.votes||0) - (a.votes||0); });
    setCached("search_" + q, filtered);
    return filtered;
  }).catch(function(err){
    console.warn("[radio] search failed:", err.message);
    return [];
  });
}

function fetchTopVoted(limit){
  var cached = getCached("topvote");
  if(cached) return Promise.resolve(cached);
  
  return rbRequest("/json/stations/topvote/" + (limit || 50)).then(function(data){
    var filtered = data.filter(function(s){
      var codec = (s.codec || "").toLowerCase();
      return codec.match(/mp3|aac|ogg|opus/) && s.url_resolved;
    });
    filtered.sort(function(a,b){ return (b.votes||0) - (a.votes||0); });
    setCached("topvote", filtered);
    return filtered;
  }).catch(function(err){
    console.warn("[radio] topvote fetch failed:", err.message);
    return [];
  });
}

/* ===== FAVORITES MANAGEMENT ===== */

function isFavorite(uuid){
  if(!state.data) return false;
  return !!state.data.favorites.find(function(f){ return f.stationuuid === uuid; });
}

function favoriteToggle(station){
  if(!state.data) return;
  
  var payload = sliceGet();
  var existing = payload.favorites.find(function(f){
    return f.stationuuid === station.stationuuid;
  });
  
  if(existing){
    payload.favorites = payload.favorites.filter(function(f){
      return f.stationuuid !== station.stationuuid;
    });
    payload.deleted[station.stationuuid] = Date.now();
  }else{
    payload.favorites.push({
      stationuuid: station.stationuuid,
      name: station.name,
      url_resolved: station.url_resolved,
      country: station.country || "",
      countrycode: station.countrycode || "",
      tags: Array.isArray(station.tags) ? station.tags : (station.tags ? station.tags.split(",").map(function(t){ return t.trim(); }) : []),
      codec: station.codec || "",
      bitrate: station.bitrate || 0,
      homepage: station.homepage || "",
      mtime: Date.now()
    });
  }
  
  sliceSet(payload);
  commitLocal();
}

/* ===== SLEEP TIMER UI ===== */

function openSleepDialog(){
  var dlg = document.getElementById("rx-sleep-dlg");
  if(!dlg){
    dlg = document.createElement("dialog");
    dlg.id = "rx-sleep-dlg";
    dlg.innerHTML = '<div class="rx-sleep-content">' +
      '<h3>' + t("sleep.title") + '</h3>' +
      '<div class="rx-sleep-presets" id="rx-sleep-presets"></div>' +
      '<div class="rx-sleep-status" id="rx-sleep-status"></div>' +
      '<button type="button" class="rx-sleep-btn" id="rx-sleep-cancel">' + t("sleep.off") + '</button>' +
    '</div>';
    document.body.appendChild(dlg);
    // Attach ONCE at creation — the dialog element is reused
    dlg.addEventListener("click", function(e){
      if(e.target === dlg) dlg.close();
    });
    // RX-13: wired ONCE here (it was re-added on every open, so the
    // Nth open ran cancelSleep N times per click)
    var cancelBtn = $("rx-sleep-cancel");
    if(cancelBtn){
      cancelBtn.addEventListener("click", function(){
        host.api.cancelSleep();
        renderSleepStatus();
      });
    }
  }

  // Build presets
  var presetsDiv = $("rx-sleep-presets");
  if(presetsDiv) presetsDiv.innerHTML = "";
  SLEEP_PRESETS.forEach(function(min){
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rx-sleep-preset";
    btn.textContent = fmt("sleep.min", min);
    btn.addEventListener("click", function(){
      host.api.setSleep(min);
      renderSleepStatus();
      transientNote(fmt("sleep.set", min));   // the key existed, nothing said it
    });
    presetsDiv.appendChild(btn);
  });

  dlg.showModal();
  renderSleepStatus();
}

function renderSleepStatus(){
  var statusEl = $("rx-sleep-status");
  if(!statusEl) return;
  
  var st = getHostState();
  if(st.sleepUntil && st.sleepUntil > Date.now()){
    var minsLeft = Math.ceil((st.sleepUntil - Date.now()) / 60000);
    statusEl.textContent = fmt("sleep.remaining", minsLeft);
  }else if(st.current && st.paused && host.lastEvent === "sleep-expired"){
    // RX-13: was "any pause" — a failed stream or a manual pause read
    // "stopped by the sleep timer" without a timer ever being set
    statusEl.textContent = t("sleep.stopped");
  }else{
    statusEl.textContent = "";
  }
}

console.log("[radio] part 1/3 loaded");

// ============================================================
// orOS Radio — Part 2/3: UI & Rendering (same IIFE continues)
// ============================================================

/* ===== DOM RENDERERS ===== */

// RX-12: every render bumps the token; an async view (countries,
// genres, stations, search) whose fetch lands after the user moved
// on appends nothing (stale tiles used to land in the new view).
var renderSeq = 0;

function renderMain(){
  renderSeq++;
  var main = $("rx-main");
  var list = $("rx-list");
  var crumb = $("rx-crumb");
  var empty = $("rx-empty");
  var tabs = document.querySelectorAll(".rx-tab");
  
  if(!list || !empty || !crumb) return;
  
  // Update tab states
  tabs.forEach(function(tab){
    var isActive = tab.id.replace("rx-tab-", "") === state.viewMode;
    tab.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  
  // Clear view
  list.innerHTML = "";
  list.className = "rx-list";
  empty.setAttribute("hidden", "");
  crumb.setAttribute("hidden", "");
  
  // Render based on view mode
  switch(state.viewMode){
    case "discover":
      crumb.textContent = t("view.discover");
      crumb.removeAttribute("hidden");
      list.className = "rx-list stations";
      renderDiscover(list);
      break;
      
    case "countries":
      crumb.textContent = t("view.countries");
      crumb.removeAttribute("hidden");
      list.className = "rx-list tiles";
      renderCountries(list);
      break;
      
    case "genres":
      crumb.textContent = t("view.genres");
      crumb.removeAttribute("hidden");
      list.className = "rx-list tiles";
      renderGenres(list);
      break;
      
    case "favorites":
      crumb.textContent = t("view.favorites");
      crumb.removeAttribute("hidden");
      list.className = "rx-list stations";
      renderFavorites(list);
      break;
      
    case "recents":
      crumb.textContent = t("view.recents");
      crumb.removeAttribute("hidden");
      list.className = "rx-list stations";
      renderRecents(list);
      break;
      
    case "stations":
      if(state.parent && state.parent.type === "country"){
        crumb.textContent = state.parent.name;
        crumb.removeAttribute("hidden");
        list.className = "rx-list stations";
        renderStationsByCountry(list, state.parent.code);
      }else if(state.parent && state.parent.type === "genre"){
        crumb.textContent = state.parent.name;
        crumb.removeAttribute("hidden");
        list.className = "rx-list stations";
        renderStationsByTag(list, state.parent.tag);
      }
      break;
      
    case "search":
      if(state.searchQuery){
        // RX-8: the string has no {n}, so the query never showed
        crumb.textContent = t("search.results") + " “" + state.searchQuery + "”";
        crumb.removeAttribute("hidden");
        list.className = "rx-list stations";
        renderSearchResults(list);
      }
      break;
  }
  
  // Empty state — sync views ONLY (favorites/recents render
  // synchronously). Async views (countries/genres/stations/search)
  // own their empty banner inside the fetch callbacks, AFTER the
  // data lands: a sync check here flashed "no results" and never
  // re-hidden once tiles arrived.
  if(state.viewMode === "favorites"){
    if(!state.data || !state.data.favorites || state.data.favorites.length === 0){
      empty.textContent = t("nofavorites");
      empty.removeAttribute("hidden");
    }
  }else if(state.viewMode === "recents"){
    if(!state.recents.length){
      empty.textContent = t("norecents");
      empty.removeAttribute("hidden");
    }
  }
  
  // Update player UI to match host state
  updatePlayerUI();
  
  // FIX-6: Keep player visible if audio is playing
  var player = $("rx-player");
  var hostState = getHostState();
  if(player && hostState.current && !player.hidden){
    player.removeAttribute("hidden");
  }
}

function renderCountries(container){
  var seq = renderSeq;
  fetchCountries().then(function(data){
    if(seq !== renderSeq) return;   // RX-12: a newer view owns the list
    if(!data || data.length === 0){
      $("rx-empty").textContent = t("noresults");
      $("rx-empty").removeAttribute("hidden");
      return;
    }
    
    data.forEach(function(country){
      var tile = createTileElement(
        country.iso_3166_1 || "",
        country.name || "",
        country.stationcount || 0,
        "country"
      );
      tile.addEventListener("click", function(){
        state.parent = { type: "country", code: country.iso_3166_1, name: country.name };
        state.viewMode = "stations";
        state.tagFilter = "";
        renderMain();
      });
      container.appendChild(tile);
    });
  });
}

function renderGenres(container){
  var seq = renderSeq;
  fetchGenres().then(function(data){
    if(seq !== renderSeq) return;   // RX-12
    if(!data || data.length === 0){
      $("rx-empty").textContent = t("noresults");
      $("rx-empty").removeAttribute("hidden");
      return;
    }
    
    data.forEach(function(genre){
      var tile = createTileElement(
        "#" + genre.name,
        genre.name,
        genre.stationcount || 0,
        "genre"
      );
      tile.addEventListener("click", function(){
        state.parent = { type: "genre", tag: genre.name, name: genre.name };
        state.viewMode = "stations";
        renderMain();
      });
      container.appendChild(tile);
    });
  });
}

function renderDiscover(container){
  // W3-5: surprise-me tile first
  var dice = document.createElement("button");
  dice.type = "button";
  dice.className = "rx-tile";
  dice.innerHTML = '<span class="rx-tile-flag">🎲</span>' +
    '<div class="rx-tile-body"><div class="rx-tile-name">' + esc(t("random")) + '</div>' +
    '<div class="rx-tile-count">' + esc(t("random.hint")) + '</div></div>';
  dice.addEventListener("click", surpriseMe);
  container.appendChild(dice);
  
  var seq = renderSeq;
  fetchTopVoted().then(function(data){
    if(seq !== renderSeq) return;   // RX-12
    if(!data || data.length === 0){
      $("rx-empty").textContent = t("noresults");
      $("rx-empty").removeAttribute("hidden");
      return;
    }
    
    data.forEach(function(station){
      var card = createStationCard(station);
      container.appendChild(card);
    });
  });
}

function surpriseMe(){
  // Pool: cached topvote first (instant, offline-friendly), else
  // a fresh fetch. Honest offline: no pool + no network → nothing
  // happens (the offline banner is already speaking).
  var pool = getCached("topvote") || [];
  if(pool.length){
    var st = pool[Math.floor(Math.random() * pool.length)];
    playStation(st);
    return;
  }
  fetchTopVoted(100).then(function(data){
    if(data && data.length){
      var st = data[Math.floor(Math.random() * data.length)];
      playStation(st);
    }
  });
}

function createTileElement(flagOrHash, label, count, type){
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rx-tile";
  
  var icon = "";
  if(type === "country"){
    icon = '<span class="rx-tile-flag">' + getFlagEmoji(flagOrHash) + '</span>';
  }else{
    icon = '<span class="rx-tile-hash">#</span>';
  }
  
  btn.innerHTML = icon +
    '<div class="rx-tile-body"><div class="rx-tile-name">' + esc(label) + '</div>' +
    '<div class="rx-tile-count">' + count + ' ' + t("stations") + '</div></div>';
  
  return btn;
}

function getFlagEmoji(cc){
  if(!cc || cc.length !== 2) return "🌐";
  var codePoints = cc.toUpperCase().split("").map(function(c){
    return 127397 + c.charCodeAt(0);
  });
  return String.fromCodePoint.apply(String, codePoints);
}

function renderFavorites(container){
  if(!state.data || !state.data.favorites || state.data.favorites.length === 0){
    return;
  }
  
  state.data.favorites.forEach(function(fav){
    var card = createStationCard({
      stationuuid: fav.stationuuid,
      name: fav.name,
      url_resolved: fav.url_resolved,
      codec: fav.codec,
      bitrate: fav.bitrate,
      countrycode: fav.countrycode
    });
    container.appendChild(card);
  });
}

function renderRecents(container){
  if(!state.recents || state.recents.length === 0){
    return;
  }
  
  state.recents.forEach(function(rec){
    var card = createStationCard(rec);
    container.appendChild(card);
  });
}

function renderStationsByCountry(container, code){
  var seq = renderSeq;
  fetchStationsByCountry(code).then(function(data){
    if(seq !== renderSeq) return;   // RX-12
    if(!data || data.length === 0){
      $("rx-empty").textContent = t("noresults");
      $("rx-empty").removeAttribute("hidden");
      return;
    }
    
    // W3-8: tag filter chips — client-side aggregation of the most
    // popular tags in this country. Clicking a chip filters the
    // cards (data is cached, so re-render is instant, no network).
    var counts = {};
    data.forEach(function(s){
      String(s.tags || "").split(",").forEach(function(tag){
        tag = tag.trim();
        if(tag) counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    var topTags = Object.keys(counts).sort(function(a, b){
      return counts[b] - counts[a];
    }).slice(0, 12);
    
    if(topTags.length){
      var chips = document.createElement("div");
      chips.className = "rx-chips";
      topTags.forEach(function(tag){
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "rx-chip";
        chip.textContent = tag;
        if(state.tagFilter === tag) chip.classList.add("on");
        chip.addEventListener("click", function(){
          state.tagFilter = (state.tagFilter === tag) ? "" : tag;
          renderMain();
        });
        chips.appendChild(chip);
      });
      container.appendChild(chips);
    }
    
    data.forEach(function(station){
      if(state.tagFilter &&
         String(station.tags || "").indexOf(state.tagFilter) === -1) return;
      var card = createStationCard(station);
      container.appendChild(card);
    });
  });
}

function renderStationsByTag(container, tag){
  var seq = renderSeq;
  fetchStationsByTag(tag).then(function(data){
    if(seq !== renderSeq) return;   // RX-12
    if(!data || data.length === 0){
      $("rx-empty").textContent = t("noresults");
      $("rx-empty").removeAttribute("hidden");
      return;
    }
    
    data.forEach(function(station){
      var card = createStationCard(station);
      container.appendChild(card);
    });
  });
}

function renderSearchResults(container){
  var q = state.searchQuery;
  var seq = renderSeq;
  searchStations(q).then(function(data){
    if(seq !== renderSeq) return;   // RX-12
    if(!data || data.length === 0){
      $("rx-empty").textContent = t("noresults");
      $("rx-empty").removeAttribute("hidden");
      return;
    }
    
    data.forEach(function(station){
      var card = createStationCard(station);
      container.appendChild(card);
    });
  });
}

function createStationCard(station){
  var card = document.createElement("div");
  card.className = "rx-card";
  card.dataset.uuid = station.stationuuid;
  
  // Check if currently playing
  var hs = getHostState();
  if(hs.current && hs.current.stationuuid === station.stationuuid && hs.playing){
    card.classList.add("playing");
  }
  
  var initials = (station.name || "?").substring(0,2).toUpperCase();
  var logoHtml = '<div class="rx-logo">' + esc(initials) + '</div>';
  if(station.favicon){
    // W3-1 (RX-N1): no preload — the image loads only when the
    // card is in the DOM (lazy). Initials stay underneath the
    // overlay and show through if the image errors (self-remove).
    logoHtml = '<div class="rx-logo" style="position:relative;">' + esc(initials) +
      '<img src="' + esc(station.favicon) + '" alt="" loading="lazy" ' +
      'style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;" ' +
      'onerror="this.remove()"></div>';
  }
  
  var metaStr = "";
  if(station.bitrate) metaStr += station.bitrate + " kbps";
  if(station.codec) metaStr += (metaStr ? " · " : "") + station.codec;
  if(station.countrycode) metaStr += (metaStr ? " · " : "") + station.countrycode;
  
  card.innerHTML = logoHtml +
    '<div class="rx-card-body"><div class="rx-card-name">' + esc(station.name) + '</div>' +
    '<div class="rx-card-meta">' + esc(metaStr) + '</div></div>';
  
  card.addEventListener("click", function(){
    playStation(station);
  });
  
  return card;
}

function playStation(station){
  // Add to recents
  addRecent(station);
  
  // Play via host
  host.api.play(station);
  
  // Show player bar if hidden
  var player = $("rx-player");
  if(player) player.removeAttribute("hidden");
  
  updatePlayerUI();
  highlightPlayingCard(station.stationuuid);
  
  // FIX-3: Send notification
  transientNote(station.name);
}

// W3-7: single-source highlight — clears any previous .playing
// card, marks and scrolls to the new one. Called from playStation
// only (cards are also re-marked at render time).
function highlightPlayingCard(uuid){
  if(!uuid) return;
  var list = $("rx-list");
  if(!list) return;
  var prev = list.querySelector(".rx-card.playing");
  if(prev) prev.classList.remove("playing");
  // stationuuid chars are [a-z0-9-] — attribute-selector safe
  var card = list.querySelector('.rx-card[data-uuid="' + uuid + '"]');
  if(card){
    card.classList.add("playing");
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/* ===== PLAYER UI ===== */

function updatePlayerUI(){
  var player = $("rx-player");
  if(!player) return;
  
  var playBtn = $("rx-pl-play");
  var nameEl = $("rx-pl-name");
  var metaEl = $("rx-pl-meta");
  var favBtn = $("rx-pl-fav");
  
  if(!playBtn || !nameEl || !metaEl) return;
  
  var st = getHostState();
  
  // Play/Pause button
  if(st.playing){
    // Equalizer animation
    playBtn.innerHTML = '<div class="rx-eq"><i></i><i></i><i></i></div>';
    playBtn.setAttribute("aria-label", t("pause"));
  }else{
    playBtn.innerHTML = "▶";
    playBtn.setAttribute("aria-label", t("play"));
  }
  
  // Station info
  if(st.current){
    nameEl.textContent = st.current.name;
    var metaParts = [];
    if(st.current.bitrate) metaParts.push(st.current.bitrate + " kbps");
    if(st.current.codec) metaParts.push(st.current.codec);
    if(st.flags.buffering) metaEl.innerHTML = '<span class="buf">' + t("buffering") + '</span>';
    else if(st.flags.error) metaEl.innerHTML = '<span class="err">' + t("err.stream") + '</span>';
    else metaEl.textContent = metaParts.join(" · ");
  }else{
    nameEl.textContent = "";
    metaEl.textContent = "";
  }
  
  // Favorite button
  if(favBtn && st.current){
    var fav = isFavorite(st.current.stationuuid);
    favBtn.classList.toggle("active", fav);
    favBtn.setAttribute("aria-label", fav ? t("unfavorite") : t("favorite"));
    // Icon update
    favBtn.innerHTML = fav ? "♥" : "♡";
  }
  
  // Sleep timer chip
  updateSleepChip();
}

function togglePlayPause(){
  host.api.toggle();
  updatePlayerUI();
}

function toggleFavorite(){
  var st = getHostState();
  if(st.current){
    favoriteToggle(st.current);
    var msg = isFavorite(st.current.stationuuid) ? t("fav.added") : t("fav.removed");
    transientNote(msg);
    updatePlayerUI();
  }
}

/* ===== AUTOCOMPLETE ===== */

function doSearch(query){
  if(query && query.trim().length >= 3){
    state.viewMode = "search";
    state.searchQuery = query.trim();
    renderMain();
  }else{
    state.viewMode = "discover";
    state.searchQuery = "";
    state.parent = null;
    state.tagFilter = "";
    renderMain();
  }
  
  // Clear autocomplete
  var ac = $("rx-ac");
  if(ac) ac.setAttribute("hidden", "");
  state.acItems = [];
}

function renderAutocomplete(items, rect){
  var ac = $("rx-ac");
  if(!ac) return;
  
  if(!items || items.length === 0){
    ac.setAttribute("hidden", "");
    state.acItems = [];
    state.acSel = -1;
    return;
  }
  
  ac.innerHTML = "";
  state.acItems = items.slice(0, 8);
  state.acSel = -1;
  
  state.acItems.forEach(function(station, idx){
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rx-ac-item";
    btn.dataset.idx = idx;
    
    var display = station.name || "";
    var meta = (station.country || station.countrycode) || "";
    
    btn.innerHTML = esc(display) + (meta ? ' <small>(' + esc(meta) + ')</small>' : '');
    btn.addEventListener("mouseenter", function(){ state.acSel = idx; updateAcSelection(); });
    btn.addEventListener("click", function(){ selectAcItem(station); });
    
    ac.appendChild(btn);
  });
  
  // RX-10: positioned by CSS only (absolute under the relative
  // .rx-search). Viewport coordinates from getBoundingClientRect()
  // pushed the list down and to the right of the input.
  ac.removeAttribute("hidden");
}

function updateAcSelection(){
  var ac = $("rx-ac");
  if(!ac) return;
  
  var items = ac.querySelectorAll(".rx-ac-item");
  items.forEach(function(item, idx){
    item.classList.toggle("sel", idx === state.acSel);
  });
}

function selectAcItem(station){
  var input = $("rx-search-input");
  if(input && station){
    input.value = station.name;
    input.blur();
  }
  doSearch(station.name);
  
  var ac = $("rx-ac");
  if(ac) ac.setAttribute("hidden", "");
}

/* ===== CONTINUE IN PART 3/3 ===== */

console.log("[radio] part 2/3 loaded");

/* ===== TAB HANDLERS ===== */

function setupTabs(){
  document.querySelectorAll(".rx-tab").forEach(function(tab){
    tab.addEventListener("click", function(){
      var mode = tab.id.replace("rx-tab-", "");
      state.viewMode = mode;
      state.parent = null;
      state.searchQuery = "";
      state.tagFilter = "";
      renderMain();
    });
  });
}

/* ===== SEARCH HANDLER ===== */

function setupSearch(){
  var input = $("rx-search-input");
  if(!input) return;
  
  var clearBtn = $("rx-clear-recents");
  if(clearBtn){
    clearBtn.title = t("recents.clear");
    clearBtn.setAttribute("aria-label", t("recents.clear"));
    clearBtn.addEventListener("click", clearRecents);
  }
  
  // Focus shows recents suggestions
  input.addEventListener("focus", function(){
    if(state.recents.length === 0) return;
    var seen = {};
    var suggestions = [];
    state.recents.forEach(function(s){
      if(s.name && !seen[s.name]){
        seen[s.name] = true;
        suggestions.push(s);
      }
    });
    if(suggestions.length){
      var rect = input.getBoundingClientRect();
      renderAutocomplete(suggestions.slice(0, 5), rect);
    }
  });
  
  // Debounced live search
  input.addEventListener("input", function(){
    clearTimeout(state.searchTimer);
    var val = this.value.trim();
    
    if(val.length >= 3){
      var self = this;
      state.searchTimer = setTimeout(function(){
        searchStations(val).then(function(results){
          if(self.value.trim() === val && document.activeElement === self){
            var rect = self.getBoundingClientRect();
            renderAutocomplete(results.slice(0, 8), rect);
          }
        });
      }, 300);
    }else{
      var ac = $("rx-ac");
      if(ac) ac.setAttribute("hidden", "");
      state.acItems = [];
      state.acSel = -1;
    }
  });
  
  // Keyboard navigation
  input.addEventListener("keydown", function(e){
    // RX-8 (R28): Enter without a highlighted suggestion used to do
    // nothing at all (no grid search existed outside the dropdown).
    if(e.key === "Enter" && !(state.acSel >= 0 && state.acItems[state.acSel])){
      e.preventDefault();
      clearTimeout(state.searchTimer);
      input.blur();
      doSearch(input.value);
      return;
    }
    if(state.acItems.length === 0) return;

    if(e.key === "ArrowDown"){
      e.preventDefault();
      state.acSel = Math.min(state.acSel + 1, state.acItems.length - 1);
      updateAcSelection();
    }else if(e.key === "ArrowUp"){
      e.preventDefault();
      state.acSel = Math.max(state.acSel - 1, 0);   // RX-8: was clamped at the current row
      updateAcSelection();
    }else if(e.key === "Enter"){
      e.preventDefault();
      selectAcItem(state.acItems[state.acSel]);
    }else if(e.key === "Escape"){
      e.preventDefault();
      var ac = $("rx-ac");
      if(ac) ac.setAttribute("hidden", "");
      state.acItems = [];
      state.acSel = -1;
    }
  });
  
  // Blur closes (delayed so click on item registers first)
  input.addEventListener("blur", function(){
    setTimeout(function(){
      var ac = $("rx-ac");
      if(ac) ac.setAttribute("hidden", "");
      state.acItems = [];
      state.acSel = -1;
    }, 200);
  });
  
  // Hook into renderMain to toggle clear button visibility
  var origRenderMain = renderMain;
  renderMain = function(){
    origRenderMain();
    if(clearBtn){
      clearBtn.style.display = (state.viewMode === "recents" && state.recents.length) ? "" : "none";
    }
  };
}

/* ===== PLAYER CONTROLS ===== */

function setupPlayerControls(){
  var playBtn = $("rx-pl-play");
  var favBtn  = $("rx-pl-fav");
  var sleepBtn = $("rx-pl-sleep");
  var stopBtn = $("rx-pl-stop");
  
  if(playBtn)  playBtn.addEventListener("click", togglePlayPause);
  if(favBtn)   favBtn.addEventListener("click", toggleFavorite);
  if(sleepBtn) sleepBtn.addEventListener("click", openSleepDialog);
  if(stopBtn){
    stopBtn.addEventListener("click", function(){
      host.api.stop();
      var player = $("rx-player");
      if(player) player.setAttribute("hidden", ""); // hide the bar
      updatePlayerUI();
    });
    stopBtn.setAttribute("aria-label", t("stop"));
    stopBtn.title = t("stop");
  }
}

/* ===== SLEEP CHIP ===== */

function updateSleepChip(){
  var chip = $("rx-sleep-chip");
  if(!chip) return;
  
  var st = getHostState();
  if(st.sleepUntil && st.sleepUntil > Date.now()){
    var minsLeft = Math.ceil((st.sleepUntil - Date.now()) / 60000);
    chip.textContent = fmt("sleep.remaining", minsLeft);
    chip.removeAttribute("hidden");
  }else{
    chip.setAttribute("hidden", "");
  }
}

/* ===== PALETTE INHERITANCE (iframe theme bridge) ===== */

// CSS custom properties do NOT cross document boundaries, so an
// iframe app never inherits shell variables naturally. This bridge
// copies the shell's LIVE computed variables onto the radio root
// (boot + every skin/theme swap via MutationObserver).
var SHELL_VAR_MAP = [
  // [shell variable, radio variable]
  ["--accent",   "--accent"],
  ["--bg",       "--bg"],
  ["--panel-bg", "--panel"],
  ["--text",     "--fg"],
  ["--text-dim", "--muted"],
  ["--border",   "--line"],
  ["--danger",   "--danger"],
  ["--warn",     "--warn"],
  ["--ok",       "--ok"]
];

function readShellVar(name){
  try{
    var v = getComputedStyle(window.parent.document.documentElement)
            .getPropertyValue(name);
    v = (v || "").trim();
    if(v) return v;
  }catch(e){}
  return null;
}

// hex → rgba(), used to derive a soft tint that follows the
// accent (replaces the old hardcoded purple tints in radio.css)
function hexToRgba(hex, alpha){
  var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim());
  if(!m) return null;
  var h = m[1];
  if(h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return "rgba(" + parseInt(h.slice(0,2),16) + "," +
                  parseInt(h.slice(2,4),16) + "," +
                  parseInt(h.slice(4,6),16) + "," + alpha + ")";
}

function inheritPalette(){
  var root = document.documentElement;
  SHELL_VAR_MAP.forEach(function(pair){
    var v = readShellVar(pair[0]);
    if(v) root.style.setProperty(pair[1], v);
  });
  var acc = readShellVar("--accent") || "#6d4aff";
  var soft = hexToRgba(acc, 0.14);
  if(soft) root.style.setProperty("--accent-soft", soft);
}

// LIVE palette tracking: a MutationObserver on the parent <html>
// re-runs the full bridge instantly on skin/theme swaps — zero
// timers, zero polls. If observation fails, the boot value from
// inheritPalette() stands (graceful degradation).
function watchPalette(){
  try{
    var apply = function(){ inheritPalette(); };
    new MutationObserver(apply).observe(
      window.parent.document.documentElement, {
        attributes: true,
        attributeFilter: ["data-skin", "data-theme"]
      });
  }catch(e){ /* same-origin read failed — boot value stands */ }
}

/* ===== DEEP LINK RECEIVER ===== */

window.__orosRadioOpen = function(stationUuid){
  // Called live from the shell (§9i bridge) or from
  // consumeDeepLink() at boot. Look recents first (fresh URLs),
  // favorites second.
  var station = state.recents.find(function(s){
    return s.stationuuid === stationUuid;
  });
  if(!station && state.data){
    station = state.data.favorites.find(function(f){
      return f.stationuuid === stationUuid;
    });
  }
  if(station) playStation(station);
};

function consumeDeepLink(){
  try{
    // Bridge contract (shell §9i): the shell stores a RAW uuid
    // string (one-shot take via __orosRadioTakePending) — never a
    // JSON object. Fall back to direct sessionStorage for shells
    // predating the bridge (also a raw string there).
    var id = null;
    try{
      var w = window.parent;
      if(w && typeof w.__orosRadioTakePending === "function"){
        id = w.__orosRadioTakePending();
      }
    }catch(e){}
    if(!id){
      id = sessionStorage.getItem("oros-radio-open");
      if(id) sessionStorage.removeItem("oros-radio-open");
    }
    if(id) window.__orosRadioOpen(id);
  }catch(e){}
}

/* ===== I18N APPLICATION ===== */

function applyI18n(){
  var map = {
    "rx-tab-discover":  "tab.discover",
    "rx-tab-countries": "tab.countries",
    "rx-tab-genres":    "tab.genres",
    "rx-tab-favorites": "tab.favorites",
    "rx-tab-recents":   "tab.recents"
  };
  Object.keys(map).forEach(function(id){
    var el = $(id);
    if(el) el.textContent = t(map[id]);
  });
  
  var input = $("rx-search-input");
  if(input){
    input.placeholder = t("search.ph");
    input.setAttribute("aria-label", t("search.ph"));
  }
  var sl = $("rx-pl-sleep");
  if(sl){ sl.setAttribute("aria-label", t("sleep.title")); sl.title = t("sleep.title"); }
}

/* ===== WIRING ===== */

function wire(){
  setupTabs();
  setupSearch();
  setupPlayerControls();
  
  // Live updates from the shell-owned host (play/pause/buffering/
  // sleep countdown) — even when state changes originate from the
  // Media Session keys while this app is closed... note: subs are
  // dead-frame-safe (notify splices failures), resubscribed at
  // every boot.
  state.unsubHost = host.api.subscribe(function(){
    updatePlayerUI();
    updateSleepChip();
  });
  
  inheritPalette();
  watchPalette();
  updateOnlineState();
  applyI18n();
}

/* ===== BOOT ===== */

function start(){
  registerSync();
  // FIX-F1: boot-load the synced slice. state.data stayed null on
  // boot, so favoriteToggle()'s null guard made every heart click
  // a silent no-op — isFavorite() always returned false and the
  // toast always said "Removed from favorites".
  state.data = sliceGet();
  loadRecents();
  sweepCache(null);   // RX-7: expired / oversized API cache from older builds
  
  // FIX-6: Check if audio is already playing from shell
  var initialState = getHostState();
  if(initialState.playing){
    var player = $("rx-player");
    if(player) player.removeAttribute("hidden");
  }
  
  renderMain();
  wire();
  consumeDeepLink();
  console.log("[radio] ready — v0.3 Wave 3 complete");
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", start);
}else{
  start();
}

console.log("[radio] part 3/3 loaded");

})();