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
// Wave 43: own M3U playlists (by address or file; the addresses
// sync, the contents stay on the device) and XMLTV programme
// guides (now/next on every channel, a timeline for today, cached
// per day in Cache Storage). Pure logic: core.js (orosTvCore).
// ============================================================

var SCRIPT_V = "";
(function(){ var m=(document.currentScript && document.currentScript.src||"").match(/[?&]v=([^&#]+)/);
  SCRIPT_V=m?m[1]:""; console.log("television.js v"+(SCRIPT_V||"?")+" boot"); })();

(function(){
"use strict";
// Q6 CSP: no inline handlers. A logo marked data-drop-on-error removes
// itself when it fails to load (error does not bubble: capture phase).
document.addEventListener("error", function(e){
  var t = e.target;
  if(t && t.tagName === "IMG" && t.hasAttribute("data-drop-on-error")) t.remove();
}, true);

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
var FILES_KEY    = "oros-television-files";     // device-local list of opened files
var GUIDE_ROWS   = 150;                         // timeline rows drawn at most
var HOUR_MS      = 3600000;
var C = window.orosTvCore;

/* ===== I18N (inline STRINGS — Bible Part VI, radio pattern) ===== */

var STRINGS = {
  en: {
    "tab.browse":     "Browse",
    "tab.favorites":  "Favorites",
    "tab.recents":    "Recent",
    "filter.all":     "All",
    "filter.country": "Country",
    "filter.category": "Category",
    "filter.lang":    "Language",
    "filter.allCountries":  "All countries",
    "filter.allCategories": "All categories",
    "filter.allLangs":      "All languages",
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
    "notifs.streamfail.body":  "Couldn't play on this device",
    "tab.lists":      "My lists",
    "tab.guide":      "Guide",
    "manage":         "Lists & guides",
    "filter.group":   "Group",
    "filter.allGroups": "All groups",
    "src.title":      "Playlists and programme guides",
    "src.pl.h":       "Playlists (M3U)",
    "src.pl.hint":    "Add your own playlist by address or open a file. Addresses sync between your devices; files stay on this device.",
    "src.epg.h":      "Programme guides (XMLTV)",
    "src.epg.hint":   "Add an XMLTV guide (.xml or .xml.gz). Channels match by tvg-id or by name. The guide is kept on this device for the day.",
    "src.url.ph":     "https://… address",
    "src.add":        "Add",
    "src.file":       "Open file…",
    "src.refresh":    "Refresh",
    "src.refreshAll": "Refresh all",
    "src.remove":     "Remove",
    "src.none":       "Nothing added yet.",
    "src.local":      "File on this device",
    "src.loading":    "Loading…",
    "src.channels":   "{n} channels",
    "src.progs":      "{n} channels with programmes",
    "src.stale":      "showing the last copy",
    "src.added":      "Added",
    "src.removed":    "Removed",
    "src.exists":     "Already in the list",
    "src.badurl":     "Enter an http or https address",
    "src.epgAuto":    "The playlist's guide was added too",
    "src.err.offline": "Offline",
    "src.err.cors":   "This site doesn't let the browser read it. Set up the Mail relay, or download the file and open it.",
    "src.err.http":   "The server answered {n}",
    "src.err.empty":  "No channels or programmes found in it",
    "src.err.big":    "Too big or unreadable",
    "src.err.gone":   "The file is no longer on this device — open it again",
    "src.err.net":    "Couldn't download it",
    "lists.empty":    "No playlists yet — add one by address or file.",
    "lists.loading":  "Loading your playlists…",
    "lists.failed":   "Your playlists couldn't be loaded. Open Lists & guides to see why.",
    "guide.empty":    "No programme guide yet. Add an XMLTV guide in Lists & guides.",
    "guide.nomatch":  "The guide has no programmes today for your channels.",
    "guide.loading":  "Loading the programme guide…",
    "guide.today":    "Today",
    "guide.capped":   "Showing the first {n} channels — search to narrow.",
    "epg.now":        "Now",
    "epg.next":       "Next",
    "prog.watch":     "Watch",
    "prog.remind":    "Remind me",
    "prog.remind.hint": "Add to the Calendar with a reminder",
    "prog.remind.sent": "Check the details and press Save in the Calendar"
  },
  el: {
    "tab.browse":     "Περιήγηση",
    "tab.favorites":  "Αγαπημένα",
    "tab.recents":    "Πρόσφατα",
    "filter.all":     "Όλα",
    "filter.country": "Χώρα",
    "filter.category": "Κατηγορία",
    "filter.lang":    "Γλώσσα",
    "filter.allCountries":  "Όλες οι χώρες",
    "filter.allCategories": "Όλες οι κατηγορίες",
    "filter.allLangs":      "Όλες οι γλώσσες",
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
    "notifs.streamfail.body":  "Αδυναμία αναπαραγωγής σε αυτή τη συσκευή",
    "tab.lists":      "Οι λίστες μου",
    "tab.guide":      "Οδηγός",
    "manage":         "Λίστες & οδηγοί",
    "filter.group":   "Ομάδα",
    "filter.allGroups": "Όλες οι ομάδες",
    "src.title":      "Λίστες καναλιών και οδηγοί προγράμματος",
    "src.pl.h":       "Λίστες καναλιών (M3U)",
    "src.pl.hint":    "Πρόσθεσε τη δική σου λίστα με διεύθυνση ή άνοιξε ένα αρχείο. Οι διευθύνσεις συγχρονίζονται στις συσκευές σου· τα αρχεία μένουν σε αυτή τη συσκευή.",
    "src.epg.h":      "Οδηγοί προγράμματος (XMLTV)",
    "src.epg.hint":   "Πρόσθεσε έναν οδηγό XMLTV (.xml ή .xml.gz). Τα κανάλια ταιριάζουν με το tvg-id ή με το όνομα. Ο οδηγός κρατιέται σε αυτή τη συσκευή για τη μέρα.",
    "src.url.ph":     "Διεύθυνση https://…",
    "src.add":        "Προσθήκη",
    "src.file":       "Άνοιγμα αρχείου…",
    "src.refresh":    "Ανανέωση",
    "src.refreshAll": "Ανανέωση όλων",
    "src.remove":     "Αφαίρεση",
    "src.none":       "Δεν έχει προστεθεί τίποτα ακόμα.",
    "src.local":      "Αρχείο σε αυτή τη συσκευή",
    "src.loading":    "Φόρτωση…",
    "src.channels":   "{n} κανάλια",
    "src.progs":      "{n} κανάλια με πρόγραμμα",
    "src.stale":      "εμφανίζεται το τελευταίο αντίγραφο",
    "src.added":      "Προστέθηκε",
    "src.removed":    "Αφαιρέθηκε",
    "src.exists":     "Υπάρχει ήδη στη λίστα",
    "src.badurl":     "Γράψε μια διεύθυνση http ή https",
    "src.epgAuto":    "Προστέθηκε και ο οδηγός της λίστας",
    "src.err.offline": "Εκτός σύνδεσης",
    "src.err.cors":   "Αυτός ο ιστότοπος δεν επιτρέπει την ανάγνωση από τον περιηγητή. Ρύθμισε το relay του Mail ή κατέβασε το αρχείο και άνοιξέ το.",
    "src.err.http":   "Ο διακομιστής απάντησε {n}",
    "src.err.empty":  "Δεν βρέθηκαν κανάλια ή προγράμματα",
    "src.err.big":    "Πολύ μεγάλο ή μη αναγνώσιμο",
    "src.err.gone":   "Το αρχείο δεν υπάρχει πια σε αυτή τη συσκευή — άνοιξέ το ξανά",
    "src.err.net":    "Δεν ήταν δυνατή η λήψη",
    "lists.empty":    "Δεν υπάρχουν λίστες ακόμα — πρόσθεσε μία με διεύθυνση ή αρχείο.",
    "lists.loading":  "Φόρτωση των λιστών σου…",
    "lists.failed":   "Οι λίστες σου δεν φορτώθηκαν. Άνοιξε τις Λίστες & οδηγούς για να δεις γιατί.",
    "guide.empty":    "Δεν υπάρχει ακόμα οδηγός προγράμματος. Πρόσθεσε έναν οδηγό XMLTV στις Λίστες & οδηγούς.",
    "guide.nomatch":  "Ο οδηγός δεν έχει σημερινό πρόγραμμα για τα κανάλια σου.",
    "guide.loading":  "Φόρτωση του οδηγού προγράμματος…",
    "guide.today":    "Σήμερα",
    "guide.capped":   "Εμφανίζονται τα πρώτα {n} κανάλια — ψάξε για να περιορίσεις.",
    "epg.now":        "Τώρα",
    "epg.next":       "Μετά",
    "prog.watch":     "Παρακολούθηση",
    "prog.remind":    "Υπενθύμιση",
    "prog.remind.hint": "Πρόσθεσε στο Ημερολόγιο με υπενθύμιση",
    "prog.remind.sent": "Έλεγξε τα στοιχεία και πάτα Αποθήκευση στο Ημερολόγιο"
  }
};

// orosI18n (../i18n.js): the full language code, a pack language
// included (it reads the shell's orosLang, then oros-lang).
function activeLang(){
  if(window.orosI18n) return window.orosI18n.lang();
  try{ return (window.parent && window.parent.orosLang) || window.orosLang || "en"; }
  catch(e){ return window.orosLang || "en"; }
}
function loc(){
  var l = activeLang();
  return window.orosI18n ? window.orosI18n.locale(l) : (l === "el" ? "el-GR" : "en-GB");
}

function t(key){
  var lang = activeLang();
  var pack = STRINGS[lang] || (window.orosI18n ? window.orosI18n.table(STRINGS, "television", lang) : STRINGS.en);
  return pack[key] !== undefined ? pack[key]
       : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
}

/* ===== HELPERS ===== */

// TV-7: 71 call sites pass a CSS selector ("#tv-grid", "#tv-loading p")
// to a getElementById helper, so every one of them got null: the grid
// never rendered (eternal spinner), the filters never filled, the
// player never opened. Accept both forms.
function $(id){
  return (id.charAt(0) === "#") ? document.querySelector(id) : document.getElementById(id);
}

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
  persistedMuted: false,     // loaded from localStorage
  // Wave 43 — own playlists + programme guides (device memory only):
  files: [],                 // device-local opened files [{id, kind, name, mtime, file:true}]
  playlists: {},             // srcId -> parsed M3U
  guides: {},                // srcId -> parsed XMLTV (today's window)
  srcStatus: {},             // srcId -> { busy, n, stale, err }
  plChannels: [],            // channels of every playlist, in list order
  plById: {},
  plGroups: [],
  filterGroup: "",
  guideIdx: null,            // orosTvCore.buildIndex(...)
  guideDay: "",              // ymd the guides were loaded for
  srcSig: "",                // which sources are loaded (sync pull reload)
  cards: []                  // [card, channel] of the rendered grid (now/next refresh)
};

var __orosSyncApi = null;

/* ===== SYNC CONTRACT (Bible Part V/VI, 5-arg — radio mirror) ===== */

function saveLocal(){
  if(state.data) normalizeState(state.data);  // TV-8: stored bytes canonical (closed-app proxy)
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
  // TV-8 (R26, = Radio RX-6): tombstone keys in sorted order; the merge
  // emitted "remote keys first" → endless uploads between two devices.
  var keys = Object.keys(obj.deleted).sort(), del = {};
  keys.forEach(function(k){
    if(typeof obj.deleted[k] === "number") del[k] = obj.deleted[k];
  });
  obj.deleted = del;
  C.normSources(obj);        // Wave 43: sources[] / srcDel{} only when non-empty
}

function sortFavorites(arr){
  arr.sort(function(a, b){
    if(b.mtime !== a.mtime) return b.mtime - a.mtime;
    var an = String(a.name || ""), bn = String(b.name || "");
    if(an !== bn) return an < bn ? -1 : 1;                    // deterministic tie-break
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
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
  reloadSourcesIfChanged();
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
  // Wave 43: the synced list of playlist / guide addresses
  var ms = C.mergeSources(remote, local);
  if(ms.sources) merged.sources = ms.sources;
  if(ms.srcDel) merged.srcDel = ms.srcDel;
  normalizeState(merged);   // TV-8: same canonical shape as the getter
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
  if(state.plById[id]) return state.plById[id];
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

/* ===== CONTRACT B — shortcut forwarding ===== */

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

/* ===== OWN PLAYLISTS + PROGRAMME GUIDES (Wave 43) ===== */

// Sources: the synced addresses (slice sources[], kind m3u | xmltv)
// plus the files opened on this device (FILES_KEY, never synced).
// Contents live in Cache Storage (CACHE_STORE), never in the slice:
//   pl-<id>.json            parsed playlist (address: refreshed daily)
//   epg-<id>-<ymd>.json     parsed guide, today's window (one per day)
//   epgf-<id>.json          parsed guide from a file
// iptv-org publishes no guide files (its epg repository only ships
// the grabber), so guides are the user's own XMLTV addresses / files.

function loadFiles(){
  try{
    var a = JSON.parse(localStorage.getItem(FILES_KEY) || "[]");
    state.files = (Array.isArray(a) ? a : []).filter(function(f){
      return f && /^f[0-9a-f]{16}$/.test(f.id) && (f.kind === "m3u" || f.kind === "xmltv");
    }).map(function(f){
      return { id: f.id, kind: f.kind, name: String(f.name || "").slice(0, 120), mtime: +f.mtime || 0, file: true };
    });
  }catch(e){ state.files = []; }
}

function saveFiles(){
  try{
    localStorage.setItem(FILES_KEY, JSON.stringify(state.files.map(function(f){
      return { id: f.id, kind: f.kind, name: f.name, mtime: f.mtime };
    })));
  }catch(e){}
}

function allSources(kind){
  var synced = C.liveSources(state.data || {});
  return synced.concat(state.files).filter(function(s){ return !kind || s.kind === kind; });
}

/* --- Cache Storage, with an in-memory stand-in when it is missing --- */

var memStore = {};

function csGet(name){
  if(!HAS_CS) return Promise.resolve(memStore[name] || null);
  var read = caches.open(CACHE_STORE).then(function(cs){ return cs.match(name); })
    .then(function(res){ return res ? res.json() : null; })
    .then(function(w){ return (w && w.ts) ? w : null; });
  var guard = new Promise(function(resolve){ setTimeout(function(){ resolve(null); }, 8000); });
  return Promise.race([read, guard]).catch(function(){ return null; });
}

function csPut(name, data){
  var w = { ts: Date.now(), data: data };
  if(!HAS_CS){ memStore[name] = w; return Promise.resolve(); }
  return caches.open(CACHE_STORE).then(function(cs){
    return cs.put(name, new Response(JSON.stringify(w)));
  }).catch(function(){ memStore[name] = w; });
}

// Delete every cached entry whose name starts with prefix (but keep).
function csDrop(prefix, keep){
  Object.keys(memStore).forEach(function(k){ if(k.indexOf(prefix) === 0 && k !== keep) delete memStore[k]; });
  if(!HAS_CS) return Promise.resolve();
  return caches.open(CACHE_STORE).then(function(cs){
    return cs.keys().then(function(reqs){
      return Promise.all(reqs.map(function(r){
        var name = String(r.url).split("/").pop();
        if(name.indexOf(prefix) === 0 && name !== keep) return cs.delete(r);
      }));
    });
  }).catch(function(){});
}

/* --- network: straight from the browser, then the Mail relay (feeds/fetch.js) --- */

function SrcError(code, n){ this.code = code; this.n = n || 0; }

function fetchBytes(url){
  if(state.offline) return Promise.reject(new SrcError("offline"));
  var F = window.orosFeedsFetch;
  var p;
  if(F && typeof F.fetchOne === "function"){
    p = F.fetchOne(url, { timeout: 60000 }).then(function(r){
      if(r.status < 200 || r.status >= 300) throw new SrcError("http", r.status);
      return r.bytes || new Uint8Array(0);
    }, function(e){
      var c = e && e.code;
      if(c === "cors" || c === "norelay") throw new SrcError("cors");
      if(c === "offline") throw new SrcError("offline");
      if(c === "too-big" || c === "budget") throw new SrcError("big");
      throw new SrcError("net");
    });
  }else{
    p = fetch(url, { credentials: "omit", cache: "no-cache", referrerPolicy: "no-referrer" }).then(function(r){
      if(!r.ok) throw new SrcError("http", r.status);
      return r.arrayBuffer();
    }, function(){ throw new SrcError("cors"); }).then(function(b){ return new Uint8Array(b); });
  }
  return p.then(function(b){
    return C.gunzipIfNeeded(b).catch(function(){ throw new SrcError("big"); });
  });
}

function bytesToText(b){
  if(b.length > 150 * 1024 * 1024) throw new SrcError("big");
  var FC = window.orosFeedsCore;
  try{
    return (FC && typeof FC.decodeBytes === "function") ? FC.decodeBytes(b, "") : new TextDecoder("utf-8").decode(b);
  }catch(e){ throw new SrcError("big"); }
}

function srcErrText(e){
  var code = (e && e.code) || "net";
  if(code === "http") return t("src.err.http").replace("{n}", String(e.n || "?"));
  var k = "src.err." + code;
  return STRINGS.en[k] !== undefined ? t(k) : t("src.err.net");
}

function guideWindow(){
  var r = C.dayRange(Date.now());
  return { from: r.start - 3 * HOUR_MS, to: r.end + 6 * HOUR_MS };
}

/* --- loading one source --- */

function loadPlaylist(src, force){
  var key = "pl-" + src.id + ".json";
  state.srcStatus[src.id] = { busy: true };
  return csGet(key).then(function(hit){
    if(hit && (src.file || (!force && Date.now() - hit.ts < API_TTL_MS))) return { r: hit.data };
    if(src.file) throw new SrcError("gone");
    return fetchBytes(src.url).then(bytesToText).then(function(txt){
      var r = C.parseM3U(txt);
      if(!r.channels.length) throw new SrcError("empty");
      csPut(key, r);
      return { r: r, fresh: true };
    }).catch(function(e){
      if(hit) return { r: hit.data, stale: e };
      throw e;
    });
  }).then(function(o){
    state.playlists[src.id] = o.r;
    state.srcStatus[src.id] = { n: o.r.channels.length, stale: o.stale || null };
    return o;
  }, function(e){
    delete state.playlists[src.id];
    state.srcStatus[src.id] = { err: e };
    return null;
  });
}

function loadGuide(src, force){
  var day = C.ymd(Date.now()), w = guideWindow();
  var key = src.file ? "epgf-" + src.id + ".json" : "epg-" + src.id + "-" + day + ".json";
  state.srcStatus[src.id] = { busy: true };
  return csGet(key).then(function(hit){
    if(hit && (src.file || !force)) return { g: hit.data };
    if(src.file) throw new SrcError("gone");
    return fetchBytes(src.url).then(bytesToText).then(function(txt){
      var g = C.parseXMLTV(txt, { from: w.from, to: w.to, lang: activeLang() });
      if(!g.count) throw new SrcError("empty");
      csPut(key, g);
      csDrop("epg-" + src.id + "-", key);      // yesterday's copy goes
      return { g: g };
    }).catch(function(e){
      if(hit) return { g: hit.data, stale: e };
      throw e;
    });
  }).then(function(o){
    state.guides[src.id] = o.g;
    state.srcStatus[src.id] = { n: Object.keys(o.g.progs || {}).length, stale: o.stale || null };
    return o;
  }, function(e){
    delete state.guides[src.id];
    state.srcStatus[src.id] = { err: e };
    return null;
  });
}

function loadSource(src, force){
  return src.kind === "xmltv" ? loadGuide(src, force) : loadPlaylist(src, force);
}

/* --- derived lists --- */

function rebuildPlaylistChannels(){
  var list = [], byId = {}, groups = [], gseen = {};
  allSources("m3u").forEach(function(src){
    var r = state.playlists[src.id];
    if(!r || !Array.isArray(r.channels)) return;
    r.channels.forEach(function(c){
      if(!c || !c.id || byId[c.id]) return;
      var ch = {
        id: c.id, name: c.name || c.url, logo: C.safeLogo(c.logo), country: "",
        categories: c.group ? [c.group] : [], languages: [], website: "",
        group: c.group || "", tvgId: c.tvgId || "", tvgName: c.tvgName || "", src: src.id,
        streams: [{ url: c.url, quality: "" }]
      };
      byId[ch.id] = ch;
      list.push(ch);
      if(ch.group && !gseen[ch.group]){ gseen[ch.group] = 1; groups.push(ch.group); }
    });
  });
  state.plChannels = list;
  state.plById = byId;
  state.plGroups = groups;
  if(state.filterGroup && !gseen[state.filterGroup]) state.filterGroup = "";
}

function rebuildGuideIndex(){
  var gs = allSources("xmltv").map(function(s){ return state.guides[s.id]; }).filter(Boolean);
  state.guideIdx = gs.length ? C.buildIndex(gs) : null;
}

function sourcesSig(){
  return allSources().map(function(s){ return s.id; }).sort().join(",");
}

// Load every source (cached copies first); force re-downloads addresses.
function loadAllSources(force){
  var list = allSources();
  state.srcSig = sourcesSig();
  state.guideDay = C.ymd(Date.now());
  if(!list.length){
    rebuildPlaylistChannels(); rebuildGuideIndex(); refreshViews();
    return Promise.resolve();
  }
  renderSourcesDialog();
  // one at a time: guides can be large, memory stays flat
  return list.reduce(function(p, src){
    return p.then(function(){ return loadSource(src, force); }).then(function(){
      renderSourcesDialog();
    });
  }, Promise.resolve()).then(function(){
    rebuildPlaylistChannels();
    rebuildGuideIndex();
    refreshViews();
    renderSourcesDialog();
  });
}

// Sync pull brought another device's list: load what is new.
function reloadSourcesIfChanged(){
  if(state.srcHold || sourcesSig() === state.srcSig) return;
  loadAllSources(false);
}

function refreshViews(){
  renderGroupFilter();
  renderMain();
  updatePlayerEpg();
}

/* --- adding / removing --- */

function addSourceUrl(kind, raw){
  var url = C.httpUrl(raw);
  if(!url){ transientNote(t("src.badurl")); return false; }
  var id = C.sourceId(kind, url);
  if(allSources().some(function(s){ return s.id === id; })){ transientNote(t("src.exists")); return false; }
  var payload = sliceGet();
  payload.sources = (payload.sources || []).filter(function(s){ return s.id !== id; });
  payload.sources.push({ id: id, kind: kind, url: url, name: C.nameFromUrl(url), mtime: Date.now() });
  state.srcHold = true;                  // sliceSet must not load it a second time
  sliceSet(payload);
  commitLocal();
  state.srcHold = false;
  transientNote(t("src.added"));
  state.srcSig = sourcesSig();
  var src = allSources().filter(function(s){ return s.id === id; })[0];
  if(!src) return true;
  renderSourcesDialog();
  loadSource(src, true).then(function(o){
    // TiviMate-style: a playlist that names its guide (url-tvg / x-tvg-url)
    // brings it along, unless the user removed that guide before.
    var r = kind === "m3u" && o && o.r;
    var added = false;
    if(r && r.epgUrls && r.epgUrls.length){
      var pl = sliceGet();
      r.epgUrls.slice(0, 2).forEach(function(u){
        var gid = C.sourceId("xmltv", u);
        if((pl.srcDel && pl.srcDel[gid]) || allSources().some(function(s){ return s.id === gid; })) return;
        if((pl.sources || []).some(function(s){ return s.id === gid; })) return;
        pl.sources = (pl.sources || []).concat({ id: gid, kind: "xmltv", url: u, name: C.nameFromUrl(u), mtime: Date.now() });
        added = true;
      });
      if(added){
        state.srcHold = true;
        sliceSet(pl);
        commitLocal();
        state.srcHold = false;
        transientNote(t("src.epgAuto"));
      }
    }
    return added ? loadAllSources(false) : finishSourceChange();
  });
  return true;
}

function finishSourceChange(){
  state.srcSig = sourcesSig();
  rebuildPlaylistChannels();
  rebuildGuideIndex();
  refreshViews();
  renderSourcesDialog();
}

function addSourceFile(kind, file){
  if(!file) return;
  var id = "f" + C.hash(file.name + "|" + file.size + "|" + Date.now() + "|" + Math.random());
  var src = { id: id, kind: kind, name: String(file.name || "").slice(0, 120), mtime: Date.now(), file: true };
  state.srcStatus[id] = { busy: true };
  file.arrayBuffer().then(function(b){
    return C.gunzipIfNeeded(new Uint8Array(b)).catch(function(){ throw new SrcError("big"); });
  }).then(bytesToText).then(function(txt){
    if(kind === "m3u"){
      var r = C.parseM3U(txt);
      if(!r.channels.length) throw new SrcError("empty");
      return csPut("pl-" + id + ".json", r);
    }
    // a file is kept for a week: yesterday … +7 days
    var r0 = C.dayRange(Date.now());
    var g = C.parseXMLTV(txt, { from: r0.start - 24 * HOUR_MS, to: r0.end + 7 * 24 * HOUR_MS, lang: activeLang() });
    if(!g.count) throw new SrcError("empty");
    return csPut("epgf-" + id + ".json", g);
  }).then(function(){
    state.files.push(src);
    saveFiles();
    transientNote(t("src.added"));
    return loadSource(src, false);
  }).then(finishSourceChange, function(e){
    delete state.srcStatus[id];
    transientNote(srcErrText(e));
  });
}

function removeSource(src){
  if(src.file){
    state.files = state.files.filter(function(f){ return f.id !== src.id; });
    saveFiles();
  }else{
    var payload = sliceGet();
    payload.sources = (payload.sources || []).filter(function(s){ return s.id !== src.id; });
    payload.srcDel = payload.srcDel || {};
    payload.srcDel[src.id] = Date.now();
    state.srcHold = true;
    sliceSet(payload);
    commitLocal();
    state.srcHold = false;
  }
  delete state.playlists[src.id];
  delete state.guides[src.id];
  delete state.srcStatus[src.id];
  csDrop((src.kind === "xmltv" ? (src.file ? "epgf-" : "epg-") : "pl-") + src.id, null);
  transientNote(t("src.removed"));
  finishSourceChange();
}

/* --- the Lists & guides dialog --- */

function openSourcesDialog(){
  var dlg = $("#tv-src");
  if(!dlg) return;
  if(!dlg.open) dlg.showModal();
  renderSourcesDialog();
}

function srcStatusText(src){
  var st = state.srcStatus[src.id];
  if(!st || st.busy) return { text: t("src.loading"), err: false };
  if(st.err) return { text: srcErrText(st.err), err: true };
  var text = t(src.kind === "xmltv" ? "src.progs" : "src.channels").replace("{n}", String(st.n || 0));
  if(st.stale) text += " · " + t("src.stale") + " (" + srcErrText(st.stale) + ")";
  return { text: text, err: false };
}

function renderSourcesDialog(){
  var dlg = $("#tv-src");
  if(!dlg || !dlg.open) return;
  [["m3u", "#tvs-pl-list"], ["xmltv", "#tvs-epg-list"]].forEach(function(p){
    var box = $(p[1]);
    if(!box) return;
    box.innerHTML = "";
    var list = allSources(p[0]);
    if(!list.length){
      var none = document.createElement("p");
      none.className = "tvs-none";
      none.textContent = t("src.none");
      box.appendChild(none);
      return;
    }
    list.forEach(function(src){
      var row = document.createElement("div");
      row.className = "tvs-row";
      var info = document.createElement("div");
      info.className = "tvs-info";
      var nm = document.createElement("div");
      nm.className = "tvs-name";
      nm.textContent = src.name || src.url || "";
      var sub = document.createElement("div");
      sub.className = "tvs-url";
      sub.textContent = src.file ? t("src.local") : src.url;
      var stx = srcStatusText(src);
      var st = document.createElement("div");
      st.className = "tvs-st" + (stx.err ? " err" : "");
      st.textContent = stx.text;
      info.appendChild(nm); info.appendChild(sub); info.appendChild(st);
      row.appendChild(info);
      if(!src.file){
        var rb = iconButton("refresh", t("src.refresh"));
        rb.addEventListener("click", function(){
          loadSource(src, true).then(finishSourceChange);
          renderSourcesDialog();
        });
        row.appendChild(rb);
      }
      var del = iconButton("remove", t("src.remove"));
      del.addEventListener("click", function(){ removeSource(src); });
      row.appendChild(del);
      box.appendChild(row);
    });
  });
}

var SRC_ICONS = {
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  remove:  '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'
};

function iconButton(kind, label){
  var b = document.createElement("button");
  b.type = "button";
  b.className = "tv-icon";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + SRC_ICONS[kind] + '</svg>';
  return b;
}

function setupSourcesDialog(){
  var dlg = $("#tv-src");
  if(!dlg) return;
  var manage = $("#tv-manage");
  if(manage) manage.addEventListener("click", openSourcesDialog);
  var close = $("#tvs-close");
  if(close) close.addEventListener("click", function(){ dlg.close(); });
  dlg.addEventListener("click", function(e){ if(e.target === dlg) dlg.close(); });
  [["m3u", "pl"], ["xmltv", "epg"]].forEach(function(p){
    var form = $("#tvs-" + p[1] + "-form"), input = $("#tvs-" + p[1] + "-url");
    if(form) form.addEventListener("submit", function(e){
      e.preventDefault();
      if(addSourceUrl(p[0], input.value)) input.value = "";
    });
    var fileBtn = $("#tvs-" + p[1] + "-file"), fileIn = $("#tvs-" + p[1] + "-input");
    if(fileBtn && fileIn){
      fileBtn.addEventListener("click", function(){ fileIn.click(); });
      fileIn.addEventListener("change", function(){
        var f = fileIn.files && fileIn.files[0];
        fileIn.value = "";
        addSourceFile(p[0], f);
      });
    }
  });
  var all = $("#tvs-refresh");
  if(all) all.addEventListener("click", function(){ loadAllSources(true); });
}

/* --- now / next --- */

function epgOf(ch){
  if(!state.guideIdx || !ch) return null;
  return C.lookup(state.guideIdx, ch);
}

function nowNextHtml(ch){
  var progs = epgOf(ch);
  if(!progs) return "";
  var nn = C.nowNext(progs, Date.now());
  if(!nn.now && !nn.next) return "";
  var h = "";
  if(nn.now){
    h += '<span class="tv-now-t" title="' + esc(C.hhmm(nn.now.s) + "–" + C.hhmm(nn.now.e) + " " + nn.now.t) + '">' +
         esc(nn.now.t) + '</span>' +
         '<span class="tv-prog" aria-hidden="true"><i style="width:' + (nn.pct | 0) + '%"></i></span>';
  }
  if(nn.next){
    h += '<span class="tv-next">' + esc(t("epg.next") + " " + C.hhmm(nn.next.s) + " · " + nn.next.t) + '</span>';
  }
  return h;
}

function refreshNowLines(){
  state.cards.forEach(function(pair){
    var box = pair[0].querySelector(".tv-now");
    var h = nowNextHtml(pair[1]);
    if(box){
      if(h) box.innerHTML = h; else box.remove();
    }else if(h){
      var d = document.createElement("div");
      d.className = "tv-now";
      d.innerHTML = h;
      pair[0].appendChild(d);
    }
  });
}

function updatePlayerEpg(){
  var el = $("#tvp-epg");
  if(!el) return;
  var ch = state.playerCh;
  var nn = ch ? C.nowNext(epgOf(ch), Date.now()) : null;
  if(!nn || (!nn.now && !nn.next)){ el.setAttribute("hidden", ""); el.textContent = ""; return; }
  var parts = [];
  if(nn.now) parts.push(t("epg.now") + " " + C.hhmm(nn.now.s) + "–" + C.hhmm(nn.now.e) + " · " + nn.now.t);
  if(nn.next) parts.push(t("epg.next") + " " + C.hhmm(nn.next.s) + " · " + nn.next.t);
  el.textContent = parts.join("   ");
  if(nn.now && nn.now.d) el.title = nn.now.d; else el.removeAttribute("title");
  el.removeAttribute("hidden");
}

/* --- the timeline (Guide tab) --- */

function guideChannels(){
  var idx = state.guideIdx;
  if(!idx) return [];
  var day = C.dayRange(Date.now());
  var seen = {}, rows = [];
  var q = (state.searchQuery || "").toLowerCase();
  function add(ch){
    if(!ch || !ch.id || seen[ch.id]) return;
    seen[ch.id] = 1;
    if(q && String(ch.name || "").toLowerCase().indexOf(q) < 0) return;
    if(state.filterGroup && ch.group !== state.filterGroup) return;
    var progs = C.lookup(idx, ch);
    if(!progs) return;
    var lay = C.layoutRow(progs, day.start, day.end, 1);
    if(!lay.length) return;
    rows.push({ ch: ch, progs: progs });
  }
  (state.data ? state.data.favorites : []).forEach(function(f){ add(resolveChannelById(f.id)); });
  state.plChannels.forEach(add);
  if(state.catalog && !state.filterGroup) state.catalog.channels.forEach(add);
  return rows;
}

function guidePx(){ return window.innerWidth < 600 ? 2.5 : 4; }  // px per minute

function renderGuide(box){
  var prev = box.querySelector(".tvg-scroll");
  var keep = prev ? { x: prev.scrollLeft, y: prev.scrollTop } : null;
  box.innerHTML = "";
  var busy = allSources("xmltv").some(function(s){ return state.srcStatus[s.id] && state.srcStatus[s.id].busy; });
  if(!state.guideIdx){
    guideMessage(box, busy ? t("guide.loading") : t("guide.empty"), !busy);
    return;
  }
  var rows = guideChannels();
  if(!rows.length){
    guideMessage(box, busy ? t("guide.loading") : (state.searchQuery || state.filterGroup ? t("noresults") : t("guide.nomatch")), !busy);
    return;
  }
  var now = Date.now(), day = C.dayRange(now), ppm = guidePx();
  var dayW = Math.round((day.end - day.start) / 60000 * ppm);
  var chW = window.innerWidth < 600 ? 96 : 140;
  var capped = rows.length > GUIDE_ROWS;
  rows = rows.slice(0, GUIDE_ROWS);

  var bar = document.createElement("div");
  bar.className = "tvg-bar";
  var lbl = document.createElement("strong");
  var dateTxt = "";
  try{ dateTxt = new Date(now).toLocaleDateString(loc(), { weekday: "long", day: "numeric", month: "long" }); }catch(e){ dateTxt = C.ymd(now); }
  lbl.textContent = t("guide.today") + " · " + dateTxt;
  bar.appendChild(lbl);
  var nowBtn = document.createElement("button");
  nowBtn.type = "button";
  nowBtn.className = "tv-btn ghost";
  nowBtn.textContent = t("epg.now");
  bar.appendChild(nowBtn);
  box.appendChild(bar);
  if(capped){
    var cap = document.createElement("p");
    cap.className = "tvg-cap";
    cap.textContent = t("guide.capped").replace("{n}", String(GUIDE_ROWS));
    box.appendChild(cap);
  }

  var scroll = document.createElement("div");
  scroll.className = "tvg-scroll";
  var inner = document.createElement("div");
  inner.className = "tvg-inner";
  inner.style.width = (chW + dayW) + "px";
  inner.style.setProperty("--tvg-ch", chW + "px");

  var hours = '<div class="tvg-hours"><div class="tvg-corner"></div><div class="tvg-hrs" style="width:' + dayW + 'px">';
  for(var h = 0; h < 24; h++){
    var ts = new Date(new Date(day.start).setHours(h)).getTime();
    if(ts >= day.end) break;
    hours += '<span style="left:' + Math.round((ts - day.start) / 60000 * ppm) + 'px">' + esc(C.hhmm(ts)) + '</span>';
  }
  hours += '</div></div>';
  inner.innerHTML = hours;

  rows.forEach(function(row){
    var r = document.createElement("div");
    r.className = "tvg-row";
    var chBtn = document.createElement("button");
    chBtn.type = "button";
    chBtn.className = "tvg-ch";
    chBtn.title = row.ch.name || "";
    var logo = C.safeLogo(row.ch.logo);
    chBtn.innerHTML = (logo ? '<img src="' + esc(logo) + '" alt="" loading="lazy" data-drop-on-error>' : "") +
      '<span>' + esc(row.ch.name || "") + '</span>';
    chBtn.addEventListener("click", function(){ playChannel(row.ch); });
    r.appendChild(chBtn);
    var track = document.createElement("div");
    track.className = "tvg-track";
    track.style.width = dayW + "px";
    C.layoutRow(row.progs, day.start, day.end, ppm).forEach(function(cell){
      var p = cell.p;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tvg-p" + (p.s <= now && p.e > now ? " on" : (p.e <= now ? " past" : ""));
      b.style.left = cell.left + "px";
      b.style.width = Math.max(2, cell.width - 2) + "px";
      b.title = C.hhmm(p.s) + "–" + C.hhmm(p.e) + " " + (p.t || "");
      b.innerHTML = '<span class="tvg-pt">' + esc(p.t || "") + '</span><span class="tvg-ps">' + esc(C.hhmm(p.s)) + '</span>';
      b.addEventListener("click", function(){ openProg(row.ch, p); });
      track.appendChild(b);
    });
    r.appendChild(track);
    inner.appendChild(r);
  });

  if(now >= day.start && now < day.end){
    var line = document.createElement("div");
    line.className = "tvg-nowline";
    line.style.left = (chW + Math.round((now - day.start) / 60000 * ppm)) + "px";
    inner.appendChild(line);
  }
  scroll.appendChild(inner);
  box.appendChild(scroll);

  var toNow = function(){ scroll.scrollLeft = Math.max(0, Math.round((now - day.start) / 60000 * ppm) - 60); };
  nowBtn.addEventListener("click", toNow);
  if(keep){ scroll.scrollLeft = keep.x; scroll.scrollTop = keep.y; } else toNow();
}

function guideMessage(box, text, withAction){
  var p = document.createElement("div");
  p.className = "tvg-msg";
  var m = document.createElement("p");
  m.textContent = text;
  p.appendChild(m);
  if(withAction){
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tv-btn";
    b.textContent = t("manage");
    b.addEventListener("click", openSourcesDialog);
    p.appendChild(b);
  }
  box.appendChild(p);
}

/* --- programme details --- */

var progCh = null, progCal = null;

function openProg(ch, p){
  var dlg = $("#tv-prog");
  if(!dlg) return;
  progCh = ch;
  // "Remind me" only for a programme that has not started yet
  progCal = C.calPayload(p, ch && ch.name, Date.now());
  var cb = $("#tvpg-cal");
  if(cb) cb.hidden = !progCal;
  $("#tvpg-title").textContent = p.t || "";
  var when = C.hhmm(p.s) + "–" + C.hhmm(p.e) + " · " + (ch.name || "");
  $("#tvpg-when").textContent = when;
  var sub = [p.st, p.c].filter(Boolean).join(" · ");
  var subEl = $("#tvpg-sub");
  subEl.textContent = sub;
  subEl.hidden = !sub;
  var d = $("#tvpg-desc");
  d.textContent = p.d || "";
  d.hidden = !p.d;
  if(!dlg.open) dlg.showModal();
}

function setupProgDialog(){
  var dlg = $("#tv-prog");
  if(!dlg) return;
  $("#tvpg-close").addEventListener("click", function(){ dlg.close(); });
  dlg.addEventListener("click", function(e){ if(e.target === dlg) dlg.close(); });
  $("#tvpg-watch").addEventListener("click", function(){
    dlg.close();
    if(progCh) playChannel(progCh);
  });
  var cb = $("#tvpg-cal");
  if(cb) cb.addEventListener("click", function(){
    var p = progCal;
    dlg.close();
    if(p) sendToCalendar(p);
  });
}

// Calendar axis (BR-W8): the programme goes to the Calendar's New event
// window, prefilled with a reminder. Nothing is saved until Save there.
function sendToCalendar(p){
  var sent = false;
  try {
    if(window.parent && window.parent !== window &&
       typeof window.parent.__orosOpenCalendarNew === "function"){
      window.parent.__orosOpenCalendarNew(p);
      sent = true;
    }
  } catch(e){}
  if(!sent){
    window.open("../calendar/?new=" + encodeURIComponent(JSON.stringify(p)), "_blank", "noopener,noreferrer");
  }
  transientNote(t("prog.remind.sent"));
}

/* --- groups filter --- */

function renderGroupFilter(){
  var sel = $("#tv-group");
  if(!sel) return;
  var cur = state.filterGroup;
  sel.innerHTML = "";
  var all = document.createElement("option");
  all.value = "";
  all.textContent = t("filter.allGroups");
  sel.appendChild(all);
  state.plGroups.forEach(function(g){
    var o = document.createElement("option");
    o.value = g;
    o.textContent = g;
    sel.appendChild(o);
  });
  sel.value = cur;
}

/* --- minute tick: now/next, the now line, a new day --- */

function minuteTick(){
  if(state.guideDay && C.ymd(Date.now()) !== state.guideDay){
    loadAllSources(false);
    return;
  }
  if(!state.guideIdx) return;
  if(state.viewMode === "guide") renderMain();
  else refreshNowLines();
  updatePlayerEpg();
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
  state.cards = [];
  empty.setAttribute("hidden", "");
  if(moreBtn) moreBtn.setAttribute("hidden", "");
  var emptyAct = $("#tv-empty-act");
  if(emptyAct) emptyAct.setAttribute("hidden", "");
  updateToolbar();

  // Wave 43: the Guide tab swaps the card grid for the timeline
  var guideBox = $("#tv-guide");
  var main = $("#tv-main");
  var isGuide = state.viewMode === "guide";
  if(main) main.classList.toggle("guide-mode", isGuide);
  if(guideBox){
    if(isGuide){ guideBox.removeAttribute("hidden"); renderGuide(guideBox); }
    else { guideBox.setAttribute("hidden", ""); guideBox.innerHTML = ""; }
  }

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

    case "lists":
      renderLists(grid);
      break;
  }
}

// Country / category / language filter only the directory; the group
// filter only your playlists (and the guide rows that come from them).
function updateToolbar(){
  var browse = state.viewMode === "browse";
  ["country", "category", "lang"].forEach(function(k){
    var sel = $("#tv-" + k);
    var wrap = sel && sel.closest(".tv-filter");
    if(wrap) wrap.hidden = !browse;
  });
  var gw = $("#tv-group-wrap");
  if(gw) gw.hidden = !((state.viewMode === "lists" || state.viewMode === "guide") && state.plGroups.length);
}

function renderLists(container){
  var msg = $("#tv-empty-msg"), empty = $("#tv-empty"), act = $("#tv-empty-act");
  var srcs = allSources("m3u");
  function say(text, withAction){
    msg.textContent = text;
    empty.removeAttribute("hidden");
    if(withAction && act) act.removeAttribute("hidden");
  }
  if(!srcs.length){ say(t("lists.empty"), true); return; }
  if(!state.plChannels.length){
    var busy = srcs.some(function(s){ return !state.srcStatus[s.id] || state.srcStatus[s.id].busy; });
    say(busy ? t("lists.loading") : t("lists.failed"), !busy);
    return;
  }
  var q = (state.searchQuery || "").toLowerCase();
  var filtered = state.plChannels.filter(function(ch){
    if(state.filterGroup && ch.group !== state.filterGroup) return false;
    if(q && ch.name.toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  if(!filtered.length){ say(t("noresults"), false); return; }
  filtered.slice(0, state.rendered).forEach(function(ch){
    container.appendChild(createChannelCard(ch));
  });
  if(state.rendered < filtered.length){
    var btn = $("#tv-more");
    if(btn) btn.removeAttribute("hidden");
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
    var ch = (state.catalog && state.catalog.byId[fav.id]) || state.plById[fav.id] || null;
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
    var ch = (state.catalog && state.catalog.byId[rec.id]) || state.plById[rec.id] || null;
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
  var logo = C.safeLogo(channel.logo);            // Wave 43: https logos only
  if(logo){
    logoHtml += '<img src="' + esc(logo) +
      '" alt="" loading="lazy" data-drop-on-error>';
  }
  logoHtml += '</div>';

  // Metadata line
  var metaParts = [];
  if(channel.country && state.catalog && state.catalog.countryNames[channel.country]){
    metaParts.push(esc(state.catalog.countryNames[channel.country]));
  }
  if(channel.categories && channel.categories.length){
    var cn = !channel.src && state.catalog && state.catalog.categoryNames[channel.categories[0]];
    metaParts.push(esc(cn || channel.categories[0]));
  }
  var nowHtml = nowNextHtml(channel);

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
    '</div>' +
    (nowHtml ? '<div class="tv-now">' + nowHtml + '</div>' : '');
  state.cards.push([card, channel]);

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
      countrySelect.innerHTML = '<option value="">' + esc(t("filter.allCountries")) + '</option>';
      Object.keys(cat.countryNames).sort().forEach(function(code){
        var opt = document.createElement("option");
        opt.value = code;
        opt.textContent = cat.countryNames[code];
        countrySelect.appendChild(opt);
      });
    }

    // Category
    if(catSelect){
      catSelect.innerHTML = '<option value="">' + esc(t("filter.allCategories")) + '</option>';
      Object.keys(cat.categoryNames).sort().forEach(function(id){
        var opt = document.createElement("option");
        opt.value = id;
        opt.textContent = cat.categoryNames[id];
        catSelect.appendChild(opt);
      });
    }

    // Language
    if(langSelect){
      langSelect.innerHTML = '<option value="">' + esc(t("filter.allLangs")) + '</option>';
      Object.keys(cat.languageNames).sort().forEach(function(code){
        var opt = document.createElement("option");
        opt.value = code;
        opt.textContent = cat.languageNames[code];
        langSelect.appendChild(opt);
      });
    }
  }).catch(function(err){
    console.warn("[television] filter selects skipped — catalog unavailable:", err && err.message);
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
      clearTimeout(state.searchTimer);   // TV-10
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
          // stale — or TV-10: the field already left (Enter ran the grid
          // search and blurred): the list reopened and stayed open over
          // the grid, eating taps
          if(self.value.trim() !== val || document.activeElement !== self) return;
          // Search in-memory (fast, cached); My lists searches your playlists
          var q = val.toLowerCase();
          var pool = state.viewMode === "lists" ? state.plChannels : cat.channels;
          var results = pool.filter(function(ch){
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
  if(state.viewMode !== "lists") state.viewMode = "browse";
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
      state.filterGroup = "";
      state.searchQuery = "";
      state.rendered = PAGE_SIZE;
      var groupSelect = $("#tv-group");
      if(groupSelect) groupSelect.value = "";

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
  $("tvp-meta").textContent = (channel.country && state.catalog && state.catalog.countryNames[channel.country]) || channel.group || "";
  $("tvp-labels").textContent = (channel.categories && channel.categories.join(", ")) || "";

  // Restore volume/mute preferences for this session
  applyVolumePrefs();

  // Build stream picker (all available streams for this channel)
  buildStreamPicker(channel);

  // Try first stream
  tryStream();

  dlg.showModal();
  updatePlayerEpg();
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
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    playBtn.setAttribute("aria-label", video && !video.paused ? t("pause") : t("play"));
  }

  if(muteBtn && volSlider){
    var video = $("#tvp-video");
    var muted = video ? video.muted : false;
    muteBtn.innerHTML = muted
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
    muteBtn.setAttribute("aria-label", muted ? t("unmute") : t("mute"));
    volSlider.value = video ? video.volume : 1;
  }

  if(favBtn && state.playerCh){
    var isFav = isFavorite(state.playerCh.id);
    favBtn.innerHTML = isFav
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 15,10 24,10 17,15 20,24 12,18 4,24 7,15 0,10 9,10"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 15,10 24,10 17,15 20,24 12,18 4,24 7,15 0,10 9,10"/></svg>';
    favBtn.classList.toggle("on", isFav);
  }

  // TV-9: no usable (http/https) website → no button (R28: it used to
  // stay clickable and do nothing)
  if(extBtn && state.playerCh){
    extBtn.hidden = !/^https?:\/\//i.test(String(state.playerCh.website || ""));
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
      // TV-9: `website` comes from the remote directory (and from synced
      // favorites); a javascript: URL would run in a same-origin window.
      var site = state.playerCh && String(state.playerCh.website || "");
      if(site && /^https?:\/\//i.test(site)){
        window.open(site, "_blank", "noopener");
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

  // Filter captions: each select says what it filters before it is
  // opened; the "All" option names its dimension too.
  [["country", "filter.country", "filter.allCountries"],
   ["category", "filter.category", "filter.allCategories"],
   ["lang", "filter.lang", "filter.allLangs"]].forEach(function(f){
    var cap = $("#tv-" + f[0] + "-cap");
    if(cap) cap.textContent = t(f[1]);
    var sel = $("#tv-" + f[0]);
    if(sel){
      sel.setAttribute("aria-label", t(f[1]));
      if(sel.options[0] && sel.options[0].value === "") sel.options[0].textContent = t(f[2]);
    }
  });

  var loading = $("#tv-loading p");
  if(loading) loading.textContent = t("loading");

  var moreBtn = $("#tv-more");
  if(moreBtn) moreBtn.textContent = t("more");

  // TV-11 (R9: HTML ships icon buttons empty, JS injects the SVG):
  // close / open-website / fullscreen were never filled, so the three
  // buttons were invisible (an empty box in the player's corner).
  var SVG_A = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var icons = {
    "#tvp-close": SVG_A + '<path d="M6 6l12 12M18 6L6 18"/></svg>',
    "#tvp-ext":   SVG_A + '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    "#tvp-fs":    SVG_A + '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'
  };
  Object.keys(icons).forEach(function(sel){
    var b = $(sel);
    if(b && !b.firstChild) b.innerHTML = icons[sel];
  });

  // Player control tooltips
  var closeBtn = $("#tvp-close");
  if(closeBtn){
    closeBtn.setAttribute("title", t("close"));
    closeBtn.setAttribute("aria-label", t("close"));
  }

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

  // Wave 43: lists & guides
  var txt = {
    "#tv-manage-txt": "manage", "#tv-group-cap": "filter.group", "#tv-empty-act": "manage",
    "#tvs-title": "src.title", "#tvs-pl-h": "src.pl.h", "#tvs-pl-hint": "src.pl.hint",
    "#tvs-epg-h": "src.epg.h", "#tvs-epg-hint": "src.epg.hint",
    "#tvs-pl-add": "src.add", "#tvs-epg-add": "src.add",
    "#tvs-pl-file": "src.file", "#tvs-epg-file": "src.file",
    "#tvs-refresh": "src.refreshAll", "#tvpg-watch": "prog.watch", "#tvpg-cal": "prog.remind"
  };
  Object.keys(txt).forEach(function(sel){ var el = $(sel); if(el) el.textContent = t(txt[sel]); });
  ["#tvs-pl-url", "#tvs-epg-url"].forEach(function(sel){
    var el = $(sel);
    if(el){ el.placeholder = t("src.url.ph"); }
  });
  var pu = $("#tvs-pl-url"); if(pu) pu.setAttribute("aria-label", t("src.pl.h"));
  var eu = $("#tvs-epg-url"); if(eu) eu.setAttribute("aria-label", t("src.epg.h"));
  var mg = $("#tv-manage"); if(mg){ mg.title = t("manage"); mg.setAttribute("aria-label", t("manage")); }
  var gs = $("#tv-group"); if(gs) gs.setAttribute("aria-label", t("filter.group"));
  var pc = $("#tvpg-cal"); if(pc) pc.title = t("prog.remind.hint");
  ["#tvs-close", "#tvpg-close"].forEach(function(sel){
    var b = $(sel);
    if(b){
      if(!b.firstChild) b.innerHTML = SVG_A + '<path d="M6 6l12 12M18 6L6 18"/></svg>';
      b.title = t("close"); b.setAttribute("aria-label", t("close"));
    }
  });
  renderGroupFilter();
}

/* ===== WIRING ===== */

function wire(){
  setupFilters();
  setupSearch();
  setupPlayerControls();
  setupSourcesDialog();
  setupProgDialog();

  var groupSelect = $("#tv-group");
  if(groupSelect){
    groupSelect.addEventListener("change", function(){
      state.filterGroup = this.value;
      state.rendered = PAGE_SIZE;
      renderMain();
    });
  }
  var emptyAct = $("#tv-empty-act");
  if(emptyAct) emptyAct.addEventListener("click", openSourcesDialog);

  // Wave 43: own playlists + guides (cached copies first, then the network)
  loadFiles();
  loadAllSources(false);
  setInterval(minuteTick, 60000);

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