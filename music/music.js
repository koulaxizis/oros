// ============================================================
// orOS Music — App logic (v1.0.0)
// A music player for the songs on this device, in the shape people
// know from the big streaming apps: Home, Search, Your library,
// albums, artists, playlists, liked songs, a queue with shuffle and
// repeat, and a player that keeps playing when this window closes.
//   - the player and the synced data (likes + playlists) live in the
//     SHELL (music/host.js, window.parent.__orosMusicHost); this
//     window is only the screen over it
//   - the music files are on the orOS disk, /internal/Music
//     (library.js scans them; store.js keeps the device index)
//   - device-local: prefs "oros-music-prefs" (tab, library view,
//     sort, old-tag encoding)
// Sections:
//   1. Constants, i18n, helpers
//   2. Host (attach / inject into the shell)
//   3. Library index + covers
//   4. Actions (play, like, playlists, add, delete)
//   5. Views: home, search, library, pages
//   6. Rows, cards, menus
//   7. Player bar + full player + queue
//   8. Dialogs, toasts, keyboard (Contract Β)
//   9. Palette
//  10. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.OrosMusicCore, ST = window.OrosMusicStore, LIB = window.OrosMusicLibrary;
  var PREFS_KEY = "oros-music-prefs";

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
      "app": "Music",
      "tab.home": "Home", "tab.search": "Search", "tab.lib": "Your library",
      "btn.add": "Add music", "btn.more": "Settings", "btn.back": "Back",
      "drop": "Drop music files to add them",
      "hello.m": "Good morning", "hello.a": "Good afternoon", "hello.e": "Good evening",
      "home.recent": "Jump back in", "home.pls": "Your playlists", "home.added": "Recently added", "home.top": "Your most played",
      "home.albums": "Albums", "home.shuffleAll": "Shuffle all songs",
      "empty.title": "Your music, on your device",
      "empty.body": "Add songs or a whole folder. They are kept in Files › Music, play without a connection and, with Vault Drive on, reach your other devices too.",
      "empty.files": "Add songs", "empty.folder": "Add a folder",
      "empty.soon": "Free music from open catalogues comes next.",
      "search.ph": "What do you want to listen to?", "search.none": "Nothing found for “{q}”.",
      "search.hint": "Search your songs, albums, artists and playlists.",
      "search.genres": "Browse by genre",
      "sec.songs": "Songs", "sec.albums": "Albums", "sec.artists": "Artists", "sec.pls": "Playlists", "sec.genres": "Genres",
      "lib.pl": "Playlists", "lib.songs": "Songs", "lib.albums": "Albums", "lib.artists": "Artists", "lib.genres": "Genres", "lib.folders": "Folders",
      "lib.newPl": "New playlist", "lib.liked": "Liked songs", "lib.empty": "Nothing here yet.",
      "sort.title": "Title", "sort.artist": "Artist", "sort.album": "Album", "sort.added": "Recently added", "sort.by": "Sort",
      "n.songs": "{n} songs", "n.song": "1 song", "n.albums": "{n} albums", "n.album": "1 album",
      "kind.album": "Album", "kind.artist": "Artist", "kind.pl": "Playlist", "kind.genre": "Genre", "kind.folder": "Folder", "kind.single": "Song",
      "unknown.artist": "Unknown artist", "unknown.album": "Unknown album",
      "play": "Play", "pause": "Pause", "shuffle": "Shuffle", "shuffleOn": "Shuffle on", "shuffleOff": "Shuffle off",
      "repeat.off": "Repeat off", "repeat.all": "Repeat all", "repeat.one": "Repeat one",
      "next": "Next", "prev": "Previous", "like": "Save to Liked songs", "unlike": "Remove from Liked songs",
      "more": "More", "queue": "Queue", "close": "Close", "volume": "Volume", "seek": "Position",
      "m.playNext": "Play next", "m.addQueue": "Add to queue", "m.addPl": "Add to playlist", "m.album": "Go to album", "m.artist": "Go to artist",
      "m.removePl": "Remove from this playlist", "m.up": "Move up", "m.down": "Move down", "m.delete": "Delete from this device",
      "m.rename": "Rename", "m.deletePl": "Delete playlist", "m.info": "Details",
      "pl.name": "Playlist name", "pl.my": "My playlist #{n}", "pl.create": "Create", "pl.save": "Save", "cancel": "Cancel",
      "pl.pick": "Add to playlist", "pl.deleteQ": "Delete the playlist “{n}”? The songs stay in your library.",
      "pl.emptyRows": "This playlist is empty. Use “Add to playlist” on any song.",
      "del.q": "Delete “{t}” from this device? The file goes from Files › Music (and from your other devices with Vault Drive).",
      "del.many": "Delete these {n} songs from this device?",
      "missing": "Not on this device", "missing.toast": "This song is not on this device. Add its file to Files › Music.",
      "now.from": "Playing from", "now.lib": "Your library", "q.now": "Now playing", "q.up": "Next up", "q.next": "Next from: {n}",
      "q.clear": "Clear", "q.empty": "Nothing else in the queue.", "q.remove": "Remove from queue",
      "toast.added": "Added to “{n}”.", "toast.queued": "Added to the queue.", "toast.next": "Plays next.",
      "toast.liked": "Saved to Liked songs.", "toast.unliked": "Removed from Liked songs.",
      "toast.saved": "{n} songs added.", "toast.saved1": "1 song added.", "toast.skip": "{n} files were not music and were left out.",
      "toast.deleted": "Deleted.", "toast.err": "Something went wrong ({c}).", "toast.noFs": "The orOS disk is not available here.",
      "toast.cant": "This song cannot play here.",
      "scan.busy": "Reading your music… {d} of {n}", "scan.done": "Library up to date.",
      "s.title": "Music settings", "s.rescan": "Read the music folder again", "s.rescanHint": "Use it after you add or change files in Files › Music.",
      "s.legacy": "Old tags (ID3v1, Latin-1)", "s.legacyAuto": "Recognise Greek automatically", "s.legacyEl": "Always Greek (Windows-1253)",
      "s.legacyLatin": "Always Western (Latin-1)", "s.folder": "Open the music folder in Files", "s.stats": "{n} songs · {a} albums · {r} artists",
      "s.keys": "Keys: Space play/pause · ← → seek 10 s · Shift+← → previous/next · S shuffle · R repeat · L like",
      "info.file": "File", "info.format": "Format", "info.size": "Size", "info.genre": "Genre", "info.year": "Year", "info.track": "Track",
      "info.length": "Length",
      "liked.empty": "Songs you like appear here. Tap the heart on any song."
    },
    el: {
      "app": "Μουσική",
      "tab.home": "Αρχική", "tab.search": "Αναζήτηση", "tab.lib": "Η βιβλιοθήκη σου",
      "btn.add": "Προσθήκη μουσικής", "btn.more": "Ρυθμίσεις", "btn.back": "Πίσω",
      "drop": "Άφησε εδώ αρχεία μουσικής για να προστεθούν",
      "hello.m": "Καλημέρα", "hello.a": "Καλό απόγευμα", "hello.e": "Καλησπέρα",
      "home.recent": "Συνέχισε από εκεί που έμεινες", "home.pls": "Οι λίστες σου", "home.added": "Πρόσφατες προσθήκες", "home.top": "Αυτά που ακούς πιο συχνά",
      "home.albums": "Άλμπουμ", "home.shuffleAll": "Τυχαία όλα τα τραγούδια",
      "empty.title": "Η μουσική σου, στη συσκευή σου",
      "empty.body": "Πρόσθεσε τραγούδια ή έναν ολόκληρο φάκελο. Μένουν στα Αρχεία › Music, παίζουν χωρίς σύνδεση και, με το Vault Drive ανοιχτό, φτάνουν και στις άλλες συσκευές σου.",
      "empty.files": "Πρόσθεσε τραγούδια", "empty.folder": "Πρόσθεσε φάκελο",
      "empty.soon": "Δωρεάν μουσική από ανοιχτούς καταλόγους έρχεται σύντομα.",
      "search.ph": "Τι θέλεις να ακούσεις;", "search.none": "Δεν βρέθηκε τίποτα για «{q}».",
      "search.hint": "Ψάξε στα τραγούδια, τα άλμπουμ, τους καλλιτέχνες και τις λίστες σου.",
      "search.genres": "Περιήγηση ανά είδος",
      "sec.songs": "Τραγούδια", "sec.albums": "Άλμπουμ", "sec.artists": "Καλλιτέχνες", "sec.pls": "Λίστες", "sec.genres": "Είδη",
      "lib.pl": "Λίστες", "lib.songs": "Τραγούδια", "lib.albums": "Άλμπουμ", "lib.artists": "Καλλιτέχνες", "lib.genres": "Είδη", "lib.folders": "Φάκελοι",
      "lib.newPl": "Νέα λίστα", "lib.liked": "Αγαπημένα τραγούδια", "lib.empty": "Δεν υπάρχει τίποτα εδώ ακόμα.",
      "sort.title": "Τίτλος", "sort.artist": "Καλλιτέχνης", "sort.album": "Άλμπουμ", "sort.added": "Πρόσφατες προσθήκες", "sort.by": "Ταξινόμηση",
      "n.songs": "{n} τραγούδια", "n.song": "1 τραγούδι", "n.albums": "{n} άλμπουμ", "n.album": "1 άλμπουμ",
      "kind.album": "Άλμπουμ", "kind.artist": "Καλλιτέχνης", "kind.pl": "Λίστα", "kind.genre": "Είδος", "kind.folder": "Φάκελος", "kind.single": "Τραγούδι",
      "unknown.artist": "Άγνωστος καλλιτέχνης", "unknown.album": "Άγνωστο άλμπουμ",
      "play": "Αναπαραγωγή", "pause": "Παύση", "shuffle": "Τυχαία σειρά", "shuffleOn": "Τυχαία σειρά: ναι", "shuffleOff": "Τυχαία σειρά: όχι",
      "repeat.off": "Επανάληψη: όχι", "repeat.all": "Επανάληψη όλων", "repeat.one": "Επανάληψη ενός",
      "next": "Επόμενο", "prev": "Προηγούμενο", "like": "Αποθήκευση στα αγαπημένα", "unlike": "Αφαίρεση από τα αγαπημένα",
      "more": "Περισσότερα", "queue": "Ουρά", "close": "Κλείσιμο", "volume": "Ένταση", "seek": "Θέση",
      "m.playNext": "Παίξε το επόμενο", "m.addQueue": "Πρόσθεσε στην ουρά", "m.addPl": "Πρόσθεσε σε λίστα", "m.album": "Πήγαινε στο άλμπουμ", "m.artist": "Πήγαινε στον καλλιτέχνη",
      "m.removePl": "Αφαίρεση από αυτή τη λίστα", "m.up": "Μετακίνηση πάνω", "m.down": "Μετακίνηση κάτω", "m.delete": "Διαγραφή από αυτή τη συσκευή",
      "m.rename": "Μετονομασία", "m.deletePl": "Διαγραφή λίστας", "m.info": "Λεπτομέρειες",
      "pl.name": "Όνομα λίστας", "pl.my": "Η λίστα μου #{n}", "pl.create": "Δημιουργία", "pl.save": "Αποθήκευση", "cancel": "Ακύρωση",
      "pl.pick": "Πρόσθεσε σε λίστα", "pl.deleteQ": "Να διαγραφεί η λίστα «{n}»; Τα τραγούδια μένουν στη βιβλιοθήκη σου.",
      "pl.emptyRows": "Η λίστα είναι άδεια. Χρησιμοποίησε το «Πρόσθεσε σε λίστα» σε οποιοδήποτε τραγούδι.",
      "del.q": "Να διαγραφεί το «{t}» από αυτή τη συσκευή; Το αρχείο φεύγει από τα Αρχεία › Music (και από τις άλλες συσκευές σου με το Vault Drive).",
      "del.many": "Να διαγραφούν αυτά τα {n} τραγούδια από αυτή τη συσκευή;",
      "missing": "Δεν υπάρχει σε αυτή τη συσκευή", "missing.toast": "Αυτό το τραγούδι δεν υπάρχει σε αυτή τη συσκευή. Πρόσθεσε το αρχείο του στα Αρχεία › Music.",
      "now.from": "Παίζει από", "now.lib": "Η βιβλιοθήκη σου", "q.now": "Παίζει τώρα", "q.up": "Στη σειρά", "q.next": "Επόμενα από: {n}",
      "q.clear": "Καθαρισμός", "q.empty": "Δεν υπάρχει τίποτα άλλο στην ουρά.", "q.remove": "Αφαίρεση από την ουρά",
      "toast.added": "Προστέθηκε στη λίστα «{n}».", "toast.queued": "Προστέθηκε στην ουρά.", "toast.next": "Παίζει αμέσως μετά.",
      "toast.liked": "Αποθηκεύτηκε στα αγαπημένα.", "toast.unliked": "Αφαιρέθηκε από τα αγαπημένα.",
      "toast.saved": "Προστέθηκαν {n} τραγούδια.", "toast.saved1": "Προστέθηκε 1 τραγούδι.", "toast.skip": "{n} αρχεία δεν ήταν μουσική και αφέθηκαν έξω.",
      "toast.deleted": "Διαγράφηκε.", "toast.err": "Κάτι πήγε στραβά ({c}).", "toast.noFs": "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ.",
      "toast.cant": "Αυτό το τραγούδι δεν παίζει εδώ.",
      "scan.busy": "Διαβάζω τη μουσική σου… {d} από {n}", "scan.done": "Η βιβλιοθήκη είναι ενημερωμένη.",
      "s.title": "Ρυθμίσεις Μουσικής", "s.rescan": "Ξαναδιάβασε τον φάκελο μουσικής", "s.rescanHint": "Χρησιμοποίησέ το αφού προσθέσεις ή αλλάξεις αρχεία στα Αρχεία › Music.",
      "s.legacy": "Παλιές ετικέτες (ID3v1, Latin-1)", "s.legacyAuto": "Αυτόματη αναγνώριση ελληνικών", "s.legacyEl": "Πάντα ελληνικά (Windows-1253)",
      "s.legacyLatin": "Πάντα δυτικά (Latin-1)", "s.folder": "Άνοιγμα του φακέλου μουσικής στα Αρχεία", "s.stats": "{n} τραγούδια · {a} άλμπουμ · {r} καλλιτέχνες",
      "s.keys": "Πλήκτρα: Space αναπαραγωγή/παύση · ← → 10 δ. πίσω/μπρος · Shift+← → προηγούμενο/επόμενο · S τυχαία · R επανάληψη · L αγαπημένο",
      "info.file": "Αρχείο", "info.format": "Μορφή", "info.size": "Μέγεθος", "info.genre": "Είδος", "info.year": "Έτος", "info.track": "Κομμάτι",
      "info.length": "Διάρκεια",
      "liked.empty": "Τα τραγούδια που σου αρέσουν εμφανίζονται εδώ. Πάτησε την καρδιά σε οποιοδήποτε τραγούδι."
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
  function nSongs(n) { return n === 1 ? t("n.song") : t("n.songs", { n: n }); }
  function nAlbums(n) { return n === 1 ? t("n.album") : t("n.albums", { n: n }); }
  function fmtSize(b) {
    if (!b) return "0 MB";
    if (b < 1e6) return Math.max(1, Math.round(b / 1e3)) + " KB";
    if (b < 1e9) return (b / 1e6).toFixed(1) + " MB";
    return (b / 1e9).toFixed(1) + " GB";
  }
  function totalTime(list) {
    var s = 0;
    list.forEach(function (r) { s += r.d || 0; });
    if (!s) return "";
    var m = Math.max(1, Math.round(s / 60));
    return m < 60 ? m + (LANG === "el" ? " λεπ." : " min") : Math.floor(m / 60) + (LANG === "el" ? " ώρ. " : " h ") + (m % 60) + (LANG === "el" ? " λεπ." : " min");
  }
  var I = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    lib: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16M9 4v16M14 4l6 16"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5.5v13a1 1 0 0 0 1.6.8l8.4-6.5a1 1 0 0 0 0-1.6L6.6 4.7A1 1 0 0 0 5 5.5z"/><rect x="16" y="5" width="3" height="14" rx="1"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 5.5v13a1 1 0 0 1-1.6.8L9 12.8a1 1 0 0 1 0-1.6l8.4-6.5A1 1 0 0 1 19 5.5z"/><rect x="5" y="5" width="3" height="14" rx="1"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    repeat1: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M11 10h1v5"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    heartOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h13M3 12h13M3 18h8"/><path d="M17 15v6l4-3z"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>'
  };

  // Device-local view prefs (R10): never synced.
  var prefs = (function () {
    var p = { tab: "home", lib: "pl", sort: "title", legacy: "auto" };
    try {
      var o = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (o && typeof o === "object") {
        if (["home", "search", "lib"].indexOf(o.tab) >= 0) p.tab = o.tab;
        if (["pl", "songs", "albums", "artists", "genres", "folders"].indexOf(o.lib) >= 0) p.lib = o.lib;
        if (["title", "artist", "album", "added"].indexOf(o.sort) >= 0) p.sort = o.sort;
        if (["auto", "el", "latin"].indexOf(o.legacy) >= 0) p.legacy = o.legacy;
      }
    } catch (e) {}
    return p;
  })();
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }

  // ---------- 2. Host ----------
  var H = null, unsub = null;
  function shellWin() { try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; } }
  function attach() {
    var w = shellWin() || window;
    var h = null;
    try { h = w.__orosMusicHost; } catch (e) { h = null; }
    if (h && h.api) return Promise.resolve(h.api);
    // Not loaded by the shell (older shell or standalone): load the
    // three files into the shell window, in order.
    var base = w === window ? "" : "music/";
    var ver = (document.querySelector('script[src*="music.js"]') || {}).src || "";
    var q = (ver.match(/\?v=[^"&]+/) || [""])[0];
    return [["core.js", "OrosMusicCore"], ["store.js", "OrosMusicStore"], ["host.js", "__orosMusicHost"]].reduce(function (p, f) {
      return p.then(function () {
        if (w[f[1]]) return null;
        return new Promise(function (resolve) {
          var s = w.document.createElement("script");
          s.src = base + f[0] + q;
          s.onload = s.onerror = function () { resolve(); };
          w.document.head.appendChild(s);
        });
      });
    }, Promise.resolve()).then(function () { var hh = w.__orosMusicHost; return hh && hh.api ? hh.api : null; });
  }
  function D() { return H ? H.data() : C.emptyData(); }
  function mutate(fn) { return H ? H.mutate(fn) : false; }

  // ---------- 3. Library index + covers ----------
  var tracks = [], byPath = {}, resolve = function () { return null; };
  var cache = { albums: null, artists: null, genres: null };
  var scanState = { busy: false, d: 0, n: 0 };
  function setTracks(list) {
    // A song with no picture of its own shows its album's cover.
    var albumArt = {};
    list.forEach(function (r) { var ak = C.albumKey(r); if (ak && r.art && !albumArt[ak]) albumArt[ak] = r.art; });
    tracks = list.map(function (r) {
      var ak = !r.art && C.albumKey(r);
      return ak && albumArt[ak] ? Object.assign({}, r, { art: albumArt[ak] }) : r;
    });
    byPath = {};
    tracks.forEach(function (r) { byPath[r.p] = r; });
    resolve = C.resolver(tracks);
    cache = { albums: null, artists: null, genres: null };
  }
  function albumsAll() { return cache.albums || (cache.albums = C.albums(tracks, LANG)); }
  function artistsAll() { return cache.artists || (cache.artists = C.artists(tracks, LANG)); }
  function genresAll() { return cache.genres || (cache.genres = C.genres(tracks, LANG)); }
  function loadIndex() { return ST.all().then(setTracks, function () { setTracks([]); }); }
  function rescan(force) {
    if (!LIB.fs()) { showToast(t("toast.noFs")); return Promise.resolve(); }
    scanState = { busy: true, d: 0, n: 0 };
    paintScan();
    return LIB.scan({ legacy: prefs.legacy, force: !!force, onProgress: function (d, n) { scanState.d = d; scanState.n = n; paintScan(); } })
      .then(function (r) {
        setTracks(r.tracks);
        relinkQueue();
        scanState.busy = false;
        renderKeepScroll();
        if (force) showToast(t("scan.done"));
      }, function (e) { scanState.busy = false; paintScan(); showToast(t("toast.err", { c: (e && e.message) || "scan" })); });
  }
  // Paths in the queue follow renamed/moved files (same song key).
  function relinkQueue() {
    if (!H || typeof H.relink !== "function") return;
    H.relink(function (it) {
      if (!it || !it.p) return it;
      if (byPath[it.p]) return it;
      var r = resolve(it);
      return r ? C.itemOf(r) : null;
    });
  }
  function paintScan() {
    var box = $("scan-line");
    if (!box) return;
    box.hidden = !scanState.busy || !scanState.n;
    box.textContent = t("scan.busy", { d: scanState.d, n: scanState.n });
  }
  // Covers: object URLs per art id, made once.
  var artUrls = {}, artWait = {};
  function artUrl(id) {
    if (!id) return Promise.resolve("");
    if (artUrls[id]) return Promise.resolve(artUrls[id]);
    if (artWait[id]) return artWait[id];
    artWait[id] = ST.getArt(id).then(function (b) { var u = b ? URL.createObjectURL(b) : ""; artUrls[id] = u; delete artWait[id]; return u; },
      function () { delete artWait[id]; return ""; });
    return artWait[id];
  }
  window.addEventListener("pagehide", function () { Object.keys(artUrls).forEach(function (k) { try { URL.revokeObjectURL(artUrls[k]); } catch (e) {} }); });
  // A square cover: the picture, else a colour from the name + a note.
  function cover(artId, seed, cls, icon) {
    var box = el("span", "cover " + (cls || ""));
    var hue = parseInt(C.hash(C.fold(seed || "")).slice(0, 4), 36) % 360;
    box.style.setProperty("--hue", hue);
    box.innerHTML = icon || I.note;           // constant markup
    if (artId) artUrl(artId).then(function (u) {
      if (!u) return;
      var img = el("img");
      img.alt = ""; img.decoding = "async"; img.src = u;
      box.textContent = "";
      box.appendChild(img);
      box.classList.add("has-img");
    });
    return box;
  }
  function collage(list, cls) {
    var arts = [];
    list.forEach(function (r) { if (r && r.art && arts.indexOf(r.art) < 0) arts.push(r.art); });
    if (arts.length < 4) return cover(arts[0] || "", list.length ? list[0].al || list[0].t : "pl", cls);
    var box = el("span", "cover collage " + (cls || ""));
    arts.slice(0, 4).forEach(function (a) { box.appendChild(cover(a, a, "")); });
    return box;
  }

  // ---------- 4. Actions ----------
  // Rows of a list as playable items (refs without a file stay out).
  function itemsOf(list) {
    return list.map(function (x) { var r = x && x.p ? x : resolve(x); return r ? C.itemOf(r) : null; }).filter(Boolean);
  }
  function playRows(rows, idx, src, shuffle) {
    if (!H) return;
    var items = [], map = -1;
    rows.forEach(function (x, i) {
      var r = x && x.p ? x : resolve(x);
      if (!r) return;
      if (i === idx) map = items.length;
      items.push(C.itemOf(r));
    });
    if (!items.length) { showToast(t("missing.toast")); return; }
    if (idx >= 0 && map < 0) { showToast(t("missing.toast")); return; }
    // The Shuffle button turns shuffle on; Play and a tapped row keep the current setting.
    var shf = shuffle ? 1 : H.getState().shf;
    H.playList(items, idx >= 0 ? map : (shf ? -1 : 0), { shf: shf, src: src });
  }
  function toggleLike(x) {
    var ref = C.normRef(x.p ? C.refOf(x) : x);
    if (!ref) return;
    var on = !C.isLiked(D(), ref.k);
    mutate(function (d, now) { return C.setLike(d, ref, on, now); });
    showToast(on ? t("toast.liked") : t("toast.unliked"));
  }
  function newPlaylist(refs, then) {
    var n = D().pls.length + 1;
    promptDlg(t("lib.newPl"), t("pl.name"), t("pl.my", { n: n }), t("pl.create"), function (name) {
      var id = null;
      mutate(function (d, now) { var r = C.addPl(d, name, refs || [], now); id = r.id; return r.data; });
      if (refs && refs.length) showToast(t("toast.added", { n: name }));
      if (then && id) then(id);
    });
  }
  function addToPlaylist(refs) {
    var list = D().pls;
    var dlg = makeDialog("mu-pick", "menu-dlg");
    dlg.appendChild(el("h2", "dlg-title", t("pl.pick")));
    var col = el("div", "menu-col");
    col.appendChild(button("+ " + t("lib.newPl"), "", function () { dlg.close(); newPlaylist(refs); }));
    list.forEach(function (p) {
      col.appendChild(button(p.n, "", function () {
        dlg.close();
        mutate(function (d, now) { return C.addToPl(d, p.id, refs, now); });
        showToast(t("toast.added", { n: p.n }));
      }));
    });
    col.appendChild(button(t("cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(col);
    openDialog(dlg);
  }
  function deleteSongs(recs) {
    recs = recs.filter(function (r) { return r && r.p; });
    if (!recs.length) return;
    var q = recs.length === 1 ? t("del.q", { t: recs[0].t }) : t("del.many", { n: recs.length });
    confirmDlg(q, t("m.delete"), function () {
      recs.reduce(function (p, r) { return p.then(function () { return LIB.removeFile(r.p).catch(function () {}); }); }, Promise.resolve())
        .then(loadIndex).then(function () { relinkQueue(); renderKeepScroll(); showToast(t("toast.deleted")); });
    });
  }
  function pickFiles(folder) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = true;
    inp.accept = "audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.wav,.webm";
    if (folder) { inp.setAttribute("webkitdirectory", ""); inp.setAttribute("directory", ""); }
    inp.style.display = "none";
    inp.addEventListener("change", function () { var f = [].slice.call(inp.files || []); inp.remove(); if (f.length) addFiles(f); });
    inp.addEventListener("cancel", function () { inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  }
  function addFiles(files) {
    if (!LIB.fs()) { showToast(t("toast.noFs")); return; }
    scanState = { busy: true, d: 0, n: files.length };
    paintScan();
    LIB.addFiles(files, function (d, n) { scanState.d = d; scanState.n = n; paintScan(); }).then(function (r) {
      if (r.skipped) showToast(t("toast.skip", { n: r.skipped }));
      return rescan(false).then(function () {
        if (r.saved) showToast(r.saved === 1 ? t("toast.saved1") : t("toast.saved", { n: r.saved }));
      });
    }, function (e) { scanState.busy = false; paintScan(); showToast(t("toast.err", { c: (e && e.message) || "add" })); });
  }
  function addMenu() {
    menuDlg([
      [t("empty.files"), function () { pickFiles(false); }],
      [t("empty.folder"), function () { pickFiles(true); }],
      [t("lib.newPl"), function () { newPlaylist([], function (id) { openView({ kind: "pl", id: id }); }); }]
    ]);
  }
  function openInFiles() {
    var F = LIB.fs();
    Promise.resolve(F ? F.mkdir(LIB.ROOT).catch(function () {}) : null).then(function () {
      try {
        var f = window.parent && window.parent.__orosOpenAt;
        if (typeof f === "function") f("files", { path: LIB.ROOT, dir: true });
      } catch (e) {}
    });
  }

  // ---------- 5. Views ----------
  var view = null, history = [];       // view = { kind, id } over the tab
  var searchQ = "";
  function openView(v) {
    if (view) history.push(view);
    view = v;
    renderAll();
    $("main").scrollTop = 0;
  }
  function goBack() {
    view = history.pop() || null;
    renderAll();
  }
  function setTab(tab) {
    prefs.tab = tab; savePrefs();
    view = null; history = [];
    renderAll();
    $("main").scrollTop = 0;
    if (tab === "search") { var q = $("q"); if (q) q.focus(); }
  }
  function renderAll() {
    paintTabs();
    var m = $("main");
    m.textContent = "";
    var line = el("div", "scan-line");
    line.id = "scan-line";
    m.appendChild(line);
    paintScan();
    $("back-btn").hidden = !view;
    $("app-name").textContent = t("app");
    if (view) renderPage(m, view);
    else if (prefs.tab === "search") renderSearch(m);
    else if (prefs.tab === "lib") renderLib(m);
    else renderHome(m);
    paintPlayer();
    paintPlaying();
  }
  function renderKeepScroll() {
    var m = $("main"), y = m.scrollTop;
    if (document.querySelector("dialog[open]:not(#mu-full)")) { paintPlayer(); return; }
    var qf = document.activeElement && document.activeElement.id === "q";
    renderAll();
    m.scrollTop = y;
    if (qf && $("q")) { var q = $("q"); q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) {} }
  }
  function paintTabs() {
    [].forEach.call(document.querySelectorAll("#tabs [data-tab]"), function (b) {
      var on = b.getAttribute("data-tab") === prefs.tab;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.classList.toggle("on", on);
    });
  }
  function section(m, title, more) {
    var s = el("section", "sec");
    var h = el("div", "sec-head");
    h.appendChild(el("h2", "", title));
    if (more) h.appendChild(more);
    s.appendChild(h);
    m.appendChild(s);
    return s;
  }
  function emptyHero(m) {
    var box = el("div", "hero");
    box.appendChild(cover("", "music", "hero-art"));
    box.appendChild(el("h1", "", t("empty.title")));
    box.appendChild(el("p", "dim", t("empty.body")));
    var row = el("div", "hero-btns");
    row.appendChild(button(t("empty.files"), "pill accent", function () { pickFiles(false); }));
    row.appendChild(button(t("empty.folder"), "pill", function () { pickFiles(true); }));
    box.appendChild(row);
    box.appendChild(el("p", "dim small", t("empty.soon")));
    m.appendChild(box);
  }
  function greeting() {
    var h = new Date().getHours();
    return h < 12 && h >= 5 ? t("hello.m") : h < 18 && h >= 5 ? t("hello.a") : t("hello.e");
  }
  function renderHome(m) {
    if (!tracks.length && !D().pls.length) { emptyHero(m); return; }
    m.appendChild(el("h1", "greet", greeting()));
    // Quick tiles: liked songs, playlists, shuffle all.
    var tiles = el("div", "tiles");
    var liked = C.likedList(D());
    tiles.appendChild(tile(t("lib.liked"), likedCover(), function () { openView({ kind: "liked" }); }));
    D().pls.slice(0, 5).forEach(function (p) { tiles.appendChild(tile(p.n, collage(p.it.map(function (r) { return resolve(r) || r; }), ""), function () { openView({ kind: "pl", id: p.id }); })); });
    if (tracks.length) tiles.appendChild(tile(t("home.shuffleAll"), cover("", "shuffle", "", I.shuffle), function () { playRows(tracks, -1, { kind: "all", id: "", n: t("now.lib") }, true); }));
    m.appendChild(tiles);
    void liked;
    var hist = H ? H.history() : null;
    var recent = (hist && hist.r ? hist.r : []).map(function (x) { return resolve(x); }).filter(Boolean);
    if (recent.length) {
      var s1 = section(m, t("home.recent"));
      var rowR = el("div", "cards");
      // Albums of the recent songs, then the songs with no album.
      var seenAl = {};
      recent.forEach(function (r) {
        var ak = C.albumKey(r);
        if (ak) {
          if (seenAl[ak]) return;
          seenAl[ak] = 1;
          var al = albumsAll().filter(function (a) { return a.k === ak; })[0];
          if (al) { rowR.appendChild(albumCard(al)); return; }
        }
        rowR.appendChild(songCard(r));
      });
      s1.appendChild(rowR);
    }
    var added = albumsAll().slice().sort(function (a, b) { return b.add - a.add; }).slice(0, 12);
    if (added.length) {
      var s2 = section(m, t("home.added"));
      var rowA = el("div", "cards");
      added.forEach(function (a) { rowA.appendChild(albumCard(a)); });
      s2.appendChild(rowA);
    }
    if (hist && hist.c) {
      var top = Object.keys(hist.c).sort(function (a, b) { return hist.c[b] - hist.c[a]; }).map(function (k) { return resolve({ k: k }); }).filter(Boolean).slice(0, 8);
      if (top.length >= 3) {
        var s3 = section(m, t("home.top"));
        s3.appendChild(rowList(top, { src: { kind: "top", id: "", n: t("home.top") } }));
      }
    }
    var arts = artistsAll().slice(0, 12);
    if (arts.length) {
      var s4 = section(m, t("sec.artists"));
      var rowAr = el("div", "cards");
      arts.forEach(function (a) { rowAr.appendChild(artistCard(a)); });
      s4.appendChild(rowAr);
    }
  }
  function tile(label, art, fn) {
    var b = el("button", "tile");
    b.type = "button";
    b.appendChild(art);
    b.appendChild(el("span", "tile-t", label));
    b.addEventListener("click", fn);
    return b;
  }
  function likedCover(cls) { var c = el("span", "cover liked " + (cls || "")); c.innerHTML = I.heartOn; return c; }
  function renderSearch(m) {
    var bar = el("div", "search-bar");
    var inp = el("input");
    inp.id = "q"; inp.type = "search"; inp.placeholder = t("search.ph"); inp.value = searchQ;
    inp.setAttribute("aria-label", t("search.ph"));
    inp.autocomplete = "off";
    var timer = null;
    inp.addEventListener("input", function () {
      searchQ = inp.value;
      clearTimeout(timer);
      timer = setTimeout(function () { var r = $("search-res"); if (r) { r.textContent = ""; searchResults(r); } }, 150);
    });
    bar.appendChild(inp);
    m.appendChild(bar);
    var res = el("div", "");
    res.id = "search-res";
    m.appendChild(res);
    searchResults(res);
  }
  function searchResults(box) {
    var q = searchQ.trim();
    if (!q) {
      if (!tracks.length) { box.appendChild(el("p", "empty", t("search.hint"))); return; }
      var gs = genresAll();
      if (gs.length) {
        box.appendChild(el("h2", "sub-h", t("search.genres")));
        var grid = el("div", "genre-grid");
        gs.forEach(function (g) {
          var b = el("button", "genre");
          b.type = "button";
          b.style.setProperty("--hue", parseInt(C.hash(C.fold(g.n)).slice(0, 4), 36) % 360);
          b.appendChild(el("span", "", g.n));
          b.appendChild(el("span", "dim small", nSongs(g.list.length)));
          b.addEventListener("click", function () { openView({ kind: "genre", id: g.k }); });
          grid.appendChild(b);
        });
        box.appendChild(grid);
      } else box.appendChild(el("p", "empty", t("search.hint")));
      return;
    }
    var r = C.search(tracks, q, LANG);
    var w = C.words(q);
    var pls = D().pls.filter(function (p) { var f = C.fold(p.n); return w.every(function (x) { return f.indexOf(x) >= 0; }); });
    if (!r.songs.length && !r.albums.length && !r.artists.length && !pls.length) { box.appendChild(el("p", "empty", t("search.none", { q: q }))); return; }
    if (r.songs.length) {
      box.appendChild(el("h2", "sub-h", t("sec.songs")));
      box.appendChild(rowList(r.songs.slice(0, 30), { src: { kind: "search", id: q, n: q } }));
    }
    if (r.artists.length) {
      box.appendChild(el("h2", "sub-h", t("sec.artists")));
      var ca = el("div", "cards"); r.artists.slice(0, 20).forEach(function (a) { ca.appendChild(artistCard(a)); }); box.appendChild(ca);
    }
    if (r.albums.length) {
      box.appendChild(el("h2", "sub-h", t("sec.albums")));
      var cb = el("div", "cards"); r.albums.slice(0, 20).forEach(function (a) { cb.appendChild(albumCard(a)); }); box.appendChild(cb);
    }
    if (pls.length) {
      box.appendChild(el("h2", "sub-h", t("sec.pls")));
      var cp = el("div", "cards"); pls.forEach(function (p) { cp.appendChild(plCard(p)); }); box.appendChild(cp);
    }
  }
  function renderLib(m) {
    var chips = el("div", "chips");
    ["pl", "songs", "albums", "artists", "genres", "folders"].forEach(function (k) {
      var b = button(t("lib." + k), "chip" + (prefs.lib === k ? " on" : ""), function () { prefs.lib = k; savePrefs(); renderAll(); });
      b.setAttribute("aria-pressed", prefs.lib === k ? "true" : "false");
      chips.appendChild(b);
    });
    m.appendChild(chips);
    if (!tracks.length && prefs.lib !== "pl") { emptyHero(m); return; }
    if (prefs.lib === "pl") {
      var list = el("div", "lib-list");
      list.appendChild(libRow(likedCover("sm"), t("lib.liked"), t("kind.pl") + " · " + nSongs(C.likedList(D()).length), function () { openView({ kind: "liked" }); }));
      D().pls.slice().sort(function (a, b) { return b.m - a.m; }).forEach(function (p) {
        list.appendChild(libRow(collage(p.it.map(function (r) { return resolve(r) || r; }), "sm"), p.n, t("kind.pl") + " · " + nSongs(p.it.length), function () { openView({ kind: "pl", id: p.id }); }));
      });
      list.appendChild(libRow(cover("", "+", "sm", I.plus), t("lib.newPl"), "", function () { newPlaylist([], function (id) { openView({ kind: "pl", id: id }); }); }));
      m.appendChild(list);
      if (!tracks.length) emptyHero(m);
    } else if (prefs.lib === "songs") {
      var bar = el("div", "list-bar");
      bar.appendChild(el("span", "dim small", nSongs(tracks.length)));
      bar.appendChild(el("span", "spacer"));
      var sel = el("select", "sort");
      sel.setAttribute("aria-label", t("sort.by"));
      ["title", "artist", "album", "added"].forEach(function (k) { var o = el("option", "", t("sort." + k)); o.value = k; if (prefs.sort === k) o.selected = true; sel.appendChild(o); });
      sel.addEventListener("change", function () { prefs.sort = sel.value; savePrefs(); renderAll(); });
      bar.appendChild(sel);
      m.appendChild(bar);
      var sorted = C.sortTracks(tracks, prefs.sort, LANG);
      m.appendChild(playBar(sorted, { kind: "all", id: "", n: t("now.lib") }));
      m.appendChild(rowList(sorted, { src: { kind: "all", id: "", n: t("now.lib") } }));
    } else if (prefs.lib === "albums") {
      var g = el("div", "grid");
      albumsAll().forEach(function (a) { g.appendChild(albumCard(a)); });
      m.appendChild(g);
      var loose = tracks.filter(function (r) { return !r.al; });
      if (loose.length) {
        m.appendChild(el("h2", "sub-h", t("unknown.album")));
        m.appendChild(rowList(C.sortTracks(loose, "title", LANG), { src: { kind: "all", id: "", n: t("unknown.album") } }));
      }
    } else if (prefs.lib === "artists") {
      var la = el("div", "lib-list");
      artistsAll().forEach(function (a) { la.appendChild(libRow(cover(a.art, a.n, "sm round", I.user), a.n, t("kind.artist") + " · " + nSongs(a.list.length), function () { openView({ kind: "artist", id: a.k }); })); });
      m.appendChild(la);
    } else if (prefs.lib === "genres") {
      var lg = el("div", "lib-list");
      genresAll().forEach(function (g2) { lg.appendChild(libRow(cover("", g2.n, "sm"), g2.n, nSongs(g2.list.length), function () { openView({ kind: "genre", id: g2.k }); })); });
      if (!genresAll().length) m.appendChild(el("p", "empty", t("lib.empty")));
      m.appendChild(lg);
    } else if (prefs.lib === "folders") {
      renderFolder(m, LIB.ROOT);
    }
  }
  function renderFolder(m, dir) {
    var fv = C.folderView(tracks, LIB.ROOT, dir);
    var lf = el("div", "lib-list");
    fv.dirs.forEach(function (d) { lf.appendChild(libRow(cover("", d.n, "sm", I.folder), d.n, nSongs(d.c), function () { openView({ kind: "folder", id: d.p }); })); });
    m.appendChild(lf);
    if (fv.files.length) {
      m.appendChild(playBar(fv.files, { kind: "folder", id: dir, n: dir.split("/").pop() }));
      m.appendChild(rowList(fv.files, { src: { kind: "folder", id: dir, n: dir.split("/").pop() } }));
    }
    if (!fv.dirs.length && !fv.files.length) m.appendChild(el("p", "empty", t("lib.empty")));
    var open = button(t("s.folder"), "pill small-pill", openInFiles);
    m.appendChild(el("div", "center pad")).appendChild(open);
  }
  function libRow(art, title, sub, fn) {
    var b = el("button", "lib-row");
    b.type = "button";
    b.appendChild(art);
    var tx = el("span", "lr-text");
    tx.appendChild(el("span", "lr-t", title));
    if (sub) tx.appendChild(el("span", "lr-s dim", sub));
    b.appendChild(tx);
    b.addEventListener("click", fn);
    return b;
  }
  function pageHead(m, art, kind, title, sub, list, src, extra) {
    var h = el("div", "page-head");
    h.appendChild(art);
    var tx = el("div", "ph-text");
    tx.appendChild(el("span", "dim small up", kind));
    tx.appendChild(el("h1", "", title));
    if (sub) tx.appendChild(sub);
    h.appendChild(tx);
    m.appendChild(h);
    m.appendChild(playBar(list, src, extra));
  }
  function playBar(list, src, extra) {
    var bar = el("div", "play-bar");
    var playing = isPlayingFrom(src);
    var pb = button(playing ? t("pause") : t("play"), "big-play", function () {
      if (playing) { H.toggle(); return; }
      playRows(list, -1, src, false);
    }, playing && H.getState().playing ? I.pause : I.play);
    pb.setAttribute("data-src", JSON.stringify(src));
    bar.appendChild(pb);
    bar.appendChild(button(t("shuffle"), "icon-btn", function () { playRows(list, -1, src, true); }, I.shuffle));
    if (extra) extra.forEach(function (x) { bar.appendChild(x); });
    return bar;
  }
  function isPlayingFrom(src) {
    if (!H) return false;
    var st = H.getState();
    return !!(st.cur && st.src && src && st.src.kind === src.kind && st.src.id === src.id);
  }
  function artistLink(name, cls) {
    var a = el("button", "link " + (cls || ""), name || t("unknown.artist"));
    a.type = "button";
    if (name) a.addEventListener("click", function (e) { e.stopPropagation(); openView({ kind: "artist", id: C.artistKey(name) }); });
    return a;
  }
  function renderPage(m, v) {
    var src;
    if (v.kind === "album") {
      var al = albumsAll().filter(function (a) { return a.k === v.id; })[0];
      if (!al) { m.appendChild(el("p", "empty", t("lib.empty"))); return; }
      src = { kind: "album", id: al.k, n: al.n };
      var sub = el("div", "ph-sub");
      sub.appendChild(artistLink(al.a));
      sub.appendChild(el("span", "dim", [al.y || "", nSongs(al.list.length), totalTime(al.list)].filter(Boolean).join(" · ")));
      pageHead(m, cover(al.art, al.n, "big"), t("kind.album"), al.n, sub, al.list, src,
        [button(t("m.addPl"), "icon-btn", function () { addToPlaylist(al.list.map(C.refOf)); }, I.plus)]);
      m.appendChild(rowList(al.list, { src: src, numbers: true, noArt: true, noAlbum: true }));
    } else if (v.kind === "artist") {
      var ar = artistsAll().filter(function (a) { return a.k === v.id; })[0];
      if (!ar) { m.appendChild(el("p", "empty", t("lib.empty"))); return; }
      src = { kind: "artist", id: ar.k, n: ar.n };
      var als = albumsAll().filter(function (a) { return a.list.some(function (r) { return ar.list.indexOf(r) >= 0; }); });
      pageHead(m, cover(ar.art, ar.n, "big round", I.user), t("kind.artist"), ar.n,
        el("div", "ph-sub dim", [nSongs(ar.list.length), als.length ? nAlbums(als.length) : ""].filter(Boolean).join(" · ")), C.sortTracks(ar.list, "album", LANG), src);
      m.appendChild(el("h2", "sub-h", t("sec.songs")));
      m.appendChild(rowList(C.sortTracks(ar.list, "album", LANG), { src: src, noArtist: true }));
      if (als.length) {
        m.appendChild(el("h2", "sub-h", t("sec.albums")));
        var cb = el("div", "cards");
        als.forEach(function (a) { cb.appendChild(albumCard(a)); });
        m.appendChild(cb);
      }
    } else if (v.kind === "pl") {
      var p = C.findPl(D(), v.id);
      if (!p) { view = null; renderAll(); return; }
      src = { kind: "pl", id: p.id, n: p.n };
      var rows = p.it.map(function (r) { return resolve(r) ? Object.assign({}, resolve(r), { _ref: r }) : Object.assign({ _missing: 1 }, r); });
      pageHead(m, collage(rows, "big"), t("kind.pl"), p.n, el("div", "ph-sub dim", [nSongs(p.it.length), totalTime(rows.filter(function (r) { return !r._missing; }))].filter(Boolean).join(" · ")),
        rows, src, [button(t("more"), "icon-btn", function () { plMenu(p); }, I.more)]);
      if (!rows.length) m.appendChild(el("p", "empty", t("pl.emptyRows")));
      m.appendChild(rowList(rows, { src: src, pl: p }));
    } else if (v.kind === "liked") {
      src = { kind: "liked", id: "", n: t("lib.liked") };
      var lk = C.likedList(D()).map(function (l) { var r = resolve(l); return r || Object.assign({ _missing: 1 }, l); });
      pageHead(m, likedCover("big"), t("kind.pl"), t("lib.liked"), el("div", "ph-sub dim", nSongs(lk.length)), lk, src);
      if (!lk.length) m.appendChild(el("p", "empty", t("liked.empty")));
      m.appendChild(rowList(lk, { src: src }));
    } else if (v.kind === "genre") {
      var g = genresAll().filter(function (x) { return x.k === v.id; })[0];
      if (!g) { m.appendChild(el("p", "empty", t("lib.empty"))); return; }
      src = { kind: "genre", id: g.k, n: g.n };
      var gl = C.sortTracks(g.list, "artist", LANG);
      pageHead(m, cover("", g.n, "big"), t("kind.genre"), g.n, el("div", "ph-sub dim", nSongs(g.list.length)), gl, src);
      m.appendChild(rowList(gl, { src: src }));
    } else if (v.kind === "folder") {
      var crumbs = el("div", "crumbs dim small", v.id.replace(LIB.ROOT, "Music"));
      m.appendChild(crumbs);
      renderFolder(m, v.id);
    }
  }

  // ---------- 6. Rows, cards, menus ----------
  // One row per song. opts: src, numbers, noArt, noAlbum, noArtist, pl
  function rowList(rows, opts) {
    var ul = el("ul", "rows");
    rows.forEach(function (r, i) { ul.appendChild(songRow(r, i, rows, opts || {})); });
    return ul;
  }
  function songRow(r, i, rows, opts) {
    var li = el("li", "row" + (r._missing ? " missing" : ""));
    var k = r.k;
    li.setAttribute("data-k", k);
    if (r.p) li.setAttribute("data-p", r.p);
    var main = el("button", "row-main");
    main.type = "button";
    if (opts.numbers) main.appendChild(el("span", "row-n dim", String(r.n || i + 1)));
    else if (!opts.noArt) main.appendChild(cover(r.art, r.al || r.t, "xs"));
    var tx = el("span", "row-text");
    tx.appendChild(el("span", "row-t", r.t || "?"));
    var sub = [];
    if (r._missing) sub.push(t("missing"));
    else {
      if (!opts.noArtist) sub.push(r.a || t("unknown.artist"));
      if (!opts.noAlbum && r.al) sub.push(r.al);
    }
    tx.appendChild(el("span", "row-s dim", sub.join(" · ")));
    main.appendChild(tx);
    main.addEventListener("click", function () {
      if (r._missing) { showToast(t("missing.toast")); return; }
      var st = H && H.getState();
      if (st && st.cur && st.cur.k === k && st.src && opts.src && st.src.kind === opts.src.kind && st.src.id === opts.src.id) { H.toggle(); return; }
      playRows(rows, i, opts.src, undefined);
    });
    li.appendChild(main);
    var liked = C.isLiked(D(), k);
    var lb = button(liked ? t("unlike") : t("like"), "icon-btn like" + (liked ? " on" : ""), function () { toggleLike(r._ref || r); renderKeepScroll(); }, liked ? I.heartOn : I.heart);
    li.appendChild(lb);
    li.appendChild(el("span", "row-d dim", r.d ? C.fmtTime(r.d) : ""));
    li.appendChild(button(t("more"), "icon-btn", function () { songMenu(r, i, opts); }, I.more));
    return li;
  }
  function songMenu(r, i, opts) {
    var items = [];
    var ref = C.normRef(r._ref || (r.p ? C.refOf(r) : r));
    var item = r._missing ? null : (r.p ? C.itemOf(r) : null);
    if (item) {
      items.push([t("m.playNext"), function () { H.addNext([item]); showToast(t("toast.next")); }]);
      items.push([t("m.addQueue"), function () { H.addLast([item]); showToast(t("toast.queued")); }]);
    }
    if (ref) items.push([t("m.addPl"), function () { addToPlaylist([ref]); }]);
    var ak = r.p ? C.albumKey(r) : "";
    if (ak && !(view && view.kind === "album" && view.id === ak)) items.push([t("m.album"), function () { openView({ kind: "album", id: ak }); }]);
    var an = r.p ? (r.a || "") : "";
    if (an && !(view && view.kind === "artist" && view.id === C.artistKey(an))) items.push([t("m.artist"), function () { openView({ kind: "artist", id: C.artistKey(an) }); }]);
    if (opts.pl) {
      var p = opts.pl;
      if (i > 0) items.push([t("m.up"), function () { mutate(function (d, now) { return C.movePl(d, p.id, i, i - 1, now); }); }]);
      if (i < p.it.length - 1) items.push([t("m.down"), function () { mutate(function (d, now) { return C.movePl(d, p.id, i, i + 1, now); }); }]);
      items.push([t("m.removePl"), function () { mutate(function (d, now) { return C.removeFromPl(d, p.id, i, now); }); }]);
    }
    if (r.p) items.push([t("m.info"), function () { infoDlg(r); }]);
    if (r.p) items.push([t("m.delete"), function () { deleteSongs([r]); }, true]);
    menuDlg(items, r.t, r.a);
  }
  function plMenu(p) {
    menuDlg([
      [t("m.rename"), function () {
        promptDlg(t("m.rename"), t("pl.name"), p.n, t("pl.save"), function (name) { mutate(function (d, now) { return C.renamePl(d, p.id, name, now); }); });
      }],
      [t("m.addQueue"), function () { var it = itemsOf(p.it); if (it.length) { H.addLast(it); showToast(t("toast.queued")); } }],
      [t("m.deletePl"), function () {
        confirmDlg(t("pl.deleteQ", { n: p.n }), t("m.deletePl"), function () { mutate(function (d, now) { return C.deletePl(d, p.id, now); }); goBack(); });
      }, true]
    ], p.n);
  }
  function card(art, title, sub, fn, playFn) {
    var c = el("div", "card");
    var b = el("button", "card-main");
    b.type = "button";
    b.appendChild(art);
    b.appendChild(el("span", "card-t", title));
    if (sub) b.appendChild(el("span", "card-s dim", sub));
    b.addEventListener("click", fn);
    c.appendChild(b);
    if (playFn) {
      var pb = button(t("play"), "card-play", function (e) { e.stopPropagation(); playFn(); }, I.play);
      c.appendChild(pb);
    }
    return c;
  }
  function albumCard(a) {
    return card(cover(a.art, a.n, ""), a.n, a.a || t("unknown.artist"), function () { openView({ kind: "album", id: a.k }); },
      function () { playRows(a.list, -1, { kind: "album", id: a.k, n: a.n }, false); });
  }
  function artistCard(a) {
    return card(cover(a.art, a.n, "round", I.user), a.n, t("kind.artist"), function () { openView({ kind: "artist", id: a.k }); });
  }
  function songCard(r) {
    return card(cover(r.art, r.al || r.t, ""), r.t, r.a || t("kind.single"), function () { playRows([r], 0, { kind: "song", id: r.k, n: r.t }, false); });
  }
  function plCard(p) {
    return card(collage(p.it.map(function (r) { return resolve(r) || r; }), ""), p.n, t("kind.pl"), function () { openView({ kind: "pl", id: p.id }); });
  }
  function infoDlg(r) {
    var dlg = makeDialog("mu-info", "menu-dlg");
    dlg.appendChild(el("h2", "dlg-title", r.t));
    var dl = el("dl", "info");
    var add = function (k, v) { if (!v) return; dl.appendChild(el("dt", "dim", t(k))); dl.appendChild(el("dd", "", String(v))); };
    add("info.file", r.p.replace(LIB.ROOT + "/", ""));
    add("info.format", (r.fmt || "").toUpperCase());
    add("info.size", r.sz ? fmtSize(r.sz) : "");
    add("info.length", r.d ? C.fmtTime(r.d) : "");
    add("info.track", r.n ? (r.dn ? r.dn + "-" : "") + r.n : "");
    add("info.genre", r.g);
    add("info.year", r.y);
    dlg.appendChild(dl);
    var row = el("div", "dlg-btns");
    row.appendChild(button(t("close"), "txt-btn", function () { dlg.close(); }));
    dlg.appendChild(row);
    openDialog(dlg);
  }

  // ---------- 7. Player bar + full player + queue ----------
  function paintPlayer() {
    var bar = $("player");
    if (!H) { bar.hidden = true; return; }
    var st = H.getState(), c = st.cur;
    bar.hidden = !c;
    document.body.classList.toggle("has-player", !!c);
    if (!c) return;
    var key = c.k + "|" + (c.art || "");
    if (bar.getAttribute("data-k") !== key) {
      bar.setAttribute("data-k", key);
      var a = $("pl-art"); a.textContent = ""; a.appendChild(cover(c.art, c.al || c.t, "xs"));
      $("pl-title").textContent = c.t || "";
      $("pl-sub").textContent = c.a || "";
    }
    var pp = $("pl-play");
    pp.innerHTML = st.playing ? I.pause : I.play;
    pp.setAttribute("aria-label", st.playing ? t("pause") : t("play")); pp.title = pp.getAttribute("aria-label");
    var liked = C.isLiked(D(), c.k), lk = $("pl-like");
    lk.innerHTML = liked ? I.heartOn : I.heart;
    lk.classList.toggle("on", liked);
    lk.setAttribute("aria-label", liked ? t("unlike") : t("like")); lk.title = lk.getAttribute("aria-label");
    $("pl-prog").style.width = (st.dur ? Math.min(100, st.pos / st.dur * 100) : 0) + "%";
    bar.classList.toggle("err", !!st.error);
    var full = $("mu-full");
    if (full && full.open && full._paint) full._paint();
  }
  // The playing row and the big play buttons follow the host.
  function paintPlaying() {
    if (!H) return;
    var st = H.getState(), k = st.cur ? st.cur.k : "";
    [].forEach.call(document.querySelectorAll(".row"), function (li) { li.classList.toggle("now", !!k && li.getAttribute("data-k") === k); });
    [].forEach.call(document.querySelectorAll(".big-play"), function (b) {
      var src = null;
      try { src = JSON.parse(b.getAttribute("data-src") || "null"); } catch (e) {}
      var on = isPlayingFrom(src) && st.playing;
      b.innerHTML = on ? I.pause : I.play;
      b.setAttribute("aria-label", on ? t("pause") : t("play"));
    });
  }
  function fullPlayer() {
    if (!H || !H.getState().cur) return;
    var dlg = makeDialog("mu-full", "full-dlg");
    var head = el("div", "fp-head");
    head.appendChild(button(t("close"), "icon-btn", function () { dlg.close(); }, I.down));
    var from = el("div", "fp-from");
    from.appendChild(el("span", "dim small up", t("now.from")));
    var fromN = el("span", "fp-from-n");
    from.appendChild(fromN);
    head.appendChild(from);
    var qBtn = button(t("queue"), "icon-btn", function () { showQ = !showQ; dlg._paint(true); }, I.queue);
    head.appendChild(qBtn);
    dlg.appendChild(head);
    var body = el("div", "fp-body");
    var artBox = el("div", "fp-art");
    var qBox = el("div", "fp-queue");
    body.appendChild(artBox);
    body.appendChild(qBox);
    dlg.appendChild(body);
    var meta = el("div", "fp-meta");
    var tx = el("div", "fp-text");
    var tt = el("div", "fp-t"), ta = el("div", "fp-a");
    tx.appendChild(tt); tx.appendChild(ta);
    meta.appendChild(tx);
    var like = button(t("like"), "icon-btn like", function () { var c = H.getState().cur; if (c) { toggleLike(c); dlg._paint(true); } }, I.heart);
    meta.appendChild(like);
    dlg.appendChild(meta);
    var seek = el("input", "seek");
    seek.type = "range"; seek.min = "0"; seek.max = "1000"; seek.step = "1"; seek.value = "0";
    seek.setAttribute("aria-label", t("seek"));
    var dragging = false;
    seek.addEventListener("input", function () { dragging = true; var st = H.getState(); tPos.textContent = C.fmtTime(seek.value / 1000 * st.dur); });
    seek.addEventListener("change", function () { var st = H.getState(); dragging = false; if (st.dur) H.seekTo(seek.value / 1000 * st.dur); });
    dlg.appendChild(seek);
    var times = el("div", "fp-times dim small");
    var tPos = el("span", "", "0:00"), tDur = el("span", "", "0:00");
    times.appendChild(tPos); times.appendChild(tDur);
    dlg.appendChild(times);
    var ctl = el("div", "fp-ctl");
    var shf = button(t("shuffle"), "icon-btn", function () { H.setShuffle(!H.getState().shf); }, I.shuffle);
    var prv = button(t("prev"), "icon-btn", function () { H.prev(); }, I.prev);
    var ply = button(t("play"), "icon-btn fp-play", function () { H.toggle(); }, I.play);
    var nxt = button(t("next"), "icon-btn", function () { H.next(); }, I.next);
    var rep = button(t("repeat.off"), "icon-btn", function () { H.cycleRepeat(); }, I.repeat);
    [shf, prv, ply, nxt, rep].forEach(function (b) { ctl.appendChild(b); });
    dlg.appendChild(ctl);
    var vol = el("div", "fp-vol");
    var vi = el("span", "vol-ic"); vi.innerHTML = I.vol;
    vol.appendChild(vi);
    var vr = el("input");
    vr.type = "range"; vr.min = "0"; vr.max = "100"; vr.value = String(Math.round(H.getState().vol * 100));
    vr.setAttribute("aria-label", t("volume"));
    vr.addEventListener("input", function () { H.setVolume(vr.value / 100); });
    vol.appendChild(vr);
    dlg.appendChild(vol);
    var showQ = false, lastK = "";
    dlg._paint = function (full) {
      var st = H.getState(), c = st.cur;
      if (!c) { dlg.close(); return; }
      if (full || lastK !== c.k) {
        lastK = c.k;
        artBox.textContent = "";
        artBox.appendChild(cover(c.art, c.al || c.t, "huge"));
        tt.textContent = c.t || "";
        ta.textContent = "";
        ta.appendChild(artistLink(c.a, "dim"));
        fromN.textContent = (st.src && st.src.n) || t("now.lib");
        var liked = C.isLiked(D(), c.k);
        like.innerHTML = liked ? I.heartOn : I.heart;
        like.classList.toggle("on", liked);
        like.setAttribute("aria-label", liked ? t("unlike") : t("like"));
        body.classList.toggle("q-on", showQ);
        qBtn.classList.toggle("on", showQ);
        if (showQ) paintQueue(qBox);
      }
      ply.innerHTML = st.playing ? I.pause : I.play;
      ply.setAttribute("aria-label", st.playing ? t("pause") : t("play"));
      shf.classList.toggle("on", !!st.shf);
      shf.setAttribute("aria-label", st.shf ? t("shuffleOn") : t("shuffleOff")); shf.title = shf.getAttribute("aria-label");
      rep.innerHTML = st.rep === "one" ? I.repeat1 : I.repeat;
      rep.classList.toggle("on", st.rep !== "off");
      rep.setAttribute("aria-label", t("repeat." + st.rep)); rep.title = rep.getAttribute("aria-label");
      if (!dragging) {
        seek.value = st.dur ? String(Math.round(st.pos / st.dur * 1000)) : "0";
        tPos.textContent = C.fmtTime(st.pos);
      }
      tDur.textContent = C.fmtTime(st.dur);
      if (document.activeElement !== vr) vr.value = String(Math.round(st.vol * 100));
    };
    dlg.addEventListener("close", function () { dlg.remove(); });
    // Artist link inside: close first.
    ta.addEventListener("click", function () { dlg.close(); });
    openDialog(dlg);
    dlg._paint(true);
  }
  function paintQueue(box) {
    box.textContent = "";
    var st = H.getState(), up = H.upcoming(100);
    box.appendChild(el("h3", "q-h", t("q.now")));
    var nowUl = el("ul", "rows");
    nowUl.appendChild(qRow(st.cur, -1, true));
    box.appendChild(nowUl);
    var n = 0;
    if (up.up.length) {
      var h = el("div", "q-head");
      h.appendChild(el("h3", "q-h", t("q.up")));
      h.appendChild(button(t("q.clear"), "txt-btn small", function () { H.clearUp(); paintQueue(box); }));
      box.appendChild(h);
      var ul = el("ul", "rows");
      up.up.forEach(function (it, i) { ul.appendChild(qRow(it, n++, false, i)); });
      box.appendChild(ul);
    }
    if (up.next.length) {
      box.appendChild(el("h3", "q-h", t("q.next", { n: (st.src && st.src.n) || t("now.lib") })));
      var ul2 = el("ul", "rows");
      up.next.forEach(function (it) { ul2.appendChild(qRow(it, n++, false)); });
      box.appendChild(ul2);
    }
    if (!up.up.length && !up.next.length) box.appendChild(el("p", "empty", t("q.empty")));
  }
  function qRow(it, n, isNow, upIdx) {
    var li = el("li", "row" + (isNow ? " now" : ""));
    var main = el("button", "row-main");
    main.type = "button";
    main.appendChild(cover(it.art, it.al || it.t, "xs"));
    var tx = el("span", "row-text");
    tx.appendChild(el("span", "row-t", it.t || "?"));
    tx.appendChild(el("span", "row-s dim", it.a || ""));
    main.appendChild(tx);
    if (!isNow) main.addEventListener("click", function () { H.jump(n); });
    li.appendChild(main);
    if (typeof upIdx === "number") li.appendChild(button(t("q.remove"), "icon-btn", function () { H.removeUp(upIdx); var b = li.closest(".fp-queue"); if (b) paintQueue(b); }, I.x));
    return li;
  }

  // ---------- 8. Dialogs, toasts, keyboard ----------
  function makeDialog(id, cls) {
    var old = $(id);
    if (old) { try { old.close(); } catch (e) {} old.remove(); }
    var dlg = el("dialog", cls || "");
    dlg.id = id;
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () { parkToast(); setTimeout(function () { if (!dlg.open) dlg.remove(); }, 0); });
    return dlg;
  }
  function openDialog(dlg) { document.body.appendChild(dlg); dlg.showModal(); }
  // items: [[label, fn, danger?]]
  function menuDlg(items, title, sub) {
    var dlg = makeDialog("mu-menu", "menu-dlg");
    if (title) dlg.appendChild(el("h2", "dlg-title", title));
    if (sub) dlg.appendChild(el("p", "dim small dlg-sub", sub));
    var col = el("div", "menu-col");
    items.forEach(function (x) { col.appendChild(button(x[0], x[2] ? "danger" : "", function () { dlg.close(); x[1](); })); });
    col.appendChild(button(t("cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(col);
    openDialog(dlg);
  }
  function promptDlg(title, label, value, okLabel, fn) {
    var dlg = makeDialog("mu-prompt", "menu-dlg");
    var form = el("form", "");
    form.method = "dialog";
    form.appendChild(el("h2", "dlg-title", title));
    var lab = el("label", "field");
    lab.appendChild(el("span", "dim small", label));
    var inp = el("input");
    inp.type = "text"; inp.maxLength = C.LIM.plName; inp.value = value || "";
    lab.appendChild(inp);
    form.appendChild(lab);
    var row = el("div", "dlg-btns");
    row.appendChild(button(t("cancel"), "txt-btn", function () { dlg.close(); }));
    var ok = el("button", "txt-btn accent", okLabel);
    ok.type = "submit";
    row.appendChild(ok);
    form.appendChild(row);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = C.clean(inp.value, C.LIM.plName);
      if (!v) { inp.focus(); return; }
      dlg.close();
      fn(v);
    });
    dlg.appendChild(form);
    openDialog(dlg);
    inp.focus(); inp.select();
  }
  function confirmDlg(text, okLabel, fn) {
    var dlg = makeDialog("mu-confirm", "menu-dlg");
    dlg.appendChild(el("p", "confirm-text", text));
    var row = el("div", "dlg-btns");
    row.appendChild(button(t("cancel"), "txt-btn", function () { dlg.close(); }));
    row.appendChild(button(okLabel, "txt-btn danger", function () { dlg.close(); fn(); }));
    dlg.appendChild(row);
    openDialog(dlg);
  }
  function settingsDlg() {
    var dlg = makeDialog("mu-settings", "menu-dlg");
    dlg.appendChild(el("h2", "dlg-title", t("s.title")));
    dlg.appendChild(el("p", "dim small", t("s.stats", { n: tracks.length, a: albumsAll().length, r: artistsAll().length })));
    var lab = el("label", "field");
    lab.appendChild(el("span", "dim small", t("s.legacy")));
    var sel = el("select");
    [["auto", "s.legacyAuto"], ["el", "s.legacyEl"], ["latin", "s.legacyLatin"]].forEach(function (x) {
      var o = el("option", "", t(x[1])); o.value = x[0]; if (prefs.legacy === x[0]) o.selected = true; sel.appendChild(o);
    });
    sel.addEventListener("change", function () { prefs.legacy = sel.value; savePrefs(); dlg.close(); rescan(true); });
    lab.appendChild(sel);
    dlg.appendChild(lab);
    var col = el("div", "menu-col");
    col.appendChild(button(t("s.rescan"), "", function () { dlg.close(); rescan(true); }));
    col.appendChild(el("p", "dim small", t("s.rescanHint")));
    col.appendChild(button(t("s.folder"), "", function () { dlg.close(); openInFiles(); }));
    dlg.appendChild(col);
    dlg.appendChild(el("p", "dim small keys", t("s.keys")));
    var row = el("div", "dlg-btns");
    row.appendChild(button(t("close"), "txt-btn", function () { dlg.close(); }));
    dlg.appendChild(row);
    openDialog(dlg);
  }
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" && n.transient({ ns: "music", title: String(text) })) return;
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
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || !H) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (tag === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
      var st = H.getState();
      if (!st.cur) return;
      if (e.key === " ") { e.preventDefault(); H.toggle(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); if (e.shiftKey) H.prev(); else H.seekBy(-10); }
      else if (e.key === "ArrowRight") { e.preventDefault(); if (e.shiftKey) H.next(); else H.seekBy(10); }
      else if (e.key === "s" || e.key === "S") H.setShuffle(!st.shf);
      else if (e.key === "r" || e.key === "R") H.cycleRepeat();
      else if (e.key === "l" || e.key === "L") { toggleLike(st.cur); renderKeepScroll(); }
    });
  }
  // Drop files anywhere on the window to add them.
  function wireDrop() {
    var depth = 0, box = $("drop");
    var has = function (e) { return e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], "Files") >= 0; };
    document.addEventListener("dragenter", function (e) { if (!has(e)) return; depth++; box.hidden = false; });
    document.addEventListener("dragleave", function () { depth = Math.max(0, depth - 1); if (!depth) box.hidden = true; });
    document.addEventListener("dragover", function (e) { if (has(e)) e.preventDefault(); });
    document.addEventListener("drop", function (e) {
      if (!has(e)) return;
      e.preventDefault();
      depth = 0; box.hidden = true;
      var files = [].slice.call(e.dataTransfer.files || []);
      if (files.length) addFiles(files);
    });
  }

  // ---------- 9. Palette ----------
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

  // ---------- 10. Wiring & boot ----------
  function applyI18n() {
    document.title = t("app") + " · orOS";
    document.documentElement.lang = LANG;
    $("app-name").textContent = t("app");
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-ic]"), function (n) { n.innerHTML = I[n.getAttribute("data-ic")] || ""; });
    var ib = function (id, icon, label) { var b = $(id); b.innerHTML = icon; b.setAttribute("aria-label", label); b.title = label; };
    ib("back-btn", I.left, t("btn.back"));
    ib("add-btn", I.plus, t("btn.add"));
    ib("more-btn", I.gear, t("btn.more"));
    ib("pl-next", I.next, t("next"));
    ib("pl-play", I.play, t("play"));
    ib("pl-like", I.heart, t("like"));
    $("pl-open").setAttribute("aria-label", t("q.now"));
  }
  function wire() {
    [].forEach.call(document.querySelectorAll("#tabs [data-tab]"), function (b) {
      b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
    });
    $("back-btn").addEventListener("click", goBack);
    $("add-btn").addEventListener("click", addMenu);
    $("more-btn").addEventListener("click", settingsDlg);
    $("pl-play").addEventListener("click", function () { if (H) H.toggle(); });
    $("pl-next").addEventListener("click", function () { if (H) H.next(); });
    $("pl-like").addEventListener("click", function () { var c = H && H.getState().cur; if (c) { toggleLike(c); renderKeepScroll(); } });
    $("pl-open").addEventListener("click", fullPlayer);
    wireKeyboard();
    wireDrop();
  }
  var paintTimer = null;
  function onHost(ev) {
    if (ev === "time") {
      if (paintTimer) return;
      paintTimer = setTimeout(function () { paintTimer = null; paintPlayer(); }, 250);
      return;
    }
    if (ev === "data") { renderKeepScroll(); return; }
    if (ev === "index") { loadIndex().then(renderKeepScroll); return; }
    if (ev === "error") { var st = H.getState(); if (st.error && st.error !== "NotAllowedError") showToast(t("toast.cant")); }
    paintPlayer();
    paintPlaying();
    var full = $("mu-full");
    if (full && full.open && full._paint) full._paint(ev === "load" || ev === "queue" || ev === "data");
  }
  // Deep links (shell __orosOpenAt / __orosTakeTarget): { album } |
  // { artist } | { pl } | { liked: 1 } | { track } (plays it).
  function openTarget(tg) {
    if (!H || !tg || typeof tg !== "object" || document.querySelector("dialog[open]")) return;
    view = null; history = [];
    if (typeof tg.album === "string") openView({ kind: "album", id: tg.album });
    else if (typeof tg.artist === "string") openView({ kind: "artist", id: tg.artist });
    else if (typeof tg.pl === "string" && C.findPl(D(), tg.pl)) openView({ kind: "pl", id: tg.pl });
    else if (tg.liked) openView({ kind: "liked" });
    else if (typeof tg.track === "string") {
      var r = resolve({ k: tg.track });
      if (r) {
        var al = C.albumKey(r) && albumsAll().filter(function (a) { return a.k === C.albumKey(r); })[0];
        if (al) { openView({ kind: "album", id: al.k }); playRows(al.list, al.list.indexOf(r), { kind: "album", id: al.k, n: al.n }, false); }
        else playRows([r], 0, { kind: "song", id: r.k, n: r.t }, false);
      }
    }
  }
  window.__orosOpenAt = openTarget;

  function boot() {
    inheritPalette();
    watchPalette();
    applyI18n();
    wire();
    if (!C || !ST || !LIB) { $("main").appendChild(el("div", "empty", t("toast.err", { c: "load" }))); return; }
    attach().then(function (api) {
      if (!api) { $("main").appendChild(el("div", "empty", t("toast.err", { c: "host" }))); return; }
      H = api;
      unsub = H.subscribe(onHost);
      window.addEventListener("pagehide", function () { if (unsub) unsub(); });
      return loadIndex().then(function () {
        renderAll();
        var tg = null;
        try {
          if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function") tg = window.parent.__orosTakeTarget("music");
        } catch (e) {}
        if (tg) openTarget(tg);
        // New or changed files in Files › Music since last time.
        return rescan(false);
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
