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
//     sort, old-tag encoding, LRCLIB yes/no), lyrics found online
//     "oros-music-lyrics"; the sound settings live in the host
//     ("oros-music-sound": equalizer, crossfade, ReplayGain)
// Sections:
//   1. Constants, i18n, helpers
//   2. Host (attach / inject into the shell)
//   3. Library index + covers
//   4. Actions (play, like, playlists, add, delete)
//   5. Views: home, search, library, pages
//   6. Rows, cards, menus
//   7. Player bar + full player + queue
//  7b. Lyrics, sound, sleep timer
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
      "empty.soon": "Or listen to free music from open catalogues below.",
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
      "liked.empty": "Songs you like appear here. Tap the heart on any song.",
      "home.free": "Free music", "home.freeSub": "Open catalogues: Jamendo, Internet Archive, Openverse and ccMixter. Every song shows its licence.",
      "home.genres": "Free music by genre", "kind.free": "Free music", "home.moods": "Moods (Jamendo)", "kind.mood": "Mood",
      "o.title": "Free music online", "o.all": "All", "o.loading": "Loading…", "o.more": "Show more", "o.none": "Nothing found here.",
      "o.err": "No answer from {s}.", "o.busy": "Too many requests to {s}. Try again in a minute.", "o.offline": "You are offline.",
      "o.retry": "Try again", "o.closed": "This item has no open licence, so Music does not play it.", "o.wait": "Searching online…",
      "o.albums": "Albums · {s}", "o.songs": "Songs · {s}",
      "m.credit": "Copy credit", "m.source": "Open on {s}", "m.saveOff": "Save for offline", "m.delOff": "Remove offline copy",
      "m.saveAlbum": "Save album for offline",
      "toast.copied": "Credit copied.", "toast.offSaving": "Saving {n} for offline…", "toast.offSaved": "{n} saved for offline.",
      "toast.offFail": "{n} could not be saved: the source does not allow downloads from the browser.",
      "toast.offNo": "The licence or the source does not allow an offline copy of this song.", "toast.offHave": "Already saved for offline.",
      "toast.offDel": "Offline copy removed.", "toast.offDels": "Offline copies removed.",
      "lib.offline": "Offline", "off.empty": "Songs from the free catalogues that you save for offline appear here.", "off.badge": "Saved for offline",
      "s.open": "Free music online (Jamendo, Internet Archive, Openverse, ccMixter)",
      "s.openHint": "Only when you browse or search. The requests go straight to those services, with no account and no tracking.",
      "s.offInfo": "Offline copies: {n} · {s}", "s.offClear": "Delete all offline copies",
      "s.offClearQ": "Delete all offline copies ({n})? The songs stay in your playlists and play online.",
      "info.source": "Source", "info.licence": "Licence", "info.page": "Page", "info.credit": "Credit",
      "lib.servers": "Servers", "home.servers": "Your servers", "home.newOn": "New on {n}",
      "sv.connect": "Connect a server", "sv.import": "Import a playlist (M3U, PLS, XSPF)", "sv.feedAdd": "Add a music feed (RSS)",
      "sv.type": "Kind of server", "sv.name": "Name (shown in Music)", "sv.addr": "Address", "sv.user": "User name", "sv.pass": "Password",
      "sv.tok": "Access token (optional)", "sv.dir": "Folder (optional)", "sv.go": "Connect", "sv.busy": "Connecting…",
      "sv.h.subsonic": "Navidrome, Airsonic, Gonic, Ampache and other Subsonic servers. The password itself is not kept, only a salted token.",
      "sv.h.jellyfin": "Signs in once and keeps only the access token the server gives back.",
      "sv.h.funkwhale": "Public pods work without a login. For your own library, create a token in Funkwhale › Settings › Applications (read access).",
      "sv.h.webdav": "For Nextcloud, copy the WebDAV address from Files › Settings and use an app password. The server must allow requests from orOS (CORS).",
      "sv.h.dropbox": "Uses the Dropbox connection of the Files app: connect Dropbox there first.",
      "sv.h.all": "The address and the login stay on this device, sealed, and are never synced.",
      "sv.ok": "Connected to “{n}”.", "sv.kind": "Server", "sv.albums": "Albums", "sv.artists": "Artists", "sv.pls": "Playlists",
      "sv.all": "Show all", "sv.random": "Shuffle the server", "sv.lists": "Playlist files",
      "sv.rename": "Rename", "sv.remove": "Remove from this device", "sv.removed": "Removed.",
      "sv.removeQ": "Remove “{n}” from this device? Its login is deleted. Its songs stay in your playlists and play again when you connect it again.",
      "sv.none": "No servers yet. Connect Navidrome, Jellyfin, Funkwhale, Nextcloud (WebDAV) or a Dropbox folder.",
      "sv.feeds": "Music feeds",
      "sv.e.auth": "The server did not accept the login. Check the user name and the password (or token).",
      "sv.e.net": "No answer from {s}. Check the address, and that the server allows requests from orOS (CORS).",
      "sv.e.http": "Browsers block plain http:// addresses here. Use https:// (a server on this computer works with http).",
      "sv.e.address": "This is not a web address.", "sv.e.login": "Fill in the user name and the password.",
      "sv.e.dropbox": "Connect Dropbox in the Files app first (Files › Dropbox), then try again.",
      "sv.e.notfound": "Nothing found there. Check the address and the folder.", "sv.e.format": "That address did not answer like a {s} server.",
      "sv.e.version": "This server is too old for Music.", "sv.e.timeout": "{s} took too long to answer.",
      "sv.e.seal": "This browser cannot keep the login safely (a private window?).", "sv.e.perm": "This user may not do that on the server.",
      "sv.e.gone": "This server is not connected on this device.", "sv.openFiles": "Open Files",
      "missing.sv": "From a server not connected here",
      "missing.svToast": "This song is on a server that is not connected on this device. Connect it in Your library › Servers.",
      "imp.file": "From a file", "imp.url": "From an address", "imp.urlPh": "Address of the playlist (https://…)", "imp.go": "Import",
      "imp.done": "Playlist “{n}” created: {k}.", "imp.miss": "{n} entries were not found and were left out.", "imp.none": "None of the songs of this playlist could be found.",
      "feed.ph": "Address of the feed (https://…)", "feed.add": "Add", "feed.none": "This feed has no songs.", "feed.err": "This address is not a feed.",
      "feed.added": "Feed added.", "feed.kind": "Music feed", "feed.remove": "Remove feed", "feed.removed": "Feed removed.", "feed.site": "Open website",
      "info.server": "Server", "m.page": "Open page",
      "ly.btn": "Lyrics", "ly.wait": "Looking for lyrics…", "ly.none": "No lyrics found for this song.", "ly.instr": "This song is instrumental.",
      "ly.err": "LRCLIB did not answer. Try again later.", "ly.offline": "You are offline, so Music cannot look for lyrics online.",
      "ly.askT": "Find lyrics online?", "ly.ask": "Music can ask LRCLIB (lrclib.net, free and open) for the lyrics. It sends only the song's title, artist, album and length.",
      "ly.yes": "Look up lyrics", "ly.no": "Not now", "ly.from": "Lyrics: {s}", "ly.file": "the .lrc file next to the song", "ly.tags": "the song's tags",
      "ly.plain": "These lyrics have no timing, so they do not follow the song.", "ly.retry": "Look again",
      "snd.btn": "Sound", "snd.title": "Sound", "snd.eq": "Equalizer", "snd.preset": "Preset", "snd.custom": "Custom",
      "snd.eqHint": "The equalizer works on songs on this device, songs saved offline and songs from WebDAV or Dropbox. Songs that stream from other sites play without it.",
      "snd.eqOff": "This song streams from another site, so the equalizer does not change it.",
      "snd.xf": "Crossfade", "snd.xfOff": "Off", "snd.xfS": "{n} s", "snd.gap": "Gapless playback (the next song is loaded before this one ends)",
      "snd.rg": "Same volume for every song (ReplayGain)", "snd.rgOff": "Off", "snd.rgAuto": "Automatic (album gain when you play an album)",
      "snd.rgTrack": "Track gain", "snd.rgAlbum": "Album gain", "snd.rgHint": "It uses the ReplayGain tags in your files. Songs without them keep their volume.",
      "snd.reset": "Reset", "snd.hz": "{n} Hz", "snd.khz": "{n} kHz",
      "eq.flat": "Flat", "eq.bass": "Bass boost", "eq.treble": "Treble boost", "eq.vocal": "Vocal", "eq.rock": "Rock", "eq.pop": "Pop", "eq.jazz": "Jazz",
      "eq.classical": "Classical", "eq.electronic": "Electronic", "eq.loud": "Loudness", "eq.small": "Small speakers", "eq.night": "Late night (soft)",
      "sl.btn": "Sleep timer", "sl.title": "Sleep timer", "sl.min": "{n} minutes", "sl.end": "End of this song", "sl.off": "Turn off the timer",
      "sl.left": "Stops in {n}", "sl.leftEnd": "Stops after this song", "sl.set": "The music stops in {n}.", "sl.setEnd": "The music stops after this song.",
      "sl.cleared": "Sleep timer off.", "s.lrclib": "Look up lyrics online (LRCLIB)", "s.lrclibHint": "Sends the title, artist, album and length of the song you open lyrics for."
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
      "empty.soon": "Ή άκου ελεύθερη μουσική από ανοιχτούς καταλόγους παρακάτω.",
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
      "liked.empty": "Τα τραγούδια που σου αρέσουν εμφανίζονται εδώ. Πάτησε την καρδιά σε οποιοδήποτε τραγούδι.",
      "home.free": "Ελεύθερη μουσική", "home.freeSub": "Ανοιχτοί κατάλογοι: Jamendo, Internet Archive, Openverse και ccMixter. Κάθε τραγούδι δείχνει την άδειά του.",
      "home.genres": "Ελεύθερη μουσική ανά είδος", "kind.free": "Ελεύθερη μουσική", "home.moods": "Διάθεση (Jamendo)", "kind.mood": "Διάθεση",
      "o.title": "Ελεύθερη μουσική online", "o.all": "Όλα", "o.loading": "Φόρτωση…", "o.more": "Δείξε περισσότερα", "o.none": "Δεν βρέθηκε τίποτα εδώ.",
      "o.err": "Δεν ήρθε απάντηση από {s}.", "o.busy": "Πολλά αιτήματα προς {s}. Δοκίμασε ξανά σε ένα λεπτό.", "o.offline": "Δεν υπάρχει σύνδεση.",
      "o.retry": "Δοκίμασε ξανά", "o.closed": "Αυτό δεν έχει ανοιχτή άδεια, οπότε η Μουσική δεν το παίζει.", "o.wait": "Αναζήτηση online…",
      "o.albums": "Άλμπουμ · {s}", "o.songs": "Τραγούδια · {s}",
      "m.credit": "Αντιγραφή αναφοράς", "m.source": "Άνοιγμα στο {s}", "m.saveOff": "Αποθήκευση για χωρίς σύνδεση", "m.delOff": "Αφαίρεση αντιγράφου",
      "m.saveAlbum": "Αποθήκευση άλμπουμ για χωρίς σύνδεση",
      "toast.copied": "Η αναφορά αντιγράφηκε.", "toast.offSaving": "Αποθήκευση: {n} για χωρίς σύνδεση…", "toast.offSaved": "Αποθηκεύτηκαν για χωρίς σύνδεση: {n}.",
      "toast.offFail": "Δεν αποθηκεύτηκαν {n}: η πηγή δεν επιτρέπει λήψη από τον browser.",
      "toast.offNo": "Η άδεια ή η πηγή δεν επιτρέπει αντίγραφο χωρίς σύνδεση για αυτό το τραγούδι.", "toast.offHave": "Είναι ήδη αποθηκευμένο για χωρίς σύνδεση.",
      "toast.offDel": "Το αντίγραφο αφαιρέθηκε.", "toast.offDels": "Τα αντίγραφα αφαιρέθηκαν.",
      "lib.offline": "Χωρίς σύνδεση", "off.empty": "Εδώ εμφανίζονται τα τραγούδια από τους ελεύθερους καταλόγους που αποθηκεύεις για χωρίς σύνδεση.", "off.badge": "Αποθηκευμένο για χωρίς σύνδεση",
      "s.open": "Ελεύθερη μουσική online (Jamendo, Internet Archive, Openverse, ccMixter)",
      "s.openHint": "Μόνο όταν περιηγείσαι ή ψάχνεις. Τα αιτήματα πάνε κατευθείαν σε αυτές τις υπηρεσίες, χωρίς λογαριασμό και χωρίς παρακολούθηση.",
      "s.offInfo": "Αντίγραφα χωρίς σύνδεση: {n} · {s}", "s.offClear": "Διαγραφή όλων των αντιγράφων",
      "s.offClearQ": "Να διαγραφούν όλα τα αντίγραφα χωρίς σύνδεση ({n}); Τα τραγούδια μένουν στις λίστες σου και παίζουν online.",
      "info.source": "Πηγή", "info.licence": "Άδεια", "info.page": "Σελίδα", "info.credit": "Αναφορά",
      "lib.servers": "Servers", "home.servers": "Οι servers σου", "home.newOn": "Νέα στο {n}",
      "sv.connect": "Σύνδεση server", "sv.import": "Εισαγωγή λίστας (M3U, PLS, XSPF)", "sv.feedAdd": "Προσθήκη feed μουσικής (RSS)",
      "sv.type": "Είδος server", "sv.name": "Όνομα (όπως φαίνεται στη Μουσική)", "sv.addr": "Διεύθυνση", "sv.user": "Όνομα χρήστη", "sv.pass": "Κωδικός",
      "sv.tok": "Token πρόσβασης (προαιρετικό)", "sv.dir": "Φάκελος (προαιρετικό)", "sv.go": "Σύνδεση", "sv.busy": "Σύνδεση…",
      "sv.h.subsonic": "Navidrome, Airsonic, Gonic, Ampache και άλλοι servers Subsonic. Ο ίδιος ο κωδικός δεν κρατιέται, μόνο ένα token με salt.",
      "sv.h.jellyfin": "Συνδέεται μία φορά και κρατά μόνο το token πρόσβασης που δίνει ο server.",
      "sv.h.funkwhale": "Τα δημόσια pods δουλεύουν χωρίς σύνδεση. Για τη δική σου βιβλιοθήκη, φτιάξε ένα token στο Funkwhale › Settings › Applications (πρόσβαση ανάγνωσης).",
      "sv.h.webdav": "Για το Nextcloud, αντέγραψε τη διεύθυνση WebDAV από τα Files › Settings και χρησιμοποίησε κωδικό εφαρμογής. Ο server πρέπει να δέχεται αιτήματα από το orOS (CORS).",
      "sv.h.dropbox": "Χρησιμοποιεί τη σύνδεση Dropbox της εφαρμογής Αρχεία: σύνδεσε πρώτα εκεί το Dropbox.",
      "sv.h.all": "Η διεύθυνση και τα στοιχεία σύνδεσης μένουν σε αυτή τη συσκευή, κλειδωμένα, και δεν συγχρονίζονται ποτέ.",
      "sv.ok": "Συνδέθηκε το «{n}».", "sv.kind": "Server", "sv.albums": "Άλμπουμ", "sv.artists": "Καλλιτέχνες", "sv.pls": "Λίστες",
      "sv.all": "Δείξε όλα", "sv.random": "Τυχαία από τον server", "sv.lists": "Αρχεία λιστών",
      "sv.rename": "Μετονομασία", "sv.remove": "Αφαίρεση από αυτή τη συσκευή", "sv.removed": "Αφαιρέθηκε.",
      "sv.removeQ": "Να αφαιρεθεί το «{n}» από αυτή τη συσκευή; Τα στοιχεία σύνδεσης διαγράφονται. Τα τραγούδια του μένουν στις λίστες σου και ξαναπαίζουν όταν το συνδέσεις ξανά.",
      "sv.none": "Δεν υπάρχουν servers ακόμα. Σύνδεσε Navidrome, Jellyfin, Funkwhale, Nextcloud (WebDAV) ή έναν φάκελο του Dropbox.",
      "sv.feeds": "Feeds μουσικής",
      "sv.e.auth": "Ο server δεν δέχτηκε τη σύνδεση. Έλεγξε το όνομα χρήστη και τον κωδικό (ή το token).",
      "sv.e.net": "Δεν ήρθε απάντηση από {s}. Έλεγξε τη διεύθυνση και ότι ο server δέχεται αιτήματα από το orOS (CORS).",
      "sv.e.http": "Οι browsers μπλοκάρουν εδώ τις διευθύνσεις http://. Χρησιμοποίησε https:// (ένας server σε αυτόν τον υπολογιστή δουλεύει και με http).",
      "sv.e.address": "Αυτή δεν είναι διεύθυνση ιστού.", "sv.e.login": "Συμπλήρωσε το όνομα χρήστη και τον κωδικό.",
      "sv.e.dropbox": "Σύνδεσε πρώτα το Dropbox στην εφαρμογή Αρχεία (Αρχεία › Dropbox) και δοκίμασε ξανά.",
      "sv.e.notfound": "Δεν βρέθηκε τίποτα εκεί. Έλεγξε τη διεύθυνση και τον φάκελο.", "sv.e.format": "Αυτή η διεύθυνση δεν απάντησε σαν server {s}.",
      "sv.e.version": "Αυτός ο server είναι πολύ παλιός για τη Μουσική.", "sv.e.timeout": "Το {s} άργησε πολύ να απαντήσει.",
      "sv.e.seal": "Αυτός ο browser δεν μπορεί να κρατήσει τα στοιχεία σύνδεσης με ασφάλεια (ιδιωτικό παράθυρο;).", "sv.e.perm": "Αυτός ο χρήστης δεν έχει δικαίωμα για αυτό στον server.",
      "sv.e.gone": "Αυτός ο server δεν είναι συνδεδεμένος σε αυτή τη συσκευή.", "sv.openFiles": "Άνοιγμα Αρχείων",
      "missing.sv": "Από server που δεν είναι συνδεδεμένος εδώ",
      "missing.svToast": "Αυτό το τραγούδι είναι σε server που δεν είναι συνδεδεμένος σε αυτή τη συσκευή. Σύνδεσέ τον από το «Η βιβλιοθήκη σου › Servers».",
      "imp.file": "Από αρχείο", "imp.url": "Από διεύθυνση", "imp.urlPh": "Διεύθυνση της λίστας (https://…)", "imp.go": "Εισαγωγή",
      "imp.done": "Δημιουργήθηκε η λίστα «{n}»: {k}.", "imp.miss": "{n} εγγραφές δεν βρέθηκαν και αφέθηκαν έξω.", "imp.none": "Δεν βρέθηκε κανένα τραγούδι αυτής της λίστας.",
      "feed.ph": "Διεύθυνση του feed (https://…)", "feed.add": "Προσθήκη", "feed.none": "Αυτό το feed δεν έχει τραγούδια.", "feed.err": "Αυτή η διεύθυνση δεν είναι feed.",
      "feed.added": "Το feed προστέθηκε.", "feed.kind": "Feed μουσικής", "feed.remove": "Αφαίρεση feed", "feed.removed": "Το feed αφαιρέθηκε.", "feed.site": "Άνοιγμα ιστότοπου",
      "info.server": "Server", "m.page": "Άνοιγμα σελίδας",
      "ly.btn": "Στίχοι", "ly.wait": "Ψάχνω τους στίχους…", "ly.none": "Δεν βρέθηκαν στίχοι για αυτό το τραγούδι.", "ly.instr": "Αυτό το τραγούδι είναι ορχηστρικό.",
      "ly.err": "Το LRCLIB δεν απάντησε. Δοκίμασε ξανά αργότερα.", "ly.offline": "Είσαι εκτός σύνδεσης, οπότε η Μουσική δεν μπορεί να ψάξει στίχους online.",
      "ly.askT": "Να βρω τους στίχους online;", "ly.ask": "Η Μουσική μπορεί να ζητήσει τους στίχους από το LRCLIB (lrclib.net, δωρεάν και ανοιχτό). Στέλνει μόνο τον τίτλο, τον καλλιτέχνη, το άλμπουμ και τη διάρκεια του τραγουδιού.",
      "ly.yes": "Βρες τους στίχους", "ly.no": "Όχι τώρα", "ly.from": "Στίχοι: {s}", "ly.file": "το αρχείο .lrc δίπλα στο τραγούδι", "ly.tags": "οι ετικέτες του τραγουδιού",
      "ly.plain": "Αυτοί οι στίχοι δεν έχουν χρόνους, οπότε δεν ακολουθούν το τραγούδι.", "ly.retry": "Ψάξε ξανά",
      "snd.btn": "Ήχος", "snd.title": "Ήχος", "snd.eq": "Ισοσταθμιστής", "snd.preset": "Προεπιλογή", "snd.custom": "Δική μου",
      "snd.eqHint": "Ο ισοσταθμιστής δουλεύει στα τραγούδια αυτής της συσκευής, σε όσα αποθήκευσες για χωρίς σύνδεση και σε όσα έρχονται από WebDAV ή Dropbox. Τα τραγούδια που παίζουν από άλλους ιστότοπους παίζουν χωρίς αυτόν.",
      "snd.eqOff": "Αυτό το τραγούδι παίζει από άλλον ιστότοπο, οπότε ο ισοσταθμιστής δεν το αλλάζει.",
      "snd.xf": "Crossfade (σβήσιμο από το ένα στο άλλο)", "snd.xfOff": "Ανενεργό", "snd.xfS": "{n} δευτ.", "snd.gap": "Αναπαραγωγή χωρίς κενά (το επόμενο τραγούδι φορτώνει πριν τελειώσει αυτό)",
      "snd.rg": "Ίδια ένταση σε όλα τα τραγούδια (ReplayGain)", "snd.rgOff": "Ανενεργό", "snd.rgAuto": "Αυτόματα (ένταση άλμπουμ όταν παίζεις άλμπουμ)",
      "snd.rgTrack": "Ένταση τραγουδιού", "snd.rgAlbum": "Ένταση άλμπουμ", "snd.rgHint": "Χρησιμοποιεί τις ετικέτες ReplayGain των αρχείων σου. Τα τραγούδια χωρίς αυτές κρατούν την ένταση που έχουν.",
      "snd.reset": "Επαναφορά", "snd.hz": "{n} Hz", "snd.khz": "{n} kHz",
      "eq.flat": "Επίπεδο", "eq.bass": "Περισσότερα μπάσα", "eq.treble": "Περισσότερα πρίμα", "eq.vocal": "Φωνή", "eq.rock": "Ροκ", "eq.pop": "Ποπ", "eq.jazz": "Τζαζ",
      "eq.classical": "Κλασική", "eq.electronic": "Ηλεκτρονική", "eq.loud": "Loudness", "eq.small": "Μικρά ηχεία", "eq.night": "Αργά το βράδυ (απαλό)",
      "sl.btn": "Χρονοδιακόπτης ύπνου", "sl.title": "Χρονοδιακόπτης ύπνου", "sl.min": "{n} λεπτά", "sl.end": "Στο τέλος αυτού του τραγουδιού", "sl.off": "Κλείσε τον χρονοδιακόπτη",
      "sl.left": "Σταματά σε {n}", "sl.leftEnd": "Σταματά μετά από αυτό το τραγούδι", "sl.set": "Η μουσική σταματά σε {n}.", "sl.setEnd": "Η μουσική σταματά μετά από αυτό το τραγούδι.",
      "sl.cleared": "Ο χρονοδιακόπτης ύπνου έκλεισε.", "s.lrclib": "Αναζήτηση στίχων online (LRCLIB)", "s.lrclibHint": "Στέλνει τον τίτλο, τον καλλιτέχνη, το άλμπουμ και τη διάρκεια του τραγουδιού που ανοίγεις τους στίχους του."
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
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
    rss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5"/></svg>',
    lyrics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M4 10h10M4 14h6"/><path d="M18 18V6l3-1"/><circle cx="16" cy="18" r="2"/></svg>',
    eq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 4v16M12 4v16M18 4v16"/><path d="M4 14h4M10 8h4M16 16h4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>'
  };

  // Device-local view prefs (R10): never synced.
  var prefs = (function () {
    var p = { tab: "home", lib: "pl", sort: "title", legacy: "auto", open: true, osrc: "all", ly: "" };
    try {
      var o = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (o && typeof o === "object") {
        if (["home", "search", "lib"].indexOf(o.tab) >= 0) p.tab = o.tab;
        if (["pl", "songs", "albums", "artists", "genres", "folders", "offline", "servers"].indexOf(o.lib) >= 0) p.lib = o.lib;
        if (["title", "artist", "album", "added"].indexOf(o.sort) >= 0) p.sort = o.sort;
        if (["auto", "el", "latin"].indexOf(o.legacy) >= 0) p.legacy = o.legacy;
        if (o.open === false) p.open = false;
        if (["all", "jm", "ia", "ov", "cc"].indexOf(o.osrc) >= 0) p.osrc = o.osrc;
        if (o.ly === "on" || o.ly === "off") p.ly = o.ly;
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
  // ---------- 3b. Open catalogues (open.js, wave 2) ----------
  var O = window.OrosMusicOpen || null;
  function openOn() { return !!(O && prefs.open); }
  // What plays for a row: the local file, else a song of an open
  // catalogue (it carries its own address), else nothing.
  function playable(x) {
    if (!x) return null;
    if (x.p) return x;
    var r = resolve(x);
    if (r) return r;
    if (C.isServer(x)) return svOn(x.sh) ? svShow(x) : null;
    return C.isRemote(x) ? x : null;
  }
  // A song of the open catalogues (not a link, not a server).
  function isOpen(r) { return !!(r && r.s && O && O.SOURCES[r.s]); }
  function srcName(s) { return O && O.SOURCES[s] ? O.SOURCES[s].name : ""; }
  // Offline copies on this device: key -> { k, sz, at, ref }.
  var offKeys = {};
  function loadOff() {
    if (!ST || typeof ST.offList !== "function") return Promise.resolve();
    return ST.offList().then(function (l) { offKeys = {}; l.forEach(function (x) { if (x && x.k) offKeys[x.k] = x; }); });
  }
  // Answers of the open catalogues, kept while the app is open so a
  // re-render shows them at once: key -> { list, page, more, busy, err, extra }.
  var feeds = {}, feedN = 0;
  function feed(key, fetcher) {
    var f = feeds[key];
    if (!f) {
      f = feeds[key] = { list: [], page: 0, more: true, busy: false, err: "", extra: null, fetcher: fetcher, n: ++feedN };
      var ks = Object.keys(feeds);
      if (ks.length > 60) ks.sort(function (a, b) { return feeds[a].n - feeds[b].n; }).slice(0, ks.length - 60).forEach(function (k) { if (!feeds[k].busy) delete feeds[k]; });
      feedMore(key);
    }
    return f;
  }
  function feedMore(key) {
    var f = feeds[key];
    if (!f || f.busy || !f.more) return;
    f.busy = true; f.err = "";
    var page = f.page + 1;
    f.fetcher(page).then(function (r) {
      f.busy = false; f.page = page;
      var seen = {}, got = (r && r.list) || [];
      f.list.forEach(function (x) { seen[x.k || x.id] = 1; });
      got.forEach(function (x) { var id = x.k || x.id; if (!seen[id]) { seen[id] = 1; f.list.push(x); } });
      f.more = !!(r && r.more) && got.length > 0;
      if (r && r.extra) f.extra = r.extra;
      renderKeepScroll();
    }, function (e) {
      f.busy = false; f.err = (e && e.code) || "net";
      renderKeepScroll();
    });
  }
  function fIa(o) { return function (page) { return O.iaSearch(Object.assign({}, o, { page: page })).then(function (r) { return { list: r.albums, more: r.more }; }); }; }
  function fOv(o) { return function (page) { return O.ovSearch(Object.assign({}, o, { page: page })).then(function (r) { return { list: r.tracks, more: r.more }; }); }; }
  function fCc(o) { return function (page) { return O.ccSearch(Object.assign({}, o, { page: page })).then(function (r) { return { list: r.tracks, more: r.more }; }); }; }
  function fJm(o) {
    return function (page) {
      var q = Object.assign({}, o, { page: page });
      if (o.albums) return O.jmAlbums(q).then(function (r) { return { list: r.albums, more: r.more }; });
      if (o.radios) return O.jmRadios().then(function (r) { return { list: r.radios, more: false }; });
      return O.jmTracks(q).then(function (r) { return { list: r.tracks, more: r.more }; });
    };
  }
  // An album page of Internet Archive (ia) or Jamendo (jm).
  function albumOf(sk, id) { return sk === "jm" ? O.jmAlbum(id) : O.iaAlbum(id); }
  function fAlbum(sk, id) { return function () { return albumOf(sk, id).then(function (r) { return { list: r.tracks, more: false, extra: r.album }; }); }; }
  function errText(code, s) {
    return code === "busy" ? t("o.busy", { s: s }) : code === "offline" ? t("o.offline") : code === "closed" ? t("o.closed") : t("o.err", { s: s });
  }
  // Loading / error / "show more" under a list of an open catalogue.
  function feedStatus(box, key, s, noMore) {
    var f = feeds[key];
    if (!f) return;
    if (f.busy) { box.appendChild(el("p", "dim small o-note", t("o.loading"))); return; }
    if (f.err) {
      var p = el("div", "o-note o-err");
      p.appendChild(el("span", "dim small", key.indexOf("sv|") === 0 ? svErr(f.err, s) : errText(f.err, s)));
      if (f.err !== "closed") p.appendChild(button(t("o.retry"), "pill small-pill", function () { f.more = true; feedMore(key); renderKeepScroll(); }));
      box.appendChild(p);
      return;
    }
    if (!f.list.length) { box.appendChild(el("p", "dim small o-note", t("o.none"))); return; }
    if (f.more && !noMore) box.appendChild(el("div", "o-note")).appendChild(button(t("o.more"), "pill small-pill", function () { feedMore(key); renderKeepScroll(); }));
  }
  function oAlbumCard(a) {
    var sk = a.s === "jm" ? "jm" : "ia";
    return card(cover(a.art, a.n, ""), a.n, a.a || srcName(sk), function () { openView({ kind: sk, id: a.id, n: a.n }); },
      function () {
        albumOf(sk, a.id).then(function (r) { playRows(r.tracks, -1, { kind: sk, id: a.id, n: r.album.n }, false); },
          function (e) { showToast(errText(e && e.code, srcName(sk))); });
      });
  }
  // A Jamendo radio: its stream address is asked for on play.
  function radioCard(x) {
    var go = function () {
      O.jmRadio(x).then(function (it) { playRows([it], 0, { kind: "jmradio", id: x.id, n: it.t }, false); },
        function (e) { showToast(errText(e && e.code, srcName("jm"))); });
    };
    return card(cover(x.art, x.n, ""), x.n, "Jamendo Radio", go, go);
  }
  // The album page of a song from an open catalogue, if it has one.
  function oAlbumView(r) {
    if (!r || !O) return null;
    if (r.s === "ia") { var ia = O.iaIdFromPage(r.pg); return ia ? { kind: "ia", id: ia, n: r.al } : null; }
    if (r.s === "jm" && r.ai) return { kind: "jm", id: r.ai, n: r.al };
    return null;
  }
  function oArtistId(r) {
    if (!r || !r.s) return "";
    if (r.s === "cc") { var u = O.ccUserFromPage(r.pg); return u ? "cc|" + u : ""; }
    if (r.s === "jm") return r.ri ? "jm|" + r.ri : "";
    return r.a ? r.s + "|" + r.a : "";
  }
  function freeSection(m) {
    if (!openOn()) return;
    var s1 = section(m, t("home.free"));
    s1.appendChild(el("p", "dim small sec-note", t("home.freeSub")));
    var row = el("div", "cards");
    O.BROWSE.forEach(function (b) {
      var name = b[LANG] || b.en;
      row.appendChild(card(cover("", b.id, "", I.globe), name, srcName(b.src), function () { openView({ kind: "browse", id: b.id }); }));
    });
    s1.appendChild(row);
    var s2 = section(m, t("home.genres"));
    var chips = el("div", "chips wrap");
    O.OPEN_GENRES.forEach(function (g) { chips.appendChild(button(LANG === "el" ? g[2] : g[1], "chip", function () { openView({ kind: "ogenre", id: g[0] }); })); });
    s2.appendChild(chips);
    var s3 = section(m, t("home.moods"));
    var mc = el("div", "chips wrap");
    O.MOODS.forEach(function (g) { mc.appendChild(button(LANG === "el" ? g[2] : g[1], "chip", function () { openView({ kind: "omood", id: g[0] }); })); });
    s3.appendChild(mc);
  }
  function copyText(text, ok) {
    var legacy = function () {
      var ta = el("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      (document.querySelector("dialog[open]") || document.body).appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) {}
      ta.remove();
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, legacy); return; }
    } catch (e) {}
    legacy();
  }
  function copyCredit(r) { copyText(O.credit(r, LANG), function () { showToast(t("toast.copied")); }); }
  function openExt(u) {
    if (!/^https:\/\//i.test(u || "")) return;
    var w = window.open(u, "_blank", "noopener,noreferrer");
    if (w) { try { w.opener = null; } catch (e) {} }
  }
  // Offline copies: only songs whose licence and source allow it
  // (off: 1), fetched straight from the source; one at a time.
  var offBusy = false;
  function saveOffline(list) {
    var allowed = list.filter(function (r) { return r && r.off === 1 && C.isRemote(r); });
    if (!allowed.length) { showToast(t("toast.offNo")); return; }
    var todo = allowed.filter(function (r) { return !offKeys[r.k]; });
    if (!todo.length) { showToast(t("toast.offHave")); return; }
    if (offBusy || !ST || typeof ST.putOff !== "function") return;
    offBusy = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
    showToast(t("toast.offSaving", { n: nSongs(todo.length) }));
    var ok = 0, bad = 0;
    todo.reduce(function (p, r) {
      return p.then(function () {
        return fetch(r.u, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" }).then(function (res) {
          if (!res.ok) throw new Error("http");
          return res.blob();
        }).then(function (b) {
          if (!b || !b.size || b.size > 300e6 || /^text\//i.test(b.type || "")) throw new Error("type");
          return ST.putOff({ k: r.k, blob: b, sz: b.size, at: Date.now(), ref: C.normRef(r) });
        }).then(function () { ok++; }, function () { bad++; });
      });
    }, Promise.resolve()).then(function () {
      offBusy = false;
      return loadOff();
    }).then(function () {
      renderKeepScroll();
      var msg = ok ? t("toast.offSaved", { n: nSongs(ok) }) : "";
      if (bad) msg = (msg ? msg + " " : "") + t("toast.offFail", { n: bad });
      showToast(msg);
    });
  }
  function delOffline(keys) {
    if (!keys.length || !ST || typeof ST.delOff !== "function") return;
    ST.delOff(keys).then(loadOff).then(function () { renderKeepScroll(); showToast(keys.length === 1 ? t("toast.offDel") : t("toast.offDels")); });
  }
  function offRows() {
    return Object.keys(offKeys).map(function (k) { return offKeys[k]; }).filter(function (x) { return x.ref; })
      .sort(function (a, b) { return b.at - a.at; }).map(function (x) { return x.ref; });
  }
  function offSize() { var n = 0; Object.keys(offKeys).forEach(function (k) { n += offKeys[k].sz || 0; }); return n; }

  // ---------- 3c. My servers, playlist files, music feeds (servers.js, wave 4) ----------
  var SV = window.OrosMusicServers || null;
  var FEEDS_KEY = "oros-music-feeds";        // device-local list of music feeds
  function svList() { return SV ? SV.servers() : []; }
  function svOn(id) { return !!(SV && SV.has(id)); }
  function svLib() { return svList().filter(function (x) { return SV.TYPES[x.ty].lib; }); }
  // A server song on screen gets its cover address (it carries the login, so it is never stored).
  function svShow(x) { var a = SV.coverUrl(x); return a ? Object.assign({}, x, { art: a }) : x; }
  function artOf(c) { return c && c.s === "sv" ? (SV ? SV.coverUrl(c) : "") : c && c.art; }
  function svName(id) { var x = SV && SV.get(id); return x ? x.n : ""; }
  // The shell keeps its own copy of servers.js (the player): it reads the list again.
  function svChanged() {
    try { var w = shellWin(); if (w && w.OrosMusicServers && w.OrosMusicServers !== SV) w.OrosMusicServers.reload(); } catch (e) {}
  }
  function svForget(id) { Object.keys(feeds).forEach(function (k) { if (k.indexOf("sv|" + id + "|") === 0 && !feeds[k].busy) delete feeds[k]; }); }
  var SV_ERR = { auth: "sv.e.auth", token: "sv.e.auth", "http-only": "sv.e.http", address: "sv.e.address", login: "sv.e.login",
    dropbox: "sv.e.dropbox", notfound: "sv.e.notfound", format: "sv.e.format", version: "sv.e.version", timeout: "sv.e.timeout",
    seal: "sv.e.seal", perm: "sv.e.perm", gone: "sv.e.gone", net: "sv.e.net" };
  function svErr(code, s) { return SV_ERR[code] ? t(SV_ERR[code], { s: s }) : errText(code, s); }
  // A list from a server, in the shape feed() keeps.
  function fSv(id, what, arg) {
    return function (page) {
      return SV.call(id, what, arg === undefined ? page : arg).then(function (r) {
        if (what === "album") return { list: r.tracks, more: false, extra: r.album };
        if (what === "artist") return { list: r.albums, more: false, extra: r.artist };
        if (what === "playlist") return { list: r.tracks, more: false, extra: r.pl };
        if (what === "search") return { list: r.songs, more: false, extra: { albums: r.albums, artists: r.artists } };
        if (what === "folder") return { list: r.songs, more: false, extra: { dirs: r.dirs, lists: r.lists } };
        return { list: r.list, more: !!r.more };
      });
    };
  }
  function svPair(v) { var i = String(v.id).indexOf("|"); return i > 0 ? { sid: v.id.slice(0, i), x: v.id.slice(i + 1) } : { sid: v.id, x: "" }; }
  function svAlbumCard(id, a) {
    var v = { kind: "sva", id: id + "|" + a.id, n: a.n };
    return card(cover(SV.albumCover(id, a.ca), a.n, ""), a.n, a.a || svName(id), function () { openView(v); }, function () {
      SV.call(id, "album", a.id).then(function (r) { playRows(r.tracks, -1, { kind: "sva", id: v.id, n: a.n }, false); },
        function (e) { showToast(svErr(e && e.code, svName(id))); });
    });
  }
  function svArtistCard(id, a) {
    return card(cover(SV.albumCover(id, a.ca), a.n, "round", I.user), a.n, t("kind.artist"), function () { openView({ kind: "svr", id: id + "|" + a.id, n: a.n }); });
  }
  function svPlCard(id, p) {
    return card(cover(SV.albumCover(id, p.ca), p.n, "", I.queue), p.n, p.c ? nSongs(p.c) : t("kind.pl"), function () { openView({ kind: "svp", id: id + "|" + p.id, n: p.n }); });
  }
  function svCard(x) { return card(cover("", x.id, "", I.server), x.n, SV.TYPES[x.ty].name, function () { openView({ kind: "sv", id: x.id }); }); }
  function svArtistLink(r, cls) {
    var a = el("button", "link " + (cls || ""), r.a || t("unknown.artist"));
    a.type = "button";
    if (r.ri) a.addEventListener("click", function (e) { e.stopPropagation(); openView({ kind: "svr", id: r.sh + "|" + r.ri, n: r.a }); });
    return a;
  }
  // Home: the servers, then the newest albums of the first three.
  function serverSection(m) {
    var l = svList();
    if (!l.length) return;
    var s0 = section(m, t("home.servers"));
    var row = el("div", "cards");
    l.forEach(function (x) { row.appendChild(svCard(x)); });
    s0.appendChild(row);
    svLib().slice(0, 3).forEach(function (x) {
      var k = "sv|" + x.id + "|albums", f = feed(k, fSv(x.id, "albums"));
      var sc = section(m, t("home.newOn", { n: x.n }), button(t("sv.all"), "txt-btn small", function () { openView({ kind: "svall", id: x.id }); }));
      if (f.list.length) { var r2 = el("div", "cards"); f.list.slice(0, 16).forEach(function (a) { r2.appendChild(svAlbumCard(x.id, a)); }); sc.appendChild(r2); }
      feedStatus(sc, k, x.n, true);
    });
  }
  // Search: songs, albums and artists of each server (asked once the typing stops).
  function serverResults(box, q) {
    svLib().slice(0, 5).forEach(function (x) {
      var sec = section(box, x.n);
      if (onlineQ !== q) { sec.appendChild(el("p", "dim small o-note", t("o.wait"))); return; }
      var k = "sv|" + x.id + "|s|" + q, f = feed(k, fSv(x.id, "search", q)), ex = f.extra || {};
      var al = ex.albums || [], ar = ex.artists || [];
      if (f.list.length) { sec.appendChild(el("h3", "sub-h", t("sec.songs"))); sec.appendChild(rowList(f.list, { src: { kind: "svsearch", id: x.id + "|" + q, n: q } })); }
      if (al.length) { sec.appendChild(el("h3", "sub-h", t("sec.albums"))); var ca = el("div", "cards"); al.forEach(function (a) { ca.appendChild(svAlbumCard(x.id, a)); }); sec.appendChild(ca); }
      if (ar.length) { sec.appendChild(el("h3", "sub-h", t("sec.artists"))); var cr = el("div", "cards"); ar.forEach(function (a) { cr.appendChild(svArtistCard(x.id, a)); }); sec.appendChild(cr); }
      if (f.busy || f.err) feedStatus(sec, k, x.n, true);
      else if (!f.list.length && !al.length && !ar.length) sec.appendChild(el("p", "dim small o-note", t("o.none")));
    });
  }
  // Your library › Servers: the servers and the music feeds.
  function renderServers(m) {
    var l = svList();
    var list = el("div", "lib-list");
    l.forEach(function (x) { list.appendChild(libRow(cover("", x.id, "sm", I.server), x.n, SV.TYPES[x.ty].name, function () { openView({ kind: "sv", id: x.id }); })); });
    list.appendChild(libRow(cover("", "+", "sm", I.plus), t("sv.connect"), "", function () { connectDlg(); }));
    m.appendChild(list);
    if (!l.length) m.appendChild(el("p", "dim small o-note", t("sv.none")));
    m.appendChild(el("h2", "sub-h", t("sv.feeds")));
    var lf = el("div", "lib-list");
    feedList().forEach(function (fd) { lf.appendChild(libRow(cover(fd.art, fd.n, "sm", I.rss), fd.n, t("feed.kind"), function () { openView({ kind: "rss", id: fd.u, n: fd.n }); })); });
    lf.appendChild(libRow(cover("", "+f", "sm", I.plus), t("sv.feedAdd"), "", feedDlg));
    lf.appendChild(libRow(cover("", "+m", "sm", I.plus), t("sv.import"), "", importMenu));
    m.appendChild(lf);
  }
  function cardRow(m, title, list, mk, more) {
    if (!list.length) return null;
    var sc = section(m, title, more);
    var row = el("div", "cards");
    list.forEach(function (x) { row.appendChild(mk(x)); });
    sc.appendChild(row);
    return sc;
  }
  function renderServer(m, v) {
    var pr = svPair(v), x = SV.get(pr.sid), src, k, f;
    if (!x) { m.appendChild(el("p", "empty", t("sv.e.gone"))); return; }
    var kind = SV.TYPES[x.ty].name;
    if (v.kind === "sv") {
      src = { kind: "sv", id: x.id, n: x.n };
      var more = button(t("more"), "icon-btn", function () { svMenu(x); }, I.more);
      if (!SV.TYPES[x.ty].lib) {
        pageHead(m, cover("", x.id, "big", I.server), t("sv.kind") + " · " + kind, x.n, el("div", "ph-sub dim", x.dir || "/"), null, src, [more]);
        svFolder(m, x, x.dir || "/");
        return;
      }
      var rnd = button(t("sv.random"), "icon-btn", function () {
        SV.call(x.id, "random").then(function (r) { playRows(r.list, -1, { kind: "svrand", id: x.id, n: x.n }, true); }, function (e) { showToast(svErr(e && e.code, x.n)); });
      }, I.shuffle);
      pageHead(m, cover("", x.id, "big", I.server), t("sv.kind") + " · " + kind, x.n, el("div", "ph-sub dim", x.b.replace(/^https?:\/\//, "")), null, src, [rnd, more]);
      var kA = "sv|" + x.id + "|albums", fA = feed(kA, fSv(x.id, "albums"));
      var sA = section(m, t("sv.albums"), button(t("sv.all"), "txt-btn small", function () { openView({ kind: "svall", id: x.id }); }));
      if (fA.list.length) { var ra = el("div", "cards"); fA.list.slice(0, 16).forEach(function (a) { ra.appendChild(svAlbumCard(x.id, a)); }); sA.appendChild(ra); }
      feedStatus(sA, kA, x.n, true);
      var fP = feed("sv|" + x.id + "|pls", fSv(x.id, "playlists"));
      cardRow(m, t("sv.pls"), fP.list, function (p) { return svPlCard(x.id, p); });
      var kR = "sv|" + x.id + "|artists", fR = feed(kR, fSv(x.id, "artists"));
      cardRow(m, t("sv.artists"), fR.list.slice(0, 16), function (a) { return svArtistCard(x.id, a); },
        button(t("sv.all"), "txt-btn small", function () { openView({ kind: "svar", id: x.id }); }));
    } else if (v.kind === "svall" || v.kind === "svar") {
      var arts = v.kind === "svar";
      src = { kind: v.kind, id: x.id, n: x.n };
      k = "sv|" + x.id + (arts ? "|artists" : "|albums");
      f = feed(k, fSv(x.id, arts ? "artists" : "albums"));
      pageHead(m, cover("", x.id, "big", I.server), x.n, arts ? t("sv.artists") : t("sv.albums"), null, null, src);
      var g = el("div", arts ? "lib-list" : "grid");
      f.list.forEach(function (a) {
        g.appendChild(arts ? libRow(cover(SV.albumCover(x.id, a.ca), a.n, "sm round", I.user), a.n, t("kind.artist"), function () { openView({ kind: "svr", id: x.id + "|" + a.id, n: a.n }); })
          : svAlbumCard(x.id, a));
      });
      m.appendChild(g);
      feedStatus(m, k, x.n);
    } else if (v.kind === "sva") {
      k = "sv|" + x.id + "|a|" + pr.x;
      f = feed(k, fSv(x.id, "album", pr.x));
      var al = f.extra || { id: pr.x, n: v.n || "", a: "", ri: "", ca: "" };
      src = { kind: "sva", id: v.id, n: al.n || v.n || "" };
      var sub = el("div", "ph-sub");
      if (al.a) sub.appendChild(svArtistLink({ sh: x.id, a: al.a, ri: al.ri }));
      sub.appendChild(el("span", "dim", [al.y || "", f.list.length ? nSongs(f.list.length) : "", totalTime(f.list)].filter(Boolean).join(" · ")));
      pageHead(m, cover(SV.albumCover(x.id, al.ca), al.n || v.n, "big"), t("kind.album") + " · " + x.n, al.n || v.n || "…", sub, f.list.length ? f.list : null, src,
        f.list.length ? [button(t("m.addPl"), "icon-btn", function () { addToPlaylist(f.list.map(C.normRef).filter(Boolean)); }, I.plus)] : null);
      if (f.list.length) m.appendChild(rowList(f.list, { src: src, numbers: true, noArt: true, noAlbum: true }));
      feedStatus(m, k, x.n);
    } else if (v.kind === "svr") {
      k = "sv|" + x.id + "|r|" + pr.x;
      f = feed(k, fSv(x.id, "artist", pr.x));
      var an = (f.extra && f.extra.n) || v.n || "…";
      src = { kind: "svr", id: v.id, n: an };
      pageHead(m, cover(SV.albumCover(x.id, f.extra && f.extra.ca), an, "big round", I.user), t("kind.artist") + " · " + x.n, an,
        f.list.length ? el("div", "ph-sub dim", nAlbums(f.list.length)) : null, null, src);
      var ga = el("div", "grid");
      f.list.forEach(function (a) { ga.appendChild(svAlbumCard(x.id, a)); });
      m.appendChild(ga);
      feedStatus(m, k, x.n);
    } else if (v.kind === "svp") {
      k = "sv|" + x.id + "|p|" + pr.x;
      f = feed(k, fSv(x.id, "playlist", pr.x));
      var pn = v.n || (f.extra && f.extra.n) || "…";
      src = { kind: "svp", id: v.id, n: pn };
      pageHead(m, collage(f.list, "big"), t("kind.pl") + " · " + x.n, pn, el("div", "ph-sub dim", [f.list.length ? nSongs(f.list.length) : "", totalTime(f.list)].filter(Boolean).join(" · ")),
        f.list.length ? f.list : null, src, f.list.length ? [button(t("m.addPl"), "icon-btn", function () { addToPlaylist(f.list.map(C.normRef).filter(Boolean)); }, I.plus)] : null);
      if (f.list.length) m.appendChild(rowList(f.list, { src: src }));
      feedStatus(m, k, x.n);
    } else if (v.kind === "svf") {
      m.appendChild(el("div", "crumbs dim small", x.n + (pr.x === "/" ? "" : pr.x)));
      svFolder(m, x, pr.x || "/");
    }
  }
  // A folder of a WebDAV or Dropbox server: sub-folders, playlist files, songs.
  function svFolder(m, x, dir) {
    var k = "sv|" + x.id + "|f|" + dir, f = feed(k, fSv(x.id, "folder", dir)), ex = f.extra || { dirs: [], lists: [] };
    var src = { kind: "svf", id: x.id + "|" + dir, n: dir === "/" ? x.n : dir.split("/").pop() };
    var lf = el("div", "lib-list");
    ex.dirs.forEach(function (d) { lf.appendChild(libRow(cover("", d.n, "sm", I.folder), d.n, "", function () { openView({ kind: "svf", id: x.id + "|" + d.p }); })); });
    ex.lists.forEach(function (pf) { lf.appendChild(libRow(cover("", pf.n, "sm", I.queue), pf.n, t("sv.lists"), function () { importServerList(x, dir, pf); })); });
    m.appendChild(lf);
    if (f.list.length) { m.appendChild(playBar(f.list, src)); m.appendChild(rowList(f.list, { src: src })); }
    if (f.busy || f.err) feedStatus(m, k, x.n, true);
    else if (!ex.dirs.length && !ex.lists.length && !f.list.length) m.appendChild(el("p", "empty", t("lib.empty")));
  }
  function svMenu(x) {
    menuDlg([
      [t("sv.rename"), function () {
        promptDlg(t("sv.rename"), t("sv.name"), x.n, t("pl.save"), function (n) { SV.rename(x.id, n); svChanged(); renderKeepScroll(); });
      }],
      [t("sv.remove"), function () {
        confirmDlg(t("sv.removeQ", { n: x.n }), t("sv.remove"), function () {
          SV.remove(x.id).then(function () { svChanged(); svForget(x.id); view = null; history = []; prefs.lib = "servers"; setTab("lib"); showToast(t("sv.removed")); });
        });
      }, true]
    ], x.n, SV.TYPES[x.ty].name);
  }
  function openApp(id, target) {
    try { var f = window.parent && window.parent.__orosOpenAt; if (typeof f === "function") f(id, target || {}); } catch (e) {}
  }
  function connectDlg(preTy) {
    if (!SV) return;
    var dlg = makeDialog("mu-connect", "menu-dlg");
    var form = el("form", "");
    form.method = "dialog";
    form.appendChild(el("h2", "dlg-title", t("sv.connect")));
    var field = function (label, inp) { var lab = el("label", "field"); lab.appendChild(el("span", "dim small", label)); lab.appendChild(inp); form.appendChild(lab); return lab; };
    var sel = el("select");
    Object.keys(SV.TYPES).forEach(function (k) { var o = el("option", "", SV.TYPES[k].name); o.value = k; sel.appendChild(o); });
    sel.value = SV.TYPES[preTy] ? preTy : "subsonic";
    field(t("sv.type"), sel);
    var hint = el("p", "dim small");
    form.appendChild(hint);
    var mk = function (type, ac, max) {
      var i = el("input");
      i.type = type; i.autocomplete = ac || "off"; i.spellcheck = false; i.maxLength = max;
      i.setAttribute("autocapitalize", "none");
      return i;
    };
    var name = mk("text", "off", 60), addr = mk("text", "url", 500), user = mk("text", "username", 120), pass = mk("password", "current-password", 500),
      tok = mk("password", "off", 2000), dir = mk("text", "off", 500);
    addr.inputMode = "url";
    field(t("sv.name"), name);
    var fA = field(t("sv.addr"), addr), fU = field(t("sv.user"), user), fP = field(t("sv.pass"), pass), fT = field(t("sv.tok"), tok), fD = field(t("sv.dir"), dir);
    form.appendChild(el("p", "dim small", t("sv.h.all")));
    var msg = el("p", "sv-msg small");
    msg.setAttribute("role", "status");
    form.appendChild(msg);
    var PH = { subsonic: "https://music.example.com", jellyfin: "https://jellyfin.example.com", funkwhale: "https://open.audio",
      webdav: "https://cloud.example.com/remote.php/dav/files/me" };
    var paint = function () {
      var ty = sel.value, login = ty === "subsonic" || ty === "jellyfin" || ty === "webdav";
      fA.hidden = ty === "dropbox"; addr.placeholder = PH[ty] || "";
      fU.hidden = !login; fP.hidden = !login;
      fT.hidden = ty !== "funkwhale";
      fD.hidden = !(ty === "webdav" || ty === "dropbox"); dir.placeholder = ty === "dropbox" ? "/Music" : "/";
      name.placeholder = SV.TYPES[ty].name;
      hint.textContent = t("sv.h." + ty);
      msg.textContent = "";
    };
    sel.addEventListener("change", paint);
    form.addEventListener("input", function (e) { if (e.target !== sel) msg.textContent = ""; });
    paint();
    var row = el("div", "dlg-btns");
    row.appendChild(button(t("cancel"), "txt-btn", function () { dlg.close(); }));
    var ok = el("button", "txt-btn accent", t("sv.go"));
    ok.type = "submit";
    row.appendChild(ok);
    form.appendChild(row);
    var busy = false;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      busy = true; ok.disabled = true;
      msg.className = "sv-msg small dim"; msg.textContent = t("sv.busy");
      var ty = sel.value;
      SV.connect({ ty: ty, n: name.value, b: addr.value, us: user.value, pw: pass.value, tok: tok.value, dir: dir.value }).then(function (srv) {
        busy = false;
        pass.value = ""; tok.value = "";
        svChanged();
        svForget(srv.id);
        dlg.close();
        showToast(t("sv.ok", { n: srv.n }));
        openView({ kind: "sv", id: srv.id });
      }, function (err) {
        busy = false; ok.disabled = false;
        var c = err && err.code;
        msg.className = "sv-msg small err";
        msg.textContent = svErr(c, SV.TYPES[ty].name);
        if (c === "dropbox") {
          msg.appendChild(document.createTextNode(" "));
          msg.appendChild(button(t("sv.openFiles"), "link", function () { dlg.close(); openApp("files"); }));
        }
      });
    });
    dlg.appendChild(form);
    openDialog(dlg);
    sel.focus();
  }
  // Where a server song or a link comes from.
  function infoServer(r) {
    var dlg = makeDialog("mu-info", "menu-dlg");
    dlg.appendChild(el("h2", "dlg-title", r.t));
    var dl = el("dl", "info");
    var add = function (k2, node) { if (!node) return; dl.appendChild(el("dt", "dim", t(k2))); var dd = el("dd", ""); if (typeof node === "string") dd.textContent = node; else dd.appendChild(node); dl.appendChild(dd); };
    if (r.s === "sv") { var x = SV && SV.get(r.sh); add("info.server", x ? x.n + " · " + SV.TYPES[x.ty].name : ""); if (x && !SV.TYPES[x.ty].lib) add("info.file", r.ii); }
    else add("info.source", (/^https:\/\/([^/]+)/.exec(r.u || "") || [])[1] || "");
    add("sec.albums", r.al || "");
    add("info.length", r.d ? C.fmtTime(r.d) : "");
    if (r.pg) { var b = el("button", "link", r.pg.replace(/^https:\/\//, "").slice(0, 60)); b.type = "button"; b.addEventListener("click", function () { openExt(r.pg); }); add("info.page", b); }
    dlg.appendChild(dl);
    var row = el("div", "dlg-btns");
    row.appendChild(button(t("close"), "txt-btn", function () { dlg.close(); }));
    dlg.appendChild(row);
    openDialog(dlg);
  }
  // Playlist files (M3U, PLS, XSPF) → a new playlist. Entries match a
  // song on this device (file name, else title + artist), a song on
  // the server the file is on, or a public https address.
  function joinPath(dir, rel) {
    rel = String(rel || "").replace(/\\/g, "/");
    if (/%[0-9a-f]{2}/i.test(rel)) { try { rel = decodeURIComponent(rel); } catch (e) {} }
    var parts = (rel[0] === "/" ? [] : String(dir || "/").split("/")).concat(rel.split("/")), out = [];
    parts.forEach(function (p) { if (!p || p === ".") return; if (p === "..") out.pop(); else out.push(p); });
    return "/" + out.join("/");
  }
  function importEntries(parsed, name, ctx) {
    var refs = [], miss = 0, byName = {}, here = null;
    tracks.forEach(function (r) { var b = C.fold(r.p.split("/").pop()); if (!byName[b]) byName[b] = r; });
    var lf = ctx && ctx.sid && feeds["sv|" + ctx.sid + "|f|" + (ctx.dir || "/")];
    if (lf && !lf.busy && !lf.err && lf.page) { here = {}; lf.list.forEach(function (x) { here[x.ii] = 1; }); }
    parsed.entries.forEach(function (e) {
      var ref = null;
      if (e.u) ref = SV.linkRef(e);
      else if (e.path && ctx && ctx.sid) {
        var p = joinPath(ctx.dir, e.path);
        // In the folder the file is in, only the songs that are there.
        var dirOf = p.slice(0, p.lastIndexOf("/")) || "/";
        if (here && dirOf === (ctx.dir || "/") && !here[p]) { miss++; return; }
        ref = SV.fileSong(ctx.sid, p, p.split("/").pop());
        if (ref && e.t) { ref.t = C.clean(e.t); if (e.a) ref.a = C.clean(e.a); }
      } else if (e.path) {
        var hit = byName[C.fold(e.path.split("/").pop())] || (e.t ? resolve({ k: "x:000000", t: e.t, a: e.a || "" }) : null);
        if (hit) ref = C.refOf(hit);
      }
      ref = ref ? C.normRef(ref) : null;
      if (ref) refs.push(ref); else miss++;
    });
    if (!refs.length) { showToast(t("imp.none")); return; }
    var title = C.clean(parsed.title, C.LIM.plName) || C.clean(C.stem(name), C.LIM.plName) || t("pl.my", { n: D().pls.length + 1 });
    var id = null;
    mutate(function (d, now) { var r = C.addPl(d, title, refs, now); id = r.id; return r.data; });
    showToast(t("imp.done", { n: title, k: nSongs(refs.length) }) + (miss ? " " + t("imp.miss", { n: miss }) : ""));
    if (id) { view = null; history = []; openView({ kind: "pl", id: id }); }
  }
  function importMenu() {
    menuDlg([
      [t("imp.file"), pickPlaylistFile],
      [t("imp.url"), function () { promptDlg(t("sv.import"), t("imp.urlPh"), "https://", t("imp.go"), importUrl, 1000); }]
    ], t("sv.import"));
  }
  function pickPlaylistFile() {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".m3u,.m3u8,.pls,.xspf,audio/x-mpegurl,audio/mpegurl,audio/x-scpls,application/xspf+xml";
    inp.style.display = "none";
    inp.addEventListener("change", function () {
      var f = (inp.files || [])[0];
      inp.remove();
      if (!f) return;
      if (f.size > 5e6) { showToast(t("imp.none")); return; }
      f.text().then(function (text) { importEntries(SV.parsePlaylist(text, f.name, ""), f.name, null); }, function () { showToast(t("imp.none")); });
    });
    inp.addEventListener("cancel", function () { inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  }
  function getText(u) {
    var FF = window.orosFeedsFetch;
    if (!FF || typeof FF.fetchOne !== "function") return Promise.reject({ code: "net" });
    return FF.fetchOne(u, { accept: "application/rss+xml, application/xml, text/xml, audio/x-mpegurl, */*" }).then(function (r) {
      if (!r.status || r.status >= 400) throw { code: "http" };
      return r;
    });
  }
  function importUrl(u) {
    u = /^https?:\/\//i.test(u) ? u : "https://" + u;
    getText(u).then(function (r) {
      var nm = decodeURIComponent((u.split(/[?#]/)[0].split("/").pop() || "playlist"));
      importEntries(SV.parsePlaylist(r.text, nm, r.finalUrl || u), nm, null);
    }, function (e) { showToast(errText(e && e.code, (/^https?:\/\/([^/]+)/.exec(u) || [])[1] || u)); });
  }
  function importServerList(x, dir, pf) {
    SV.fileText(x.id, pf.p).then(function (text) { importEntries(SV.parsePlaylist(text, pf.n, ""), pf.n, { sid: x.id, dir: dir }); },
      function (e) { showToast(svErr(e && e.code, x.n)); });
  }
  // Music feeds (RSS / Atom with audio): kept on this device.
  function feedList() {
    try {
      var a = JSON.parse(localStorage.getItem(FEEDS_KEY) || "[]");
      return (Array.isArray(a) ? a : []).filter(function (f) { return f && typeof f.u === "string" && /^https?:\/\//i.test(f.u) && f.u.length <= 1000; })
        .map(function (f) { return { u: f.u, n: C.clean(f.n) || f.u, art: /^https:\/\/[^\s"'<>]+$/i.test(f.art || "") ? f.art : "" }; }).slice(0, 50);
    } catch (e) { return []; }
  }
  function saveFeeds(l) { try { localStorage.setItem(FEEDS_KEY, JSON.stringify(l.slice(0, 50))); } catch (e) {} }
  function hostOf(u) { return (/^https?:\/\/([^/]+)/.exec(u || "") || [])[1] || ""; }
  function loadFeed(u) {
    var X = window.orosFeedsCore;
    if (!X) return Promise.reject({ code: "net" });
    return getText(u).then(function (r) {
      var fd = X.parseFeed(r.text, r.finalUrl || u, Date.now());
      if (!fd) throw { code: "feed" };
      if (!fd.icon) { var im = /<itunes:image[^>]*href=["']([^"']+)["']/i.exec(r.text); if (im) fd.icon = im[1]; }
      return { feed: fd, songs: SV.feedSongs(fd) };
    });
  }
  function fRss(u) {
    return function () {
      return loadFeed(u).then(function (r) { return { list: r.songs, more: false, extra: { n: r.feed.title, art: r.feed.icon, site: r.feed.site } }; });
    };
  }
  function feedDlg() {
    promptDlg(t("sv.feedAdd"), t("feed.ph"), "https://", t("feed.add"), function (u) {
      u = /^https?:\/\//i.test(u) ? u : "https://" + u;
      loadFeed(u).then(function (r) {
        if (!r.songs.length) { showToast(t("feed.none")); return; }
        var n = C.clean(r.feed.title) || hostOf(u);
        saveFeeds([{ u: u, n: n, art: /^https:\/\//i.test(r.feed.icon || "") ? r.feed.icon : "" }].concat(feedList().filter(function (f) { return f.u !== u; })));
        delete feeds["rss|" + u];
        showToast(t("feed.added"));
        openView({ kind: "rss", id: u, n: n });
      }, function (e) { showToast(e && e.code === "feed" ? t("feed.err") : errText(e && e.code, hostOf(u))); });
    }, 1000);
  }
  function renderRss(m, v) {
    var k = "rss|" + v.id, f = feed(k, fRss(v.id)), ex = f.extra || {}, host = hostOf(v.id);
    var name = C.clean(ex.n) || v.n || host;
    var src = { kind: "rss", id: v.id, n: name };
    var saved = feedList().some(function (x) { return x.u === v.id; });
    var more = button(t("more"), "icon-btn", function () {
      var items = [];
      if (f.list.length) items.push([t("m.addPl"), function () { addToPlaylist(f.list.map(C.normRef).filter(Boolean)); }]);
      if (/^https:\/\//i.test(ex.site || "")) items.push([t("feed.site"), function () { openExt(ex.site); }]);
      if (saved) items.push([t("feed.remove"), function () { saveFeeds(feedList().filter(function (x) { return x.u !== v.id; })); goBack(); showToast(t("feed.removed")); }, true]);
      menuDlg(items, name, host);
    }, I.more);
    pageHead(m, cover(/^https:\/\//i.test(ex.art || "") ? ex.art : "", name, "big", I.rss), t("feed.kind"), name, el("div", "ph-sub dim", host), f.list.length ? f.list : null, src, [more]);
    if (f.list.length) m.appendChild(rowList(f.list, { src: src }));
    feedStatus(m, k, host);
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
    if (artId && /^https?:\/\//i.test(artId)) {
      // A cover of an open catalogue, straight from the source.
      var im = el("img");
      im.alt = ""; im.decoding = "async"; im.loading = "lazy"; im.referrerPolicy = "no-referrer";
      im.addEventListener("error", function () { im.remove(); box.classList.remove("has-img"); box.innerHTML = icon || I.note; });
      im.src = artId;
      box.textContent = "";
      box.appendChild(im);
      box.classList.add("has-img");
      return box;
    }
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
    return list.map(function (x) { var r = playable(x); return r ? C.itemOf(r) : null; }).filter(Boolean);
  }
  function playRows(rows, idx, src, shuffle) {
    if (!H) return;
    var items = [], map = -1;
    rows.forEach(function (x, i) {
      var r = playable(x);
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
    var ref = C.normRef(x.p || x.s ? C.refOf(x) : x);
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
    inp.accept = "audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.wav,.webm,.lrc";
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
    ].concat(SV ? [[t("sv.connect"), function () { connectDlg(); }], [t("sv.import"), importMenu], [t("sv.feedAdd"), feedDlg]] : []));
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
    if (!tracks.length && !D().pls.length && !C.likedList(D()).length && !svList().length) { emptyHero(m); freeSection(m); return; }
    m.appendChild(el("h1", "greet", greeting()));
    // Quick tiles: liked songs, playlists, shuffle all.
    var tiles = el("div", "tiles");
    var liked = C.likedList(D());
    tiles.appendChild(tile(t("lib.liked"), likedCover(), function () { openView({ kind: "liked" }); }));
    D().pls.slice(0, 5).forEach(function (p) { tiles.appendChild(tile(p.n, collage(p.it.map(function (r) { return playable(r) || r; }), ""), function () { openView({ kind: "pl", id: p.id }); })); });
    if (tracks.length) tiles.appendChild(tile(t("home.shuffleAll"), cover("", "shuffle", "", I.shuffle), function () { playRows(tracks, -1, { kind: "all", id: "", n: t("now.lib") }, true); }));
    m.appendChild(tiles);
    void liked;
    var hist = H ? H.history() : null;
    var recent = (hist && hist.r ? hist.r : []).map(playable).filter(Boolean);
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
        var ov = oAlbumView(r);
        if (ov) {
          if (seenAl[ov.kind + "|" + ov.id]) return;
          seenAl[ov.kind + "|" + ov.id] = 1;
          rowR.appendChild(oAlbumCard({ s: ov.kind, id: ov.id, n: r.al || r.t, a: r.a, art: r.art }));
          return;
        }
        rowR.appendChild(songCard(r));
      });
      s1.appendChild(rowR);
    }
    serverSection(m);
    var added = albumsAll().slice().sort(function (a, b) { return b.add - a.add; }).slice(0, 12);
    if (added.length) {
      var s2 = section(m, t("home.added"));
      var rowA = el("div", "cards");
      added.forEach(function (a) { rowA.appendChild(albumCard(a)); });
      s2.appendChild(rowA);
    }
    if (hist && hist.c) {
      var seenR = {};
      (hist.r || []).forEach(function (x) { if (x && x.k) seenR[x.k] = x; });
      var top = Object.keys(hist.c).sort(function (a, b) { return hist.c[b] - hist.c[a]; }).map(function (k) { return playable(seenR[k] || { k: k }); }).filter(Boolean).slice(0, 8);
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
    freeSection(m);
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
    var refresh = function () { var r = $("search-res"); if (r) { r.textContent = ""; searchResults(r); } };
    inp.addEventListener("input", function () {
      searchQ = inp.value;
      clearTimeout(timer);
      timer = setTimeout(refresh, 150);
      // The open catalogues are asked only once the typing stops.
      clearTimeout(onlineTimer);
      onlineTimer = setTimeout(function () { if (onlineQ !== searchQ.trim()) { onlineQ = searchQ.trim(); refresh(); } }, 800);
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      clearTimeout(onlineTimer);
      if (onlineQ !== searchQ.trim()) { onlineQ = searchQ.trim(); refresh(); }
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
      if (openOn()) {
        box.appendChild(el("h2", "sub-h", t("home.genres")));
        var og = el("div", "genre-grid");
        O.OPEN_GENRES.forEach(function (g) {
          var b = el("button", "genre");
          b.type = "button";
          b.style.setProperty("--hue", parseInt(C.hash(g[0]).slice(0, 4), 36) % 360);
          b.appendChild(el("span", "", LANG === "el" ? g[2] : g[1]));
          b.appendChild(el("span", "dim small", t("kind.free")));
          b.addEventListener("click", function () { openView({ kind: "ogenre", id: g[0] }); });
          og.appendChild(b);
        });
        box.appendChild(og);
      }
      if (!tracks.length) { if (!openOn()) box.appendChild(el("p", "empty", t("search.hint"))); return; }
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
    if (!r.songs.length && !r.albums.length && !r.artists.length && !pls.length && !openOn() && !svLib().length) { box.appendChild(el("p", "empty", t("search.none", { q: q }))); return; }
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
    if (SV && q.length >= 2) serverResults(box, q);
    if (openOn() && q.length >= 2) onlineResults(box, q);
  }
  var onlineQ = "", onlineTimer = null;
  function onlineResults(box, q) {
    var sec = section(box, t("o.title"));
    var chips = el("div", "chips");
    ["all", "jm", "ia", "ov", "cc"].forEach(function (k) {
      var b = button(k === "all" ? t("o.all") : srcName(k), "chip" + (prefs.osrc === k ? " on" : ""), function () { prefs.osrc = k; savePrefs(); renderKeepScroll(); });
      b.setAttribute("aria-pressed", prefs.osrc === k ? "true" : "false");
      chips.appendChild(b);
    });
    sec.appendChild(chips);
    if (onlineQ !== q) { sec.appendChild(el("p", "dim small o-note", t("o.wait"))); return; }
    var all = prefs.osrc === "all", src = { kind: "osearch", id: q, n: q };
    if (all || prefs.osrc === "ia") {
      var kI = "s|ia|" + q, fi = feed(kI, fIa({ q: q }));
      sec.appendChild(el("h3", "sub-h", t("o.albums", { s: srcName("ia") })));
      var ci = el("div", all ? "cards" : "grid");
      fi.list.forEach(function (a) { ci.appendChild(oAlbumCard(a)); });
      if (fi.list.length) sec.appendChild(ci);
      feedStatus(sec, kI, srcName("ia"));
    }
    ["jm", "ov", "cc"].forEach(function (sk) {
      if (!all && prefs.osrc !== sk) return;
      var k = "s|" + sk + "|" + q, f = feed(k, sk === "jm" ? fJm({ q: q }) : sk === "ov" ? fOv({ q: q }) : fCc({ q: q }));
      sec.appendChild(el("h3", "sub-h", t("o.songs", { s: srcName(sk) })));
      if (f.list.length) sec.appendChild(rowList(f.list, { src: src }));
      feedStatus(sec, k, srcName(sk));
    });
  }
  function renderLib(m) {
    var chips = el("div", "chips");
    ["pl", "songs", "albums", "artists", "genres", "folders"].concat(O ? ["offline"] : [], SV ? ["servers"] : []).forEach(function (k) {
      var b = button(t("lib." + k), "chip" + (prefs.lib === k ? " on" : ""), function () { prefs.lib = k; savePrefs(); renderAll(); });
      b.setAttribute("aria-pressed", prefs.lib === k ? "true" : "false");
      chips.appendChild(b);
    });
    m.appendChild(chips);
    // The chosen chip stays in sight on a narrow screen.
    var onChip = chips.querySelector(".chip.on");
    if (onChip) requestAnimationFrame(function () { if (onChip.offsetLeft + onChip.offsetWidth > chips.clientWidth) chips.scrollLeft = onChip.offsetLeft - 12; });
    if (prefs.lib === "offline") {
      var offSrc = { kind: "offline", id: "", n: t("lib.offline") }, offL = offRows();
      if (!offL.length) { m.appendChild(el("p", "empty", t("off.empty"))); return; }
      m.appendChild(el("p", "dim small o-note", t("s.offInfo", { n: nSongs(offL.length), s: fmtSize(offSize()) })));
      m.appendChild(playBar(offL, offSrc));
      m.appendChild(rowList(offL, { src: offSrc }));
      return;
    }
    if (prefs.lib === "servers" && SV) { renderServers(m); return; }
    if (!tracks.length && prefs.lib !== "pl") { emptyHero(m); return; }
    if (prefs.lib === "pl") {
      var list = el("div", "lib-list");
      list.appendChild(libRow(likedCover("sm"), t("lib.liked"), t("kind.pl") + " · " + nSongs(C.likedList(D()).length), function () { openView({ kind: "liked" }); }));
      D().pls.slice().sort(function (a, b) { return b.m - a.m; }).forEach(function (p) {
        list.appendChild(libRow(collage(p.it.map(function (r) { return playable(r) || r; }), "sm"), p.n, t("kind.pl") + " · " + nSongs(p.it.length), function () { openView({ kind: "pl", id: p.id }); }));
      });
      list.appendChild(libRow(cover("", "+", "sm", I.plus), t("lib.newPl"), "", function () { newPlaylist([], function (id) { openView({ kind: "pl", id: id }); }); }));
      m.appendChild(list);
      if (!tracks.length) { emptyHero(m); freeSection(m); }
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
    if (list) m.appendChild(playBar(list, src, extra));
    else if (extra && extra.length) { var bar = el("div", "play-bar"); extra.forEach(function (x) { bar.appendChild(x); }); m.appendChild(bar); }
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
      var rows = p.it.map(function (r) { var x = playable(r); return x ? Object.assign({}, x, { _ref: r }) : Object.assign({ _missing: 1 }, r); });
      pageHead(m, collage(rows, "big"), t("kind.pl"), p.n, el("div", "ph-sub dim", [nSongs(p.it.length), totalTime(rows.filter(function (r) { return !r._missing; }))].filter(Boolean).join(" · ")),
        rows, src, [button(t("more"), "icon-btn", function () { plMenu(p); }, I.more)]);
      if (!rows.length) m.appendChild(el("p", "empty", t("pl.emptyRows")));
      m.appendChild(rowList(rows, { src: src, pl: p }));
    } else if (v.kind === "liked") {
      src = { kind: "liked", id: "", n: t("lib.liked") };
      var lk = C.likedList(D()).map(function (l) { var r = playable(l); return r || Object.assign({ _missing: 1 }, l); });
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
    } else if (O && (v.kind === "browse" || v.kind === "ogenre" || v.kind === "omood" || v.kind === "ia" || v.kind === "jm" || v.kind === "oartist")) {
      renderOpen(m, v);
    } else if (SV && /^(sv|svall|svar|sva|svr|svp|svf)$/.test(v.kind)) {
      renderServer(m, v);
    } else if (SV && v.kind === "rss") {
      renderRss(m, v);
    } else if (v.kind === "folder") {
      var crumbs = el("div", "crumbs dim small", v.id.replace(LIB.ROOT, "Music"));
      m.appendChild(crumbs);
      renderFolder(m, v.id);
    }
  }

  // Pages of the open catalogues: a shelf, a genre, an Internet
  // Archive album, an artist.
  function renderOpen(m, v) {
    var src, f, k;
    if (v.kind === "browse") {
      var b = O.browseOf(v.id);
      if (!b) { m.appendChild(el("p", "empty", t("lib.empty"))); return; }
      var name = b[LANG] || b.en;
      src = { kind: "browse", id: b.id, n: name };
      k = "b|" + b.id;
      f = feed(k, b.src === "ia" ? fIa(b.ia) : b.src === "cc" ? fCc(b.cc) : b.src === "jm" ? fJm(b.jm) : fOv(b.ov));
      var cardsOnly = b.src === "ia" || (b.jm && (b.jm.albums || b.jm.radios));
      pageHead(m, cover("", b.id, "big", I.globe), t("kind.free"), name, el("div", "ph-sub dim", srcName(b.src)), cardsOnly ? null : f.list, src);
      if (cardsOnly) { var g = el("div", "grid"); f.list.forEach(function (a) { g.appendChild(b.jm && b.jm.radios ? radioCard(a) : oAlbumCard(a)); }); m.appendChild(g); }
      else m.appendChild(rowList(f.list, { src: src }));
      feedStatus(m, k, srcName(b.src));
    } else if (v.kind === "ogenre") {
      var gg = O.genreOf(v.id);
      if (!gg) { m.appendChild(el("p", "empty", t("lib.empty"))); return; }
      var gn = gg[LANG] || gg.en, word = gg.id === "hiphop" ? "hip hop" : gg.id;
      src = { kind: "ogenre", id: gg.id, n: gn };
      var ki = "g|ia|" + gg.id, ko = "g|ov|" + gg.id, kc = "g|cc|" + gg.id, kj = "g|jm|" + gg.id;
      var fj = feed(kj, fJm({ tags: gg.id, order: "popularity_month" }));
      var fi = feed(ki, fIa({ subject: word })), fo = feed(ko, fOv({ q: word })), fc = feed(kc, fCc({ tags: gg.id === "hiphop" ? "hip_hop" : gg.id }));
      var songs = fj.list.concat(fo.list, fc.list);
      pageHead(m, cover("", gg.id, "big", I.globe), t("kind.free"), gn, el("div", "ph-sub dim", t("home.freeSub")), songs, src);
      m.appendChild(el("h2", "sub-h", t("o.albums", { s: srcName("ia") })));
      var ci = el("div", "cards");
      fi.list.forEach(function (a) { ci.appendChild(oAlbumCard(a)); });
      if (fi.list.length) m.appendChild(ci);
      feedStatus(m, ki, srcName("ia"));
      [["jm", kj, fj], ["ov", ko, fo], ["cc", kc, fc]].forEach(function (x) {
        m.appendChild(el("h2", "sub-h", t("o.songs", { s: srcName(x[0]) })));
        if (x[2].list.length) m.appendChild(rowList(x[2].list, { src: src }));
        feedStatus(m, x[1], srcName(x[0]));
      });
    } else if (v.kind === "omood") {
      var mo = O.moodOf(v.id);
      if (!mo) { m.appendChild(el("p", "empty", t("lib.empty"))); return; }
      var mn = mo[LANG] || mo.en;
      src = { kind: "omood", id: mo.id, n: mn };
      k = "m|jm|" + mo.id;
      f = feed(k, fJm({ mood: mo.id, order: "popularity_month" }));
      pageHead(m, cover("", "mood" + mo.id, "big", I.globe), t("kind.mood"), mn, el("div", "ph-sub dim", srcName("jm")), f.list, src);
      m.appendChild(rowList(f.list, { src: src }));
      feedStatus(m, k, srcName("jm"));
    } else if (v.kind === "ia" || v.kind === "jm") {
      var sk0 = v.kind;
      k = sk0 + "|" + v.id;
      f = feed(k, fAlbum(sk0, v.id));
      var al = f.extra || (sk0 === "ia" ? { id: v.id, n: v.n || v.id, a: "", art: "https://archive.org/services/img/" + encodeURIComponent(v.id), pg: "https://archive.org/details/" + encodeURIComponent(v.id) }
        : { s: "jm", id: v.id, n: v.n || v.id, a: "", art: "", pg: "https://www.jamendo.com/album/" + encodeURIComponent(v.id) });
      src = { kind: sk0, id: v.id, n: al.n };
      var sub = el("div", "ph-sub");
      if (al.a) sub.appendChild(oArtistLink({ s: sk0, a: al.a, ri: al.ri }));
      sub.appendChild(el("span", "dim", [al.y || "", f.list.length ? nSongs(f.list.length) : "", totalTime(f.list)].filter(Boolean).join(" · ")));
      if (al.li) sub.appendChild(el("span", "lic", O.licShort(al.li)));
      var extra = [];
      if (f.list.length) {
        extra.push(button(t("m.addPl"), "icon-btn", function () { addToPlaylist(f.list.map(C.normRef).filter(Boolean)); }, I.plus));
        if (al.off) extra.push(button(t("m.saveAlbum"), "icon-btn", function () { saveOffline(f.list); }, I.dl));
      }
      extra.push(button(t("more"), "icon-btn", function () {
        var items = [[t("m.credit"), function () { copyCredit({ s: sk0, t: al.n, a: al.a, li: al.li, pg: al.pg }); }]];
        if (al.pg) items.push([t("m.source", { s: srcName(sk0) }), function () { openExt(al.pg); }]);
        if (al.li) items.push([t("info.licence") + ": " + O.licLabel(al.li, LANG), function () { openExt(O.licUrl(al.li)); }]);
        menuDlg(items, al.n, al.a);
      }, I.more));
      pageHead(m, cover(al.art, al.n, "big"), t("kind.album") + " · " + srcName(sk0), al.n, sub, f.list.length ? f.list : null, src, extra);
      if (f.list.length) m.appendChild(rowList(f.list, { src: src, numbers: true, noArt: true, noAlbum: true }));
      feedStatus(m, k, srcName(sk0));
    } else if (v.kind === "oartist") {
      var i = v.id.indexOf("|"), sk = v.id.slice(0, i), who = v.id.slice(i + 1);
      if (!O.SOURCES[sk] || !who) { m.appendChild(el("p", "empty", t("lib.empty"))); return; }
      var an = v.n || who;
      src = { kind: "oartist", id: v.id, n: an };
      k = "a|" + v.id;
      f = feed(k, sk === "ia" ? fIa({ creator: who }) : sk === "cc" ? fCc({ user: who }) : sk === "jm" ? fJm({ artist: who }) : fOv({ creator: who }));
      pageHead(m, cover("", an, "big round", I.user), t("kind.artist") + " · " + srcName(sk), an, null, sk === "ia" ? null : f.list, src);
      if (sk === "ia") { var ga = el("div", "grid"); f.list.forEach(function (a) { ga.appendChild(oAlbumCard(a)); }); m.appendChild(ga); }
      else m.appendChild(rowList(f.list, { src: src, noArtist: true }));
      feedStatus(m, k, srcName(sk));
    }
  }
  function oArtistLink(r, cls) {
    var id = oArtistId(r);
    var a = el("button", "link " + (cls || ""), r.a || t("unknown.artist"));
    a.type = "button";
    if (id) a.addEventListener("click", function (e) { e.stopPropagation(); openView({ kind: "oartist", id: id, n: r.a }); });
    return a;
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
    if (r._missing) sub.push(r.s === "sv" ? t("missing.sv") : t("missing"));
    else {
      if (!opts.noArtist) sub.push(r.a || t("unknown.artist"));
      if (!opts.noAlbum && r.al) sub.push(r.al);
    }
    var subEl = el("span", "row-s dim", sub.join(" · "));
    if (r.s && !r._missing && O) {
      if (offKeys[k]) {
        var oi = el("span", "off-ic"); oi.innerHTML = I.dl; oi.title = t("off.badge"); oi.setAttribute("aria-label", t("off.badge"));
        subEl.insertBefore(oi, subEl.firstChild);
      }
      if (r.li) { var lb0 = el("span", "lic", O.licShort(r.li)); lb0.title = O.licLabel(r.li, LANG); subEl.insertBefore(lb0, subEl.firstChild); }
    }
    tx.appendChild(subEl);
    main.appendChild(tx);
    main.addEventListener("click", function () {
      if (r._missing) { showToast(r.s === "sv" ? t("missing.svToast") : t("missing.toast")); return; }
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
    var item = r._missing ? null : (r.p || C.isRemote(r) || C.isServer(r) ? C.itemOf(r) : null);
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
    if (r.s === "sv" && !r.p && !r._missing && SV) {
      var sa = r.ai ? { kind: "sva", id: r.sh + "|" + r.ai, n: r.al } : null;
      if (sa && !(view && view.kind === "sva" && view.id === sa.id)) items.push([t("m.album"), function () { openView(sa); }]);
      var sr = r.ri ? { kind: "svr", id: r.sh + "|" + r.ri, n: r.a } : null;
      if (sr && !(view && view.kind === "svr" && view.id === sr.id)) items.push([t("m.artist"), function () { openView(sr); }]);
      items.push([t("m.info"), function () { infoServer(r); }]);
    }
    if (r.s === "ln" && !r.p && !r._missing) {
      if (r.pg) items.push([t("m.page"), function () { openExt(r.pg); }]);
      items.push([t("m.info"), function () { infoServer(r); }]);
    }
    if (isOpen(r) && !r.p && !r._missing) {
      var av = oAlbumView(r);
      if (av && !(view && view.kind === av.kind && view.id === av.id)) items.push([t("m.album"), function () { openView(av); }]);
      var oa = oArtistId(r);
      if (oa && !(view && view.kind === "oartist" && view.id === oa)) items.push([t("m.artist"), function () { openView({ kind: "oartist", id: oa, n: r.a }); }]);
      if (r.off === 1) items.push(offKeys[r.k] ? [t("m.delOff"), function () { delOffline([r.k]); }] : [t("m.saveOff"), function () { saveOffline([r]); }]);
      items.push([t("m.credit"), function () { copyCredit(r); }]);
      if (r.pg) items.push([t("m.source", { s: O.sourceName(r) }), function () { openExt(r.pg); }]);
      items.push([t("m.info"), function () { infoRemote(r); }]);
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
    return card(collage(p.it.map(function (r) { return playable(r) || r; }), ""), p.n, t("kind.pl"), function () { openView({ kind: "pl", id: p.id }); });
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

  // Where a song of an open catalogue comes from, its licence and the
  // credit line to copy.
  function infoRemote(r) {
    var dlg = makeDialog("mu-info", "menu-dlg");
    dlg.appendChild(el("h2", "dlg-title", r.t));
    var dl = el("dl", "info");
    var add = function (k2, node) { if (!node) return; dl.appendChild(el("dt", "dim", t(k2))); var dd = el("dd", ""); if (typeof node === "string") dd.textContent = node; else dd.appendChild(node); dl.appendChild(dd); };
    var lnk = function (label, url) { var b = el("button", "link", label); b.type = "button"; b.addEventListener("click", function () { openExt(url); }); return b; };
    add("info.source", O.sourceName(r));
    if (r.li) add("info.licence", lnk(O.licLabel(r.li, LANG), O.licUrl(r.li)));
    if (r.pg) add("info.page", lnk(r.pg.replace(/^https:\/\//, "").slice(0, 60), r.pg));
    add("info.length", r.d ? C.fmtTime(r.d) : "");
    add("lib.offline", offKeys[r.k] ? fmtSize(offKeys[r.k].sz) : "");
    dlg.appendChild(dl);
    dlg.appendChild(el("p", "dim small", t("info.credit")));
    dlg.appendChild(el("p", "credit-line", O.credit(r, LANG)));
    var row = el("div", "dlg-btns");
    row.appendChild(button(t("m.credit"), "txt-btn", function () { copyCredit(r); }));
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
      var a = $("pl-art"); a.textContent = ""; a.appendChild(cover(artOf(c), c.al || c.t, "xs"));
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
    var lyBtn = button(t("ly.btn"), "icon-btn", function () { showLy = !showLy; if (showLy) showQ = false; dlg._paint(true); }, I.lyrics);
    var qBtn = button(t("queue"), "icon-btn", function () { showQ = !showQ; if (showQ) showLy = false; dlg._paint(true); }, I.queue);
    head.appendChild(lyBtn);
    head.appendChild(qBtn);
    dlg.appendChild(head);
    var body = el("div", "fp-body");
    var artBox = el("div", "fp-art");
    var qBox = el("div", "fp-queue");
    var lyBox = el("div", "fp-lyrics");
    body.appendChild(artBox);
    body.appendChild(qBox);
    body.appendChild(lyBox);
    dlg.appendChild(body);
    var meta = el("div", "fp-meta");
    var tx = el("div", "fp-text");
    var tt = el("div", "fp-t"), ta = el("div", "fp-a");
    tx.appendChild(tt); tx.appendChild(ta);
    meta.appendChild(tx);
    var like = button(t("like"), "icon-btn like", function () { var c = H.getState().cur; if (c) { toggleLike(c); dlg._paint(true); } }, I.heart);
    meta.appendChild(like);
    dlg.appendChild(meta);
    var licLine = el("button", "link fp-lic dim small");
    licLine.type = "button";
    licLine.addEventListener("click", function () { var c = H.getState().cur; if (isOpen(c)) infoRemote(c); });
    dlg.appendChild(licLine);
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
    var extra = el("div", "fp-extra");
    var pillBtn = function (label, fn, icon) {
      var b = button(label, "pill fp-pill", fn);
      b.innerHTML = icon;
      b.appendChild(el("span", "", label));
      return b;
    };
    var sndBtn = pillBtn(t("snd.btn"), soundDlg, I.eq);
    var slBtn = pillBtn(t("sl.btn"), sleepDlg, I.moon);
    extra.appendChild(sndBtn); extra.appendChild(slBtn);
    extra.hidden = !hasSound();
    dlg.appendChild(extra);
    var showQ = false, showLy = false, lastK = "", lyP = null;
    dlg._paint = function (full) {
      var st = H.getState(), c = st.cur;
      if (!c) { dlg.close(); return; }
      if (full || lastK !== c.k) {
        lastK = c.k;
        artBox.textContent = "";
        artBox.appendChild(cover(artOf(c), c.al || c.t, "huge"));
        tt.textContent = c.t || "";
        ta.textContent = "";
        ta.appendChild(c.s === "sv" ? svArtistLink(c, "dim") : isOpen(c) ? oArtistLink(c, "dim") : c.s ? el("span", "dim", c.a || "") : artistLink(c.a, "dim"));
        licLine.hidden = !isOpen(c);
        licLine.textContent = isOpen(c) ? [c.li ? O.licLabel(c.li, LANG) : "", O.sourceName(c)].filter(Boolean).join(" · ") : "";
        fromN.textContent = (st.src && st.src.n) || t("now.lib");
        var liked = C.isLiked(D(), c.k);
        like.innerHTML = liked ? I.heartOn : I.heart;
        like.classList.toggle("on", liked);
        like.setAttribute("aria-label", liked ? t("unlike") : t("like"));
        body.classList.toggle("q-on", showQ);
        body.classList.toggle("ly-on", showLy);
        qBtn.classList.toggle("on", showQ);
        lyBtn.classList.toggle("on", showLy);
        if (showQ) paintQueue(qBox);
        lyP = showLy ? lyPanel(lyBox, c) : null;
      }
      if (lyP) lyP.tick(st.pos);
      var sl = sleepLeft(st);
      slBtn.classList.toggle("on", !!sl);
      slBtn.lastChild.textContent = sl || t("sl.btn");
      sndBtn.classList.toggle("on", hasSound() && !!H.sound().eq.on);
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
    main.appendChild(cover(artOf(it), it.al || it.t, "xs"));
    var tx = el("span", "row-text");
    tx.appendChild(el("span", "row-t", it.t || "?"));
    tx.appendChild(el("span", "row-s dim", it.a || ""));
    main.appendChild(tx);
    if (!isNow) main.addEventListener("click", function () { H.jump(n); });
    li.appendChild(main);
    if (typeof upIdx === "number") li.appendChild(button(t("q.remove"), "icon-btn", function () { H.removeUp(upIdx); var b = li.closest(".fp-queue"); if (b) paintQueue(b); }, I.x));
    return li;
  }

  // ---------- 7b. Lyrics, sound, sleep timer (wave 5) ----------
  // Lyrics: the .lrc file next to a song on this device, then the
  // lyrics in its tags, then LRCLIB (opt-in; only title, artist, album
  // and length go out). Found lyrics and misses are kept on this
  // device ("oros-music-lyrics", the 150 newest; misses for a week).
  var LY_KEY = "oros-music-lyrics", LY_MAX = 150, LY_MISS = 7 * 86400000;
  var LRCLIB = "https://lrclib.net/api/";
  function lyCache() {
    try { var o = JSON.parse(localStorage.getItem(LY_KEY) || "null"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; }
  }
  function lyPut(k, rec) {
    var all = lyCache();
    rec.m = Date.now();
    all[k] = rec;
    var keys = Object.keys(all).sort(function (a, b) { return (all[b].m || 0) - (all[a].m || 0); });
    keys.slice(LY_MAX).forEach(function (x) { delete all[x]; });
    for (var n = keys.length; n > 0; n--) {
      try { localStorage.setItem(LY_KEY, JSON.stringify(all)); return; }
      catch (e) { delete all[keys[n - 1]]; }      // storage full: drop the oldest
    }
  }
  function lyOf(text, src) { var r = C.parseLrc(text); return r.lines.length || r.plain ? { lines: r.lines, plain: r.plain, src: src } : null; }
  function recOf(p) { for (var i = 0; i < tracks.length; i++) if (tracks[i].p === p) return tracks[i]; return null; }
  // → Promise<{ lines, plain, src } | { instr } | { ask } | { none } | { err }>
  function lyricsFor(c, online) {
    var local = !c.p || !LIB ? Promise.resolve(null) : LIB.lrcFor(c.p).then(function (txt) {
      if (txt && lyOf(txt, "file")) return lyOf(txt, "file");
      var rec = recOf(c.p);
      return rec && rec.ly ? LIB.tagLyrics(c.p).then(function (tx) { return tx ? lyOf(tx, "tags") : null; }) : null;
    });
    return local.then(function (found) {
      if (found) return found;
      var hit = lyCache()[c.k];
      if (hit && !hit.n) return hit.i ? { instr: 1 } : lyOf(hit.s || hit.p || "", "lrclib") || { none: 1 };
      if (hit && hit.n && Date.now() - hit.m < LY_MISS && !online) return { none: 1 };
      if (prefs.ly !== "on" && !online) return prefs.ly === "off" ? { none: 1 } : { ask: 1 };
      if (navigator.onLine === false) return { err: "offline" };
      return lrclib(c);
    });
  }
  function lrclib(c) {
    var q = function (o) { return Object.keys(o).filter(function (k) { return o[k]; }).map(function (k) { return k + "=" + encodeURIComponent(o[k]); }).join("&"); };
    var get = function (u) {
      return fetch(LRCLIB + u, { credentials: "omit", referrerPolicy: "no-referrer" }).then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("http");
        return r.json();
      });
    };
    var one = q({ track_name: c.t, artist_name: c.a, album_name: c.al, duration: c.d ? String(Math.round(c.d)) : "" });
    var keep = function (x) {
      if (!x) { lyPut(c.k, { n: 1 }); return { none: 1 }; }
      var rec = { s: typeof x.syncedLyrics === "string" ? x.syncedLyrics.slice(0, 30000) : "", p: typeof x.plainLyrics === "string" ? x.plainLyrics.slice(0, 30000) : "", i: x.instrumental ? 1 : 0 };
      if (!rec.s && !rec.p && !rec.i) { lyPut(c.k, { n: 1 }); return { none: 1 }; }
      lyPut(c.k, rec);
      return rec.i && !rec.s && !rec.p ? { instr: 1 } : lyOf(rec.s || rec.p, "lrclib") || { none: 1 };
    };
    return (c.al && c.d ? get("get?" + one) : Promise.resolve(null)).then(function (x) {
      if (x) return keep(x);
      return get("search?" + q({ track_name: c.t, artist_name: c.a })).then(function (list) { return keep(C.lrclibPick(list, c)); });
    }).catch(function () { return { err: "net" }; });
  }
  // The lyrics panel of the full player. → { tick(pos) }
  function lyPanel(box, c) {
    var my = {}, lines = null, at = -2, rows = [];
    box.textContent = "";
    box.appendChild(el("p", "empty", t("ly.wait")));
    var show = function (r) {
      if (box._for !== c.k) return;
      box.textContent = "";
      if (r.ask) {
        var ask = el("div", "ly-ask");
        ask.appendChild(el("h3", "q-h", t("ly.askT")));
        ask.appendChild(el("p", "dim small", t("ly.ask")));
        var bt = el("div", "dlg-btns");
        bt.appendChild(button(t("ly.no"), "txt-btn", function () { prefs.ly = "off"; savePrefs(); show({ none: 1 }); }));
        bt.appendChild(button(t("ly.yes"), "txt-btn accent", function () { prefs.ly = "on"; savePrefs(); go(true); }));
        ask.appendChild(bt);
        box.appendChild(ask);
        return;
      }
      if (r.err || r.none || r.instr) {
        box.appendChild(el("p", "empty", t(r.instr ? "ly.instr" : r.err === "offline" ? "ly.offline" : r.err ? "ly.err" : "ly.none")));
        if (r.err || (r.none && prefs.ly !== "off" && navigator.onLine !== false)) box.appendChild(el("div", "dlg-btns center")).appendChild(button(t("ly.retry"), "txt-btn", function () { go(true); }));
        return;
      }
      var wrap = el("div", "ly-text" + (r.lines.length ? " synced" : ""));
      if (r.lines.length) {
        lines = r.lines;
        rows = lines.map(function (x) {
          var b = el("button", "ly-l", x.s || "♪");
          b.type = "button";
          b.addEventListener("click", function () { H.seekTo(x.t); });
          wrap.appendChild(b);
          return b;
        });
      } else {
        wrap.appendChild(el("p", "ly-plain", r.plain));
        box.appendChild(wrap);
        box.appendChild(el("p", "dim small ly-src", t("ly.plain")));
        wrap = null;
      }
      if (wrap) box.appendChild(wrap);
      var src = el("p", "dim small ly-src");
      if (r.src === "lrclib") {
        src.appendChild(document.createTextNode(t("ly.from", { s: "" })));
        var a = el("button", "link", "LRCLIB");
        a.type = "button";
        a.addEventListener("click", function () { openExt("https://lrclib.net/"); });
        src.appendChild(a);
      } else src.textContent = t("ly.from", { s: t(r.src === "file" ? "ly.file" : "ly.tags") });
      box.appendChild(src);
      at = -2;
      my.tick(H.getState().pos);
    };
    var go = function (online) {
      box._for = c.k;
      box.textContent = "";
      box.appendChild(el("p", "empty", t("ly.wait")));
      lyricsFor(c, online).then(show, function () { show({ err: "net" }); });
    };
    my.tick = function (pos) {
      if (!lines) return;
      var i = C.lrcAt(lines, pos);
      if (i === at) return;
      if (rows[at]) rows[at].classList.remove("on");
      at = i;
      if (rows[i]) {
        rows[i].classList.add("on");
        var r = rows[i];
        box.scrollTop = Math.max(0, r.offsetTop - box.clientHeight / 2 + r.offsetHeight / 2);
      }
    };
    go(false);
    return my;
  }
  function hasSound() { return !!(H && typeof H.sound === "function"); }
  function eqLabel(hz) { return hz >= 1000 ? t("snd.khz", { n: hz / 1000 }) : t("snd.hz", { n: hz }); }
  function soundDlg() {
    if (!hasSound()) return;
    var dlg = makeDialog("mu-sound", "menu-dlg sound-dlg");
    dlg.appendChild(el("h2", "dlg-title", t("snd.title")));
    var s = H.sound();
    // Equalizer
    var eqOn = el("label", "check");
    var cb = el("input"); cb.type = "checkbox"; cb.checked = !!s.eq.on;
    eqOn.appendChild(cb); eqOn.appendChild(el("span", "", t("snd.eq")));
    dlg.appendChild(eqOn);
    var lab = el("label", "field");
    lab.appendChild(el("span", "dim small", t("snd.preset")));
    var sel = el("select");
    Object.keys(C.EQ_PRESETS).concat(["custom"]).forEach(function (k) {
      var o = el("option", "", t(k === "custom" ? "snd.custom" : "eq." + k)); o.value = k; sel.appendChild(o);
    });
    sel.value = s.eq.p;
    lab.appendChild(sel);
    dlg.appendChild(lab);
    var bands = el("div", "eq-bands"), ranges = [];
    C.EQ_HZ.forEach(function (hz, i) {
      var row = el("label", "eq-band");
      row.appendChild(el("span", "eq-hz small", eqLabel(hz)));
      var r = el("input");
      r.type = "range"; r.min = "-12"; r.max = "12"; r.step = "1"; r.value = String(s.eq.g[i]);
      r.setAttribute("aria-label", t("snd.eq") + " " + eqLabel(hz));
      var v = el("span", "eq-v small", (s.eq.g[i] > 0 ? "+" : "") + s.eq.g[i]);
      r.addEventListener("input", function () {
        var g = ranges.map(function (x) { return +x.value; });
        v.textContent = (+r.value > 0 ? "+" : "") + r.value;
        sel.value = "custom";
        H.setSound({ eq: { on: 1, p: "custom", g: g } });
        cb.checked = true; paintOn();
      });
      ranges.push(r);
      row.appendChild(r); row.appendChild(v);
      bands.appendChild(row);
    });
    dlg.appendChild(bands);
    var eqNote = el("p", "dim small", t("snd.eqHint"));
    dlg.appendChild(eqNote);
    var paintOn = function () {
      var st = H.getState(), on = cb.checked;
      bands.classList.toggle("off", !on);
      eqNote.textContent = on && st.cur && !st.eq ? t("snd.eqOff") : t("snd.eqHint");
    };
    var setBands = function (g) { ranges.forEach(function (r, i) { r.value = String(g[i]); r.nextSibling.textContent = (g[i] > 0 ? "+" : "") + g[i]; }); };
    cb.addEventListener("change", function () { H.setSound({ eq: { on: cb.checked ? 1 : 0 } }); paintOn(); });
    sel.addEventListener("change", function () {
      var g = C.EQ_PRESETS[sel.value] ? C.EQ_PRESETS[sel.value].slice() : ranges.map(function (x) { return +x.value; });
      setBands(g);
      cb.checked = true;
      H.setSound({ eq: { on: 1, p: sel.value, g: g } });
      paintOn();
    });
    // Crossfade + gapless
    var xl = el("label", "field");
    var xt = el("span", "dim small");
    var xr = el("input"); xr.type = "range"; xr.min = "0"; xr.max = "12"; xr.step = "1"; xr.value = String(s.xf);
    var xLabel = function () { xt.textContent = t("snd.xf") + ": " + (+xr.value ? t("snd.xfS", { n: xr.value }) : t("snd.xfOff")); };
    xLabel();
    xr.addEventListener("input", xLabel);
    xr.addEventListener("change", function () { H.setSound({ xf: +xr.value }); });
    xl.appendChild(xt); xl.appendChild(xr);
    dlg.appendChild(xl);
    var gl = el("label", "check");
    var gc = el("input"); gc.type = "checkbox"; gc.checked = !!s.gap;
    gc.addEventListener("change", function () { H.setSound({ gap: gc.checked ? 1 : 0 }); });
    gl.appendChild(gc); gl.appendChild(el("span", "", t("snd.gap")));
    dlg.appendChild(gl);
    // ReplayGain
    var rl = el("label", "field");
    rl.appendChild(el("span", "dim small", t("snd.rg")));
    var rs = el("select");
    [["off", "snd.rgOff"], ["auto", "snd.rgAuto"], ["track", "snd.rgTrack"], ["album", "snd.rgAlbum"]].forEach(function (x) {
      var o = el("option", "", t(x[1])); o.value = x[0]; rs.appendChild(o);
    });
    rs.value = s.rg;
    rs.addEventListener("change", function () { H.setSound({ rg: rs.value }); });
    rl.appendChild(rs);
    dlg.appendChild(rl);
    dlg.appendChild(el("p", "dim small", t("snd.rgHint")));
    var row = el("div", "dlg-btns");
    row.appendChild(button(t("snd.reset"), "txt-btn", function () {
      H.setSound({ eq: { on: 0, p: "flat", g: C.EQ_PRESETS.flat.slice() }, xf: 0, gap: 1, rg: "auto", pre: 0 });
      dlg.close(); soundDlg();
    }));
    row.appendChild(button(t("close"), "txt-btn accent", function () { dlg.close(); }));
    dlg.appendChild(row);
    openDialog(dlg);
    paintOn();
  }
  function sleepLeft(st) {
    var s = st && st.sleep;
    if (!s) return "";
    if (s.end) return t("sl.leftEnd");
    if (!s.at) return "";
    var ms = Math.max(0, s.at - Date.now()), m = Math.ceil(ms / 60000);
    return t("sl.left", { n: m > 1 ? t("sl.min", { n: m }) : C.fmtTime(ms / 1000) });
  }
  function sleepDlg() {
    if (!hasSound()) return;
    var st = H.getState(), items = [];
    if (st.sleep && (st.sleep.at || st.sleep.end)) items.push([t("sl.off"), function () { H.sleep(0); showToast(t("sl.cleared")); }, true]);
    C.SLEEP_MIN.forEach(function (n) { items.push([t("sl.min", { n: n }), function () { H.sleep(n); showToast(t("sl.set", { n: t("sl.min", { n: n }) })); }]); });
    items.push([t("sl.end"), function () { H.sleep("end"); showToast(t("sl.setEnd")); }]);
    menuDlg(items, t("sl.title"), sleepLeft(st));
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
  function promptDlg(title, label, value, okLabel, fn, max) {
    var dlg = makeDialog("mu-prompt", "menu-dlg");
    var form = el("form", "");
    form.method = "dialog";
    form.appendChild(el("h2", "dlg-title", title));
    var lab = el("label", "field");
    lab.appendChild(el("span", "dim small", label));
    var inp = el("input");
    inp.type = "text"; inp.maxLength = max || C.LIM.plName; inp.value = value || "";
    if (max) inp.inputMode = "url";
    if (max) { inp.spellcheck = false; inp.setAttribute("autocapitalize", "none"); }
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
      var v = C.clean(inp.value, max || C.LIM.plName);
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
    if (O) {
      var ol = el("label", "check");
      var cb = el("input");
      cb.type = "checkbox"; cb.checked = !!prefs.open;
      cb.addEventListener("change", function () { prefs.open = cb.checked; savePrefs(); renderKeepScroll(); });
      ol.appendChild(cb);
      ol.appendChild(el("span", "", t("s.open")));
      dlg.appendChild(ol);
      dlg.appendChild(el("p", "dim small", t("s.openHint")));
      var nOff = Object.keys(offKeys).length;
      if (nOff) {
        dlg.appendChild(el("p", "dim small", t("s.offInfo", { n: nSongs(nOff), s: fmtSize(offSize()) })));
        dlg.appendChild(el("div", "menu-col")).appendChild(button(t("s.offClear"), "danger", function () {
          dlg.close();
          confirmDlg(t("s.offClearQ", { n: nOff }), t("s.offClear"), function () { delOffline(Object.keys(offKeys)); });
        }));
      }
    }
    var ll = el("label", "check");
    var lc = el("input");
    lc.type = "checkbox"; lc.checked = prefs.ly === "on";
    lc.addEventListener("change", function () { prefs.ly = lc.checked ? "on" : "off"; savePrefs(); });
    ll.appendChild(lc);
    ll.appendChild(el("span", "", t("s.lrclib")));
    dlg.appendChild(ll);
    dlg.appendChild(el("p", "dim small", t("s.lrclibHint")));
    var col = el("div", "menu-col");
    if (hasSound()) col.appendChild(button(t("snd.title"), "", function () { dlg.close(); soundDlg(); }));
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
  // { artist } | { pl } | { liked: 1 } | { track } (plays it) |
  // { ia } (an Internet Archive album) | { jm } (a Jamendo album).
  function openTarget(tg) {
    if (!H || !tg || typeof tg !== "object" || document.querySelector("dialog[open]")) return;
    view = null; history = [];
    if (typeof tg.album === "string") openView({ kind: "album", id: tg.album });
    else if (typeof tg.artist === "string") openView({ kind: "artist", id: tg.artist });
    else if (typeof tg.pl === "string" && C.findPl(D(), tg.pl)) openView({ kind: "pl", id: tg.pl });
    else if (tg.liked) openView({ kind: "liked" });
    else if (typeof tg.ia === "string" && O) openView({ kind: "ia", id: tg.ia });
    else if (typeof tg.jm === "string" && O) openView({ kind: "jm", id: tg.jm });
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
      return Promise.all([loadIndex(), loadOff().catch(function () {}), SV ? SV.ready().catch(function () {}) : null]).then(function () {
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
