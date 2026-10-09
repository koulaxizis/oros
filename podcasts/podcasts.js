// ============================================================
// orOS Podcasts — App logic (v1.0.0)
// Subscriptions, new episodes, an "Up next" queue, downloads for
// offline listening and a player that keeps playing when this
// window closes.
//   - the player and the synced data live in the SHELL
//     (podcasts/host.js, window.parent.__orosPodcastsHost); this
//     window is only the screen over it
//   - feeds: the Reader's shared parser (../feeds/core.js) and
//     sanitizer (../feeds/sanitize.js), read-only; transport through
//     net.js (direct, else the Mail relay's "web" operation)
//   - catalog search: Apple Podcasts + fyyd (setting: both / one /
//     none); OPML import / export through orosDialog (R33)
//   - device-local: feed cache + downloads in IndexedDB (store.js),
//     prefs "oros-podcasts-prefs" (tab, filters)
// Sections:
//   1. Constants, i18n, helpers
//   2. Host (attach / inject into the shell)
//   3. Feed cache + refresh
//   4. Downloads
//   5. Actions (subscribe, play, queue, played)
//   6. UI: toolbar, tabs, views
//   7. Episode rows + menus
//   8. Show page + show settings
//   9. Player bar + full player
//  10. Notes dialog (sanitized, sandboxed)
//  11. Discover: search, add by address, OPML
//  12. Settings
//  13. Toasts, dialogs, keyboard (Contract Β)
//  14. Palette
//  15. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.OrosPodcastsCore, FC = window.orosFeedsCore, NET = window.orosPodcastsNet, ST = window.OrosPodcastsStore;
  var PREFS_KEY = "oros-podcasts-prefs";
  var REFRESH_MIN = 60, REFRESH_GAP = 15;      // minutes
  var KEEP_NOTES = 300, KEEP_EPS = 3000;       // per show in the cache
  var PAGE = 50;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var STRINGS = {
    en: {
      "app": "Podcasts",
      "tab.now": "Listening", "tab.new": "New", "tab.lib": "Library", "tab.dl": "Downloads", "tab.find": "Discover",
      "btn.refresh": "Refresh", "btn.add": "Add podcast", "btn.more": "More", "btn.back": "Back",
      "now.playing": "Now playing", "now.next": "Up next", "now.cont": "Continue listening",
      "empty.now": "Nothing playing. Pick an episode from New or your Library.",
      "empty.next": "The queue is empty. Use “Play next” or “Add to queue” on any episode.",
      "empty.new": "No new episodes.", "empty.lib": "No podcasts yet.", "empty.libBtn": "Find a podcast",
      "empty.dl": "No downloads. Downloaded episodes play without a connection.",
      "empty.eps": "No episodes here.",
      "ep.play": "Play", "ep.pause": "Pause", "ep.resume": "Resume", "ep.left": "{t} left", "ep.played": "Played",
      "ep.next": "Play next", "ep.last": "Add to queue", "ep.unqueue": "Remove from queue",
      "ep.markPlayed": "Mark as played", "ep.markUnplayed": "Mark as unplayed",
      "ep.dl": "Download", "ep.dlDel": "Delete download", "ep.dlCancel": "Cancel download", "ep.notes": "Show notes",
      "ep.link": "Open the episode page", "ep.trailer": "Trailer", "ep.bonus": "Bonus", "ep.video": "Video",
      "ep.sxe": "S{s} · E{e}", "ep.e": "E{e}", "ep.downloaded": "Downloaded", "ep.more": "More actions",
      "f.all": "All", "f.unplayed": "Unplayed", "f.progress": "In progress", "f.played": "Played", "f.dl": "Downloaded",
      "sort.new": "Newest first", "sort.old": "Oldest first", "more.eps": "Show more",
      "show.settings": "Podcast settings", "show.unsub": "Unsubscribe", "show.unsubQ": "Unsubscribe from “{t}”? Its downloads are deleted too.",
      "show.allPlayed": "Mark all as played", "show.site": "Website", "show.support": "Support the show",
      "show.n": "{n} episodes", "show.updated": "Updated {d}",
      "set.speed": "Speed", "set.speedDef": "Default ({v}×)", "set.skA": "Skip the first", "set.skB": "Skip the last",
      "set.sec": "{n} s", "set.off": "Off", "set.auto": "Download new episodes automatically", "set.autoN": "Newest {n}",
      "set.save": "Save", "set.cancel": "Cancel",
      "pl.speed": "Playback speed", "pl.sleep": "Sleep timer", "pl.sleepOff": "Off", "pl.sleepMin": "{n} min",
      "pl.sleepEnd": "End of episode", "pl.sleepLeft": "Stops in {t}", "pl.back": "Back {n} s", "pl.fwd": "Forward {n} s",
      "pl.stop": "Stop", "pl.next": "Next in queue", "pl.open": "Open player", "pl.close": "Close",
      "pl.seek": "Position", "pl.buffer": "Loading…", "pl.err": "This episode could not be played.",
      "find.ph": "Search podcasts", "find.go": "Search", "find.add": "Feed, website or Apple Podcasts address",
      "find.addBtn": "Add", "find.subscribe": "Subscribe", "find.subscribed": "Subscribed",
      "find.none": "Nothing found.", "find.off": "Catalog search is off in Settings. You can still add a podcast by its address.",
      "find.by": "{by} · {n} episodes", "find.src": "Results from {s}.", "find.opmlIn": "Import OPML", "find.opmlOut": "Export OPML",
      "find.searching": "Searching…", "find.choose": "This page has several feeds. Pick one:",
      "dl.total": "{n} downloads · {s}", "dl.free": "{s} free on this device", "dl.persist": "Keep downloads safe from automatic clean-up",
      "dl.persistOk": "Downloads are kept until you delete them.", "dl.delAll": "Delete played downloads",
      "notes.title": "Show notes", "notes.stamps": "Jump to", "notes.none": "No notes for this episode.",
      "s.title": "Settings", "s.back": "Skip back", "s.fwd": "Skip forward", "s.autoNext": "Play the next episode in the queue",
      "s.delPlayed": "Delete downloads after they are played", "s.search": "Catalog search",
      "s.search.both": "Apple Podcasts and fyyd", "s.search.apple": "Apple Podcasts only", "s.search.fyyd": "fyyd only",
      "s.search.none": "Off (add by address only)",
      "s.searchNote": "Search terms go to the catalog you pick. Your subscriptions never leave your devices except through your own encrypted sync.",
      "s.relay": "Feeds that block browsers go through the relay you set up in Mail.", "s.noRelay": "No relay set: feeds that block browsers cannot be read. Set the relay in Mail.",
      "toast.subscribed": "Subscribed to “{t}”.", "toast.unsub": "Unsubscribed.", "toast.undo": "Undo",
      "toast.refreshed": "Up to date.", "toast.newEps": "{n} new episodes.", "toast.refreshErr": "{n} podcasts could not be refreshed.",
      "toast.dlDone": "Downloaded “{t}”.", "toast.dlCors": "This podcast host does not allow downloads. You can still stream it.",
      "toast.dlSpace": "Not enough space on this device.", "toast.dlErr": "Download failed.",
      "toast.queued": "Added to the queue.", "toast.queuedNext": "Plays next.",
      "toast.badUrl": "That is not a valid address.", "toast.noFeed": "No podcast feed found at that address.",
      "toast.notPodcast": "This feed has no audio episodes.", "toast.needRelay": "This site blocks browsers. Set up the relay in Mail to read it.",
      "toast.offline": "You are offline.", "toast.err": "Something went wrong ({c}).",
      "toast.opmlIn": "Imported {n} podcasts.", "toast.opmlNone": "No podcasts in that file.", "toast.opmlOut": "Exported {n} podcasts.",
      "toast.big": "The file is too big.", "toast.limit": "You have reached {n} podcasts.", "toast.moved": "“{t}” moved to a new address.",
      "toast.allPlayed": "All episodes marked as played.",
      "ago.now": "just now", "ago.min": "{n} min ago", "ago.h": "{n} h ago", "ago.d": "{n} d ago",
      "today": "Today", "yesterday": "Yesterday"
    },
    el: {
      "app": "Podcasts",
      "tab.now": "Ακρόαση", "tab.new": "Νέα", "tab.lib": "Βιβλιοθήκη", "tab.dl": "Λήψεις", "tab.find": "Εύρεση",
      "btn.refresh": "Ανανέωση", "btn.add": "Προσθήκη podcast", "btn.more": "Περισσότερα", "btn.back": "Πίσω",
      "now.playing": "Παίζει τώρα", "now.next": "Επόμενα", "now.cont": "Συνέχισε να ακούς",
      "empty.now": "Δεν παίζει τίποτα. Διάλεξε επεισόδιο από τα Νέα ή τη Βιβλιοθήκη.",
      "empty.next": "Η ουρά είναι άδεια. Πάτησε «Παίξε μετά» ή «Στην ουρά» σε ένα επεισόδιο.",
      "empty.new": "Δεν υπάρχουν νέα επεισόδια.", "empty.lib": "Δεν έχεις ακόμη podcasts.", "empty.libBtn": "Βρες ένα podcast",
      "empty.dl": "Καμία λήψη. Τα κατεβασμένα επεισόδια παίζουν χωρίς σύνδεση.",
      "empty.eps": "Κανένα επεισόδιο εδώ.",
      "ep.play": "Αναπαραγωγή", "ep.pause": "Παύση", "ep.resume": "Συνέχεια", "ep.left": "απομένουν {t}", "ep.played": "Ακούστηκε",
      "ep.next": "Παίξε μετά", "ep.last": "Στην ουρά", "ep.unqueue": "Έξω από την ουρά",
      "ep.markPlayed": "Σήμανση ως ακουσμένο", "ep.markUnplayed": "Σήμανση ως μη ακουσμένο",
      "ep.dl": "Λήψη", "ep.dlDel": "Διαγραφή λήψης", "ep.dlCancel": "Ακύρωση λήψης", "ep.notes": "Σημειώσεις επεισοδίου",
      "ep.link": "Σελίδα του επεισοδίου", "ep.trailer": "Τρέιλερ", "ep.bonus": "Μπόνους", "ep.video": "Βίντεο",
      "ep.sxe": "Σ{s} · Ε{e}", "ep.e": "Ε{e}", "ep.downloaded": "Κατεβασμένο", "ep.more": "Περισσότερες ενέργειες",
      "f.all": "Όλα", "f.unplayed": "Μη ακουσμένα", "f.progress": "Σε εξέλιξη", "f.played": "Ακουσμένα", "f.dl": "Κατεβασμένα",
      "sort.new": "Νεότερα πρώτα", "sort.old": "Παλαιότερα πρώτα", "more.eps": "Περισσότερα",
      "show.settings": "Ρυθμίσεις podcast", "show.unsub": "Διαγραφή συνδρομής", "show.unsubQ": "Διαγραφή της συνδρομής στο «{t}»; Σβήνονται και οι λήψεις του.",
      "show.allPlayed": "Όλα ως ακουσμένα", "show.site": "Ιστότοπος", "show.support": "Στήριξε την εκπομπή",
      "show.n": "{n} επεισόδια", "show.updated": "Ενημέρωση {d}",
      "set.speed": "Ταχύτητα", "set.speedDef": "Προεπιλογή ({v}×)", "set.skA": "Παράλειψη αρχής", "set.skB": "Παράλειψη τέλους",
      "set.sec": "{n} δευτ.", "set.off": "Όχι", "set.auto": "Αυτόματη λήψη νέων επεισοδίων", "set.autoN": "Τα {n} νεότερα",
      "set.save": "Αποθήκευση", "set.cancel": "Άκυρο",
      "pl.speed": "Ταχύτητα", "pl.sleep": "Χρονοδιακόπτης ύπνου", "pl.sleepOff": "Όχι", "pl.sleepMin": "{n} λεπτά",
      "pl.sleepEnd": "Τέλος επεισοδίου", "pl.sleepLeft": "Σταματά σε {t}", "pl.back": "Πίσω {n} δευτ.", "pl.fwd": "Μπροστά {n} δευτ.",
      "pl.stop": "Διακοπή", "pl.next": "Επόμενο στην ουρά", "pl.open": "Άνοιγμα player", "pl.close": "Κλείσιμο",
      "pl.seek": "Θέση", "pl.buffer": "Φόρτωση…", "pl.err": "Δεν ήταν δυνατή η αναπαραγωγή του επεισοδίου.",
      "find.ph": "Αναζήτηση podcasts", "find.go": "Αναζήτηση", "find.add": "Διεύθυνση feed, ιστότοπου ή Apple Podcasts",
      "find.addBtn": "Προσθήκη", "find.subscribe": "Εγγραφή", "find.subscribed": "Εγγεγραμμένο",
      "find.none": "Δεν βρέθηκε τίποτα.", "find.off": "Η αναζήτηση καταλόγου είναι κλειστή στις Ρυθμίσεις. Μπορείς να προσθέσεις podcast με τη διεύθυνσή του.",
      "find.by": "{by} · {n} επεισόδια", "find.src": "Αποτελέσματα από {s}.", "find.opmlIn": "Εισαγωγή OPML", "find.opmlOut": "Εξαγωγή OPML",
      "find.searching": "Αναζήτηση…", "find.choose": "Η σελίδα έχει πολλά feeds. Διάλεξε ένα:",
      "dl.total": "{n} λήψεις · {s}", "dl.free": "{s} ελεύθερα στη συσκευή", "dl.persist": "Προστασία των λήψεων από αυτόματο καθαρισμό",
      "dl.persistOk": "Οι λήψεις μένουν μέχρι να τις σβήσεις.", "dl.delAll": "Διαγραφή ακουσμένων λήψεων",
      "notes.title": "Σημειώσεις επεισοδίου", "notes.stamps": "Μετάβαση σε", "notes.none": "Το επεισόδιο δεν έχει σημειώσεις.",
      "s.title": "Ρυθμίσεις", "s.back": "Πίσω κατά", "s.fwd": "Μπροστά κατά", "s.autoNext": "Αναπαραγωγή του επόμενου στην ουρά",
      "s.delPlayed": "Διαγραφή λήψεων όταν ακουστούν", "s.search": "Αναζήτηση καταλόγου",
      "s.search.both": "Apple Podcasts και fyyd", "s.search.apple": "Μόνο Apple Podcasts", "s.search.fyyd": "Μόνο fyyd",
      "s.search.none": "Κλειστή (μόνο με διεύθυνση)",
      "s.searchNote": "Οι όροι αναζήτησης πάνε στον κατάλογο που διαλέγεις. Οι συνδρομές σου δεν φεύγουν από τις συσκευές σου, εκτός από το δικό σου κρυπτογραφημένο sync.",
      "s.relay": "Τα feeds που μπλοκάρουν τους browsers περνούν από το relay που έστησες στο Mail.", "s.noRelay": "Δεν υπάρχει relay: τα feeds που μπλοκάρουν τους browsers δεν διαβάζονται. Όρισέ το στο Mail.",
      "toast.subscribed": "Εγγράφηκες στο «{t}».", "toast.unsub": "Η συνδρομή διαγράφηκε.", "toast.undo": "Αναίρεση",
      "toast.refreshed": "Όλα ενημερωμένα.", "toast.newEps": "{n} νέα επεισόδια.", "toast.refreshErr": "{n} podcasts δεν ανανεώθηκαν.",
      "toast.dlDone": "Κατέβηκε το «{t}».", "toast.dlCors": "Ο πάροχος αυτού του podcast δεν επιτρέπει λήψη. Μπορείς να το ακούς online.",
      "toast.dlSpace": "Δεν υπάρχει αρκετός χώρος στη συσκευή.", "toast.dlErr": "Η λήψη απέτυχε.",
      "toast.queued": "Μπήκε στην ουρά.", "toast.queuedNext": "Παίζει αμέσως μετά.",
      "toast.badUrl": "Η διεύθυνση δεν είναι έγκυρη.", "toast.noFeed": "Δεν βρέθηκε feed podcast σε αυτή τη διεύθυνση.",
      "toast.notPodcast": "Αυτό το feed δεν έχει επεισόδια ήχου.", "toast.needRelay": "Αυτό το site μπλοκάρει τους browsers. Στήσε το relay στο Mail για να το διαβάσεις.",
      "toast.offline": "Είσαι εκτός σύνδεσης.", "toast.err": "Κάτι πήγε στραβά ({c}).",
      "toast.opmlIn": "Εισήχθησαν {n} podcasts.", "toast.opmlNone": "Το αρχείο δεν έχει podcasts.", "toast.opmlOut": "Εξήχθησαν {n} podcasts.",
      "toast.big": "Το αρχείο είναι πολύ μεγάλο.", "toast.limit": "Έφτασες τα {n} podcasts.", "toast.moved": "Το «{t}» μετακόμισε σε νέα διεύθυνση.",
      "toast.allPlayed": "Όλα τα επεισόδια σημειώθηκαν ως ακουσμένα.",
      "ago.now": "μόλις τώρα", "ago.min": "πριν από {n} λεπτά", "ago.h": "πριν από {n} ώρες", "ago.d": "πριν από {n} μέρες",
      "today": "Σήμερα", "yesterday": "Χθες"
    }
  };
  function t(k, v) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.en[k] || k;
    if (v) Object.keys(v).forEach(function (n) { s = s.split("{" + n + "}").join(String(v[n])); });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function button(label, cls, fn, icon) {
    var b = el("button", cls || "txt-btn");
    b.type = "button";
    if (icon) { b.innerHTML = icon; b.setAttribute("aria-label", label); b.title = label; }
    else b.textContent = label;
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function img(src, cls) {
    var i = el("img", cls || "art");
    i.alt = "";
    i.loading = "lazy";
    i.decoding = "async";
    i.referrerPolicy = "no-referrer";
    if (src) i.src = src;
    i.addEventListener("error", function () { i.removeAttribute("src"); i.classList.add("noart"); });
    if (!src) i.classList.add("noart");
    return i;
  }
  function now() { return Date.now(); }
  function fmtSize(b) {
    if (!b) return "0 MB";
    if (b < 1e6) return Math.max(1, Math.round(b / 1e3)) + " KB";
    if (b < 1e9) return Math.round(b / 1e6) + " MB";
    return (b / 1e9).toFixed(1) + " GB";
  }
  var dateFmt = null;
  function fmtDate(ms) {
    if (!ms) return "";
    var d = new Date(ms), today = new Date();
    var day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((day(today) - day(d)) / 86400000);
    if (diff === 0) return t("today");
    if (diff === 1) return t("yesterday");
    try {
      dateFmt = dateFmt || new Intl.DateTimeFormat(LANG === "el" ? "el-GR" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
      var s = dateFmt.format(d);
      return d.getFullYear() === today.getFullYear() ? s.replace(/\s*\d{4}$/, "") : s;
    } catch (e) { return d.toISOString().slice(0, 10); }
  }
  function ago(ms) {
    var m = Math.round((now() - ms) / 60000);
    if (m < 1) return t("ago.now");
    if (m < 60) return t("ago.min", { n: m });
    if (m < 1440) return t("ago.h", { n: Math.round(m / 60) });
    return t("ago.d", { n: Math.round(m / 1440) });
  }
  var UI = {
    play:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
    back:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    fwd:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
    next:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5.5v13a1 1 0 0 0 1.6.8l8.4-6.5a1 1 0 0 0 0-1.6L6.6 4.7A1 1 0 0 0 5 5.5z"/><rect x="16" y="5" width="3" height="14" rx="1"/></svg>',
    stop:  '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    more:  '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/></svg>',
    left:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    down:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M6 11l6 6 6-6M5 20h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    up:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
    dn:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    gear:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    moon:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>'
  };

  // Device-local view prefs (R10): never synced.
  var prefs = (function () {
    var p = { tab: "now", filter: "all", sortOld: {} };
    try {
      var o = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (o && typeof o === "object") {
        if (["now", "new", "lib", "dl", "find"].indexOf(o.tab) >= 0) p.tab = o.tab;
        if (["all", "unplayed", "progress", "played", "dl"].indexOf(o.filter) >= 0) p.filter = o.filter;
        if (o.sortOld && typeof o.sortOld === "object") p.sortOld = o.sortOld;
      }
    } catch (e) {}
    return p;
  })();
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }

  // ---------- 2. Host ----------
  var H = null;       // host.api
  var unsub = null;
  function shellWin() { try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; } }
  function attach() {
    var w = shellWin() || window;
    var h = null;
    try { h = w.__orosPodcastsHost; } catch (e) { h = null; }
    if (h && h.api) return Promise.resolve(h.api);
    // Not loaded by the shell (older shell or standalone): load the
    // three files into the shell window, in order.
    var base = w === window ? "" : "podcasts/";
    var files = ["core.js", "store.js", "host.js"];
    var ver = (document.querySelector('script[src*="podcasts.js"]') || {}).src || "";
    var q = (ver.match(/\?v=[^"&]+/) || [""])[0];
    return files.reduce(function (p, f) {
      return p.then(function () {
        var name = f === "core.js" ? "OrosPodcastsCore" : f === "store.js" ? "OrosPodcastsStore" : "__orosPodcastsHost";
        if (w[name]) return null;
        return new Promise(function (resolve) {
          var s = w.document.createElement("script");
          s.src = base + f + q;
          s.onload = s.onerror = function () { resolve(); };
          w.document.head.appendChild(s);
        });
      });
    }, Promise.resolve()).then(function () {
      var hh = w.__orosPodcastsHost;
      return hh && hh.api ? hh.api : null;
    });
  }
  function D() { return H ? H.data() : C.emptyData(); }
  function mutate(fn) { return H ? H.mutate(fn) : false; }

  // ---------- 3. Feed cache + refresh ----------
  // feeds[showId] = { id, at, etag, lm, show, eps[] } (IndexedDB copy in memory)
  var feeds = {};
  var epIndex = {};          // epId → { ep, sid }
  var refreshing = false, lastRefresh = 0;
  function indexFeed(rec) {
    (rec.eps || []).forEach(function (e) { epIndex[e.id] = { ep: e, sid: rec.id }; });
  }
  function loadFeeds() {
    var shows = D().shows;
    return Promise.all(shows.map(function (s) {
      return ST.getFeed(s.id).then(function (r) { if (r && r.eps) { feeds[s.id] = r; indexFeed(r); } });
    }));
  }
  function metaOf(id) {
    var x = epIndex[id];
    if (!x) return null;
    var s = C.findShow(D(), x.sid), e = x.ep;
    return { id: e.id, s: x.sid, title: e.title, show: s ? s.title : "", img: e.img || (s && s.img) || "",
      audio: e.audio, pd: e.pub, dur: e.dur, video: e.video };
  }
  function cacheFeed(sid, parsed, res) {
    var old = feeds[sid];
    var eps = parsed.eps.slice(0, KEEP_EPS).map(function (e, i) {
      if (i >= KEEP_NOTES) e.notes = "";
      e.s = sid;
      return e;
    });
    var rec = { id: sid, at: now(), etag: (res && res.etag) || (old && old.etag) || "", lm: (res && res.lm) || (old && old.lm) || "",
      show: parsed.show, eps: eps, seen: old ? old.seen : now() };
    feeds[sid] = rec;
    indexFeed(rec);
    ST.putFeed(rec);
    return rec;
  }
  function parseText(text, url) {
    if (!FC || !text) return null;
    if (FC.looksLikeFeed && !FC.looksLikeFeed(text)) return null;
    try { return C.parseFeed(FC.parseXml(text), url); } catch (e) { return null; }
  }
  // After a refresh: names/covers follow the feed, a moved feed moves,
  // old played episodes compact into the floor (R27: only real changes).
  function afterFeed(sid, rec) {
    var s = C.findShow(D(), sid);
    if (!s) return;
    var sh = rec.show;
    var patch = {};
    if (sh.title && sh.title !== s.title) patch.title = sh.title;
    if (sh.by !== s.by) patch.by = sh.by;
    if (sh.img && sh.img !== s.img) patch.img = sh.img;
    if (Object.keys(patch).length) mutate(function (d, n) { return C.editShow(d, sid, patch, n); });
    var list = rec.eps.map(function (e) { return { id: e.id, s: sid, pd: e.pub }; });
    mutate(function (d, n) { return C.compactShow(d, sid, list, n); });
    if (sh.newUrl) moveTo(sid, sh.newUrl, sh.title || s.title);
  }
  function moveTo(sid, url, title) {
    var nid = C.showId(url), rec = feeds[sid];
    if (!nid || nid === sid) return;
    var map = {};
    (rec ? rec.eps : []).forEach(function (e) { map[e.id] = C.episodeId(nid, e); });
    mutate(function (d, n) { return C.moveShow(d, sid, url, map, n); });
    if (rec) {
      var moved = { id: nid, at: 0, etag: "", lm: "", show: rec.show, seen: rec.seen,
        eps: rec.eps.map(function (e) { var x = Object.assign({}, e); x.id = map[e.id]; x.s = nid; return x; }) };
      feeds[nid] = moved; indexFeed(moved); ST.putFeed(moved);
    }
    delete feeds[sid]; ST.delFeed(sid);
    showToast(t("toast.moved", { t: title }));
  }

  function refresh(force, only) {
    if (refreshing || !H) return Promise.resolve();
    var shows = D().shows.filter(function (s) {
      if (only && s.id !== only) return false;
      var r = feeds[s.id];
      if (force) return !r || now() - r.at > 60000;
      return !r || now() - r.at > REFRESH_GAP * 60000;
    });
    if (!shows.length) { if (force && !only) showToast(t("toast.refreshed")); return Promise.resolve(); }
    if (navigator.onLine === false) { if (force) showToast(t("toast.offline")); return Promise.resolve(); }
    refreshing = true;
    paintRefresh();
    var before = countNew();
    return NET.fetchFeeds(shows.map(function (s) {
      var r = feeds[s.id];
      return { url: s.url, etag: r && r.etag, lm: r && r.lm };
    })).then(function (res) {
      var errs = 0;
      res.forEach(function (r, i) {
        var s = shows[i];
        if (!r || r.err) { errs++; return; }
        if (r.status === 304 && feeds[s.id]) { feeds[s.id].at = now(); ST.putFeed(feeds[s.id]); return; }
        var parsed = parseText(r.text, s.url);
        if (!parsed) { errs++; return; }
        afterFeed(s.id, cacheFeed(s.id, parsed, r));
      });
      lastRefresh = now();
      refreshing = false;
      paintRefresh();
      renderAll();
      var gained = countNew() - before;
      if (force && !only) showToast(errs ? t("toast.refreshErr", { n: errs }) : gained > 0 ? t("toast.newEps", { n: gained }) : t("toast.refreshed"));
      autoDownload();
    }, function () { refreshing = false; paintRefresh(); });
  }
  function countNew() { return C.newEpisodes(D(), cacheView(), now()).length; }
  function cacheView() {
    var o = {};
    Object.keys(feeds).forEach(function (k) { o[k] = feeds[k].eps; });
    return o;
  }

  // ---------- 4. Downloads ----------
  var files = {};            // epId → { size, at } (records without blobs)
  var dling = {};            // epId → { ctl, got, total }
  function loadFiles() {
    return ST.listFiles().then(function (list) { files = {}; list.forEach(function (f) { files[f.id] = f; }); });
  }
  function download(m, quiet) {
    if (!m || files[m.id] || dling[m.id]) return Promise.resolve(false);
    var ctl = new AbortController();
    var job = dling[m.id] = { ctl: ctl, got: 0, total: 0 };
    paintEp(m.id);
    return ST.usage().then(function (u) {
      var need = (epIndex[m.id] && epIndex[m.id].ep.size) || 0;
      if (u && u.quota && need && u.quota - u.usage < need * 1.2) throw { code: "space" };
      return fetch(m.audio, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal: ctl.signal })
        .catch(function () { throw { code: "cors" }; });
    }).then(function (r) {
      if (!r.ok) throw { code: "http" };
      job.total = +r.headers.get("Content-Length") || 0;
      var type = (r.headers.get("Content-Type") || "").split(";")[0] || "audio/mpeg";
      if (!r.body || !r.body.getReader) return r.blob().then(function (b) { return { blob: b, type: type }; });
      var reader = r.body.getReader(), parts = [], last = 0;
      return (function pump() {
        return reader.read().then(function (x) {
          if (x.done) return { blob: new Blob(parts, { type: type }), type: type };
          parts.push(x.value);
          job.got += x.value.length;
          if (now() - last > 400) { last = now(); paintEp(m.id); }
          return pump();
        });
      })();
    }).then(function (o) {
      var rec = { id: m.id, s: m.s, blob: o.blob, type: o.type, size: o.blob.size, at: now(), title: m.title, show: m.show };
      return ST.putFile(rec).then(function (ok) {
        if (ok === false) throw { code: "space" };
        files[m.id] = { id: m.id, s: m.s, size: o.blob.size, at: rec.at, title: m.title, show: m.show };
        delete dling[m.id];
        paintEp(m.id);
        if (!quiet) showToast(t("toast.dlDone", { t: m.title }));
        if (prefs.tab === "dl") renderAll();
        return true;
      });
    }).catch(function (e) {
      delete dling[m.id];
      paintEp(m.id);
      if (ctl.signal.aborted) return false;
      var code = e && e.code;
      if (!code) console.warn("[podcasts] download", e);
      if (!quiet) showToast(code === "space" ? t("toast.dlSpace") : code === "cors" ? t("toast.dlCors") : t("toast.dlErr"));
      return false;
    });
  }
  function cancelDownload(id) { var j = dling[id]; if (j) j.ctl.abort(); }
  function deleteFile(id) {
    delete files[id];
    return ST.delFile(id).then(function () { paintEp(id); if (prefs.tab === "dl") renderAll(); });
  }
  function autoDownload() {
    var d = D();
    d.shows.forEach(function (s) {
      if (!s.auto || !feeds[s.id]) return;
      feeds[s.id].eps.filter(function (e) { return e.pub >= s.at && !C.stateOf(d, { id: e.id, s: s.id, pd: e.pub }).x; })
        .slice(0, s.auto).forEach(function (e) { download(metaOf(e.id), true); });
    });
  }
  function sweepPlayed() {
    if (!C.prefOf(D(), "delPlayed")) return;
    Object.keys(files).forEach(function (id) {
      var x = epIndex[id], f = files[id];
      var st = C.stateOf(D(), { id: id, s: f.s, pd: x ? x.ep.pub : 0 });
      var cur = H && H.getState().cur;
      if (st.x && !(cur && cur.id === id)) deleteFile(id);
    });
  }

  // ---------- 5. Actions ----------
  function subscribe(hit, parsed) {
    var d = D();
    if (d.shows.length >= C.LIM.shows) { showToast(t("toast.limit", { n: C.LIM.shows })); return false; }
    var ok = mutate(function (dd, n) { return C.subscribe(dd, { url: hit.url, title: hit.title, by: hit.by, img: hit.img }, n); });
    var sid = C.showId(hit.url);
    if (parsed) cacheFeed(sid, parsed, null);
    if (ok) showToast(t("toast.subscribed", { t: hit.title }));
    if (!parsed) refresh(true, sid);
    renderAll();
    return ok;
  }
  function unsubscribe(sid) {
    var s = C.findShow(D(), sid);
    if (!s) return;
    confirmDlg(t("show.unsubQ", { t: s.title }), t("show.unsub"), function () {
      mutate(function (d, n) { return C.unsubscribe(d, sid, n); });
      Object.keys(files).forEach(function (id) { if (files[id].s === sid) deleteFile(id); });
      var cur = H.getState().cur;
      if (cur && cur.s === sid) H.stop();
      delete feeds[sid];
      ST.delFeed(sid);
      view.show = "";
      renderAll();
      showToast(t("toast.unsub"));
    });
  }
  function playEp(id) {
    var m = metaOf(id);
    if (!m) return;
    var st = H.getState();
    if (st.cur && st.cur.id === id) { H.toggle(); return; }
    var x = C.stateOf(D(), { id: id, s: m.s, pd: m.pd });
    H.play(m, x.x ? 0 : undefined);
    rememberQueue();
  }
  function queue(id, where) {
    var m = metaOf(id);
    if (!m) return;
    H.remember([m]);
    mutate(function (d, n) { return C.queueAdd(d, { id: id, s: m.s }, where, n); });
    showToast(where === "next" ? t("toast.queuedNext") : t("toast.queued"));
  }
  function unqueue(id) { mutate(function (d, n) { return C.queueRemove(d, id, n); }); }
  function rememberQueue() { H.remember(D().queue.ids.map(metaOf).filter(Boolean)); }
  function setPlayed(id, played) {
    var x = epIndex[id];
    if (!x) return;
    var cur = H.getState().cur;
    if (played && cur && cur.id === id) { H.next(); return; }
    mutate(function (d, n) { return C.setProgress(d, { id: id, s: x.sid, pd: x.ep.pub }, 0, x.ep.dur, played ? 1 : 0, n); });
    if (played) { unqueue(id); if (C.prefOf(D(), "delPlayed") && files[id]) deleteFile(id); }
  }

  // ---------- 6. UI: toolbar, tabs, views ----------
  var view = { show: "", page: 1 };
  function setTab(tab) {
    prefs.tab = tab; view.show = ""; view.page = 1;
    savePrefs();
    renderAll();
    $("main").scrollTop = 0;
  }
  function paintTabs() {
    [].forEach.call(document.querySelectorAll("#tabs [data-tab]"), function (b) {
      var on = b.getAttribute("data-tab") === prefs.tab && !view.show;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.classList.toggle("on", b.getAttribute("data-tab") === prefs.tab);
    });
    var n = countNew();
    $("cnt-new").textContent = n ? String(Math.min(n, 99)) : "";
  }
  function paintRefresh() {
    var b = $("refresh-btn");
    if (b) b.classList.toggle("spin", refreshing);
  }
  function renderAll() {
    paintTabs();
    var main = $("main");
    main.textContent = "";
    if (!H) return;
    if (view.show) { renderShow(main, view.show); paintPlayer(); return; }
    ({ now: renderNow, "new": renderNew, lib: renderLib, dl: renderDl, find: renderFind })[prefs.tab](main);
    paintPlayer();
  }
  function section(main, title) {
    var h = el("h2", "sec", title);
    main.appendChild(h);
    return h;
  }
  function empty(main, text, btnLabel, fn) {
    var box = el("div", "empty", text);
    if (btnLabel) { box.appendChild(el("br")); box.appendChild(button(btnLabel, "txt-btn primary", fn)); }
    main.appendChild(box);
  }
  function renderNow(main) {
    var st = H.getState(), d = D();
    section(main, t("now.playing"));
    if (st.cur) main.appendChild(epRow(st.cur.id, { showName: true }));
    else empty(main, t("empty.now"));
    section(main, t("now.next"));
    var q = d.queue.ids.filter(function (id) { return !(st.cur && st.cur.id === id); });
    if (!q.length) empty(main, t("empty.next"));
    var ul = el("ul", "eps");
    q.forEach(function (id, i) { ul.appendChild(epRow(id, { showName: true, queueIdx: i, queueLen: q.length })); });
    main.appendChild(ul);
    var cont = C.inProgress(d).filter(function (e) { return epIndex[e.id] && !(st.cur && st.cur.id === e.id) && q.indexOf(e.id) < 0; }).slice(0, 10);
    if (cont.length) {
      section(main, t("now.cont"));
      var ul2 = el("ul", "eps");
      cont.forEach(function (e) { ul2.appendChild(epRow(e.id, { showName: true })); });
      main.appendChild(ul2);
    }
  }
  function renderNew(main) {
    var list = C.newEpisodes(D(), cacheView(), now(), 100);
    if (!list.length) { empty(main, D().shows.length ? t("empty.new") : t("empty.lib"), D().shows.length ? "" : t("empty.libBtn"), function () { setTab("find"); }); return; }
    var ul = el("ul", "eps");
    list.forEach(function (x) { ul.appendChild(epRow(x.ep.id, { showName: true })); });
    main.appendChild(ul);
  }
  function renderLib(main) {
    var shows = D().shows.slice().sort(function (a, b) { return C.fold(a.title) < C.fold(b.title) ? -1 : 1; });
    if (!shows.length) { empty(main, t("empty.lib"), t("empty.libBtn"), function () { setTab("find"); }); return; }
    var grid = el("ul", "grid");
    var d = D(), cache = cacheView();
    var newBy = {};
    C.newEpisodes(d, cache, now()).forEach(function (x) { newBy[x.show.id] = (newBy[x.show.id] || 0) + 1; });
    shows.forEach(function (s) {
      var li = el("li", "tile");
      var b = el("button", "tile-btn");
      b.type = "button";
      b.appendChild(img(s.img, "art big"));
      b.appendChild(el("span", "tile-title", s.title));
      if (newBy[s.id]) b.appendChild(el("span", "badge", String(newBy[s.id])));
      b.setAttribute("aria-label", s.title + (newBy[s.id] ? " (" + newBy[s.id] + ")" : ""));
      b.addEventListener("click", function () { openShow(s.id); });
      li.appendChild(b);
      grid.appendChild(li);
    });
    main.appendChild(grid);
  }
  function renderDl(main) {
    var ids = Object.keys(files).sort(function (a, b) { return files[b].at - files[a].at; });
    var total = 0;
    ids.forEach(function (id) { total += files[id].size || 0; });
    var head = el("div", "dl-head");
    head.appendChild(el("div", "", t("dl.total", { n: ids.length, s: fmtSize(total) })));
    var free = el("div", "dim");
    head.appendChild(free);
    ST.usage().then(function (u) { if (u && u.quota) free.textContent = t("dl.free", { s: fmtSize(u.quota - u.usage) }); });
    var row = el("div", "row-btns");
    var pb = button(t("dl.persist"), "txt-btn", function () {
      ST.persist().then(function (ok) { if (ok) { showToast(t("dl.persistOk")); pb.remove(); } });
    });
    try {
      if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(function (p) { if (p) pb.remove(); });
    } catch (e) {}
    row.appendChild(pb);
    if (ids.length) row.appendChild(button(t("dl.delAll"), "txt-btn", function () {
      ids.forEach(function (id) {
        var x = epIndex[id];
        if (C.stateOf(D(), { id: id, s: files[id].s, pd: x ? x.ep.pub : 0 }).x) deleteFile(id);
      });
    }));
    head.appendChild(row);
    main.appendChild(head);
    if (!ids.length) { empty(main, t("empty.dl")); return; }
    var ul = el("ul", "eps");
    ids.forEach(function (id) { ul.appendChild(epRow(id, { showName: true })); });
    main.appendChild(ul);
  }

  // ---------- 7. Episode rows + menus ----------
  function epRow(id, opt) {
    opt = opt || {};
    var li = el("li", "ep");
    li.setAttribute("data-ep", id);
    fillRow(li, id, opt);
    return li;
  }
  function fillRow(li, id, opt) {
    li.textContent = "";
    var x = epIndex[id], st = H.getState();
    var m = x ? metaOf(id) : (st.cur && st.cur.id === id ? st.cur : null);
    if (!m) { li.appendChild(el("div", "dim", "…")); return; }
    var e = x ? x.ep : { title: m.title, pub: m.pd, dur: m.dur };
    var state = C.stateOf(D(), { id: id, s: m.s, pd: m.pd });
    var isCur = st.cur && st.cur.id === id, playing = isCur && st.playing;
    if (isCur) { state = { p: Math.floor(st.pos), d: Math.round(st.dur) || state.d, x: 0 }; }
    var local = H.position(id);
    if (!isCur && !state.x && local > state.p) state.p = local;
    var dur = state.d || e.dur || 0;
    li.classList.toggle("played", !!state.x);
    li.classList.toggle("cur", !!isCur);

    if (opt.showName) li.appendChild(img(m.img, "art"));
    var body = el("div", "ep-body");
    var top = el("div", "ep-meta");
    var bits = [];
    if (opt.showName) bits.push(m.show);
    bits.push(fmtDate(e.pub));
    if (x && x.ep.season && x.ep.num) bits.push(t("ep.sxe", { s: x.ep.season, e: x.ep.num }));
    else if (x && x.ep.num) bits.push(t("ep.e", { e: x.ep.num }));
    if (x && x.ep.kind === "trailer") bits.push(t("ep.trailer"));
    if (x && x.ep.kind === "bonus") bits.push(t("ep.bonus"));
    if (x && x.ep.video) bits.push(t("ep.video"));
    top.textContent = bits.filter(Boolean).join(" · ");
    body.appendChild(top);
    var title = el("button", "ep-title", e.title);
    title.type = "button";
    title.addEventListener("click", function () { notesDlg(id); });
    body.appendChild(title);
    var info = el("div", "ep-info");
    if (state.x) { var ck = el("span", "ok"); ck.innerHTML = UI.check; info.appendChild(ck); info.appendChild(el("span", "", t("ep.played"))); }
    else if (state.p > 0 && dur) info.appendChild(el("span", "", t("ep.left", { t: C.fmtTime(dur - state.p) })));
    else if (dur) info.appendChild(el("span", "", C.fmtTime(dur)));
    if (files[id]) { var dl = el("span", "ok dl-ic"); dl.innerHTML = UI.down; dl.title = t("ep.downloaded"); info.appendChild(dl); }
    var job = dling[id];
    if (job) info.appendChild(el("span", "dim", job.total ? Math.round(job.got / job.total * 100) + "%" : fmtSize(job.got)));
    body.appendChild(info);
    if (!state.x && state.p > 0 && dur) {
      var bar = el("div", "bar"), fill = el("div", "fill");
      fill.style.width = Math.min(100, state.p / dur * 100).toFixed(1) + "%";
      bar.appendChild(fill);
      body.appendChild(bar);
    }
    li.appendChild(body);

    var acts = el("div", "ep-acts");
    if (opt.queueIdx !== undefined) {
      var at = function () { return D().queue.ids.indexOf(id); };
      var upB = button("↑", "icon-btn sm", function () { mutate(function (d, n) { return C.queueMove(d, id, at() - 1, n); }); }, UI.up);
      var dnB = button("↓", "icon-btn sm", function () { mutate(function (d, n) { return C.queueMove(d, id, at() + 1, n); }); }, UI.dn);
      upB.disabled = opt.queueIdx === 0;
      dnB.disabled = opt.queueIdx === opt.queueLen - 1;
      acts.appendChild(upB);
      acts.appendChild(dnB);
    }
    var pb = button(playing ? t("ep.pause") : state.p > 0 && !state.x ? t("ep.resume") : t("ep.play"), "icon-btn play", function () { playEp(id); }, playing ? UI.pause : UI.play);
    acts.appendChild(pb);
    acts.appendChild(button(t("ep.more"), "icon-btn", function () { epMenu(id); }, UI.more));
    li.appendChild(acts);
  }
  function paintEp(id) {
    [].forEach.call(document.querySelectorAll('li.ep[data-ep="' + id + '"]'), function (li) {
      fillRow(li, id, { showName: !!li.querySelector(".art") && !view.show });
    });
  }
  function epMenu(id) {
    var x = epIndex[id], m = metaOf(id);
    if (!m) return;
    var st = C.stateOf(D(), { id: id, s: m.s, pd: m.pd });
    var inQ = D().queue.ids.indexOf(id) >= 0;
    var dlg = makeDialog("pc-menu", "menu-dlg");
    dlg.appendChild(el("div", "dlg-title", m.title));
    var col = el("div", "menu-col");
    var go = function (fn) { return function () { dlg.close(); fn(); }; };
    col.appendChild(button(t("ep.next"), "", go(function () { queue(id, "next"); })));
    col.appendChild(button(inQ ? t("ep.unqueue") : t("ep.last"), "", go(function () { if (inQ) unqueue(id); else queue(id, "end"); })));
    col.appendChild(button(st.x ? t("ep.markUnplayed") : t("ep.markPlayed"), "", go(function () { setPlayed(id, !st.x); })));
    if (files[id]) col.appendChild(button(t("ep.dlDel"), "", go(function () { deleteFile(id); })));
    else if (dling[id]) col.appendChild(button(t("ep.dlCancel"), "", go(function () { cancelDownload(id); })));
    else col.appendChild(button(t("ep.dl") + (x && x.ep.size ? " (" + fmtSize(x.ep.size) + ")" : ""), "", go(function () { download(m); })));
    col.appendChild(button(t("ep.notes"), "", go(function () { notesDlg(id); })));
    if (x && x.ep.link) col.appendChild(button(t("ep.link"), "", go(function () { openLink(x.ep.link); })));
    if (!view.show) col.appendChild(button(m.show, "", go(function () { openShow(m.s); })));
    col.appendChild(button(t("pl.close"), "", function () { dlg.close(); }));
    dlg.appendChild(col);
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function openLink(u) {
    u = C.safeUrl(u);
    if (!u) return;
    var w = window.open(u, "_blank", "noopener,noreferrer");
    if (w) { try { w.opener = null; } catch (e) {} }
  }

  // ---------- 8. Show page + show settings ----------
  function openShow(sid) { view.show = sid; view.page = 1; renderAll(); $("main").scrollTop = 0; }
  function renderShow(main, sid) {
    var s = C.findShow(D(), sid);
    if (!s) { view.show = ""; renderAll(); return; }
    var rec = feeds[sid];
    var head = el("div", "show-head");
    head.appendChild(button(t("btn.back"), "icon-btn back", function () { view.show = ""; renderAll(); }, UI.left));
    head.appendChild(img(s.img, "art big"));
    var info = el("div", "show-info");
    info.appendChild(el("h2", "show-title", s.title));
    if (s.by) info.appendChild(el("div", "dim", s.by));
    var meta = [];
    if (rec) meta.push(t("show.n", { n: rec.eps.length }), t("show.updated", { d: ago(rec.at) }));
    info.appendChild(el("div", "dim small", meta.join(" · ")));
    var btns = el("div", "row-btns");
    btns.appendChild(button(t("btn.refresh"), "icon-btn", function () { refresh(true, sid); }, UI.refresh));
    btns.appendChild(button(t("show.settings"), "icon-btn", function () { showSettings(sid); }, UI.gear));
    btns.appendChild(button(t("show.allPlayed"), "txt-btn", function () {
      if (!rec) return;
      mutate(function (d, n) { return C.markAllPlayed(d, sid, rec.eps.map(function (e) { return { id: e.id, s: sid, pd: e.pub }; }), n); });
      showToast(t("toast.allPlayed"));
    }));
    if (rec && rec.show.link) btns.appendChild(button(t("show.site"), "txt-btn", function () { openLink(rec.show.link); }));
    if (rec && rec.show.funding && rec.show.funding[0]) btns.appendChild(button(rec.show.funding[0].label || t("show.support"), "txt-btn", function () { openLink(rec.show.funding[0].url); }));
    btns.appendChild(button(t("show.unsub"), "txt-btn danger", function () { unsubscribe(sid); }));
    info.appendChild(btns);
    head.appendChild(info);
    main.appendChild(head);
    if (rec && rec.show.desc) {
      var desc = el("p", "show-desc", C.plain(rec.show.desc, 600));
      main.appendChild(desc);
    }
    var bar = el("div", "chips");
    ["all", "unplayed", "progress", "played", "dl"].forEach(function (f) {
      var c = button(t("f." + f), "chip" + (prefs.filter === f ? " on" : ""), function () { prefs.filter = f; view.page = 1; savePrefs(); renderAll(); });
      c.setAttribute("aria-pressed", prefs.filter === f ? "true" : "false");
      bar.appendChild(c);
    });
    var oldFirst = prefs.sortOld[sid] !== undefined ? !!prefs.sortOld[sid] : !!(rec && rec.show.serial);
    var so = el("select", "sort");
    so.setAttribute("aria-label", t("sort.new") + " / " + t("sort.old"));
    [["new", t("sort.new")], ["old", t("sort.old")]].forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; so.appendChild(op); });
    so.value = oldFirst ? "old" : "new";
    so.addEventListener("change", function () { prefs.sortOld[sid] = so.value === "old" ? 1 : 0; savePrefs(); renderAll(); });
    bar.appendChild(so);
    main.appendChild(bar);
    if (!rec) { empty(main, t("pl.buffer")); return; }
    var eps = prefs.filter === "dl" ? rec.eps.filter(function (e) { return files[e.id]; }) :
      C.filterEpisodes(D(), sid, rec.eps.map(function (e) { return { id: e.id, pub: e.pub }; }), prefs.filter).map(function (e) { return epIndex[e.id].ep; });
    if (oldFirst) eps = eps.slice().reverse();
    if (!eps.length) { empty(main, t("empty.eps")); return; }
    var ul = el("ul", "eps");
    eps.slice(0, view.page * PAGE).forEach(function (e) { ul.appendChild(epRow(e.id, {})); });
    main.appendChild(ul);
    if (eps.length > view.page * PAGE) main.appendChild(button(t("more.eps"), "txt-btn more", function () { view.page++; renderAll(); }));
  }
  function showSettings(sid) {
    var s = C.findShow(D(), sid);
    if (!s) return;
    var dlg = makeDialog("pc-show-set", "form-dlg");
    dlg.appendChild(el("div", "dlg-title", t("show.settings")));
    var form = el("div", "form");
    var spd = select(t("set.speed"), [[0, t("set.speedDef", { v: C.prefOf(D(), "spd") })]].concat(C.SPEEDS.map(function (v) { return [v, v + "×"]; })), s.spd);
    var secs = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300];
    var skA = select(t("set.skA"), secs.map(function (v) { return [v, v ? t("set.sec", { n: v }) : t("set.off")]; }), s.skA);
    var skB = select(t("set.skB"), secs.map(function (v) { return [v, v ? t("set.sec", { n: v }) : t("set.off")]; }), s.skB);
    var auto = select(t("set.auto"), [0, 1, 2, 3, 5, 10].map(function (v) { return [v, v ? t("set.autoN", { n: v }) : t("set.off")]; }), s.auto);
    [spd, skA, skB, auto].forEach(function (x) { form.appendChild(x.wrap); });
    dlg.appendChild(form);
    var row = el("div", "dlg-btns");
    row.appendChild(button(t("set.cancel"), "txt-btn", function () { dlg.close(); }));
    row.appendChild(button(t("set.save"), "txt-btn primary", function () {
      mutate(function (d, n) { return C.editShow(d, sid, { spd: +spd.sel.value, skA: +skA.sel.value, skB: +skB.sel.value, auto: +auto.sel.value }, n); });
      dlg.close();
      autoDownload();
    }));
    dlg.appendChild(row);
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function select(label, opts, val) {
    var wrap = el("label", "field");
    wrap.appendChild(el("span", "", label));
    var sel = el("select");
    opts.forEach(function (o) { var op = el("option", "", o[1]); op.value = String(o[0]); sel.appendChild(op); });
    sel.value = String(val);
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
    wrap.appendChild(sel);
    return { wrap: wrap, sel: sel };
  }

  // ---------- 9. Player bar + full player ----------
  function paintPlayer() {
    var bar = $("player");
    var st = H ? H.getState() : null;
    if (!st || !st.cur) { bar.hidden = true; document.body.classList.remove("has-player"); return; }
    bar.hidden = false;
    document.body.classList.add("has-player");
    var c = st.cur;
    var art = $("pl-art");
    if (art.getAttribute("data-src") !== c.img) {
      art.setAttribute("data-src", c.img || "");
      art.textContent = "";
      art.appendChild(img(c.img, "art"));
    }
    $("pl-title").textContent = c.title;
    $("pl-show").textContent = st.error ? t("pl.err") : st.buffering && st.playing ? t("pl.buffer") : c.show;
    var pb = $("pl-play");
    pb.innerHTML = st.playing ? UI.pause : UI.play;
    pb.setAttribute("aria-label", st.playing ? t("ep.pause") : t("ep.play"));
    pb.title = pb.getAttribute("aria-label");
    $("pl-prog").style.width = st.dur ? Math.min(100, st.pos / st.dur * 100).toFixed(2) + "%" : "0";
    paintFull(st);
  }
  function fullPlayer() {
    var st = H.getState();
    if (!st.cur) return;
    var dlg = makeDialog("pc-full", "full-dlg");
    var close = button(t("pl.close"), "icon-btn close", function () { dlg.close(); }, UI.dn);
    dlg.appendChild(close);
    var artBox = el("div", "full-art"); artBox.id = "fp-art";
    dlg.appendChild(artBox);
    var tt = el("div", "full-title"); tt.id = "fp-title"; dlg.appendChild(tt);
    var sh = el("button", "full-show"); sh.type = "button"; sh.id = "fp-show";
    sh.addEventListener("click", function () { var c = H.getState().cur; if (c) { dlg.close(); openShow(c.s); } });
    dlg.appendChild(sh);
    var range = el("input", "seek"); range.type = "range"; range.id = "fp-seek"; range.min = "0"; range.step = "1";
    range.setAttribute("aria-label", t("pl.seek"));
    var dragging = false;
    range.addEventListener("input", function () { dragging = true; $("fp-pos").textContent = C.fmtTime(+range.value); });
    range.addEventListener("change", function () { dragging = false; H.seekTo(+range.value); });
    range._drag = function () { return dragging; };
    dlg.appendChild(range);
    var times = el("div", "times");
    var a = el("span"); a.id = "fp-pos"; var b = el("span"); b.id = "fp-left";
    times.appendChild(a); times.appendChild(b);
    dlg.appendChild(times);
    var ctr = el("div", "controls");
    var d = D();
    ctr.appendChild(button(t("pl.back", { n: C.prefOf(d, "back") }), "icon-btn lg skip", function () { H.back(); }, UI.back));
    var p = button(t("ep.play"), "icon-btn xl play", function () { H.toggle(); }, UI.play); p.id = "fp-play";
    ctr.appendChild(p);
    ctr.appendChild(button(t("pl.fwd", { n: C.prefOf(d, "fwd") }), "icon-btn lg skip", function () { H.fwd(); }, UI.fwd));
    dlg.appendChild(ctr);
    var skB = ctr.children[0], skF = ctr.children[2];
    skB.appendChild(el("span", "skip-n", String(C.prefOf(d, "back"))));
    skF.appendChild(el("span", "skip-n", String(C.prefOf(d, "fwd"))));
    var extra = el("div", "extra");
    var spd = el("select", "sel"); spd.id = "fp-spd";
    spd.setAttribute("aria-label", t("pl.speed"));
    C.SPEEDS.forEach(function (v) { var o = el("option", "", v + "×"); o.value = String(v); spd.appendChild(o); });
    spd.addEventListener("change", function () { H.setSpeed(+spd.value); });
    extra.appendChild(spd);
    var slp = el("select", "sel"); slp.id = "fp-sleep";
    slp.setAttribute("aria-label", t("pl.sleep"));
    [["", "☾ " + t("pl.sleepOff")], ["5", t("pl.sleepMin", { n: 5 })], ["15", t("pl.sleepMin", { n: 15 })], ["30", t("pl.sleepMin", { n: 30 })],
      ["45", t("pl.sleepMin", { n: 45 })], ["60", t("pl.sleepMin", { n: 60 })], ["end", t("pl.sleepEnd")]].forEach(function (o) {
      var op = el("option", "", o[1]); op.value = o[0]; slp.appendChild(op);
    });
    slp.addEventListener("change", function () { if (slp.value) H.setSleep(slp.value === "end" ? "end" : +slp.value); else H.cancelSleep(); });
    extra.appendChild(slp);
    extra.appendChild(button(t("ep.notes"), "icon-btn", function () { var c = H.getState().cur; if (c) notesDlg(c.id); }, UI.notes));
    extra.appendChild(button(t("pl.next"), "icon-btn", function () { H.next(); }, UI.next));
    extra.appendChild(button(t("pl.stop"), "icon-btn", function () { dlg.close(); H.stop(); }, UI.stop));
    dlg.appendChild(extra);
    var sl = el("div", "dim small center"); sl.id = "fp-sleep-left"; dlg.appendChild(sl);
    var chBox = el("div", "chapters"); chBox.id = "fp-ch"; dlg.appendChild(chBox);
    document.body.appendChild(dlg);
    dlg.showModal();
    paintFull(H.getState(), true);
  }
  function paintFull(st, first) {
    var dlg = $("pc-full");
    if (!dlg || !dlg.open) return;
    if (!st.cur) { dlg.close(); return; }
    var c = st.cur;
    var art = $("fp-art");
    if (first || art.getAttribute("data-src") !== c.img) {
      art.setAttribute("data-src", c.img || "");
      art.textContent = "";
      art.appendChild(img(c.img, "art xl"));
    }
    $("fp-title").textContent = c.title;
    $("fp-show").textContent = st.error ? t("pl.err") : c.show;
    var r = $("fp-seek");
    var dur = Math.round(st.dur || 0);
    if (!r._drag()) {
      r.max = String(dur || 0);
      r.value = String(Math.floor(st.pos));
      $("fp-pos").textContent = C.fmtTime(st.pos);
    }
    $("fp-left").textContent = dur ? "−" + C.fmtTime(Math.max(0, dur - st.pos)) : "";
    var p = $("fp-play");
    p.innerHTML = st.playing ? UI.pause : UI.play;
    p.setAttribute("aria-label", st.playing ? t("ep.pause") : t("ep.play"));
    var spd = $("fp-spd");
    var v = String(Math.round(st.rate * 100) / 100);
    if (spd.value !== v) {
      if (![].some.call(spd.options, function (o) { return o.value === v; })) { var o = el("option", "", v + "×"); o.value = v; spd.appendChild(o); }
      spd.value = v;
    }
    var slp = $("fp-sleep");
    var want = st.sleepEnd ? "end" : st.sleepUntil ? slp.value || "" : "";
    if (!st.sleepEnd && !st.sleepUntil && slp.value) slp.value = "";
    else if (want !== slp.value && st.sleepEnd) slp.value = "end";
    $("fp-sleep-left").textContent = st.sleepUntil ? t("pl.sleepLeft", { t: C.fmtTime((st.sleepUntil - now()) / 1000) }) : "";
  }

  // ---------- 10. Notes dialog (sanitized, sandboxed) ----------
  function palette() {
    var cs = getComputedStyle(document.documentElement);
    var g = function (v, d) { return cs.getPropertyValue(v).trim() || d; };
    return { bg: g("--panel-bg", "#1d1a13"), text: g("--text", "#f0ead9"), dim: g("--text-dim", "#a89f8a"), accent: g("--accent", "#d4af37"), border: g("--border", "#322d20") };
  }
  // Colours come from our own computed style; still, only colour
  // characters reach the iframe's CSS.
  function cssColor(s) { return /^[#\w\s(),.%-]{1,60}$/.test(s) ? s : "inherit"; }
  function notesDlg(id) {
    var x = epIndex[id], m = metaOf(id);
    if (!x || !m) return;
    var e = x.ep;
    var dlg = makeDialog("pc-notes", "notes-dlg");
    var head = el("div", "notes-head");
    head.appendChild(img(m.img, "art"));
    var ht = el("div", "");
    ht.appendChild(el("div", "dlg-title", e.title));
    ht.appendChild(el("div", "dim small", [m.show, fmtDate(e.pub), e.dur ? C.fmtTime(e.dur) : ""].filter(Boolean).join(" · ")));
    head.appendChild(ht);
    head.appendChild(button(t("pl.close"), "icon-btn", function () { dlg.close(); }, UI.x));
    dlg.appendChild(head);
    var acts = el("div", "row-btns");
    acts.appendChild(button(t("ep.play"), "txt-btn primary", function () { dlg.close(); playEp(id); }));
    acts.appendChild(button(t("ep.next"), "txt-btn", function () { queue(id, "next"); }));
    acts.appendChild(button(t("ep.more"), "icon-btn", function () { dlg.close(); epMenu(id); }, UI.more));
    dlg.appendChild(acts);
    var text = C.plain(e.notes || "");
    var stamps = C.noteStamps(text, e.dur);
    if (stamps.length) {
      var sb = el("div", "stamps");
      sb.appendChild(el("span", "dim small", t("notes.stamps")));
      stamps.slice(0, 60).forEach(function (s) {
        sb.appendChild(button(s.text, "chip", function () {
          var st = H.getState();
          if (st.cur && st.cur.id === id) { H.seekTo(s.at); H.resume(); }
          else H.play(m, s.at);
        }));
      });
      dlg.appendChild(sb);
    }
    if (!e.notes) dlg.appendChild(el("p", "dim", t("notes.none")));
    else dlg.appendChild(notesFrame(e));
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  // Wall 1: the Reader's sanitizer (allowlist). Wall 2: an iframe with
  // sandbox (no scripts, opaque origin) and a CSP. Feed text is never
  // put into this document.
  function notesFrame(e) {
    var san = window.orosFeedsSanitize;
    var html = "";
    if (typeof san === "function") {
      try { html = san(e.notes, { base: e.link || e.audio, images: true, t: t }).html || ""; } catch (err) { html = ""; }
    }
    if (!html) html = "<p>" + C.plain(e.notes).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }).replace(/\n/g, "<br>") + "</p>";
    var p = palette();
    var csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; form-action 'none'; frame-src 'none'; font-src 'none'; media-src 'none'";
    var css = "html{background:" + cssColor(p.bg) + ";color-scheme:" + (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark") + "}" +
      "body{margin:0;padding:4px 2px 24px;font:15px/1.6 'Nunito','Segoe UI',system-ui,sans-serif;color:" + cssColor(p.text) + ";overflow-wrap:anywhere}" +
      "a{color:" + cssColor(p.accent) + "}img{max-width:100%;height:auto;border-radius:6px}" +
      "blockquote{margin:1em 0;padding-left:12px;border-left:3px solid " + cssColor(p.accent) + "}" +
      "table{max-width:100%;display:block;overflow-x:auto}hr{border:0;border-top:1px solid " + cssColor(p.border) + "}";
    var doc = "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"" + csp + "\">" +
      "<meta name=\"referrer\" content=\"no-referrer\"><base target=\"_blank\">" +
      "<style>" + css + "</style></head><body dir=\"auto\">" + html + "</body></html>";
    var fr = el("iframe", "notes-frame");
    fr.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    fr.setAttribute("referrerpolicy", "no-referrer");
    fr.setAttribute("title", t("notes.title"));
    fr.srcdoc = doc;
    return fr;
  }

  // ---------- 11. Discover: search, add by address, OPML ----------
  var found = { q: "", list: [], busy: false, src: "" };
  function renderFind(main) {
    var mode = C.prefOf(D(), "search");
    var form = el("form", "find");
    var lab = el("label", "q-wrap");
    var ic = el("span", "q-ic"); ic.innerHTML = UI.search; lab.appendChild(ic);
    var q = el("input"); q.id = "q"; q.type = "search"; q.maxLength = 100; q.autocomplete = "off";
    q.placeholder = mode === "none" ? t("find.add") : t("find.ph") + " / " + t("find.add");
    q.setAttribute("aria-label", q.placeholder);
    q.value = found.q;
    lab.appendChild(q);
    form.appendChild(lab);
    var go = button(t("find.go"), "txt-btn primary");
    go.type = "submit";
    form.appendChild(go);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = q.value.trim();
      if (!v) return;
      if (/^(https?|feed|pcast|itpc):\/\//i.test(v) || /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) addByAddress(v);
      else search(v);
    });
    main.appendChild(form);
    var row = el("div", "row-btns");
    row.appendChild(button(t("find.opmlIn"), "txt-btn", importOpml));
    row.appendChild(button(t("find.opmlOut"), "txt-btn", exportOpml));
    main.appendChild(row);
    if (mode === "none") main.appendChild(el("p", "dim small", t("find.off")));
    if (!NET.relayAvailable()) main.appendChild(el("p", "dim small", t("s.noRelay")));
    if (found.busy) { main.appendChild(el("p", "dim", t("find.searching"))); return; }
    if (found.q && !found.list.length) { main.appendChild(el("p", "dim", t("find.none"))); return; }
    if (found.src) main.appendChild(el("p", "dim small", t("find.src", { s: found.src })));
    var ul = el("ul", "hits");
    found.list.forEach(function (h) { ul.appendChild(hitRow(h)); });
    main.appendChild(ul);
  }
  function hitRow(h) {
    var li = el("li", "hit");
    li.appendChild(img(h.img, "art"));
    var b = el("div", "ep-body");
    b.appendChild(el("div", "ep-title plain", h.title));
    var by = [h.by, h.genre, h.count ? t("show.n", { n: h.count }) : ""].filter(Boolean).join(" · ");
    if (by) b.appendChild(el("div", "ep-meta", by));
    li.appendChild(b);
    var subd = !!C.findShow(D(), h.id);
    var sb = button(subd ? t("find.subscribed") : t("find.subscribe"), "txt-btn" + (subd ? "" : " primary"), function () {
      if (C.findShow(D(), h.id)) { openShow(h.id); return; }
      subscribe(h, null);
    });
    li.appendChild(sb);
    return li;
  }
  function search(term) {
    var mode = C.prefOf(D(), "search");
    found = { q: term, list: [], busy: true, src: "" };
    if (mode === "none") { addByAddress(term); return; }
    renderAll();
    var cc = LANG === "el" ? "gr" : "";
    var jobs = [], names = [];
    if (mode === "both" || mode === "apple") { names.push("Apple Podcasts"); jobs.push(NET.fetchOne(C.appleSearchUrl(term, cc)).then(function (r) { return C.parseAppleResults(JSON.parse(r.text)); }).catch(function () { return []; })); }
    if (mode === "both" || mode === "fyyd") { names.push("fyyd"); jobs.push(NET.fetchOne(C.fyydSearchUrl(term)).then(function (r) { return C.parseFyydResults(JSON.parse(r.text)); }).catch(function () { return []; })); }
    Promise.all(jobs).then(function (lists) {
      if (found.q !== term) return;
      found = { q: term, list: C.mergeResults(lists).slice(0, 50), busy: false, src: names.join(", ") };
      if (prefs.tab === "find") renderAll();
    });
  }
  // A feed, a web page (discovery) or an Apple Podcasts link.
  function addByAddress(v) {
    var url = C.safeUrl(/^[a-z]+:\/\//i.test(v) ? v.replace(/^(feed|pcast|itpc):\/\//i, "https://") : "https://" + v);
    if (!url) { showToast(t("toast.badUrl")); return; }
    var aid = C.appleId(url);
    var p = aid ? NET.fetchOne(C.appleLookupUrl(aid)).then(function (r) {
      var list = C.parseAppleResults(JSON.parse(r.text));
      if (!list.length) throw { code: "nofeed" };
      return list[0].url;
    }) : Promise.resolve(url);
    found.busy = true; renderAll();
    p.then(function (u) {
      if (C.findShow(D(), C.showId(u))) { found.busy = false; openShow(C.showId(u)); return null; }
      return NET.fetchOne(u).then(function (r) {
        var parsed = parseText(r.text, r.finalUrl || u);
        if (parsed) return finishAdd(u, parsed);
        // Not a feed: look for feeds in the page.
        var cands = [];
        try { cands = (FC.discover(r.text, r.finalUrl || u) || []).concat(FC.platformFeeds ? FC.platformFeeds(u) || [] : []); } catch (e) {}
        cands = cands.map(function (c) { return typeof c === "string" ? { url: c, title: c } : c; }).filter(function (c) { return c && C.safeUrl(c.url); });
        if (!cands.length) throw { code: "nofeed" };
        if (cands.length === 1) return addFeedUrl(cands[0].url);
        found.busy = false; renderAll();
        chooseFeed(cands);
        return null;
      });
    }).catch(function (e) {
      found.busy = false; renderAll();
      var c = e && e.code;
      showToast(c === "nofeed" || c === "gone" ? t("toast.noFeed") : c === "norelay" ? t("toast.needRelay") : c === "offline" ? t("toast.offline") :
        c === "notpod" ? t("toast.notPodcast") : t("toast.err", { c: c || "?" }));
    });
  }
  function addFeedUrl(u) {
    return NET.fetchOne(u).then(function (r) {
      var parsed = parseText(r.text, r.finalUrl || u);
      if (!parsed) throw { code: "nofeed" };
      return finishAdd(u, parsed);
    });
  }
  function finishAdd(u, parsed) {
    found.busy = false;
    if (!parsed.eps.length) throw { code: "notpod" };
    var sh = parsed.show;
    subscribe({ url: u, title: sh.title || u, by: sh.by, img: sh.img }, parsed);
    var sid = C.showId(u);
    afterFeed(sid, feeds[sid]);
    openShow(sid);
    return null;
  }
  function chooseFeed(cands) {
    var dlg = makeDialog("pc-choose", "menu-dlg");
    dlg.appendChild(el("div", "dlg-title", t("find.choose")));
    var col = el("div", "menu-col");
    cands.slice(0, 12).forEach(function (c) {
      col.appendChild(button(c.title || c.url, "", function () {
        dlg.close();
        addFeedUrl(c.url).catch(function (e) { showToast(e && e.code === "notpod" ? t("toast.notPodcast") : t("toast.noFeed")); });
      }));
    });
    col.appendChild(button(t("set.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(col);
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
  }
  function localPickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      if (accept) inp.accept = accept;
      inp.style.display = "none";
      inp.addEventListener("change", function () { var f = inp.files && inp.files[0] ? inp.files[0] : null; inp.remove(); resolve(f); });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function importOpml() {
    var dlg = dialogHost(), acc = ".opml,.xml,text/xml,text/x-opml,application/xml";
    Promise.resolve(dlg && typeof dlg.openFile === "function" ? dlg.openFile(acc) : localPickFile(acc)).then(function (file) {
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) { showToast(t("toast.big")); return; }
      file.text().then(function (txt) {
        var list = [];
        try { list = FC.parseOpml(txt) || []; } catch (e) { list = []; }
        var outlines = (list.feeds || list).filter(function (f) { return f && C.safeUrl(f.url || f.xmlUrl); });
        var n = 0;
        outlines.forEach(function (f) {
          var u = C.safeUrl(f.url || f.xmlUrl);
          if (C.findShow(D(), C.showId(u)) || D().shows.length >= C.LIM.shows) return;
          if (mutate(function (d, nn) { return C.subscribe(d, { url: u, title: C.clean(f.title || f.text || u, 200) }, nn); })) n++;
        });
        showToast(n ? t("toast.opmlIn", { n: n }) : t("toast.opmlNone"));
        renderAll();
        if (n) refresh(false);
      });
    });
  }
  function exportOpml() {
    var shows = D().shows;
    var text = "";
    try { text = FC.buildOpml(shows.map(function (s) { return { url: s.url, title: s.title, site: "" }; }), []); } catch (e) { text = ""; }
    if (!text) return;
    var name = "oros-podcasts-" + new Date().toISOString().slice(0, 10) + ".opml";
    var done = function () { showToast(t("toast.opmlOut", { n: shows.length })); };
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({ text: text, filename: name, mime: "text/x-opml",
        types: [{ description: "OPML", accept: { "text/x-opml": [".opml"] } }] }).then(function (r) { if (r && r.ok) done(); });
      return;
    }
    var url = URL.createObjectURL(new Blob([text], { type: "text/x-opml" })), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    done();
  }

  // ---------- 12. Settings ----------
  function settingsDlg() {
    var d = D();
    var dlg = makeDialog("pc-set", "form-dlg");
    dlg.appendChild(el("div", "dlg-title", t("s.title")));
    var form = el("div", "form");
    var spd = select(t("set.speed"), C.SPEEDS.map(function (v) { return [v, v + "×"]; }), C.prefOf(d, "spd"));
    var secs = [5, 10, 15, 20, 30, 45, 60, 90, 120];
    var back = select(t("s.back"), secs.map(function (v) { return [v, t("set.sec", { n: v })]; }), C.prefOf(d, "back"));
    var fwd = select(t("s.fwd"), secs.map(function (v) { return [v, t("set.sec", { n: v })]; }), C.prefOf(d, "fwd"));
    var srch = select(t("s.search"), ["both", "apple", "fyyd", "none"].map(function (v) { return [v, t("s.search." + v)]; }), C.prefOf(d, "search"));
    [spd, back, fwd, srch].forEach(function (x) { form.appendChild(x.wrap); });
    form.appendChild(el("p", "dim small", t("s.searchNote")));
    var chk = function (label, val) {
      var w = el("label", "check");
      var c = el("input"); c.type = "checkbox"; c.checked = !!val;
      w.appendChild(c); w.appendChild(el("span", "", label));
      form.appendChild(w);
      return c;
    };
    var an = chk(t("s.autoNext"), C.prefOf(d, "autoNext"));
    var dp = chk(t("s.delPlayed"), C.prefOf(d, "delPlayed"));
    form.appendChild(el("p", "dim small", NET.relayAvailable() ? t("s.relay") : t("s.noRelay")));
    dlg.appendChild(form);
    var row = el("div", "dlg-btns");
    row.appendChild(button(t("set.cancel"), "txt-btn", function () { dlg.close(); }));
    row.appendChild(button(t("set.save"), "txt-btn primary", function () {
      var vals = { spd: +spd.sel.value, back: +back.sel.value, fwd: +fwd.sel.value, search: srch.sel.value, autoNext: an.checked ? 1 : 0, delPlayed: dp.checked ? 1 : 0 };
      mutate(function (dd, n) { Object.keys(vals).forEach(function (k) { dd = C.setPref(dd, k, vals[k], n); }); return dd; });
      dlg.close();
      sweepPlayed();
      renderAll();
    }));
    dlg.appendChild(row);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- 13. Toasts, dialogs, keyboard ----------
  function makeDialog(id, cls) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "pc-dlg" + (cls ? " " + cls : "");
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () { parkToast(); setTimeout(function () { dlg.remove(); }, 0); });
    return dlg;
  }
  function confirmDlg(text, okLabel, fn) {
    var dlg = makeDialog("pc-confirm", "menu-dlg");
    dlg.appendChild(el("p", "confirm-text", text));
    var row = el("div", "dlg-btns");
    row.appendChild(button(t("set.cancel"), "txt-btn", function () { dlg.close(); }));
    row.appendChild(button(okLabel, "txt-btn danger", function () { dlg.close(); fn(); }));
    dlg.appendChild(row);
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" && n.transient({ ns: "podcasts", title: String(text) })) return;
    } catch (e) {}
    localToast(text);
  }
  var toastTimer = null;
  function localToast(text) {
    var box = $("toast");
    if (!box) return;
    var d = document.querySelector("dialog[open]");
    if (d && box.parentNode !== d) d.appendChild(box);
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 4000);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // Space play/pause, ←/→ skip, [ ] speed, N next (not while typing)
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || !H) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (tag === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
      var st = H.getState();
      if (!st.cur) return;
      if (e.key === " ") { e.preventDefault(); H.toggle(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); H.back(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); H.fwd(); }
      else if (e.key === "[" || e.key === "]") {
        var i = C.SPEEDS.indexOf(Math.round(st.rate * 100) / 100);
        if (i < 0) i = C.SPEEDS.indexOf(1);
        i = Math.max(0, Math.min(C.SPEEDS.length - 1, i + (e.key === "]" ? 1 : -1)));
        H.setSpeed(C.SPEEDS[i]);
      } else if (e.key === "n" || e.key === "N") { if (!e.repeat) H.next(); }
    });
  }

  // ---------- 14. Palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim", "--accent", "--accent-hover", "--accent-soft",
    "--panel-bg", "--border", "--shadow", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }

  // ---------- 15. Wiring & boot ----------
  function applyI18n() {
    document.title = t("app") + " · orOS";
    document.documentElement.lang = LANG;
    $("app-name").textContent = t("app");
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    var ib = function (id, icon, label) { var b = $(id); b.innerHTML = icon; b.setAttribute("aria-label", label); b.title = label; };
    ib("refresh-btn", UI.refresh, t("btn.refresh"));
    ib("add-btn", UI.plus, t("btn.add"));
    ib("more-btn", UI.gear, t("s.title"));
    ib("pl-back", UI.back, t("pl.back", { n: 15 }));
    ib("pl-fwd", UI.fwd, t("pl.fwd", { n: 30 }));
    $("pl-open").setAttribute("aria-label", t("pl.open"));
  }
  function wire() {
    [].forEach.call(document.querySelectorAll("#tabs [data-tab]"), function (b) {
      b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
    });
    $("refresh-btn").addEventListener("click", function () { refresh(true); });
    $("add-btn").addEventListener("click", function () { setTab("find"); var q = $("q"); if (q) q.focus(); });
    $("more-btn").addEventListener("click", settingsDlg);
    $("pl-play").addEventListener("click", function () { H.toggle(); });
    $("pl-back").addEventListener("click", function () { H.back(); });
    $("pl-fwd").addEventListener("click", function () { H.fwd(); });
    $("pl-open").addEventListener("click", fullPlayer);
    wireKeyboard();
  }
  var paintTimer = null;
  function onHost(ev, arg) {
    if (ev === "time") {
      // Cheap: the player bar, the full player and the playing row.
      if (paintTimer) return;
      paintTimer = setTimeout(function () {
        paintTimer = null;
        paintPlayer();
        var c = H.getState().cur;
        if (c) paintEp(c.id);
      }, 250);
      return;
    }
    if (ev === "ended" && arg && C.prefOf(D(), "delPlayed") && files[arg.id]) deleteFile(arg.id);
    if (ev === "data" || ev === "load" || ev === "stop" || ev === "ended") { renderKeepScroll(); return; }
    paintPlayer();
    var c2 = H.getState().cur;
    if (c2) paintEp(c2.id);
  }
  function renderKeepScroll() {
    var m = $("main"), y = m.scrollTop;
    if (document.querySelector("dialog[open]:not(#pc-full)")) { paintTabs(); paintPlayer(); return; }
    renderAll();
    m.scrollTop = y;
  }
  // Shell bridge: "add this feed" from another app (Reader, Bookmarks).
  window.__orosPodcastsAdd = function (url) {
    if (typeof url !== "string" || !C.safeUrl(url)) return;
    prefs.tab = "find"; view.show = "";
    found = { q: url, list: [], busy: false, src: "" };
    renderAll();
    addByAddress(url);
  };
  function takePending() {
    try {
      var p = window.parent && window.parent.__orosPodcastsTakePending;
      var u = typeof p === "function" ? p() : null;
      if (u) window.__orosPodcastsAdd(u);
    } catch (e) {}
  }

  function boot() {
    inheritPalette();
    watchPalette();
    applyI18n();
    wire();
    if (!C || !FC || !NET || !ST) { $("main").appendChild(el("div", "empty", t("toast.err", { c: "load" }))); return; }
    attach().then(function (api) {
      if (!api) { $("main").appendChild(el("div", "empty", t("toast.err", { c: "host" }))); return; }
      H = api;
      unsub = H.subscribe(onHost);
      window.addEventListener("pagehide", function () { if (unsub) unsub(); });
      return Promise.all([loadFeeds(), loadFiles()]).then(function () {
        renderAll();
        rememberQueue();
        sweepPlayed();
        takePending();
        refresh(false);
        // While open: refresh every hour (never offline or hidden).
        setInterval(function () {
          if (document.visibilityState === "visible" && now() - lastRefresh > REFRESH_MIN * 60000) refresh(false);
        }, 60000);
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
