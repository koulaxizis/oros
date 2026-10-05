// ============================================================
// orOS Television — v0.2 (Wave 2)
// Live TV via iptv-org (community channel directory).
// Single IIFE. Model: TELEVISION v1 { ver, favorites[], deleted{} }
// Slice: oros-television-data · Recents: device-local
// Streams: HLS playback via vendored hls.light.min.js
// API cache: Cache Storage (R30 — channels.json is too big
// for the localStorage 5MB quota)
// Wave 2: stream picker, volume/mute persistence, player
// keyboard shortcuts, cleanup (dead code removed)
// ============================================================

var SCRIPT_V = "";
(function(){ var m=(document.currentScript && document.currentScript.src||"").match(/[?&]v=([^&#]+)/);
  SCRIPT_V=m?m[1]:""; console.log("television.js v"+(SCRIPT_V||"?")+" boot"); })();

(function(){
"use strict";

/* ===== CONFIG ===== */

var TV_VERSION   = 1;
var STORAGE_KEY  = "oros-television-data";      // synced slice
var RECENTS_KEY  = "oros-television-recents";   // device-local, never synced
var RECENTS_CAP  = 20;
var VOL_KEY      = "oros-television-volume";    // device-local, never synced
var API_BASE     = "https://iptv-org.github.io/api";
var API_TTL_MS   = 24 * 60 * 60 * 1000;        // directory refreshes daily
var CACHE_STORE  = "oros-television-api";      // Cache Storage bucket
var PAGE_SIZE    = 120;                         // cards per "Load more"
var MIN_SEARCH   = 3;

/* ===== I18N (inline STRINGS — Bible Part VI, radio pattern) ===== */

var STRINGS = {
  en: {
    "tab.browse":     "Browse",
    "tab.favorites":  "Favorites",
    "tab.recents":    "Recent",
    "filter.all":     "All",
    "search.ph":      "Search channels…",
    "loading":        "Loading channels…",
    "noresults":      "No channels found",
    "nofavorites":    "No favorites yet — tap the star on any channel",
    "norecents":      "Nothing here yet — start watching",
    "more":           "Load more",
    "fav.added":      "Added to favorites",
    "fav.removed":    "Removed from favorites",
    "favorite":       "Add to favorites",
    "unfavorite":     "Remove from favorites",
    "play":           "Play",
    "pause":          "Pause",
    "mute":           "Mute",
    "unmute":         "Unmute",
    "close":          "Close",
    "fullscreen":     "Fullscreen",
    "openExt":        "Open channel website",
    "buffering":      "Buffering…",
    "err.next":       "Stream failed — trying next…",
    "err.nostreams":  "No playable streams for this channel",
    "err.nohls":      "This stream format is not supported here",
    "offline.hint":   "Offline — showing last known data. Playback needs a connection.",
    "catalog.err":    "Couldn't reach the TV directory — check your connection or blockers.",
    "stream.alt":     "Alternate streams",
    "notifs.streamfail.title": "Stream failed",
    "notifs.streamfail.body":  "Couldn't play on this device"
  },
  el: {
    "tab.browse":     "Αναζήτηση",
    "tab.favorites":  "Αγαπημένα",
    "tab.recents":    "Πρόσφατα",
    "filter.all":     "Όλα",
    "search.ph":      "Αναζήτηση καναλιών…",
    "loading":        "Φόρτωση καναλιών…",
    "noresults":      "Δεν βρέθηκαν κανάλια",
    "nofavorites":    "Δεν υπάρχουν αγαπημένα — πάτα το αστέρι σε κάποιο κανάλι",
    "norecents":      "Τίποτα εδώ ακόμα — άρχισε να βλέπεις",
    "more":           "Φόρτωση περισσότερων",
    "fav.added":      "Προστέθηκε στα αγαπημένα",
    "fav.removed":    "Αφαιρέθηκε από τα αγαπημένα",
    "favorite":       "Προσθήκη στα αγαπημένα",
    "unfavorite":     "Αφαίρεση από τα αγαπημένα",
    "play":           "Αναπαραγωγή",
    "pause":          "Παύση",
    "mute":           "Σίγαση",
    "unmute":         "Άρση σίγασης",
    "close":          "Κλείσιμο",
    "fullscreen":     "Πλήρης οθόνη",
    "openExt":        "Άνοιγμα ιστοσελίδας καναλιού",
    "buffering":      "Φόρτωση…",
    "err.next":       "Η ροή απέτυχε — δοκιμάζω την επόμενη…",
    "err.nostreams":  "Δεν υπάρχουν αναπαραγώγιμες ροές για αυτό το κανάλι",
    "err.nohls":      "Η μορφή αυτής της ροής δεν υποστηρίζεται εδώ",
    "offline.hint":   "Εκτός σύνδεσης — εμφανίζονται τα τελευταία γνωστά. Η αναπαραγωγή απαιτεί σύνδεση.",
    "catalog.err":    "Αποτυχία σύνδεσης με τον κατάλογο καναλιών — έλεγξε τη σύνδεση ή τυχόν blockers.",
    "stream.alt":     "Εναλλακτικές ροές",
    "notifs.streamfail.title": "Αποτυχία ροής",
    "notifs.streamfail.body":  "Αδυναμία αναπαραγωγής σε αυτή τη συσκευή"
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

// Payload whitelisting: only what we ever consume crosses the
// sync boundary (Bible Part VII)
function normalizeChannelEntry(f){
  return {
    id:         f.id || "",
    name:       f.name || "",
    url:        f.url || "",
    logo:       f.logo || "",
    country:    f.country || "",
    categories: Array.isArray(f.categories) ? f.categories.slice(0, 8) : [],
    languages:  Array.isArray(f.languages) ? f.languages.slice(0, 4) : [],
    website:    f.website || ""
  };
}

/* ===== STATE ===== */

var state = {
  viewMode: "browse",        // browse | favorites | recents
  data: null,                // slice { ver, favorites[], deleted{} }
  recents: [],
  offline: !navigator.onLine,
  searchQuery: "",
  acItems: [],
  acSel: -1,
  searchTimer: null,
  filterCountry: "",
  filterCategory: "",
  filterLang: "",
  rendered: PAGE_SIZE,       // pagination cursor for the grid
  // catalog (loaded once, never synced):
  catalog: null,             // { channels[], byId{}, streams{} }
  catalogPromise: null,
  catalogFailed: false,      // fetch rejected — spinner must die
  // player:
  playerCh: null,            // channel currently in the dialog
  streamIdx: 0,              // index into playerCh.streams[]
  hls: null,                 // live Hls instance (destroyed on switch)
  persistedVol: 1,           // loaded from localStorage
  persistedMuted: false      // loaded from localStorage
};

var __orosSyncApi = null;

/* ===== SYNC CONTRACT (Bible Part V/VI, 5-arg — radio mirror) ===== */

function saveLocal(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); }catch(e){}
}

function sliceGet(){
  var obj = null;
  try{ obj = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }catch(e){}
  if(!obj) obj = { ver: TV_VERSION, favorites: [], deleted: {} };
  normalizeState(obj);
  return JSON.parse(JSON.stringify(obj)); // deep copy getter
}

function normalizeState(obj){
  if(typeof obj.ver !== "number") obj.ver = TV_VERSION;
  if(!Array.isArray(obj.favorites)) obj.favorites = [];
  if(!obj.deleted || typeof obj.deleted !== "object") obj.deleted = {};
  obj.favorites = obj.favorites.filter(function(f){
    return f && f.id && typeof f.mtime === "number";
  });
  sortFavorites(obj.favorites);
}

function sortFavorites(arr){
  arr.sort(function(a, b){
    if(b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); // deterministic tie-break
  });
}

function sliceSet(payload){
  // Pull path: suppress echo, write, normalize, re-render. NO toast.
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

// R5-symmetric merge: union by channel id, LWW by mtime,
// lexicographic JSON tie-break, tombstones (delete wins ties,
// newer edit resurrects) — byte-exact mirror of mergeRadioStates
function mergeTelevisionStates(remote, local){
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
    if(!f || !f.id) return;
    var ex = map[f.id];
    if(!ex || f.mtime > ex.mtime ||
       (f.mtime === ex.mtime && JSON.stringify(f) > JSON.stringify(ex))){
      map[f.id] = f;
    }
  }
  (remote.favorites || []).forEach(ins);
  (local.favorites || []).forEach(ins);

  Object.keys(map).forEach(function(u){
    if(map[u].mtime > (dec[u] || 0)) merged.favorites.push(map[u]); // alive
  });
  sortFavorites(merged.favorites);
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
  api.registerSlice("television", sliceGet, sliceSet, STORAGE_KEY, mergeTelevisionStates);
}

/* ===== DEEP-LINK RECEIVER (shell bridge counterpart) ===== */

// Resolve a channel by id even when the catalog hasn't loaded or
// the channel was dropped from the directory: fall back to the
// favorite entry (it carries a snapshot URL) — recents stay
// device-local and are never a deep-link target by design.
function resolveChannelById(id){
  if(state.catalog && state.catalog.byId[id]) return state.catalog.byId[id];
  var fav = state.data && state.data.favorites.find(function(f){
    return f.id === id;
  });
  if(fav && fav.url){
    return {
      id: fav.id,
      name: fav.name,
      logo: fav.logo || "",
      country: fav.country || "",
      website: fav.website || "",
      streams: [{ url: fav.url, quality: "" }]
    };
  }
  return null;
}

// Called live by the shell when the app iframe is already running,
// or once at boot after consuming the sessionStorage payload.
function openFromShell(payload){
  if(!payload || !payload.channelId) return;
  loadCatalog().then(function(){
    var ch = resolveChannelById(payload.channelId);
    if(ch) playChannel(ch);
  }).catch(function(){
    // Catalog unreachable (offline) — favorites still resolve
    var ch = resolveChannelById(payload.channelId);
    if(ch) playChannel(ch);
  });
}

window.__orosTelevisionOpen = function(payload){ openFromShell(payload); };

/* ===== CONTRACT Β — shortcut forwarding ===== */

document.addEventListener("keydown", function(e){
  if(!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
  var p = window.parent;
  if(!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
  if(p.orosShortcuts.handle(e)) e.stopPropagation();
}, true);

/* ===== TRANSIENT NOTE (canonical helper + local fallback) ===== */

var toastEl = null, toastTimer = null;

function localToast(text){
  toastEl = document.getElementById("tv-toast");
  if(!toastEl){
    toastEl = document.createElement("div");
    toastEl.id = "tv-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.removeAttribute("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.setAttribute("hidden", ""); }, 5000);
}

function transientNote(text){
  var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
  if(n && typeof n.transient === "function"){
    n.transient({ ns: "television", title: text });
    return;
  }
  localToast(text); // stale-bundle / standalone fallback
}

// #6 — persistent notification on TERMINAL playback failure
// (auto-fallback exhausted / unsupported format). Dedup per
// channel per hour: a flaky channel spams the inbox no more.
function notifyStreamFail(ch){
  if(!ch || !ch.id) return;
  try{
    var n = (window.parent && window.parent.orosNotifs) || window.orosNotifs;
    if(!n || typeof n.emit !== "function") return;
    n.emit({
      ns: "television",
      type: "error",
      title: t("notifs.streamfail.title"),
      body: t("notifs.streamfail.body") + " — " + ch.name,
      deepLink: "television:channel:" + ch.id,
      key: "streamfail:" + ch.id + ":" + Math.floor(Date.now() / 3600000),
      ttlDays: 3
    });
  }catch(e){}
}

/* ===== OFFLINE TRACKING ===== */

function updateOnlineState(){
  var wasOffline = state.offline;
  state.offline = !navigator.onLine;
  if(state.offline !== wasOffline){
    renderMain();
    if(state.offline) transientNote(t("offline.hint"));
  }
}

window.addEventListener("online", updateOnlineState);
window.addEventListener("offline", updateOnlineState);

/* ===== API CACHE (Cache Storage — R30) ===== */

var HAS_CS = false;
try{ HAS_CS = (typeof caches !== "undefined" && typeof caches.open === "function"); }catch(e){}

// TV-6: any Cache Storage op can stall indefinitely while the SW
// is activating/purging (observed: 0 fetches started, 0 rejections,
// spinner forever). Race with a timeout — a stalled cache read
// degrades to a network fetch instead of a dead boot.
function cachedGet(file, allowStale){
  if(!HAS_CS) return Promise.resolve(null);
  var read = caches.open(CACHE_STORE).then(function(cs){
    return cs.match(file);
  }).then(function(res){
    if(!res) return null;
    return res.json();
  }).then(function(wrap){
    if(!wrap || !wrap.ts) return null;
    if(!allowStale && Date.now() - wrap.ts > API_TTL_MS) return null;
    return wrap.data;
  });
  var guard = new Promise(function(resolve){
    setTimeout(function(){ resolve("__CACHE_TIMEOUT__"); }, 6000);
  });
  return Promise.race([read, guard]).then(function(v){
    if(v === "__CACHE_TIMEOUT__") return null;   // stalled → network
    return v;
  }).catch(function(){ return null; });
}

function cachedPut(file, data){
  if(!HAS_CS) return;
  caches.open(CACHE_STORE).then(function(cs){
    return cs.put(file, new Response(JSON.stringify({ ts: Date.now(), data: data })));
  }).catch(function(){ /* quota or opaque origin — degrade to no cache */ });
}

function apiFetch(file){
  console.log("[tv-dbg] apiFetch:", file, "| offline:", state.offline);
  if(HAS_CS){
    return cachedGet(file, state.offline).then(function(known){
      console.log("[tv-dbg]", file, "cacheHit:", !!known);
      if(known) return known;
      return netFetch(file);
    });
  }
  return netFetch(file);
}

function netFetch(file){
  if(state.offline) return Promise.reject(new Error("offline"));
  // TV-N1: a plain fetch() can hang forever without ever rejecting
  // (observed as an eternal spinner — catalogFailed only fires on
  // rejection). AbortController gives every request a hard ceiling;
  // streams.json is ~20MB, so it gets the bigger ceiling.
  var ms = file === "streams.json" ? 30000 : 12000;
  var ctl = (typeof AbortController === "function") ? new AbortController() : null;
  var timer = ctl ? setTimeout(function(){ ctl.abort(); }, ms) : null;
  var opts = { cache: "no-store" };
  if(ctl) opts.signal = ctl.signal;
  console.log("[tv-dbg] netFetch:", file, "→", API_BASE + "/" + file);
  return fetch(API_BASE + "/" + file, opts).then(function(res){
    console.log("[tv-dbg]", file, "HTTP:", res.status);
    if(timer) clearTimeout(timer);
    if(!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then(function(data){
    console.log("[tv-dbg]", file, "parsed:", Array.isArray(data) ? data.length : typeof data);
    if(timer) clearTimeout(timer);
    cachedPut(file, data);
    return data;
  }).catch(function(err){
    console.warn("[tv-dbg]", file, "netFetch ERROR:", err && err.message);
    if(timer) clearTimeout(timer);
    // network failed — fall back to stale cache honestly
    return cachedGet(file, true).then(function(stale){
      if(stale) return stale;
      throw err;
    });
  });
}

/* ===== API LAYER (iptv-org) ===== */

function loadCatalog(){
  if(state.catalog) return Promise.resolve(state.catalog);
  if(state.catalogPromise) return state.catalogPromise;

  // TV-N2: last-resort watchdog. Whatever hangs — cache layer,
  // network, or parsing — the catalog promise MUST settle, because
  // an eternally pending promise means an eternally pending
  // spinner (catalogFailed only fires on rejection). Late success
  // after a watchdog trip is not wasted: cachedPut() has already
  // landed the data, so a retry resolves from cache instantly.
  var work = Promise.all([
    apiFetch("channels.json"),
    apiFetch("streams.json"),
    apiFetch("countries.json"),
    apiFetch("categories.json"),
    apiFetch("languages.json")
  ]);
  var watchdog = new Promise(function(_, reject){
    setTimeout(function(){ reject(new Error("catalog timeout")); }, 45000);
  });
  state.catalogPromise = Promise.race([work, watchdog  ]).then(function(results){
    console.log("[tv-dbg] Promise.all RESOLVED — sizes:",
      results.map(function(r){ return r ? (Array.isArray(r) ? r.length : "?") : "null"; }));
    var channelsRaw = results[0] || [];
    var streamsRaw   = results[1] || [];
    var countriesRaw = results[2] || [];
    var categoriesRaw= results[3] || [];
    var languagesRaw = results[4] || [];

    // Display-name indexes for the filter selects
    var countryNames = {};
    countriesRaw.forEach(function(c){ countryNames[c.code] = c.name || c.code; });
    var categoryNames = {};
    categoriesRaw.forEach(function(c){ categoryNames[c.id] = c.name || c.id; });
    var languageNames = {};
    languagesRaw.forEach(function(l){ languageNames[l.code] = l.name || l.code; });

    // Group streams by channel id. Streams with referrer/user_agent
    // requirements CANNOT play in a browser (no way to set those
    // headers from fetch/media elements) — dropped up front.
    var streamsByChannel = {};
    streamsRaw.forEach(function(s){
      if(!s || !s.channel || !s.url) return;
      if(s.referrer || s.user_agent) return;
      var list = streamsByChannel[s.channel] = streamsByChannel[s.channel] || [];
      list.push({ url: s.url, quality: s.quality || "" });
    });

    // Normalized channel list — only channels WITH playable
    // streams ever enter the browse grid.
    var channels = [];
    var byId = {};
    channelsRaw.forEach(function(c){
      if(!c || !c.id) return;
      var streams = streamsByChannel[c.id];
      if(!streams || !streams.length) return;
      var ch = {
        id:         c.id,
        name:       c.name || c.id,
        logo:       (c.pictures && c.pictures.logo) || "",
        country:    c.country || "",
        categories: Array.isArray(c.categories) ? c.categories : [],
        languages: Array.isArray(c.languages) ? c.languages : [],
        website:    c.website || "",
        streams:    streams
      };
      byId[ch.id] = ch;
      channels.push(ch);
    });

    // Deterministic order (API order is not guaranteed stable
    // between releases; the merge contract needs determinism)
    channels.sort(function(a, b){
      return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    });

    var catalog = {
      channels: channels,
      byId: byId,
      countryNames: countryNames,
      categoryNames: categoryNames,
      languageNames: languageNames
    };
    state.catalogFailed = false;
    state.catalog = catalog;
    return catalog;
  }).catch(function(err){
    console.warn("[television] catalog load failed:", err && err.message);
    state.catalogFailed = true;   // spinner → honest error message
    state.catalogPromise = null; // allow retry on next interaction
    throw err;
  });

  return state.catalogPromise;
}

/* ===== RECENTS (device-local, radio pattern) ===== */

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

function addRecent(channel){
  // Dedup by channel id
  state.recents = state.recents.filter(function(c){
    return c.id !== channel.id;
  });
  state.recents.unshift({
    id: channel.id,
    name: channel.name,
    logo: channel.logo || "",
    url: (channel.streams && channel.streams[0] && channel.streams[0].url) || channel.url || "",
    country: channel.country || "",
    website: channel.website || "",
    mtime: Date.now()
  });
  if(state.recents.length > RECENTS_CAP) state.recents = state.recents.slice(0, RECENTS_CAP);
  saveRecents();
}

/* ===== FAVORITES MANAGEMENT (radio pattern, id-keyed) ===== */

function isFavorite(id){
  if(!state.data) return false;
  return !!state.data.favorites.find(function(f){ return f.id === id; });
}

function favoriteToggle(channel){
  if(!state.data) return;

  var payload = sliceGet();
  var existing = payload.favorites.find(function(f){
    return f.id === channel.id;
  });

  if(existing){
    payload.favorites = payload.favorites.filter(function(f){
      return f.id !== channel.id;
    });
    payload.deleted[channel.id] = Date.now();
  }else{
    var entry = normalizeChannelEntry({
      id: channel.id,
      name: channel.name,
      logo: channel.logo,
      country: channel.country,
      categories: channel.categories,
      languages: channel.languages,
      website: channel.website,
      url: (channel.streams && channel.streams[0] && channel.streams[0].url) || ""
    });
    entry.mtime = Date.now();
    payload.favorites.push(entry);
  }

  sliceSet(payload);
  commitLocal();
}

/* ===== VOLUME/MUTE PERSISTENCE (device-local) ===== */

function loadVolumePrefs(){
  try{
    var raw = localStorage.getItem(VOL_KEY);
    if(raw){
      var prefs = JSON.parse(raw);
      if(prefs && typeof prefs.vol === "number") state.persistedVol = prefs.vol;
      if(prefs && typeof prefs.muted === "boolean") state.persistedMuted = prefs.muted;
    }
  }catch(e){}
}

function applyVolumePrefs(){
  var video = $("#tvp-video");
  if(!video) return;
  video.volume = state.persistedVol;
  video.muted = state.persistedMuted;
  var slider = $("#tvp-vol");
  if(slider) slider.value = state.persistedVol;
}

function saveVolumePrefs(){
  var video = $("#tvp-video");
  if(!video) return;
  try{
    localStorage.setItem(VOL_KEY, JSON.stringify({
      vol: video.volume,
      muted: video.muted
    }));
  }catch(e){}
}

/* ===== DOM RENDERERS ===== */

function renderMain(){
  var grid = $("#tv-grid");
  var empty = $("#tv-empty");
  var msg = $("#tv-empty-msg");
  var moreBtn = $("#tv-more");
  var tabs = document.querySelectorAll(".tv-tab");

  if(!grid || !empty) return;

  // Update tab states
  tabs.forEach(function(tab){
    var isActive = tab.dataset.tab === state.viewMode;
    tab.classList.toggle("active", isActive);
  });

  // Clear view
  grid.innerHTML = "";
  empty.setAttribute("hidden", "");
  if(moreBtn) moreBtn.setAttribute("hidden", "");

  // Loading indicator: visible only while the catalog is being
  // fetched for the first time in browse view.
  var loading = $("#tv-loading");
  if(loading){
    if(state.viewMode === "browse" && !state.catalog && !state.catalogFailed && !state.offline){
      loading.removeAttribute("hidden");
    }else{
      loading.setAttribute("hidden", "");
    }
  }

  // Render based on view mode
  switch(state.viewMode){
    case "browse":
      renderBrowse(grid);
      break;

    case "favorites":
      renderFavorites(grid);
      if(!state.data || !state.data.favorites || state.data.favorites.length === 0){
        msg.textContent = t("nofavorites");
        empty.removeAttribute("hidden");
      }
      break;

    case "recents":
      renderRecents(grid);
      if(!state.recents.length){
        msg.textContent = t("norecents");
        empty.removeAttribute("hidden");
      }
      break;
  }
}

function renderBrowse(container){
  // Still loading (in flight, not failed) — spinner stays
  if(!state.catalog && !state.catalogFailed && !state.offline){
    return; // #tv-loading handles this via CSS/JS
  }

  if(!state.catalog || !state.catalog.channels.length){
    var msg = $("#tv-empty-msg");
    var empty = $("#tv-empty");
    if(msg){
      msg.textContent = state.offline ? t("offline.hint") : t("catalog.err");
      empty.removeAttribute("hidden");
    }
    return;
  }

  // Apply filters
  var filtered = state.catalog.channels.filter(function(ch){
    if(state.filterCountry && ch.country !== state.filterCountry) return false;
    if(state.filterCategory && !ch.categories.includes(state.filterCategory)) return false;
    if(state.filterLang && !ch.languages.includes(state.filterLang)) return false;
    return true;
  });

  // Search
  if(state.searchQuery && state.viewMode === "browse"){
    var q = state.searchQuery.toLowerCase();
    filtered = filtered.filter(function(ch){
      return ch.name.toLowerCase().indexOf(q) >= 0;
    });
  }

  // Render paginated
  var end = state.rendered;
  var slice = filtered.slice(0, end);
  slice.forEach(function(ch){
    var card = createChannelCard(ch);
    container.appendChild(card);
  });

  // No-results empty state (filters or search matched nothing)
  if(!filtered.length){
    var em = $("#tv-empty-msg");
    var ee = $("#tv-empty");
    if(em){
      em.textContent = t("noresults");
      ee.removeAttribute("hidden");
    }
    return;
  }

  // "Load more" button
  if(end < filtered.length){
    var btn = $("#tv-more");
    if(btn){
      btn.removeAttribute("hidden");
    }
  }
}

function renderFavorites(container){
  if(!state.data || !state.data.favorites.length) return;

  state.data.favorites.forEach(function(fav){
    var ch = (state.catalog && state.catalog.byId[fav.id]) || null;
    if(!ch){
      // Channel not in current catalog (removed/renamed?) — show minimal card
      ch = {
        id: fav.id,
        name: fav.name,
        logo: fav.logo || "",
        country: fav.country || "",
        website: fav.website || "",
        streams: fav.url ? [{ url: fav.url, quality: "" }] : []
      };
    }
    var card = createChannelCard(ch);
    container.appendChild(card);
  });
}

function renderRecents(container){
  if(!state.recents.length) return;

  state.recents.forEach(function(rec){
    var ch = (state.catalog && state.catalog.byId[rec.id]) || null;
    if(!ch){
      // Recent entry still valid with its own stream
      ch = {
        id: rec.id,
        name: rec.name,
        logo: rec.logo || "",
        country: rec.country || "",
        website: rec.website || "",
        streams: rec.url ? [{ url: rec.url, quality: "" }] : []
      };
    }
    var card = createChannelCard(ch);
    container.appendChild(card);
  });
}

function createChannelCard(channel){
  var card = document.createElement("div");
  card.className = "tv-card";
  card.dataset.id = channel.id;

  // Radio overlay pattern: initials underneath, lazy logo on
  // top, self-remove on error — no inline-JS string gymnastics.
  var initials = (channel.name || "?").substring(0, 2).toUpperCase();
  var logoHtml = '<div class="tv-logo"><span class="tv-nologo">' + esc(initials) + '</span>';
  if(channel.logo){
    logoHtml += '<img src="' + esc(channel.logo) +
      '" alt="" loading="lazy" onerror="this.remove()">';
  }
  logoHtml += '</div>';

  // Metadata line
  var metaParts = [];
  if(channel.country && state.catalog && state.catalog.countryNames[channel.country]){
    metaParts.push(esc(state.catalog.countryNames[channel.country]));
  }
  if(channel.categories && channel.categories.length){
    var cn = state.catalog && state.catalog.categoryNames[channel.categories[0]];
    metaParts.push(esc(cn || channel.categories[0]));
  }

  // Favorite star (absolute position, NOT a button-inside-button)
  var isFav = isFavorite(channel.id);
  var starClass = isFav ? "tv-fav on" : "tv-fav";

  card.innerHTML =
    logoHtml +
    '<span class="' + starClass + '" data-id="' + esc(channel.id) + '" ' +
    'title="' + esc(isFav ? t("unfavorite") : t("favorite")) + '">' +
    (isFav ? "★" : "☆") + '</span>' +
    '<div class="tv-name">' + esc(channel.name) + '</div>' +
    '<div class="tv-meta">' +
    metaParts.join(' · ') +
    '</div>';

  // Click handler (play)
  card.addEventListener("click", function(e){
    // Ignore if star clicked
    if(e.target.classList.contains("tv-fav")) return;
    playChannel(channel);
  });

  // Star touch twin (separate event listener for better UX)
  var star = card.querySelector(".tv-fav");
  if(star){
    star.addEventListener("click", function(e){
      e.stopPropagation();
      favoriteToggle(channel);
      var nowFav = isFavorite(channel.id);
      star.className = nowFav ? "tv-fav on" : "tv-fav";
      star.textContent = nowFav ? "★" : "☆";
      star.title = nowFav ? t("unfavorite") : t("favorite");
      transientNote(nowFav ? t("fav.added") : t("fav.removed"));
    });
  }

  return card;
}

/* ===== FILTER HANDLERS ===== */

function setupFilters(){
  var countrySelect = $("#tv-country");
  var catSelect = $("#tv-category");
  var langSelect = $("#tv-lang");

  // Populate selects once (after catalog loads)
  loadCatalog().then(function(cat){
    // Country
    if(countrySelect){
      countrySelect.innerHTML = '<option value="">' + esc(t("filter.all")) + '</option>';
      Object.keys(cat.countryNames).sort().forEach(function(code){
        var opt = document.createElement("option");
        opt.value = code;
        opt.textContent = cat.countryNames[code];
        countrySelect.appendChild(opt);
      });
    }

    // Category
    if(catSelect){
      catSelect.innerHTML = '<option value="">' + esc(t("filter.all")) + '</option>';
      Object.keys(cat.categoryNames).sort().forEach(function(id){
        var opt = document.createElement("option");
        opt.value = id;
        opt.textContent = cat.categoryNames[id];
        catSelect.appendChild(opt);
      });
    }

    // Language
    if(langSelect){
      langSelect.innerHTML = '<option value="">' + esc(t("filter.all")) + '</option>';
      Object.keys(cat.languageNames).sort().forEach(function(code){
        var opt = document.createElement("option");
        opt.value = code;
        opt.textContent = cat.languageNames[code];
        langSelect.appendChild(opt);
      });
    }
  });

  // Change handlers
  if(countrySelect){
    countrySelect.addEventListener("change", function(){
      state.filterCountry = this.value;
      state.rendered = PAGE_SIZE;
      renderMain();
    });
  }

  if(catSelect){
    catSelect.addEventListener("change", function(){
      state.filterCategory = this.value;
      state.rendered = PAGE_SIZE;
      renderMain();
    });
  }

  if(langSelect){
    langSelect.addEventListener("change", function(){
      state.filterLang = this.value;
      state.rendered = PAGE_SIZE;
      renderMain();
    });
  }
}

/* ===== SEARCH & AUTOCOMPLETE ===== */

function setupSearch(){
  var input = $("#tv-search");
  var ac = $("#tv-ac");
  if(!input) return;

  // Enter without autocomplete selection → filter the grid
  input.addEventListener("keydown", function(e){
    if(e.key === "Enter" && !state.acItems.length &&
       this.value.trim().length >= MIN_SEARCH){
      state.searchQuery = this.value.trim();
      state.rendered = PAGE_SIZE;
      renderMain();
      this.blur();
      return;
    }
    if(!state.acItems.length) return;

    if(e.key === "ArrowDown"){
      e.preventDefault();
      state.acSel = Math.min(state.acSel + 1, state.acItems.length - 1);
      updateAcSelection();
    }else if(e.key === "ArrowUp"){
      e.preventDefault();
      state.acSel = Math.max(state.acSel - 1, 0);
      updateAcSelection();
    }else if(e.key === "Enter"){
      if(state.acSel >= 0 && state.acItems[state.acSel]){
        e.preventDefault();
        selectAcItem(state.acItems[state.acSel]);
      }else if(this.value.trim().length >= MIN_SEARCH){
        // dropdown open, nothing selected — fall back to grid search
        state.searchQuery = this.value.trim();
        state.rendered = PAGE_SIZE;
        renderMain();
        this.blur();
        var acEl = $("#tv-ac");
        if(acEl) acEl.setAttribute("hidden", "");
        state.acItems = [];
        state.acSel = -1;
      }
    }else if(e.key === "Escape"){
      e.preventDefault();
      if(ac) ac.setAttribute("hidden", "");
      state.acItems = [];
      state.acSel = -1;
    }
  });

  // Debounced live search (autocomplete)
  input.addEventListener("input", function(){
    clearTimeout(state.searchTimer);
    var val = this.value.trim();

    if(val.length >= MIN_SEARCH){
      var self = this;
      state.searchTimer = setTimeout(function(){
        loadCatalog().then(function(cat){
          if(self.value.trim() !== val) return; // stale
          // Search in-memory (fast, cached)
          var q = val.toLowerCase();
          var results = cat.channels.filter(function(ch){
            return ch.name.toLowerCase().indexOf(q) >= 0;
          }).slice(0, 8);

          renderAutocomplete(results);
        });
      }, 300);
    }else{
      if(ac) ac.setAttribute("hidden", "");
      state.acItems = [];
      state.acSel = -1;
      // Clear grid search when query drops below threshold
      if(state.searchQuery){
        state.searchQuery = "";
        state.rendered = PAGE_SIZE;
        renderMain();
      }
    }
  });

  // Blur closes the autocomplete (delayed so item clicks land first)
  input.addEventListener("blur", function(){
    setTimeout(function(){
      if(ac) ac.setAttribute("hidden", "");
      state.acItems = [];
      state.acSel = -1;
    }, 150);
  });

  // Load more button
  var moreBtn = $("#tv-more");
  if(moreBtn){
    moreBtn.addEventListener("click", function(){
      state.rendered += PAGE_SIZE;
      renderMain();
    });
  }

  // Tabs
  setupTabs();
}

function renderAutocomplete(items){
  var ac = $("#tv-ac");
  if(!ac) return;

  ac.innerHTML = "";
  state.acItems = items;
  state.acSel = -1;

  if(!items.length){
    ac.setAttribute("hidden", "");
    return;
  }

  items.forEach(function(ch, idx){
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tv-ac-item";
    btn.dataset.idx = idx;

    var name = ch.name || "";
    var sub = ch.country && state.catalog && state.catalog.countryNames[ch.country]
      ? state.catalog.countryNames[ch.country]
      : "";

    btn.innerHTML = '<span class="tv-ac-name">' + esc(name) + '</span>' +
      (sub ? '<span class="tv-ac-sub">' + esc(sub) + '</span>' : "");

    btn.addEventListener("mouseenter", function(){
      state.acSel = idx;
      updateAcSelection();
    });
    btn.addEventListener("click", function(){ selectAcItem(ch); });

    ac.appendChild(btn);
  });

  // Positioning is pure CSS (#tv-ac is absolute within
  // .tv-search-wrap) — no JS geometry, no viewport drift.
  ac.removeAttribute("hidden");
}

function updateAcSelection(){
  var ac = $("#tv-ac");
  if(!ac) return;

  var items = ac.querySelectorAll(".tv-ac-item");
  items.forEach(function(item, idx){
    item.classList.toggle("sel", idx === state.acSel);
  });
}

function selectAcItem(channel){
  var input = $("#tv-search");
  if(input){
    input.value = channel.name;
    input.blur();
  }
  state.viewMode = "browse";
  state.searchQuery = channel.name;
  state.rendered = PAGE_SIZE;
  renderMain();               // grid reflects the selected query
  playChannel(channel);
  var ac = $("#tv-ac");
  if(ac) ac.setAttribute("hidden", "");
  state.acItems = [];
  state.acSel = -1;
}

/* ===== TAB HANDLERS ===== */

function setupTabs(){
  document.querySelectorAll(".tv-tab").forEach(function(tab){
    tab.addEventListener("click", function(){
      var mode = this.dataset.tab;
      state.viewMode = mode;
      state.filterCountry = "";
      state.filterCategory = "";
      state.filterLang = "";
      state.searchQuery = "";
      state.rendered = PAGE_SIZE;

      var countrySelect = $("#tv-country");
      var catSelect = $("#tv-category");
      var langSelect = $("#tv-lang");
      if(countrySelect) countrySelect.value = "";
      if(catSelect) catSelect.value = "";
      if(langSelect) langSelect.value = "";

      var input = $("#tv-search");
      if(input) input.value = "";

      renderMain();
    });
  });
}

/* ===== PLAYER LOGIC ===== */

function playChannel(channel){
  // Add to recents
  addRecent(channel);

  // Open dialog
  openPlayer(channel);
}

function openPlayer(channel){
  state.playerCh = channel;
  state.streamIdx = 0;

  var dlg = $("#tv-player");
  if(!dlg) return;

  // Title & meta
  $("tvp-title").textContent = channel.name;
  $("tvp-meta").textContent = (channel.country && state.catalog && state.catalog.countryNames[channel.country]) || "";
  $("tvp-labels").textContent = (channel.categories && channel.categories.join(", ")) || "";

  // Restore volume/mute preferences for this session
  applyVolumePrefs();

  // Build stream picker (all available streams for this channel)
  buildStreamPicker(channel);

  // Try first stream
  tryStream();

  dlg.showModal();
}

function tryStream(){
  var ch = state.playerCh;
  if(!ch || !ch.streams || !ch.streams.length){
    showError(t("err.nostreams"));
    buildStreamPicker(null);
    return;
  }

  if(state.streamIdx >= ch.streams.length){
    showError(t("err.nostreams"));
    notifyStreamFail(ch);
    return;
  }

  var stream = ch.streams[state.streamIdx];
  var video = $("#tvp-video");
  var status = $("#tvp-status");

  if(status){
    status.removeAttribute("hidden");
    status.textContent = t("buffering");
    status.classList.remove("err");
  }

  // Keep the picker selection in sync with auto-fallback
  var pick = $("#tvp-streampick");
  if(pick && !pick.hidden) pick.value = String(state.streamIdx);

  // Route by stream type — only .m3u8 URLs trigger HLS handling
  var isHlsUrl = /\.m3u8(\?|$)/i.test(stream.url);

  if(isHlsUrl && window.Hls && Hls.isSupported()){
    // hls.js for MSE-capable browsers
    if(state.hls){
      state.hls.destroy();
    }
    state.hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 90
    });
    state.hls.loadSource(stream.url);
    state.hls.attachMedia(video);
    state.hls.on(Hls.Events.MANIFEST_PARSED, function(){
      video.play().catch(function(){
        // autoplay policy — retry muted, user can unmute
        video.muted = true;
        video.play().catch(function(e){
          console.warn("[television] play rejected:", e && e.message);
        });
      });
    });
    state.hls.on(Hls.Events.ERROR, function(event, data){
      handleHlsError(data);
    });
    state.hls.on(Hls.Events.FRAG_LOADED, function(){
      // Hide buffering on first fragment
      if(status && !video.paused){
        status.setAttribute("hidden", "");
      }
    });
  }else if(isHlsUrl && video.canPlayType("application/vnd.apple.mpegurl")){
    // Native HLS (Safari/iOS) — only for .m3u8 URLs
    video.src = stream.url;
    video.onerror = handleNativeError;
    video.play().catch(function(e){
      console.warn("[television] play rejected:", e && e.message);
    });
  }else{
    // Non-HLS URL → direct playback. HLS URL with neither
    // hls.js nor native support → honest error, no doomed attempt.
    if(isHlsUrl){
      showError(t("err.nohls"));
      notifyStreamFail(ch);
      return;
    }
    video.src = stream.url;
    video.onerror = handleNativeError;
    video.play().catch(function(e){
      console.warn("[television] play rejected:", e && e.message);
    });
  }

  // Update UI
  updatePlayerUI();
}

/* ===== STREAM PICKER ===== */

function buildStreamPicker(channel){
  var sel = $("#tvp-streampick");
  if(!sel) return;

  if(!channel || !channel.streams || channel.streams.length <= 1){
    sel.setAttribute("hidden", "");
    return;
  }

  sel.innerHTML = "";
  channel.streams.forEach(function(s, idx){
    var opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = s.quality || ("#" + (idx + 1));
    sel.appendChild(opt);
  });

  sel.value = String(state.streamIdx);
  sel.removeAttribute("hidden");
}

function handleHlsError(data){
  var status = $("#tvp-status");
  if(data.fatal){
    switch(data.type){
      case Hls.ErrorTypes.NETWORK_ERROR:
        console.warn("[television] network error, trying next stream...");
        if(status) status.textContent = t("err.next");
        state.streamIdx++;
        if(state.hls) state.hls.destroy();
        state.hls = null;
        tryStream(); // try next
        break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        state.hls.recoverMediaError();
        break;
      default:
        state.streamIdx++;
        if(state.hls) state.hls.destroy();
        state.hls = null;
        tryStream();
        break;
    }
  }
}

function handleNativeError(){
  state.streamIdx++;
  tryStream();
}

function showError(msg){
  var status = $("#tvp-status");
  if(status){
    status.textContent = msg;
    status.classList.add("err");
    status.removeAttribute("hidden");
  }
}

function closePlayer(){
  var video = $("#tvp-video");
  var dlg = $("#tv-player");

  if(state.hls){
    state.hls.destroy();
    state.hls = null;
  }

  if(video){
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  // Persist volume/mute on close
  saveVolumePrefs();

  if(dlg) dlg.close();
  state.playerCh = null;
}

function updatePlayerUI(){
  var playBtn = $("#tvp-play");
  var muteBtn = $("#tvp-mute");
  var volSlider = $("#tvp-vol");
  var favBtn = $("#tvp-fav");
  var extBtn = $("#tvp-ext");

  if(playBtn){
    var video = $("#tvp-video");
    playBtn.innerHTML = video && !video.paused
      ? '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
      : '<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>';
    playBtn.setAttribute("aria-label", video && !video.paused ? t("pause") : t("play"));
  }

  if(muteBtn && volSlider){
    var video = $("#tvp-video");
    var muted = video ? video.muted : false;
    muteBtn.innerHTML = muted
      ? '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
    muteBtn.setAttribute("aria-label", muted ? t("unmute") : t("mute"));
    volSlider.value = video ? video.volume : 1;
  }

  if(favBtn && state.playerCh){
    var isFav = isFavorite(state.playerCh.id);
    favBtn.innerHTML = isFav
      ? '<svg viewBox="0 0 24 24"><polygon points="12,2 15,10 24,10 17,15 20,24 12,18 4,24 7,15 0,10 9,10"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 15,10 24,10 17,15 20,24 12,18 4,24 7,15 0,10 9,10"/></svg>';
    favBtn.classList.toggle("on", isFav);
  }

  if(extBtn && state.playerCh && state.playerCh.website){
    extBtn.removeAttribute("disabled");
  }
}

// Fullscreen the whole .tvp-video wrapper (video + status badge),
// not the bare <video> — the badge would be left outside the
// fullscreen layer. Bare-video fallback for stubborn engines.
function toggleFullscreen(){
  if(document.fullscreenElement){
    document.exitFullscreen();
    return;
  }
  var video = $("#tvp-video");
  if(!video) return;
  var wrap = video.closest(".tvp-video") || video;
  if(wrap.requestFullscreen){
    wrap.requestFullscreen().catch(function(){});
  }else if(video.requestFullscreen){
    video.requestFullscreen().catch(function(){});
  }
}

/* ===== PLAYER CONTROLS ===== */

function setupPlayerControls(){
  var playBtn = $("#tvp-play");
  var muteBtn = $("#tvp-mute");
  var volSlider = $("#tvp-vol");
  var favBtn = $("#tvp-fav");
  var extBtn = $("#tvp-ext");
  var fsBtn = $("#tvp-fs");
  var closeBtn = $("#tvp-close");

  if(playBtn){
    playBtn.addEventListener("click", function(){
      var video = $("#tvp-video");
      if(!video) return;
      if(video.paused){
        video.play().catch(function(){});
      }else{
        video.pause();
      }
      updatePlayerUI();
    });
  }

  if(muteBtn){
    muteBtn.addEventListener("click", function(){
      var video = $("#tvp-video");
      if(!video) return;
      video.muted = !video.muted;
      saveVolumePrefs();
      updatePlayerUI();
    });
  }

  if(volSlider){
    volSlider.addEventListener("input", function(){
      var video = $("#tvp-video");
      if(!video) return;
      video.volume = parseFloat(this.value);
      if(video.volume > 0 && video.muted) video.muted = false;
      saveVolumePrefs();
    });
  }

  if(favBtn){
    favBtn.addEventListener("click", function(){
      if(state.playerCh){
        favoriteToggle(state.playerCh);
        updatePlayerUI();
      }
    });
  }

  if(extBtn){
    extBtn.addEventListener("click", function(){
      if(state.playerCh && state.playerCh.website){
        window.open(state.playerCh.website, "_blank");
      }
    });
  }

  if(fsBtn){
    fsBtn.addEventListener("click", function(){
      toggleFullscreen();
    });
  }

  if(closeBtn){
    closeBtn.addEventListener("click", function(){
      closePlayer();
    });
  }

  // Stream picker: manual selection switches source immediately
  var streamPick = $("#tvp-streampick");
  if(streamPick){
    streamPick.addEventListener("change", function(){
      if(this.value !== "" && this.value !== null){
        state.streamIdx = parseInt(this.value, 10);
        if(state.hls){ state.hls.destroy(); state.hls = null; }
        tryStream();
      }
    });
  }

  // Keyboard shortcuts inside the player dialog
  // (Space = play/pause · M = mute · F = fullscreen ·
  //  ↑/↓ = volume ± · ESC = close, native dialog)
  var dlg = $("#tv-player");
  if(dlg){
    dlg.addEventListener("keydown", function(e){
      if(e.ctrlKey || e.metaKey || e.altKey) return; // no modifier combos

      var video = $("#tvp-video");
      if(!video) return;

      // Don't hijack keys while typing in form controls
      var tag = (e.target && e.target.tagName || "").toLowerCase();
      if(tag === "input" || tag === "select" || tag === "textarea") return;

      if(e.key === " " || e.code === "Space"){
        e.preventDefault();
        if(video.paused) video.play().catch(function(){});
        else video.pause();
        updatePlayerUI();
      }else if(e.key === "m" || e.key === "M"){
        video.muted = !video.muted;
        saveVolumePrefs();
        updatePlayerUI();
      }else if(e.key === "f" || e.key === "F"){
        toggleFullscreen();
      }else if(e.key === "ArrowUp"){
        e.preventDefault();
        video.volume = Math.min(1, video.volume + 0.05);
        if(video.muted && video.volume > 0) video.muted = false;
        saveVolumePrefs();
        updatePlayerUI();
      }else if(e.key === "ArrowDown"){
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.05);
        saveVolumePrefs();
        updatePlayerUI();
      }
    });
  }

  // Dialog backdrop click closes
  var dlg2 = $("#tv-player");
  if(dlg2){
    dlg2.addEventListener("click", function(e){
      if(e.target === dlg2){
        closePlayer();
      }
    });
  }

  // Keep play/pause + mute icons in sync with the video element
  var vid = $("#tvp-video");
  if(vid){
    vid.addEventListener("play", updatePlayerUI);
    vid.addEventListener("pause", updatePlayerUI);
    vid.addEventListener("volumechange", updatePlayerUI);
  }

  // Native dialog 'close' (ESC / backdrop / programmatic) is the
  // single teardown hook — idempotent, no duplicate wiring.
  var pdlg = $("#tv-player");
  if(pdlg) pdlg.addEventListener("close", function(){
    if(state.hls){ state.hls.destroy(); state.hls = null; }
    var v = $("#tvp-video");
    if(v){ v.pause(); v.removeAttribute("src"); v.load(); }
    saveVolumePrefs();
    state.playerCh = null;
  });
}

/* ===== PALETTE INHERITANCE (iframe theme bridge — radio mirror) ===== */

// television.css uses the shell's OWN variable names, so the map
// is identity — unlike radio, which renamed them. Keep in sync
// with the :root fallbacks in television.css.
var SHELL_VAR_MAP = [
  ["--accent",   "--accent"],
  ["--bg",       "--bg"],
  ["--panel-bg", "--panel-bg"],
  ["--text",     "--text"],
  ["--text-dim", "--text-dim"],
  ["--border",   "--border"],
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

function watchPalette(){
  try{
    var apply = function(){ inheritPalette(); };
    new MutationObserver(apply).observe(
      window.parent.document.documentElement, {
        attributes: true,
        attributeFilter: ["data-skin", "data-theme"]
      });
  }catch(e){}
}

/* ===== I18N APPLICATION ===== */

function applyI18n(){
  // Tab labels
  document.querySelectorAll(".tv-tab").forEach(function(tab){
    var key = "tab." + tab.dataset.tab;
    tab.textContent = t(key);
  });

  // Placeholders & buttons
  var search = $("#tv-search");
  if(search) search.placeholder = t("search.ph");

  var loading = $("#tv-loading p");
  if(loading) loading.textContent = t("loading");

  var moreBtn = $("#tv-more");
  if(moreBtn) moreBtn.textContent = t("more");

  // Player control tooltips
  var closeBtn = $("#tvp-close");
  if(closeBtn) closeBtn.setAttribute("title", t("close"));

  var playBtn = $("#tvp-play");
  if(playBtn) playBtn.setAttribute("title", t("play"));

  var muteBtn = $("#tvp-mute");
  if(muteBtn) muteBtn.setAttribute("title", t("mute"));

  var extBtn = $("#tvp-ext");
  if(extBtn) extBtn.setAttribute("title", t("openExt"));

  var fsBtn = $("#tvp-fs");
  if(fsBtn) fsBtn.setAttribute("title", t("fullscreen"));

  var streamPick = $("#tvp-streampick");
  if(streamPick) streamPick.setAttribute("title", t("stream.alt"));
}

/* ===== WIRING ===== */

function wire(){
  setupFilters();
  setupSearch();
  setupPlayerControls();

  // Load catalog immediately (background fetch)
  console.log("[tv-dbg] wire: calling loadCatalog");
  loadCatalog().then(function(cat){
    console.log("[tv-dbg] wire: catalog RESOLVED, channels:",
      cat && cat.channels ? cat.channels.length : "?");
    renderMain();
  }).catch(function(err){
    console.warn("[tv-dbg] wire: catalog REJECTED:", err && err.message);
    renderMain();
  });

  // Offline/online updates
  updateOnlineState();

  // Theme bridge
  inheritPalette();
  watchPalette();

  // I18n
  applyI18n();

  console.log("[television] ready — v0.2 Wave 2 complete");
}

/* ===== BOOT ===== */

function start(){
  registerSync();
  state.data = sliceGet();
  loadRecents();
  loadVolumePrefs();
  applyVolumePrefs();
  wire();

  // Consume any staged deep-link payload from the shell (one-shot,
  // sessionStorage — device-local, swept by factory reset)
  try{
    var take = (window.parent && window.parent.__orosTelevisionTakePending) ||
               window.__orosTelevisionTakePending;
    var pending = typeof take === "function" ? take() : null;
    if(pending) openFromShell(pending);
  }catch(e){}
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", start);
}else{
  start();
}

})();