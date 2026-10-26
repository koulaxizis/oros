// ============================================================
// orOS Lyric Sync — the app inside the shell frame
// Time lyrics to a song line by line (Tap: each tap starts the next
// line; Hold: hold while the line is sung, like DistroKid's tool),
// fix the times, preview them, and export LRC / SRT / WebVTT / TTML /
// JSON / text (formats.js).
// Data:
//   - the songs (title, artist, lines and times) in localStorage
//     "oros-lyricsync-data", synced as slice "lyricsync" (core.js);
//   - the audio file only on this device, in IndexedDB
//     "oros-lyricsync" (store "audio", key = song id). It never leaves
//     the device and is never synced; another device asks for it.
//   - device-only settings in "oros-lyricsync-device" (mode, speed).
// Boot order (OROS_BIBLE.md Part VI "Boot sequence"):
//   load → applyI18n → wire → registerSync → inheritPalette →
//   watchPalette → render → take a pending deep link.
// Rules: R8 (shell APIs from window.parent, guarded), 5-argument
// registerSlice, a pulled slice never marks dirty, user and imported
// text only through textContent.
// ============================================================
(function () {
  "use strict";

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("lyricsync/app.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var APP_ID = "lyricsync";
  var STORAGE_KEY = "oros-lyricsync-data";
  var DEVICE_KEY = "oros-lyricsync-device";
  var C = window.LyricsyncCore, F = window.LyricsyncFormats, ID3 = window.LyricsyncId3;
  var MAX_AUDIO = 400 * 1024 * 1024, MAX_TEXT_FILE = 4 * 1024 * 1024, MAX_UNDO = 300;
  var LYRIC_ACCEPT = ".lrc,.elrc,.srt,.vtt,.ttml,.dfxp,.xml,.ass,.ssa,.json,.txt";
  var MAX_WAVE = 80 * 1024 * 1024, SPANS = [4, 8, 16, 32, 64];
  var AUDIO_ACCEPT = "audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.oga,.opus,.webm";

  // ---------- 1. Language ----------
  var STR = {
    en: {
      "app.name": "Lyric Sync",
      "btn.back": "Back to the songs", "btn.open": "Open file", "btn.new": "New song", "btn.export": "Export",
      "list.intro": "Time your lyrics to the music, line by line, and save them as LRC, SRT, WebVTT or TTML. The song never leaves this device.",
      "list.empty": "No songs yet. Press New song, or open a song or a lyrics file.",
      "list.untitled": "Untitled song", "list.count": "{n} of {total} lines timed", "list.noAudio": "song file not on this device",
      "list.del": "Delete", "list.delAsk": "Delete “{name}”? The lyrics and their times go on all your devices. The song file itself stays where it is.",
      "list.deleted": "Song deleted",
      "tab.lyrics": "Lyrics", "tab.sync": "Sync", "tab.preview": "Preview",
      "btn.audio": "Choose the song", "btn.audioChange": "Change the song",
      "audio.none": "No song file yet.", "audio.missing": "“{name}” is not on this device. Choose it again to sync or listen.",
      "audio.big": "This file is too big (over {n} MB).", "audio.bad": "This file cannot be played here. Try MP3, M4A, WAV, FLAC or Ogg.",
      "audio.saved": "The song is kept on this device only.", "audio.full": "There is no room on this device for the song file. It plays now but is not kept.",
      "f.name": "Title", "f.artist": "Artist", "f.album": "Album", "f.lang": "Language code", "f.langPh": "e.g. en, el, de",
      "f.lyrics": "Lyrics, one line per line. A blank line starts a new verse.",
      "f.speed": "Speed", "f.seek": "Position in the song", "f.start": "Start time of the selected line",
      "btn.importLyrics": "Open a lyrics file", "lyrics.count": "{n} lines",
      "btn.rew": "Back 5 seconds", "btn.fwd": "Forward 5 seconds", "btn.play": "Play", "btn.pause": "Pause",
      "mode.label": "How to sync", "mode.tap": "Tap", "mode.hold": "Hold",
      "mode.tapHint": "Play the song and tap (or press Space) as each line starts. Each line ends where the next starts; End line marks a pause.",
      "mode.holdHint": "Play the song, then hold the button (or Space) while each line is sung and let go when it ends.",
      "btn.undo": "Undo", "btn.redo": "Redo", "sync.progress": "{n}/{total} timed",
      "btn.playLine": "Play", "btn.syncFrom": "Sync from here", "btn.clearTime": "Clear time",
      "sync.noLines": "Write or paste the lyrics in the Lyrics tab first.",
      "btn.end": "End line", "pad.tap": "Tap", "pad.hold": "Hold", "pad.start": "Play", "pad.next": "Next: {line}", "pad.done": "All lines are timed",
      "sync.needAudio": "Choose the song file first.", "sync.started": "Playing. Now mark each line as it starts.",
      "sync.allDone": "Every line is timed. Pick a line and press Sync from here to redo from there.",
      "sync.from": "Syncing again from line {n}.", "sync.noEnd": "Tap a line first, then End line marks where it stops.",
      "sync.badTime": "Write the time as minutes:seconds, for example 1:02.50.",
      "sync.untimed": "not timed", "sync.undone": "Undone", "sync.nothing": "Nothing to undo",
      "ex.title": "Export", "ex.sum": "{n} of {total} lines are timed.", "ex.none": "Time at least one line first. Lyrics text and JSON can be saved any time.",
      "ex.lrc": "LRC", "ex.lrcD": "Line-timed lyrics for music players, karaoke and LRCLIB.",
      "ex.srt": "SRT", "ex.srtD": "Subtitles for video editors, Facebook and most players.",
      "ex.vtt": "WebVTT", "ex.vttD": "Subtitles for the web and YouTube.",
      "ex.ttml": "TTML", "ex.ttmlD": "Timed lyrics for Apple Music, iTunes, YouTube and distributors such as DistroKid.",
      "ex.json": "JSON (orOS)", "ex.jsonD": "Everything, to open again here or in your own tools.",
      "ex.txt": "Text", "ex.txtD": "Just the words, with blank lines between verses.",
      "ex.save": "Save", "ex.saved": "Saved {name}",
      "imp.bad": "This file has no lyrics Lyric Sync can read.", "imp.big": "This file is too big for lyrics.",
      "imp.ask": "Replace the lyrics and times of this song with the file?", "imp.yes": "Replace",
      "imp.done": "{n} lines read from {name}",
      "btn.close": "Close", "btn.cancel": "Cancel", "btn.delete": "Delete",
      "f.singers": "Singers, for duets (comma between names)", "f.singersPh": "e.g. Anna, Nikos", "f.singer": "Singer", "singer.n": "Singer {n}",
      "wave.label": "Waveform of the song with the lines' start marks", "wave.out": "Show more of the song", "wave.in": "Zoom in", "wave.loop": "Loop line",
      "wave.hint": "Drag a mark to move it; tap anywhere else to jump there.", "wave.big": "The waveform is shown for song files up to 80 MB.", "wave.none": "This song's waveform could not be drawn.",
      "mode.words": "Words", "mode.wordsHint": "Word by word, for karaoke: tap as each word starts. The first tap of a line also starts the line. Tap a word above to time again from it.",
      "btn.check": "Check", "btn.shift": "Shift all", "btn.calib": "Tap delay", "btn.clearWords": "Clear word times",
      "words.count": "{n}/{total} words", "pad.word": "Next word: {w}",
      "ck.title": "Check", "ck.none": "Nothing to fix. The lyrics are ready to send.", "ck.sum": "{n} things to look at. Tap one to go to its line.", "ck.line": "Line {n}",
      "ck.untimed": "has no time yet", "ck.order": "starts before a line above it", "ck.short": "is on screen for less than half a second",
      "ck.long": "is very long (over 80 characters): split it in two", "ck.label": "looks like a label or a repeat mark ([Chorus], x2): distributors want only the sung words",
      "ck.words": "has only some of its words timed", "ck.gap": "stays on screen 15 seconds or more: press End line where the singing stops",
      "sh.title": "Shift all times", "sh.hint": "Moves every timed line and word by the same amount, for example when the song file has a different intro.",
      "sh.label": "Seconds (minus = earlier)", "sh.apply": "Shift", "sh.bad": "Write a number of seconds, for example -1.5 or 0.25.", "sh.done": "Every time moved by {s} s",
      "cal.title": "Tap delay", "cal.hint": "Everyone taps a little late. Press Start, then tap the button (or Space) on each of the 8 clicks you hear. Lyric Sync takes your delay off every tap.",
      "cal.start": "Start", "cal.tap": "Tap on the click", "cal.now": "Your tap delay now: {n} ms", "cal.done": "Measured {n} ms. Every tap is corrected from now on.",
      "cal.fail": "Not enough taps landed on the clicks. Try again.", "cal.reset": "Set to 0",
      "ex.elrc": "Enhanced LRC", "ex.elrcD": "LRC with a time for every word, for karaoke players.",
      "ex.ass": "ASS karaoke", "ex.assD": "Karaoke subtitles that fill word by word, for video tools (Aegisub, ffmpeg, VLC).",
      "ex.words": "{n} lines have a time for every word.", "ex.issues": "{n} things to check before you send it to a distributor.", "ex.check": "Check",
      "x.music": "Lyrics for Music", "x.musicD": "Saves the .lrc file next to the song in your Music folder, so Music shows the lyrics as it plays (on every device that syncs).",
      "x.mp3": "MP3 with the lyrics inside", "x.mp3D": "A copy of the song with the lyrics in its tags (USLT and synced SYLT), for phones, car stereos and players that read them. The song itself is not changed.",
      "x.video": "Lyric video in Montage", "x.videoD": "Opens a new Montage project with the song and every line as a text clip, ready to style and export as a video.",
      "x.saveHere": "Save", "x.make": "Make", "x.open": "Open",
      "x.lrcSaved": "Saved next to the song. Music shows the lyrics now.", "x.lrcAsk": "There is already a lyrics file next to this song. Replace it?", "x.replace": "Replace",
      "x.noFs": "The orOS disk is not available here.", "x.fail": "Could not save the file.",
      "x.mp3Bad": "This song file's tags cannot be rewritten safely, so no copy was made.", "x.mp3Not": "Only MP3 songs can carry the lyrics inside.",
      "x.videoNeed": "The song must be on the orOS disk (open it from Music or Files) to go to Montage.",
      "audio.disk": "{name} (orOS disk)", "audio.diskMissing": "“{name}” is not on the orOS disk of this device yet. It comes with Vault Drive, or choose it again.",
      "from.music": "From Music: {name}", "list.music": "song on the orOS disk", "open.bad": "Lyric Sync cannot open this file.",
      "btn.auto": "Rough sync",
      "btn.full": "Full screen",
      "au.title": "Rough sync from the song",
      "au.hint": "Lyric Sync listens to the song on this device (Whisper, the same as Montage's automatic subtitles) and gives each line a rough start. Your words stay as you wrote them. Then play the song and fix the lines by ear. It works best with clear vocals.",
      "au.need": "The first time, it downloads the speech model once (about {mb} MB from Hugging Face, plus {rt} MB from orOS). Montage uses the same copy. The song is never sent anywhere.",
      "au.ready": "The speech model is on this device. The song is never sent anywhere.",
      "au.all": "Also move lines that already have a time",
      "au.go": "Start",
      "au.decoding": "Reading the song…",
      "au.download": "Downloading the speech model… {p}%",
      "au.listening": "Listening… {p}%",
      "au.done": "{n} lines got a rough time. Play the song and fix them by ear.",
      "au.none": "Nothing in the song matched the lyrics. Check the language code, or sync by tapping.",
      "au.fail": "Could not listen to the song.",
      "au.net": "Could not download the speech model. Check the connection and try again.",
      "au.needText": "Write the lyrics first.",
      "au.noRun": "Rough sync does not work in this browser.",
      "full": "This device is out of storage space. The change was not saved."
    },
    el: {
      "app.name": "Συγχρονισμός στίχων",
      "btn.back": "Πίσω στα τραγούδια", "btn.open": "Άνοιγμα αρχείου", "btn.new": "Νέο τραγούδι", "btn.export": "Εξαγωγή",
      "list.intro": "Συγχρόνισε τους στίχους με τη μουσική, γραμμή γραμμή, και αποθήκευσέ τους ως LRC, SRT, WebVTT ή TTML. Το τραγούδι δεν φεύγει ποτέ από αυτή τη συσκευή.",
      "list.empty": "Δεν υπάρχουν τραγούδια ακόμα. Πάτησε Νέο τραγούδι ή άνοιξε ένα τραγούδι ή ένα αρχείο στίχων.",
      "list.untitled": "Τραγούδι χωρίς τίτλο", "list.count": "{n} από {total} γραμμές συγχρονισμένες", "list.noAudio": "το αρχείο του τραγουδιού δεν είναι σε αυτή τη συσκευή",
      "list.del": "Διαγραφή", "list.delAsk": "Να διαγραφεί το «{name}»; Οι στίχοι και οι χρόνοι τους φεύγουν από όλες τις συσκευές σου. Το ίδιο το αρχείο του τραγουδιού μένει όπου είναι.",
      "list.deleted": "Το τραγούδι διαγράφηκε",
      "tab.lyrics": "Στίχοι", "tab.sync": "Συγχρονισμός", "tab.preview": "Προεπισκόπηση",
      "btn.audio": "Διάλεξε το τραγούδι", "btn.audioChange": "Άλλαξε το τραγούδι",
      "audio.none": "Δεν υπάρχει ακόμα αρχείο τραγουδιού.", "audio.missing": "Το «{name}» δεν είναι σε αυτή τη συσκευή. Διάλεξέ το ξανά για να συγχρονίσεις ή να ακούσεις.",
      "audio.big": "Το αρχείο είναι πολύ μεγάλο (πάνω από {n} MB).", "audio.bad": "Αυτό το αρχείο δεν παίζει εδώ. Δοκίμασε MP3, M4A, WAV, FLAC ή Ogg.",
      "audio.saved": "Το τραγούδι μένει μόνο σε αυτή τη συσκευή.", "audio.full": "Δεν υπάρχει χώρος στη συσκευή για το αρχείο. Παίζει τώρα, αλλά δεν κρατιέται.",
      "f.name": "Τίτλος", "f.artist": "Καλλιτέχνης", "f.album": "Άλμπουμ", "f.lang": "Κωδικός γλώσσας", "f.langPh": "π.χ. el, en, de",
      "f.lyrics": "Στίχοι, μία γραμμή ανά σειρά. Μια κενή σειρά ξεκινά νέα στροφή.",
      "f.speed": "Ταχύτητα", "f.seek": "Θέση στο τραγούδι", "f.start": "Χρόνος έναρξης της επιλεγμένης γραμμής",
      "btn.importLyrics": "Άνοιξε αρχείο στίχων", "lyrics.count": "{n} γραμμές",
      "btn.rew": "Πίσω 5 δευτερόλεπτα", "btn.fwd": "Μπροστά 5 δευτερόλεπτα", "btn.play": "Αναπαραγωγή", "btn.pause": "Παύση",
      "mode.label": "Τρόπος συγχρονισμού", "mode.tap": "Πάτημα", "mode.hold": "Κράτημα",
      "mode.tapHint": "Βάλε το τραγούδι να παίζει και πάτα (ή Space) τη στιγμή που ξεκινά κάθε γραμμή. Κάθε γραμμή τελειώνει εκεί που ξεκινά η επόμενη· το Τέλος γραμμής σημειώνει μια παύση.",
      "mode.holdHint": "Βάλε το τραγούδι να παίζει και κράτα πατημένο το κουμπί (ή το Space) όσο τραγουδιέται κάθε γραμμή· άφησέ το όταν τελειώνει.",
      "btn.undo": "Αναίρεση", "btn.redo": "Επανάληψη", "sync.progress": "{n}/{total} συγχρονισμένες",
      "btn.playLine": "Άκου", "btn.syncFrom": "Συγχρονισμός από εδώ", "btn.clearTime": "Σβήσε τον χρόνο",
      "sync.noLines": "Γράψε ή επικόλλησε πρώτα τους στίχους στην καρτέλα Στίχοι.",
      "btn.end": "Τέλος γραμμής", "pad.tap": "Πάτα", "pad.hold": "Κράτα", "pad.start": "Παίξε", "pad.next": "Επόμενη: {line}", "pad.done": "Όλες οι γραμμές έχουν χρόνο",
      "sync.needAudio": "Διάλεξε πρώτα το αρχείο του τραγουδιού.", "sync.started": "Παίζει. Τώρα σημείωσε κάθε γραμμή τη στιγμή που ξεκινά.",
      "sync.allDone": "Όλες οι γραμμές έχουν χρόνο. Διάλεξε μια γραμμή και πάτα Συγχρονισμός από εδώ για να ξαναγίνει από εκεί.",
      "sync.from": "Νέος συγχρονισμός από τη γραμμή {n}.", "sync.noEnd": "Σημείωσε πρώτα μια γραμμή· το Τέλος γραμμής δείχνει πού σταματά.",
      "sync.badTime": "Γράψε τον χρόνο ως λεπτά:δευτερόλεπτα, για παράδειγμα 1:02.50.",
      "sync.untimed": "χωρίς χρόνο", "sync.undone": "Αναιρέθηκε", "sync.nothing": "Τίποτα για αναίρεση",
      "ex.title": "Εξαγωγή", "ex.sum": "{n} από {total} γραμμές έχουν χρόνο.", "ex.none": "Συγχρόνισε πρώτα τουλάχιστον μία γραμμή. Το κείμενο των στίχων και το JSON αποθηκεύονται πάντα.",
      "ex.lrc": "LRC", "ex.lrcD": "Στίχοι με χρόνο ανά γραμμή για προγράμματα μουσικής, καραόκε και LRCLIB.",
      "ex.srt": "SRT", "ex.srtD": "Υπότιτλοι για προγράμματα επεξεργασίας βίντεο, Facebook και τα περισσότερα players.",
      "ex.vtt": "WebVTT", "ex.vttD": "Υπότιτλοι για το web και το YouTube.",
      "ex.ttml": "TTML", "ex.ttmlD": "Συγχρονισμένοι στίχοι για Apple Music, iTunes, YouTube και διανομείς όπως το DistroKid.",
      "ex.json": "JSON (orOS)", "ex.jsonD": "Όλα, για να τα ανοίξεις ξανά εδώ ή στα δικά σου εργαλεία.",
      "ex.txt": "Κείμενο", "ex.txtD": "Μόνο οι λέξεις, με κενή σειρά ανάμεσα στις στροφές.",
      "ex.save": "Αποθήκευση", "ex.saved": "Αποθηκεύτηκε το {name}",
      "imp.bad": "Αυτό το αρχείο δεν έχει στίχους που μπορεί να διαβάσει ο Συγχρονισμός στίχων.", "imp.big": "Το αρχείο είναι πολύ μεγάλο για στίχους.",
      "imp.ask": "Να αντικατασταθούν οι στίχοι και οι χρόνοι αυτού του τραγουδιού με το αρχείο;", "imp.yes": "Αντικατάσταση",
      "imp.done": "Διαβάστηκαν {n} γραμμές από το {name}",
      "btn.close": "Κλείσιμο", "btn.cancel": "Άκυρο", "btn.delete": "Διαγραφή",
      "f.singers": "Τραγουδιστές, για ντουέτα (κόμμα ανάμεσα στα ονόματα)", "f.singersPh": "π.χ. Άννα, Νίκος", "f.singer": "Τραγουδιστής", "singer.n": "Τραγουδιστής {n}",
      "wave.label": "Η κυματομορφή του τραγουδιού με τα σημάδια έναρξης των γραμμών", "wave.out": "Δείξε περισσότερο από το τραγούδι", "wave.in": "Μεγέθυνση", "wave.loop": "Επανάληψη γραμμής",
      "wave.hint": "Σύρε ένα σημάδι για να το μετακινήσεις· πάτα οπουδήποτε αλλού για να πας εκεί.", "wave.big": "Η κυματομορφή φαίνεται για αρχεία τραγουδιών έως 80 MB.", "wave.none": "Η κυματομορφή αυτού του τραγουδιού δεν σχεδιάστηκε.",
      "mode.words": "Λέξεις", "mode.wordsHint": "Λέξη λέξη, για καραόκε: πάτα τη στιγμή που ξεκινά κάθε λέξη. Το πρώτο πάτημα μιας γραμμής ξεκινά και τη γραμμή. Πάτα μια λέξη από πάνω για να ξαναρχίσεις από αυτή.",
      "btn.check": "Έλεγχος", "btn.shift": "Μετακίνηση όλων", "btn.calib": "Καθυστέρηση πατήματος", "btn.clearWords": "Σβήσε τους χρόνους λέξεων",
      "words.count": "{n}/{total} λέξεις", "pad.word": "Επόμενη λέξη: {w}",
      "ck.title": "Έλεγχος", "ck.none": "Τίποτα για διόρθωση. Οι στίχοι είναι έτοιμοι για αποστολή.", "ck.sum": "{n} σημεία για να δεις. Πάτα ένα για να πας στη γραμμή του.", "ck.line": "Γραμμή {n}",
      "ck.untimed": "δεν έχει ακόμα χρόνο", "ck.order": "ξεκινά πριν από μια γραμμή πιο πάνω", "ck.short": "μένει στην οθόνη λιγότερο από μισό δευτερόλεπτο",
      "ck.long": "είναι πολύ μεγάλη (πάνω από 80 χαρακτήρες): χώρισέ τη στα δύο", "ck.label": "μοιάζει με ετικέτα ή σημάδι επανάληψης ([Ρεφρέν], x2): οι διανομείς θέλουν μόνο τα λόγια που τραγουδιούνται",
      "ck.words": "έχει χρόνο μόνο σε μερικές λέξεις", "ck.gap": "μένει στην οθόνη 15 δευτερόλεπτα ή περισσότερο: πάτα Τέλος γραμμής εκεί που σταματά το τραγούδι",
      "sh.title": "Μετακίνηση όλων των χρόνων", "sh.hint": "Μετακινεί κάθε γραμμή και λέξη με χρόνο κατά το ίδιο διάστημα, για παράδειγμα όταν το αρχείο του τραγουδιού έχει άλλη εισαγωγή.",
      "sh.label": "Δευτερόλεπτα (μείον = νωρίτερα)", "sh.apply": "Μετακίνηση", "sh.bad": "Γράψε έναν αριθμό δευτερολέπτων, για παράδειγμα -1.5 ή 0.25.", "sh.done": "Όλοι οι χρόνοι μετακινήθηκαν κατά {s} δ.",
      "cal.title": "Καθυστέρηση πατήματος", "cal.hint": "Όλοι πατάμε λίγο αργά. Πάτα Έναρξη και μετά πάτα το κουμπί (ή το Space) σε καθένα από τα 8 κλικ που ακούς. Ο Συγχρονισμός στίχων αφαιρεί την καθυστέρησή σου από κάθε πάτημα.",
      "cal.start": "Έναρξη", "cal.tap": "Πάτα στο κλικ", "cal.now": "Η καθυστέρησή σου τώρα: {n} ms", "cal.done": "Μετρήθηκαν {n} ms. Κάθε πάτημα διορθώνεται από τώρα.",
      "cal.fail": "Λίγα πατήματα έπεσαν πάνω στα κλικ. Δοκίμασε ξανά.", "cal.reset": "Μηδενισμός",
      "ex.elrc": "Enhanced LRC", "ex.elrcD": "LRC με χρόνο για κάθε λέξη, για players καραόκε.",
      "ex.ass": "ASS καραόκε", "ex.assD": "Υπότιτλοι καραόκε που γεμίζουν λέξη λέξη, για προγράμματα βίντεο (Aegisub, ffmpeg, VLC).",
      "ex.words": "{n} γραμμές έχουν χρόνο σε κάθε λέξη.", "ex.issues": "{n} σημεία για έλεγχο πριν το στείλεις σε διανομέα.", "ex.check": "Έλεγχος",
      "x.music": "Στίχοι για τη Μουσική", "x.musicD": "Αποθηκεύει το αρχείο .lrc δίπλα στο τραγούδι στον φάκελο Μουσική, ώστε η Μουσική να δείχνει τους στίχους όσο παίζει (σε κάθε συσκευή που συγχρονίζεται).",
      "x.mp3": "MP3 με τους στίχους μέσα", "x.mp3D": "Ένα αντίγραφο του τραγουδιού με τους στίχους στις ετικέτες του (USLT και συγχρονισμένο SYLT), για κινητά, ηχοσυστήματα αυτοκινήτου και players που τους διαβάζουν. Το ίδιο το τραγούδι δεν αλλάζει.",
      "x.video": "Βίντεο στίχων στο Montage", "x.videoD": "Ανοίγει νέο έργο στο Montage με το τραγούδι και κάθε γραμμή ως κλιπ κειμένου, έτοιμο για εμφάνιση και εξαγωγή ως βίντεο.",
      "x.saveHere": "Αποθήκευση", "x.make": "Δημιουργία", "x.open": "Άνοιγμα",
      "x.lrcSaved": "Αποθηκεύτηκε δίπλα στο τραγούδι. Η Μουσική δείχνει τώρα τους στίχους.", "x.lrcAsk": "Υπάρχει ήδη αρχείο στίχων δίπλα σε αυτό το τραγούδι. Να αντικατασταθεί;", "x.replace": "Αντικατάσταση",
      "x.noFs": "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ.", "x.fail": "Δεν ήταν δυνατή η αποθήκευση του αρχείου.",
      "x.mp3Bad": "Οι ετικέτες αυτού του αρχείου δεν ξαναγράφονται με ασφάλεια, οπότε δεν φτιάχτηκε αντίγραφο.", "x.mp3Not": "Μόνο τα τραγούδια MP3 κρατούν τους στίχους μέσα τους.",
      "x.videoNeed": "Το τραγούδι πρέπει να είναι στον δίσκο του orOS (άνοιξέ το από τη Μουσική ή τα Αρχεία) για να πάει στο Montage.",
      "audio.disk": "{name} (δίσκος orOS)", "audio.diskMissing": "Το «{name}» δεν είναι ακόμα στον δίσκο του orOS σε αυτή τη συσκευή. Έρχεται με το Vault Drive, ή διάλεξέ το ξανά.",
      "from.music": "Από τη Μουσική: {name}", "list.music": "τραγούδι στον δίσκο του orOS", "open.bad": "Ο Συγχρονισμός στίχων δεν μπορεί να ανοίξει αυτό το αρχείο.",
      "btn.auto": "Πρόχειρος συγχρονισμός",
      "btn.full": "Πλήρης οθόνη",
      "au.title": "Πρόχειρος συγχρονισμός από το τραγούδι",
      "au.hint": "Ο Συγχρονισμός στίχων ακούει το τραγούδι σε αυτή τη συσκευή (Whisper, όπως οι αυτόματοι υπότιτλοι του Montage) και δίνει σε κάθε γραμμή έναν πρόχειρο χρόνο έναρξης. Τα λόγια σου μένουν όπως τα έγραψες. Μετά παίξε το τραγούδι και διόρθωσε τις γραμμές με το αυτί. Δουλεύει καλύτερα με καθαρή φωνή.",
      "au.need": "Την πρώτη φορά κατεβάζει μία φορά το μοντέλο ομιλίας (περίπου {mb} MB από το Hugging Face, και {rt} MB από το orOS). Το Montage χρησιμοποιεί το ίδιο αντίγραφο. Το τραγούδι δεν στέλνεται πουθενά.",
      "au.ready": "Το μοντέλο ομιλίας είναι σε αυτή τη συσκευή. Το τραγούδι δεν στέλνεται πουθενά.",
      "au.all": "Μετακίνησε και τις γραμμές που έχουν ήδη χρόνο",
      "au.go": "Έναρξη",
      "au.decoding": "Διάβασμα του τραγουδιού…",
      "au.download": "Λήψη του μοντέλου ομιλίας… {p}%",
      "au.listening": "Ακρόαση… {p}%",
      "au.done": "{n} γραμμές πήραν πρόχειρο χρόνο. Παίξε το τραγούδι και διόρθωσέ τες με το αυτί.",
      "au.none": "Τίποτα στο τραγούδι δεν ταίριαξε με τους στίχους. Έλεγξε τον κωδικό γλώσσας ή συγχρόνισε πατώντας.",
      "au.fail": "Δεν ήταν δυνατή η ακρόαση του τραγουδιού.",
      "au.net": "Δεν ήταν δυνατή η λήψη του μοντέλου ομιλίας. Έλεγξε τη σύνδεση και δοκίμασε ξανά.",
      "au.needText": "Γράψε πρώτα τους στίχους.",
      "au.noRun": "Ο πρόχειρος συγχρονισμός δεν λειτουργεί σε αυτόν τον browser.",
      "full": "Ο χώρος αποθήκευσης της συσκευής γέμισε. Η αλλαγή δεν αποθηκεύτηκε."
    }
  };

  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  if (window.orosI18n) window.orosI18n.table(STR, APP_ID, LANG);
  function t(k, params) {
    var p = STR[LANG] || STR.en;
    var s = p[k] !== undefined ? p[k] : (STR.en[k] !== undefined ? STR.en[k] : k);
    if (params) Object.keys(params).forEach(function (n) { s = s.split("{" + n + "}").join(String(params[n])); });
    return s;
  }

  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) { n.placeholder = t(n.getAttribute("data-i18n-ph")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) {
      var v = t(n.getAttribute("data-i18n-aria"));
      n.setAttribute("aria-label", v);
      if (n.tagName === "BUTTON") n.title = v;
    });
    document.title = t("app.name") + " · orOS";
  }

  // ---------- 2. Data: local first, then sync ----------
  var data = C.empty();
  var dev = { mode: "tap", speed: 1, lat: 0, span: 8 };

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function load() {
    try { data = C.normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch (e) { data = C.empty(); }
    try {
      var d = JSON.parse(localStorage.getItem(DEVICE_KEY) || "null") || {};
      if (d.mode === "hold" || d.mode === "words") dev.mode = d.mode;
      if (typeof d.lat === "number" && d.lat >= 0 && d.lat <= 400) dev.lat = Math.round(d.lat);
      if (SPANS.indexOf(d.span) >= 0) dev.span = d.span;
      if ([1, 0.9, 0.75, 0.5].indexOf(d.speed) >= 0) dev.speed = d.speed;
    } catch (e) { /* defaults */ }
  }
  function saveDev() { try { localStorage.setItem(DEVICE_KEY, JSON.stringify(dev)); } catch (e) { /* not kept */ } }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, C.serialize(data)); return true; }
    catch (e) { toast(t("full")); return false; }
  }

  // Every edit by the user ends here: write, then tell sync.
  function commit(next) {
    data = next;
    if (!persist()) return false;
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    return true;
  }
  function putProject(p) { return commit(C.put(data, p, Date.now())); }

  function sliceGet() { return C.normalize(data); }
  function sliceSet(incoming) {
    var merged = C.merge(data, incoming);
    if (C.serialize(merged) === C.serialize(data)) return;
    data = merged;
    persist();
    if (cur && !C.find(data, cur.id)) { closeSong(); return; }   // deleted on another device
    if (cur) { cur = C.find(data, cur.id); tlist = null; renderEditor(true); }
    else renderList();
  }

  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    try { api.registerSlice(APP_ID, sliceGet, sliceSet, STORAGE_KEY, C.merge); }   // 5 args, always
    catch (e) { /* engine busy: the next boot registers again */ }
  }

  // ---------- 3. Audio on this device (IndexedDB) ----------
  var idbP = null;
  function idb() {
    if (idbP) return idbP;
    idbP = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error("no idb")); return; }
      var rq = indexedDB.open("oros-lyricsync", 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore("audio"); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
    idbP.catch(function () { idbP = null; });
    return idbP;
  }
  function idbDo(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction("audio", mode), st = tx.objectStore("audio"), out;
        var rq = fn(st);
        if (rq) rq.onsuccess = function () { out = rq.result; };
        tx.oncomplete = function () { res(out); };
        tx.onerror = tx.onabort = function () { rej(tx.error); };
      });
    });
  }
  function audioGet(id) { return idbDo("readonly", function (st) { return st.get(id); }).catch(function () { return null; }); }
  function audioPut(id, blob, name) { return idbDo("readwrite", function (st) { return st.put({ blob: blob, name: name }, id); }); }
  function audioDel(id) { return idbDo("readwrite", function (st) { return st.delete(id); }).catch(function () {}); }
  function audioKeys() { return idbDo("readonly", function (st) { return st.getAllKeys(); }).catch(function () { return []; }); }

  // ---------- 4. Palette (G3) ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--panel-bg", "--border", "--danger"];
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

  // ---------- 5. Small helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  var toastTimer = 0;
  function toast(msg) {
    var box = $("toast");
    box.textContent = msg;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3200);
  }
  function confirmDlg(msg, yesLabel, onYes) {
    var d = $("confirm-dlg");
    $("confirm-msg").textContent = msg;
    $("confirm-yes").textContent = yesLabel;
    $("confirm-yes").onclick = function () { d.close(); onYes(); };
    $("confirm-no").onclick = function () { d.close(); };
    d.showModal();
  }
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function pickFile(accept) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.openFile === "function") return Promise.resolve(dlg.openFile(accept));
    return new Promise(function (res) {               // ?standalone only
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept;
      inp.addEventListener("change", function () { res(inp.files && inp.files[0] || null); });
      inp.addEventListener("cancel", function () { res(null); });
      inp.click();
    });
  }
  function saveFile(text, name, mime, ext) {
    return saveBlob(new Blob([text], { type: mime + ";charset=utf-8" }), name, mime, ext);
  }
  function saveBlob(blob, name, mime, ext) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      var acc = {}; acc[mime] = [ext];
      return Promise.resolve(dlg.saveFile({ blob: blob, filename: name, mime: mime, types: [{ description: t("app.name"), accept: acc }] }))
        .then(function (r) { return !!(r && r.ok); }, function () { return false; });
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 40000);
    return Promise.resolve(true);
  }
  function isAudioFile(f) {
    return /^audio\//.test(f.type || "") || /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|webm)$/i.test(f.name || "");
  }
  function baseName(n) { return String(n || "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").trim(); }
  function fileTitle(p) {
    var s = [p.ar, p.name || t("list.untitled")].filter(Boolean).join(" - ");
    return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "lyrics";
  }

  // ---------- 6. State ----------
  var cur = null;              // the open song (a project from data)
  var tab = "lyrics";
  var cursor = 0;              // the next line a tap times
  var sel = -1;                // the selected line (tools act on it)
  var toolsOpen = false;       // the line tools show for a line the user picked, not while tapping
  var holding = -1;            // Hold mode: the line being held
  var undoStack = [], redoStack = [];
  var tlist = null;            // C.timed() of the open song, rebuilt on change
  var audioUrl = "", audioOk = false;
  var audioBlob = null, audioDisk = false;   // the playing file; from the orOS disk (wave 3)
  var player = null;
  var lyricsTimer = 0;
  var wl = 0, wk = 0;          // Words mode: the next line and word to time
  var peaks = null, wave = null, loopOn = false;

  function timedList() { if (!tlist && cur) tlist = C.timed(cur.ln, cur.dur); return tlist || []; }
  function nowMs() { return player ? Math.round(player.currentTime * 1000) : 0; }
  // A tap's time: the play position less the measured tap delay (in
  // song time, so it scales with the speed).
  function tapMs() { return Math.max(0, nowMs() - Math.round(dev.lat * (player ? player.playbackRate : 1))); }

  // A change of lines: undo point, save, repaint.
  function setLines(lines, keepRedo) {
    if (!cur) return;
    undoStack.push({ ln: cur.ln, cursor: cursor, sel: sel });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    if (!keepRedo) redoStack = [];
    var next = Object.assign({}, cur, { ln: lines });
    if (!putProject(next)) { undoStack.pop(); return; }
    cur = C.find(data, cur.id);
    tlist = null;
    renderSync();
  }
  function undo() {
    if (!cur || !undoStack.length) { toast(t("sync.nothing")); return; }
    var u = undoStack.pop();
    redoStack.push({ ln: cur.ln, cursor: cursor, sel: sel });
    if (putProject(Object.assign({}, cur, { ln: u.ln }))) {
      cur = C.find(data, cur.id); tlist = null;
      cursor = u.cursor; sel = u.sel;
      renderEditor(true);
      toast(t("sync.undone"));
    }
  }
  function redo() {
    if (!cur || !redoStack.length) return;
    var r = redoStack.pop();
    undoStack.push({ ln: cur.ln, cursor: cursor, sel: sel });
    if (putProject(Object.assign({}, cur, { ln: r.ln }))) {
      cur = C.find(data, cur.id); tlist = null;
      cursor = r.cursor; sel = r.sel;
      renderEditor(true);
    }
  }

  // ---------- 7. The list of songs ----------
  var haveAudio = {};
  function renderList() {
    var ul = $("songs"), items = C.live(data);
    ul.textContent = "";
    items.forEach(function (p) {
      var li = el("li", "song");
      var open = el("button", "song-open");
      open.type = "button";
      open.appendChild(el("span", "song-name", p.name || t("list.untitled")));
      var meta = [p.ar, t("list.count", { n: C.timedCount(p.ln), total: p.ln.length })];
      if (p.src) meta.push(t("list.music"));
      else if (p.au && !haveAudio[p.id]) meta.push(t("list.noAudio"));
      open.appendChild(el("span", "song-meta dim", meta.filter(Boolean).join(" · ")));
      open.addEventListener("click", function () { openSong(p.id); });
      var del = el("button", "chip del", t("list.del"));
      del.type = "button";
      del.addEventListener("click", function () {
        confirmDlg(t("list.delAsk", { name: p.name || t("list.untitled") }), t("btn.delete"), function () {
          if (commit(C.remove(data, p.id, Date.now()))) { audioDel(p.id); renderList(); toast(t("list.deleted")); }
        });
      });
      li.appendChild(open);
      li.appendChild(del);
      ul.appendChild(li);
    });
    $("empty").hidden = items.length > 0;
  }
  function refreshAudioKeys() {
    audioKeys().then(function (keys) {
      haveAudio = {};
      (keys || []).forEach(function (k) { haveAudio[k] = 1; });
      if (!cur) renderList();
    });
  }

  function newSong(name) {
    var p = C.newProject(name || "", Date.now(), Math.random);
    if (!commit(C.put(data, p, Date.now()))) return null;
    return C.find(data, p.id);
  }

  // ---------- 8. One song ----------
  function showView(edit) {
    $("v-list").hidden = edit;
    $("v-edit").hidden = !edit;
    $("back-btn").hidden = !edit;
    $("open-btn").hidden = edit;
    $("new-btn").hidden = edit;
    $("export-btn").hidden = !edit;
    $("title").textContent = edit && cur ? (cur.name || t("list.untitled")) : t("app.name");
  }

  function openSong(id, toTab) {
    var p = C.find(data, id);
    if (!p) return;
    stopAudio();
    cur = p; tlist = null;
    undoStack = []; redoStack = [];
    cursor = C.nextUntimed(cur.ln, 0); sel = -1; holding = -1;
    wl = cursor < cur.ln.length ? cursor : 0; wk = 0; loopOn = false; peaks = null;
    showView(true);
    setTab(toTab || (cur.ln.length ? "sync" : "lyrics"));
    renderEditor(false);
    loadAudio();
  }
  function closeSong() {
    flushLyrics();
    stopAudio();
    cur = null; tlist = null;
    showView(false);
    refreshAudioKeys();
    renderList();
  }

  function stopAudio() {
    if (player) { player.pause(); player.removeAttribute("src"); try { player.load(); } catch (e) {} }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = ""; }
    audioOk = false; audioBlob = null; audioDisk = false;
  }
  function useBlob(blob, fromDisk) {
    stopAudio();
    audioBlob = blob; audioDisk = !!fromDisk;
    audioUrl = URL.createObjectURL(blob);
    player.src = audioUrl;
    player.playbackRate = dev.speed;
    audioOk = true;
    renderAudio();
    loadPeaks(blob);
  }
  function loadPeaks(blob) {
    peaks = null;
    var id = cur && cur.id;
    $("wave-hint").textContent = t("wave.hint");
    if (!window.LyricsyncWave) return;
    if (blob.size > MAX_WAVE) { $("wave-hint").textContent = t("wave.big"); return; }
    window.LyricsyncWave.peaks(blob).then(function (pk) {
      if (!cur || cur.id !== id) return;
      peaks = pk;
      drawWave();
    }, function () { $("wave-hint").textContent = t("wave.none"); });
  }
  function drawWave() { if (wave && cur && tab === "sync" && !$("wave-box").hidden) wave.draw(); }
  function loadAudio() {
    var id = cur.id;
    renderAudio();
    audioGet(id).then(function (rec) {
      if (!cur || cur.id !== id) return;
      if (rec && rec.blob) { useBlob(rec.blob); return; }
      if (cur.src) diskAudio(id, cur.src); else renderAudio();
    });
  }
  // A song on the orOS disk (from Music, Files or Studio): read from
  // there each time, never copied into this app's storage.
  function fsApi() {
    try { return (window.parent && window.parent !== window && window.parent.orosFS) || window.orosFS || null; }
    catch (e) { return window.orosFS || null; }
  }
  function diskAudio(id, src) {
    var fs = fsApi();
    if (!fs) { renderAudio(); return; }
    Promise.resolve(fs.read(src)).then(function (b) {
      if (!cur || cur.id !== id) return;
      if (!b || !b.size || b.size > MAX_AUDIO) { renderAudio(); return; }
      var file = b instanceof File ? b : new File([b], C.fileOf(src), { type: b.type || "" });
      useBlob(file, true);
    }, function () { if (cur && cur.id === id) renderAudio(); });
  }
  function attachAudio(file) {
    if (!cur || !file) return;
    if (file.size > MAX_AUDIO) { toast(t("audio.big", { n: Math.round(MAX_AUDIO / 1048576) })); return; }
    var id = cur.id;
    useBlob(file);
    var next = Object.assign({}, cur, { au: { n: file.name || "audio", z: file.size || 0 } });
    if (!cur.name) next.name = baseName(file.name);
    if (putProject(next)) { cur = C.find(data, id); showView(true); renderEditor(true); }
    audioPut(id, file, file.name || "").then(function () { toast(t("audio.saved")); }, function () { toast(t("audio.full")); });
  }
  function pickAudio() { pickFile(AUDIO_ACCEPT).then(function (f) { if (f) attachAudio(f); }); }

  function renderAudio() {
    if (!cur) return;
    var nm = $("audio-name");
    if (audioOk && audioDisk) { nm.textContent = t("audio.disk", { name: C.fileOf(cur.src) }); nm.classList.remove("warn"); }
    else if (audioOk) { nm.textContent = cur.au ? cur.au.n : ""; nm.classList.remove("warn"); }
    else if (cur.src) { nm.textContent = t("audio.diskMissing", { name: C.fileOf(cur.src) }); nm.classList.add("warn"); }
    else if (cur.au) { nm.textContent = t("audio.missing", { name: cur.au.n }); nm.classList.add("warn"); }
    else { nm.textContent = t("audio.none"); nm.classList.remove("warn"); }
    $("audio-btn").textContent = audioOk ? t("btn.audioChange") : t("btn.audio");
    renderPad();
  }

  function setTab(name) {
    if (tab === "lyrics" && name !== "lyrics") flushLyrics();
    tab = name;
    ["lyrics", "sync", "preview"].forEach(function (n) {
      var b = $("tab-" + n);
      b.setAttribute("aria-selected", n === name ? "true" : "false");
      b.tabIndex = n === name ? 0 : -1;
      $("p-" + n).hidden = n !== name;
    });
    $("transport").hidden = name === "lyrics";
    $("wave-box").hidden = name !== "sync";
    if (name === "sync") renderSync();
    if (name === "preview") renderStage();
  }

  function renderEditor(keepText) {
    if (!cur) return;
    $("title").textContent = cur.name || t("list.untitled");
    var fields = { "f-name": "name", "f-artist": "ar", "f-album": "al", "f-lang": "lg" };
    Object.keys(fields).forEach(function (fid) {
      var inp = $(fid);
      if (document.activeElement !== inp) inp.value = cur[fields[fid]] || "";
    });
    if (document.activeElement !== $("f-singers")) $("f-singers").value = (cur.vn || []).join(", ");
    var ta = $("lyrics-text");
    if (!(keepText && document.activeElement === ta)) ta.value = C.toText(cur.ln);
    $("lyrics-count").textContent = t("lyrics.count", { n: cur.ln.length });
    cursor = Math.min(cursor, cur.ln.length);
    if (sel >= cur.ln.length) sel = -1;
    renderAudio();
    renderSync();
    renderStage();
  }

  // Lyrics text → lines, keeping the times of unchanged lines.
  function flushLyrics() {
    if (!lyricsTimer) return;
    clearTimeout(lyricsTimer); lyricsTimer = 0;
    if (!cur) return;
    var text = $("lyrics-text").value;
    if (text === C.toText(cur.ln)) return;
    setLines(C.relyric(cur.ln, text, Math.random));
    cursor = C.nextUntimed(cur.ln, 0);
    $("lyrics-count").textContent = t("lyrics.count", { n: cur.ln.length });
  }
  function saveField(key, value) {
    if (!cur || (cur[key] || "") === value) return;
    var next = Object.assign({}, cur); next[key] = value;
    if (putProject(next)) { cur = C.find(data, cur.id); $("title").textContent = cur.name || t("list.untitled"); }
  }

  // ---------- 9. Sync screen ----------
  function renderSync() {
    if (!cur || tab !== "sync") { renderPad(); return; }
    var ol = $("lines");
    ol.textContent = "";
    var nowK = C.lineAt(timedList(), nowMs()), nowIdx = nowK >= 0 ? timedList()[nowK].i : -1;
    var lastS = -1;
    cur.ln.forEach(function (l, i) {
      var li = el("li", "line");
      var early = l.s !== null && l.s < lastS;          // earlier than a line above it
      if (l.s !== null) lastS = Math.max(lastS, l.s);
      if (l.p && i) li.classList.add("verse");
      if (dev.mode === "words" ? i === wl : i === cursor) li.classList.add("cursor");
      if (i === sel) li.classList.add("sel");
      if (i === holding) li.classList.add("holding");
      if (i === nowIdx) li.classList.add("now");
      li.dataset.i = i;
      var b = el("button", "line-btn");
      b.type = "button";
      b.appendChild(el("span", "ts" + (l.s === null ? " dim" : early ? " bad" : ""), l.s === null ? "–:––.––" : C.fmt(l.s, "clock")));
      b.appendChild(el("span", "lt", l.t));
      if (l.e !== null) b.appendChild(el("span", "te dim", "→ " + C.fmt(l.e, "clock")));
      if (l.w) b.appendChild(el("span", "tw" + (C.wordsDone(l) ? "" : " part"), t("words.count", { n: l.w.filter(function (x) { return x !== null; }).length, total: l.w.length })));
      if (l.v && cur.vn && cur.vn[l.v - 1]) b.appendChild(el("span", "tv", cur.vn[l.v - 1]));
      b.setAttribute("aria-label", l.t + ", " + (l.s === null ? t("sync.untimed") : C.fmt(l.s, "clock")));
      b.addEventListener("click", function () { selectLine(i); });
      li.appendChild(b);
      ol.appendChild(li);
    });
    $("no-lines").hidden = cur.ln.length > 0;
    $("progress").textContent = t("sync.progress", { n: C.timedCount(cur.ln), total: cur.ln.length });
    $("undo-btn").disabled = !undoStack.length;
    $("redo-btn").disabled = !redoStack.length;
    ["tap", "hold", "words"].forEach(function (m) { $("mode-" + m).setAttribute("aria-checked", dev.mode === m ? "true" : "false"); });
    $("mode-hint").textContent = t("mode." + dev.mode + "Hint");
    $("loop-btn").setAttribute("aria-pressed", loopOn ? "true" : "false");
    renderStrip();
    renderTools();
    renderPad();
    drawWave();
    scrollToLine(holding >= 0 ? holding : dev.mode === "words" ? wl : cursor);
  }
  function scrollToLine(i) {
    var li = $("lines").children[Math.min(i, cur.ln.length - 1)];
    if (!li) return;
    var box = li.getBoundingClientRect(), vh = window.innerHeight;
    if (box.top < 120 || box.bottom > vh - 140) li.scrollIntoView({ block: "center", behavior: "auto" });
  }
  function renderTools() {
    var on = cur && toolsOpen && sel >= 0 && sel < cur.ln.length;
    $("line-tools").hidden = !on;
    if (!on) return;
    var l = cur.ln[sel], inp = $("line-time");
    if (document.activeElement !== inp) inp.value = l.s === null ? "" : C.fmt(l.s, "clock");
    [].forEach.call(document.querySelectorAll(".nudge"), function (b) { b.disabled = l.s === null; });
    $("line-play").disabled = l.s === null || !audioOk;
    $("line-clear").disabled = l.s === null;
    $("line-words").hidden = !l.w;
    var many = (cur.vn || []).filter(Boolean).length >= 2, sg = $("line-singer");
    $("line-singer-box").hidden = !many;
    if (many) {
      sg.textContent = "";
      cur.vn.forEach(function (n, k) {
        var o = el("option", "", n || t("singer.n", { n: k + 1 }));
        o.value = String(k + 1);
        sg.appendChild(o);
      });
      sg.value = String(l.v || 1);
    }
  }
  // Words mode: the line being timed, one chip per word with its time.
  function renderStrip() {
    var box = $("word-strip");
    box.hidden = dev.mode !== "words" || !cur || !cur.ln[wl];
    if (box.hidden) return;
    box.textContent = "";
    var l = cur.ln[wl], ws = C.words(l.t);
    ws.forEach(function (w, k) {
      var b = el("button", "wchip" + (k === wk ? " next" : "") + (l.w && l.w[k] !== null ? " done" : ""));
      b.type = "button";
      b.appendChild(el("span", "ww", w));
      b.appendChild(el("span", "wt dim", l.w && l.w[k] !== null ? C.fmt(l.w[k], "clock") : "–"));
      b.addEventListener("click", function () { wk = k; renderStrip(); renderPad(); });
      box.appendChild(b);
    });
  }
  function renderPad() {
    if (!cur) return;
    var done = cursor >= cur.ln.length, pad = $("pad");
    $("pad-label").textContent = !audioOk || (player && player.paused) ? t("pad.start") : t(dev.mode === "hold" ? "pad.hold" : "pad.tap");
    if (dev.mode === "words") {
      var ws = cur.ln[wl] ? C.words(cur.ln[wl].t) : [];
      done = !ws.length || wk >= ws.length;
      $("pad-next").textContent = done ? t("pad.done") : t("pad.word", { w: ws[wk] });
    } else $("pad-next").textContent = done ? t("pad.done") : t("pad.next", { line: cur.ln[cursor].t });
    pad.classList.toggle("holding", holding >= 0);
    pad.disabled = !cur.ln.length;
    $("end-btn").disabled = !audioOk || C.prevTimed(cur.ln, Math.min(cursor, cur.ln.length)) < 0;
  }

  function selectLine(i) {
    sel = sel === i && toolsOpen ? -1 : i;
    toolsOpen = sel >= 0;
    if (dev.mode === "words" && sel >= 0) {
      var l = cur.ln[i];
      wl = i; wk = 0;
      if (l.w) { var k = l.w.indexOf(null); wk = k < 0 ? 0 : k; }
    }
    renderSync();
  }

  // Down: Tap times the line at the cursor; Hold starts it. Paused or
  // no audio: the first press only starts the song.
  function padDown() {
    if (!cur || !cur.ln.length) return;
    if (!audioOk) { toast(t("sync.needAudio")); return; }
    if (player.paused) { play(); toast(t("sync.started")); return; }
    if (dev.mode === "words") { tapWord(); return; }
    if (cursor >= cur.ln.length) { toast(t("sync.allDone")); return; }
    var at = tapMs(), i = cursor;
    if (dev.mode === "hold") holding = i;
    sel = i; toolsOpen = false;
    if (dev.mode === "tap") cursor = i + 1;
    setLines(C.startAt(cur.ln, i, at));
  }
  function padUp() {
    if (holding < 0 || !cur) return;
    var i = holding;
    holding = -1;
    cursor = i + 1;
    var at = tapMs();
    if (cur.ln[i] && cur.ln[i].s !== null && at > cur.ln[i].s) {
      // the release is part of the same step as the press: one undo
      var prev = undoStack.length ? undoStack[undoStack.length - 1] : null;
      var next = Object.assign({}, cur, { ln: C.endAt(cur.ln, i, at) });
      if (putProject(next)) { cur = C.find(data, cur.id); tlist = null; if (prev) prev.cursor = i; }
    }
    renderSync();
  }
  function endLine() {
    if (!cur || !audioOk) return;
    var k = C.prevTimed(cur.ln, Math.min(dev.mode === "words" ? (wk > 0 ? wl + 1 : wl) : cursor, cur.ln.length));
    if (k < 0) { toast(t("sync.noEnd")); return; }
    setLines(C.endAt(cur.ln, k, tapMs()));
  }
  // Words mode: time word wk of line wl, then move on (to the next
  // line's first word after the last word).
  function tapWord() {
    var l = cur.ln[wl];
    if (!l) { toast(t("sync.allDone")); return; }
    var n = C.words(l.t).length;
    if (wk >= n) { toast(t("sync.allDone")); return; }
    var i = wl, k = wk;
    sel = i; toolsOpen = false;
    wk++;
    if (wk >= n) { if (wl + 1 < cur.ln.length) { wl++; wk = 0; } }
    cursor = Math.max(cursor, i + 1);
    setLines(C.wordAt(cur.ln, i, k, tapMs()));
  }

  function syncFrom(i) {
    if (!cur || i < 0) return;
    cursor = i; sel = -1; wl = i; wk = 0;
    var k = C.prevTimed(cur.ln, i);
    var at = k >= 0 ? cur.ln[k].s : (cur.ln[i].s !== null ? Math.max(0, cur.ln[i].s - 3000) : 0);
    if (audioOk) { player.currentTime = at / 1000; }
    renderSync();
    toast(t("sync.from", { n: i + 1 }));
  }

  // ---------- 10. Transport ----------
  function play() {
    if (!audioOk) { toast(t("sync.needAudio")); return; }
    var p = player.play();
    if (p && p.catch) p.catch(function () { toast(t("audio.bad")); });
  }
  function togglePlay() { if (!audioOk) { toast(t("sync.needAudio")); return; } if (player.paused) play(); else player.pause(); }
  function seekBy(d) { if (audioOk) player.currentTime = Math.max(0, Math.min(player.duration || 0, player.currentTime + d)); }
  var lastNow = -2;
  function tick() {
    if (!cur) return;
    var ms = nowMs();
    $("clock").textContent = C.fmt(ms, "clock");
    var seek = $("seek");
    if (document.activeElement !== seek) seek.value = String(player.currentTime || 0);
    // Loop line: back to the selected line's start at its end.
    if (loopOn && !player.paused && sel >= 0) {
      var lx = timedList().filter(function (x) { return x.i === sel; })[0];
      if (lx && (ms >= lx.e || ms < lx.s - 1000)) { player.currentTime = lx.s / 1000; ms = lx.s; }
    }
    var k = C.lineAt(timedList(), ms);
    if (k !== lastNow) {
      lastNow = k;
      var idx = k >= 0 ? timedList()[k].i : -1;
      [].forEach.call($("lines").children, function (li) { li.classList.toggle("now", +li.dataset.i === idx); });
      renderStage();
    } else stageWords(ms);
    drawWave();
  }
  var raf = 0;
  function loop() { tick(); raf = player.paused ? 0 : requestAnimationFrame(loop); }

  // ---------- 11. Preview ----------
  function renderStage() {
    if (!cur || tab !== "preview") return;
    var L = timedList(), ms = nowMs(), k = C.lineAt(L, ms);
    var upcoming = k;
    if (k < 0) { upcoming = -1; for (var j = 0; j < L.length; j++) if (L[j].s > ms) { upcoming = j - 1; break; } if (upcoming === -1 && L.length && ms >= L[L.length - 1].e) upcoming = L.length - 1; }
    function txt(n) { return n >= 0 && n < L.length ? L[n].t : ""; }
    $("st-prev").textContent = txt(k >= 0 ? k - 1 : upcoming);
    var now = $("st-now");
    now.textContent = "";
    if (k >= 0 && L[k].words) {
      L[k].words.forEach(function (w, j) {
        if (j) now.appendChild(document.createTextNode(" "));
        var sp = el("span", "sw", w.t);
        sp.dataset.s = w.s;
        now.appendChild(sp);
      });
      stageWords(ms);
    } else now.textContent = k >= 0 ? L[k].t : "♪";
    $("st-next").textContent = txt((k >= 0 ? k : upcoming) + 1);
    $("st-next2").textContent = txt((k >= 0 ? k : upcoming) + 2);
  }

  // Karaoke fill: the words already sung are lit.
  function stageWords(ms) {
    if (tab !== "preview") return;
    [].forEach.call($("st-now").querySelectorAll(".sw"), function (sp) { sp.classList.toggle("sung", ms >= +sp.dataset.s); });
  }

  // ---------- 11b. Waveform, check, shift, tap delay (wave 2) ----------
  function waveState() {
    var l = cur && sel >= 0 ? cur.ln[sel] : null;
    return { list: timedList(), sel: sel, now: nowMs(), dur: cur ? cur.dur : 0, peaks: peaks, span: dev.span * 1000, words: l && l.w ? l.w : null };
  }
  function zoom(d) {
    var k = SPANS.indexOf(dev.span) + d;
    if (k < 0 || k >= SPANS.length) return;
    dev.span = SPANS[k]; saveDev();
    $("zoom-in").disabled = k === 0; $("zoom-out").disabled = k === SPANS.length - 1;
    drawWave();
  }

  var CK_ORDER = ["untimed", "order", "short", "gap", "long", "label", "words"];
  function openCheck() {
    if (!cur) return;
    flushLyrics();
    var list = C.issues(cur.ln, cur.dur), ul = $("check-list");
    list.sort(function (a, b) { return a.i - b.i || CK_ORDER.indexOf(a.code) - CK_ORDER.indexOf(b.code); });
    $("check-sum").textContent = list.length ? t("ck.sum", { n: list.length }) : t("ck.none");
    ul.textContent = "";
    list.forEach(function (it) {
      var li = el("li");
      var b = el("button", "ck-row");
      b.type = "button";
      b.appendChild(el("strong", "", t("ck.line", { n: it.i + 1 })));
      b.appendChild(el("span", "ck-text", cur.ln[it.i].t));
      b.appendChild(el("span", "dim", t("ck." + it.code)));
      b.addEventListener("click", function () {
        $("check-dlg").close();
        if ($("export-dlg").open) $("export-dlg").close();
        setTab("sync");
        sel = it.i; toolsOpen = true;
        renderSync();
        scrollToLine(it.i);
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    $("check-dlg").showModal();
  }

  function openShift() {
    if (!cur) return;
    $("shift-in").value = "";
    $("shift-dlg").showModal();
  }
  function applyShift() {
    var v = $("shift-in").value.trim().replace(",", ".");
    if (!/^[-+]?\d+(\.\d+)?$/.test(v) || Math.abs(+v) > 3600) { toast(t("sh.bad")); return; }
    $("shift-dlg").close();
    var d = Math.round(+v * 1000);
    if (!d) return;
    setLines(C.shiftAll(cur.ln, d));
    toast(t("sh.done", { s: (d > 0 ? "+" : "") + (d / 1000) }));
  }

  // Tap delay: 8 clicks 0.6 s apart after a 1.2 s lead-in; each tap is
  // matched to the nearest click; the median of the matches (0-400 ms)
  // becomes the delay taken off every tap.
  var cal = null;
  function renderCalib() {
    $("calib-now").textContent = t("cal.now", { n: dev.lat });
    $("calib-pad").textContent = cal ? t("cal.tap") : t("cal.start");
  }
  function calibPress() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!cal) {
      if (!AC) return;
      if (player && !player.paused) player.pause();
      var ac = new AC(), t0 = ac.currentTime + 1.2, clicks = [];
      for (var k = 0; k < 8; k++) {
        var at = t0 + k * 0.6, o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = k % 4 ? 880 : 1320;
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.5, at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
        o.connect(g); g.connect(ac.destination); o.start(at); o.stop(at + 0.1);
        clicks.push(at);
      }
      cal = { ac: ac, clicks: clicks, taps: [] };
      setTimeout(finishCalib, (1.2 + 8 * 0.6 + 0.6) * 1000);
      renderCalib();
      return;
    }
    cal.taps.push(cal.ac.currentTime);
  }
  function finishCalib() {
    if (!cal) return;
    var c = cal; cal = null;
    var d = [];
    c.taps.forEach(function (tp) {
      var best = null;
      c.clicks.forEach(function (ck) { var x = tp - ck; if (x > -0.15 && x < 0.45 && (best === null || Math.abs(x) < Math.abs(best))) best = x; });
      if (best !== null) d.push(best * 1000);
    });
    try { c.ac.close(); } catch (e) {}
    if (d.length < 5) { toast(t("cal.fail")); renderCalib(); return; }
    d.sort(function (a, b) { return a - b; });
    dev.lat = Math.max(0, Math.min(400, Math.round(d[d.length >> 1])));
    saveDev();
    renderCalib();
    toast(t("cal.done", { n: dev.lat }));
  }

  // ---------- 11b. Rough sync from the song (wave 4) ----------
  // Montage's Whisper (../montage/asr.js, model cached once for both
  // apps) hears the song on this device; align.js lines the person's
  // own lyrics up with it. One undoable change.
  var MAX_AUTO_SEC = 900, autoStop = null;
  function openAuto() {
    if (!cur) return;
    flushLyrics();
    if (!cur.ln.length) { toast(t("au.needText")); return; }
    if (!audioOk || !audioBlob) { toast(t("sync.needAudio")); return; }
    var ASR = window.MontageASR;
    if (!ASR || !window.LyricsyncAlign || !(window.OfflineAudioContext || window.AudioContext)) { toast(t("au.noRun")); return; }
    $("au-need").textContent = t("au.need", { mb: ASR.MODEL_MB, rt: ASR.RUNTIME_MB });
    ASR.ready().then(function (yes) { if (yes) $("au-need").textContent = t("au.ready"); }, function () {});
    $("au-all").checked = false;
    $("au-status").textContent = "";
    $("au-go").disabled = false;
    if (player && !player.paused) player.pause();
    $("auto-dlg").showModal();
  }
  // The song as mono 16 kHz samples (Whisper's input), at most 15 min.
  function samples16k(blob) {
    var AC = window.AudioContext || window.webkitAudioContext, OAC = window.OfflineAudioContext;
    return blob.arrayBuffer().then(function (ab) {
      return new Promise(function (res, rej) {
        var ac = new AC();
        var done = function (f, v) { try { ac.close(); } catch (e) {} f(v); };
        ac.decodeAudioData(ab, function (b) { done(res, b); }, function (e) { done(rej, e || new Error("decode")); });
      });
    }).then(function (buf) {
      var sec = Math.min(buf.duration, MAX_AUTO_SEC);
      if (!OAC) return window.LyricsyncAlign.to16k(buf, sec);
      var oc = new OAC(1, Math.max(1, Math.ceil(sec * 16000)), 16000), src = oc.createBufferSource();
      src.buffer = buf; src.connect(oc.destination); src.start(0);
      return oc.startRendering().then(function (r) { return r.getChannelData(0); });
    });
  }
  function runAuto() {
    if (!cur || !audioBlob) return;
    var id = cur.id, all = $("au-all").checked, blob = audioBlob, ASR = window.MontageASR;
    var lg = String(cur.lg || "").toLowerCase().slice(0, 2), lang = /^[a-z]{2}$/.test(lg) ? lg : "auto";
    var stop = false, ctl = typeof AbortController === "function" ? new AbortController() : null;
    var status = function (txt) { $("au-status").textContent = txt; };
    autoStop = function () { stop = true; if (ctl) ctl.abort(); autoStop = null; };
    $("au-go").disabled = true;
    status(t("au.decoding"));
    samples16k(blob).then(function (samples) {
      if (stop) throw new Error("stop");
      return ASR.run(samples, {
        lang: lang, cancelled: function () { return stop; }, signal: ctl ? ctl.signal : undefined,
        progress: function (q, stage) { if (!stop) status(t(stage === "download" ? "au.download" : "au.listening", { p: Math.round(q * 100) })); }
      });
    }).then(function (r) {
      if (stop || !cur || cur.id !== id) return;
      autoStop = null;
      var res = window.LyricsyncAlign.align(cur.ln, (r && r.cues) || []);
      var lines = cur.ln, n = 0;
      res.starts.forEach(function (ms, i) {
        if (ms === null || (!all && lines[i].s !== null)) return;
        // only untimed lines: a start must fit between the timed lines around it
        if (!all) {
          var a = C.prevTimed(lines, i), b = C.nextTimed(lines, i);
          if ((a >= 0 && lines[a].s >= ms) || (b >= 0 && lines[b].s <= ms)) return;
        }
        lines = C.setStart(lines, i, ms);
        n++;
      });
      $("auto-dlg").close();
      if (!n) { toast(t("au.none")); return; }
      setLines(lines);
      cursor = C.nextUntimed(cur.ln, 0);
      renderSync();
      toast(t("au.done", { n: n }));
    }, function (e) {
      if (stop) return;
      autoStop = null;
      $("au-go").disabled = false;
      status(e && /^http|fetch|network|load/i.test(String(e.message || e)) ? t("au.net") : t("au.fail"));
    });
  }

  // Preview as a karaoke screen: the stage fills the screen.
  function fullScreen() {
    var st = $("stage");
    if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); return; }
    if (st.requestFullscreen) st.requestFullscreen().catch(function () {});
  }

  // ---------- 12. Import and export ----------
  function readLyricsFile(file) {
    if (file.size > MAX_TEXT_FILE) { toast(t("imp.big")); return Promise.resolve(null); }
    return file.text().then(function (text) {
      try { return F.parse(file.name || "", text); }
      catch (e) { toast(t("imp.bad")); return null; }
    }, function () { toast(t("imp.bad")); return null; });
  }
  function linesFrom(r) {
    return r.lines.map(function (l) {
      var o = { id: C.newId("l", Math.random), t: l.t, s: l.s, e: l.e };
      if (l.p) o.p = 1;
      if (l.w) o.w = l.w;
      if (l.v) o.v = l.v;
      return o;
    });
  }
  function applyImport(r, name) {
    var next = Object.assign({}, cur, { ln: linesFrom(r) });
    ["name", "ar", "al", "lg"].forEach(function (k) { if (r[k] && !cur[k]) next[k] = r[k]; });
    if (r.dur && !cur.dur) next.dur = r.dur;
    if (r.vn && r.vn.filter(Boolean).length && !(cur.vn && cur.vn.length)) next.vn = r.vn;
    undoStack.push({ ln: cur.ln, cursor: cursor, sel: sel }); redoStack = [];
    if (putProject(next)) {
      cur = C.find(data, cur.id); tlist = null;
      cursor = C.nextUntimed(cur.ln, 0); sel = -1;
      renderEditor(false);
      toast(t("imp.done", { n: cur.ln.length, name: name }));
    }
  }
  function importIntoCurrent(file) {
    readLyricsFile(file).then(function (r) {
      if (!r || !cur) return;
      if (cur.ln.length) confirmDlg(t("imp.ask"), t("imp.yes"), function () { applyImport(r, file.name); });
      else applyImport(r, file.name);
    });
  }
  // From the list: a song file or a lyrics file becomes a new song.
  function openAnyFile(file) {
    if (!file) return;
    if (isAudioFile(file)) {
      var p = newSong(baseName(file.name));
      if (!p) return;
      openSong(p.id, "lyrics");
      attachAudio(file);
      return;
    }
    readLyricsFile(file).then(function (r) {
      if (!r) return;
      var p = newSong(r.name || baseName(file.name));
      if (!p) return;
      cur = p;
      applyImport(r, file.name);
      openSong(p.id, C.timedCount(cur.ln) ? "preview" : "sync");
    });
  }

  function openExport() {
    if (!cur) return;
    flushLyrics();
    var n = C.timedCount(cur.ln), nw = C.wordCount(cur.ln), ul = $("export-list"), iss = C.issues(cur.ln, cur.dur).length;
    var sum = $("export-sum");
    sum.textContent = n ? t("ex.sum", { n: n, total: cur.ln.length }) + (nw ? " " + t("ex.words", { n: nw }) : "") : t("ex.none");
    if (n && iss) {
      sum.appendChild(document.createTextNode(" " + t("ex.issues", { n: iss }) + " "));
      var ck = el("button", "link-btn", t("ex.check"));
      ck.type = "button";
      ck.addEventListener("click", openCheck);
      sum.appendChild(ck);
    }
    ul.textContent = "";
    ["lrc", "elrc", "srt", "vtt", "ttml", "ass", "json", "txt"].forEach(function (k) {
      var spec = F.EXPORTS[k], timedOnly = k !== "json" && k !== "txt";
      if (spec.words && !nw) return;
      var li = el("li", "ex-row");
      var txt = el("div", "ex-txt");
      txt.appendChild(el("strong", "", t("ex." + k) + " (" + spec.ext + ")"));
      txt.appendChild(el("span", "dim", t("ex." + k + "D")));
      var b = el("button", "chip pri", t("ex.save"));
      b.type = "button";
      b.disabled = timedOnly && !n;
      b.addEventListener("click", function () {
        var name = fileTitle(cur) + (k === "elrc" ? ".karaoke" : "") + spec.ext;
        saveFile(spec.fn(cur), name, spec.mime, spec.ext).then(function (ok) { if (ok) toast(t("ex.saved", { name: name })); });
      });
      li.appendChild(txt);
      li.appendChild(b);
      ul.appendChild(li);
    });
    // Wave 3: to Music, into the MP3, to Montage.
    function extra(key, label, fn) {
      var li = el("li", "ex-row ex-more");
      var txt = el("div", "ex-txt");
      txt.appendChild(el("strong", "", t("x." + key)));
      txt.appendChild(el("span", "dim", t("x." + key + "D")));
      var b = el("button", "chip pri", t(label));
      b.type = "button";
      b.disabled = !n;
      b.addEventListener("click", fn);
      li.appendChild(txt);
      li.appendChild(b);
      ul.appendChild(li);
    }
    if (cur.src) extra("music", "x.saveHere", saveNextToSong);
    if (audioBlob && (/\.mp3$/i.test(audioBlob.name || (cur.au && cur.au.n) || cur.src || "") || /mpeg|mp3/i.test(audioBlob.type || ""))) extra("mp3", "x.make", makeMp3);
    if (cur.src) extra("video", "x.open", toMontage);
    $("export-dlg").showModal();
  }

  // ---------- 12b. Other apps (wave 3) ----------
  function shellOpen(app, target) {
    try { var f = window.parent && window.parent !== window && window.parent.__orosOpenAt; if (typeof f === "function") { f(app, target); return true; } } catch (e) {}
    return false;
  }
  // Enhanced LRC when words are timed (Music drops the word stamps and
  // other players use them), else plain LRC.
  function lrcText() { return C.wordCount(cur.ln) ? F.toElrc(cur) : F.toLrc(cur, false); }
  function saveNextToSong() {
    var fs = fsApi(), p = cur && C.lrcPath(cur.src);
    if (!fs || !p) { toast(t("x.noFs")); return; }
    var text = lrcText();
    var write = function () {
      Promise.resolve(fs.write(p, new Blob([text], { type: "text/plain;charset=utf-8" }))).then(function () { toast(t("x.lrcSaved")); }, function () { toast(t("x.fail")); });
    };
    // Re-read right before writing: an .lrc made elsewhere (or another
    // device) is replaced only on a yes.
    Promise.resolve(fs.read(p)).then(function (b) { return b && typeof b.text === "function" ? b.text() : null; }, function () { return null; }).then(function (old) {
      if (old === null || old === text) { if (old !== text) write(); else toast(t("x.lrcSaved")); return; }
      confirmDlg(t("x.lrcAsk"), t("x.replace"), write);
    });
  }
  function makeMp3() {
    var blob = audioBlob;
    if (!blob || !ID3) return;
    var lyrics = { text: C.toText(cur.ln), lg: cur.lg, lines: C.timed(cur.ln, cur.dur).filter(function (x) { return x.t; }).map(function (x) { return { s: x.s, t: x.t }; }) };
    blob.slice(0, 10).arrayBuffer().then(function (ab) {
      var h10 = new Uint8Array(ab);
      if (!ID3.isMp3(h10, blob.name || (cur.au && cur.au.n) || "song.mp3", blob.type)) throw new Error("not");
      var end = ID3.tagEnd(h10);
      return blob.slice(0, Math.max(10, end)).arrayBuffer().then(function (hb) { return ID3.build(new Uint8Array(hb), lyrics); });
    }).then(function (r) {
      if (!r) { toast(t("x.mp3Bad")); return; }
      var out = new Blob([r.tag, blob.slice(r.cut)], { type: "audio/mpeg" });
      var name = fileTitle(cur) + ".mp3";
      return saveBlob(out, name, "audio/mpeg", ".mp3").then(function (ok) { if (ok) toast(t("ex.saved", { name: name })); });
    }).catch(function (e) { toast(t(e && e.message === "not" ? "x.mp3Not" : "x.fail")); });
  }
  function toMontage() {
    if (!cur || !cur.src) { toast(t("x.videoNeed")); return; }
    var srt = F.toSrt(cur);
    if (!srt) return;
    $("export-dlg").close();
    shellOpen("montage", { lyrics: { name: cur.name || C.fileOf(cur.src), srt: srt, audio: cur.src } });
  }

  // ---------- 13. Wiring ----------
  function typing(e) {
    var n = e.target;
    return n && (n.tagName === "INPUT" && n.type !== "range" || n.tagName === "TEXTAREA" || n.tagName === "SELECT" || n.isContentEditable);
  }
  function wire() {
    player = $("player");
    try { player.preservesPitch = true; } catch (e) {}
    player.addEventListener("loadedmetadata", function () {
      $("seek").max = String(player.duration || 1);
      var d = Math.round((player.duration || 0) * 1000);
      if (cur && d && isFinite(d) && Math.abs(d - (cur.dur || 0)) > 50) {
        if (putProject(Object.assign({}, cur, { dur: d }))) { cur = C.find(data, cur.id); tlist = null; }
      }
      tick();
    });
    player.addEventListener("error", function () { if (audioUrl) { toast(t("audio.bad")); } });
    player.addEventListener("play", function () { $("play-btn").textContent = "❚❚"; $("play-btn").setAttribute("aria-label", t("btn.pause")); renderPad(); if (!raf) raf = requestAnimationFrame(loop); });
    player.addEventListener("pause", function () { $("play-btn").textContent = "▶"; $("play-btn").setAttribute("aria-label", t("btn.play")); renderPad(); if (holding >= 0) padUp(); tick(); });
    player.addEventListener("seeked", tick);
    player.addEventListener("ended", function () { renderPad(); });

    $("back-btn").addEventListener("click", closeSong);
    $("new-btn").addEventListener("click", function () { var p = newSong(""); if (p) openSong(p.id, "lyrics"); });
    $("open-btn").addEventListener("click", function () { pickFile(AUDIO_ACCEPT + "," + LYRIC_ACCEPT).then(openAnyFile); });
    $("export-btn").addEventListener("click", openExport);
    $("export-close").addEventListener("click", function () { $("export-dlg").close(); });
    $("audio-btn").addEventListener("click", pickAudio);
    $("import-btn").addEventListener("click", function () { pickFile(LYRIC_ACCEPT).then(function (f) { if (f) importIntoCurrent(f); }); });

    [].forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.addEventListener("click", function () { setTab(b.dataset.tab); });
      b.addEventListener("keydown", function (e) {
        if (e.code !== "ArrowRight" && e.code !== "ArrowLeft") return;
        var order = ["lyrics", "sync", "preview"], k = order.indexOf(tab) + (e.code === "ArrowRight" ? 1 : -1);
        setTab(order[(k + 3) % 3]); $("tab-" + tab).focus(); e.preventDefault();
      });
    });

    var fields = { "f-name": "name", "f-artist": "ar", "f-album": "al", "f-lang": "lg" };
    Object.keys(fields).forEach(function (fid) {
      $(fid).addEventListener("change", function () { saveField(fields[fid], $(fid).value.trim()); });
    });
    $("lyrics-text").addEventListener("input", function () {
      clearTimeout(lyricsTimer);
      lyricsTimer = setTimeout(flushLyrics, 700);
    });
    $("lyrics-text").addEventListener("blur", flushLyrics);

    $("play-btn").addEventListener("click", togglePlay);
    $("rew-btn").addEventListener("click", function () { seekBy(-5); });
    $("fwd-btn").addEventListener("click", function () { seekBy(5); });
    $("seek").addEventListener("input", function () { if (audioOk) player.currentTime = +$("seek").value; });
    $("speed").value = String(dev.speed);
    $("speed").addEventListener("change", function () {
      dev.speed = +$("speed").value || 1; saveDev();
      if (player) player.playbackRate = dev.speed;
    });

    ["tap", "hold", "words"].forEach(function (m) {
      $("mode-" + m).addEventListener("click", function () {
        dev.mode = m; saveDev();
        if (m === "words" && cur) { wl = sel >= 0 ? sel : Math.min(cursor, Math.max(0, cur.ln.length - 1)); wk = 0; }
        renderSync();
      });
    });
    $("check-btn").addEventListener("click", openCheck);
    $("check-close").addEventListener("click", function () { $("check-dlg").close(); });
    $("shift-btn").addEventListener("click", openShift);
    $("shift-no").addEventListener("click", function () { $("shift-dlg").close(); });
    $("shift-yes").addEventListener("click", applyShift);
    $("shift-in").addEventListener("keydown", function (e) { if (e.code === "Enter" || e.code === "NumpadEnter") { e.preventDefault(); applyShift(); } });
    $("calib-btn").addEventListener("click", function () { renderCalib(); $("calib-dlg").showModal(); });
    $("auto-btn").addEventListener("click", openAuto);
    $("au-go").addEventListener("click", runAuto);
    $("au-no").addEventListener("click", function () { if (autoStop) autoStop(); $("auto-dlg").close(); });
    $("auto-dlg").addEventListener("close", function () { if (autoStop) autoStop(); });
    $("full-btn").addEventListener("click", fullScreen);
    $("stage").addEventListener("click", function () { if (document.fullscreenElement === $("stage")) togglePlay(); });
    $("calib-pad").addEventListener("pointerdown", function (e) { e.preventDefault(); calibPress(); });
    $("calib-pad").addEventListener("click", function (e) { if (e.detail === 0) calibPress(); });
    $("calib-dlg").addEventListener("keydown", function (e) { if (e.code === "Space") { e.preventDefault(); if (!e.repeat) calibPress(); } });
    $("calib-reset").addEventListener("click", function () { dev.lat = 0; saveDev(); renderCalib(); });
    $("calib-close").addEventListener("click", function () { $("calib-dlg").close(); });
    $("calib-dlg").addEventListener("close", function () { if (cal) { try { cal.ac.close(); } catch (e) {} cal = null; } });
    $("zoom-in").addEventListener("click", function () { zoom(-1); });
    $("zoom-out").addEventListener("click", function () { zoom(1); });
    $("loop-btn").addEventListener("click", function () { loopOn = !loopOn; $("loop-btn").setAttribute("aria-pressed", loopOn ? "true" : "false"); });
    if (window.LyricsyncWave) {
      wave = window.LyricsyncWave.create($("wave"), {
        state: waveState,
        seek: function (ms) { if (audioOk) { player.currentTime = ms / 1000; tick(); } },
        move: function (i, k, ms) { if (cur) { sel = i; setLines(C.moveMark(cur.ln, i, k, ms)); } }
      });
      window.addEventListener("resize", drawWave);
    }
    zoom(0);
    $("f-singers").addEventListener("change", function () {
      if (!cur) return;
      var vn = $("f-singers").value.split(",").map(function (x) { return x.trim(); }).slice(0, 4);
      while (vn.length && !vn[vn.length - 1]) vn.pop();
      var next = Object.assign({}, cur, { vn: vn });
      if (!vn.length) delete next.vn;
      if (putProject(next)) { cur = C.find(data, cur.id); renderTools(); }
    });
    $("line-words").addEventListener("click", function () { if (sel >= 0 && cur) setLines(C.clearWords(cur.ln, sel)); });
    $("line-singer").addEventListener("change", function () {
      if (sel < 0 || !cur) return;
      var lines = cur.ln.map(function (l) { return Object.assign({}, l); }), v = +$("line-singer").value;
      if (v > 1) lines[sel].v = v; else delete lines[sel].v;
      setLines(lines);
    });
    $("undo-btn").addEventListener("click", undo);
    $("redo-btn").addEventListener("click", redo);
    $("end-btn").addEventListener("click", endLine);

    // The pad: pointer for touch and mouse; a click from the keyboard
    // (Enter on the focused pad) counts as a tap.
    var pad = $("pad"), padPointer = false;
    pad.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      padPointer = true;
      try { pad.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      padDown();
    });
    ["pointerup", "pointercancel"].forEach(function (ev) {
      pad.addEventListener(ev, function () { if (padPointer) { padPointer = false; padUp(); } });
    });
    pad.addEventListener("click", function (e) { if (e.detail === 0) { padDown(); padUp(); } });
    pad.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    $("line-time").addEventListener("change", function () {
      if (sel < 0 || !cur) return;
      var v = $("line-time").value.trim();
      if (!v) { setLines(C.clearTime(cur.ln, sel)); return; }
      var ms = C.parseTime(v);
      if (ms === null) { toast(t("sync.badTime")); renderTools(); return; }
      setLines(C.setStart(cur.ln, sel, ms));
    });
    [].forEach.call(document.querySelectorAll(".nudge"), function (b) {
      b.addEventListener("click", function () { if (sel >= 0 && cur) setLines(C.nudge(cur.ln, sel, +b.dataset.nudge)); });
    });
    $("line-play").addEventListener("click", function () {
      if (sel < 0 || !cur || cur.ln[sel].s === null || !audioOk) return;
      player.currentTime = cur.ln[sel].s / 1000; play();
    });
    $("line-from").addEventListener("click", function () { syncFrom(sel); });
    $("line-clear").addEventListener("click", function () { if (sel >= 0 && cur) setLines(C.clearTime(cur.ln, sel)); });

    // Keys on the Sync and Preview tabs (e.code, never e.key; the shell
    // keeps Ctrl+Alt+Shift).
    document.addEventListener("keydown", function (e) {
      if (!cur || $("v-edit").hidden || typing(e) || document.querySelector("dialog[open]")) return;
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.shiftKey) return;
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.code === "KeyY") { e.preventDefault(); redo(); return; }
      if (mod || e.altKey || tab === "lyrics") return;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          if (tab === "sync") { if (!e.repeat) padDown(); } else togglePlay();
          break;
        case "KeyP": e.preventDefault(); togglePlay(); break;
        case "ArrowLeft": e.preventDefault(); seekBy(e.shiftKey ? -10 : -2); break;
        case "ArrowRight": e.preventDefault(); seekBy(e.shiftKey ? 10 : 2); break;
        case "Backspace": if (tab === "sync") { e.preventDefault(); undo(); } break;
        case "KeyE": if (tab === "sync") { e.preventDefault(); endLine(); } break;
        case "ArrowUp": case "ArrowDown":
          if (tab !== "sync" || !cur.ln.length) break;
          e.preventDefault();
          sel = Math.max(0, Math.min(cur.ln.length - 1, (sel < 0 ? cursor : sel) + (e.code === "ArrowUp" ? -1 : 1)));
          toolsOpen = true;
          renderSync();
          break;
        case "Comma": case "Period":
          if (tab === "sync" && sel >= 0) { e.preventDefault(); setLines(C.nudge(cur.ln, sel, (e.code === "Comma" ? -1 : 1) * (e.shiftKey ? 100 : 10))); }
          break;
      }
    });
    document.addEventListener("keyup", function (e) {
      if (e.code !== "Space" || !cur || $("v-edit").hidden || typing(e)) return;
      if (tab === "sync") { e.preventDefault(); padUp(); }
    });
    // Contract B (Bible Part VI): Ctrl+Alt+Shift goes to the shell.
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null; try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);

    // Dropping files: a song attaches to the open song (or starts one),
    // a lyrics file is read into it.
    document.addEventListener("dragover", function (e) { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], "Files") >= 0) e.preventDefault(); });
    document.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      if (!cur) { openAnyFile(f); return; }
      if (isAudioFile(f)) attachAudio(f); else importIntoCurrent(f);
    });
    window.addEventListener("pagehide", flushLyrics);
  }

  // ---------- 14. Deep links ----------
  // { song: id } (search hits); { musicPath, title?, artist?, album?,
  // lyrics? } (Music's and Studio's "Sync lyrics": a song on the orOS
  // disk, opened in the song made from it before, else a new one);
  // { openFile: { token } } (a lyrics or song file from Files or the
  // system's "Open with"). Anything else is ignored.
  window.__orosOpenAt = function (target) {
    if (!target || typeof target !== "object") return;
    if (document.querySelector("dialog[open]")) return;
    if (typeof target.song === "string") {
      if (!C.find(data, target.song)) return;
      flushLyrics();
      openSong(target.song);
      return;
    }
    if (typeof target.musicPath === "string") { fromMusic(target); return; }
    var f = target.openFile;
    if (f && typeof f === "object" && typeof f.token === "string") {
      var file = null;
      try { file = window.parent.__orosTakeFile(f.token); } catch (e) {}
      if (!file) { toast(t("open.bad")); return; }
      if (cur) closeSong();
      // A File from the shell window belongs to another realm: wrap it.
      openAnyFile(new File([file], String(file.name || ""), { type: file.type || "" }));
    }
  };
  function fromMusic(tg) {
    var src = C.diskPath(tg.musicPath);
    if (!src) return;
    flushLyrics();
    var old = C.bySrc(data, src);
    if (old) { if (!cur || cur.id !== old.id) openSong(old.id); return; }
    var str = function (v, n) { return typeof v === "string" ? v.slice(0, n) : ""; };
    var p = newSong(str(tg.title, 200) || baseName(C.fileOf(src)));
    if (!p) return;
    var next = Object.assign({}, p, { src: src, ar: str(tg.artist, 200), al: str(tg.album, 200), au: { n: C.fileOf(src), z: 0 } });
    var text = str(tg.lyrics, 200000).trim();
    if (text) {
      var r = null;
      try { r = F.parse(/^\s*\[\d{1,3}:\d/m.test(text) ? "lyrics.lrc" : "lyrics.txt", text); } catch (e) { r = null; }
      if (r && r.lines && r.lines.length) {
        next.ln = linesFrom(r);
        if (r.dur) next.dur = r.dur;
      }
    }
    if (!putProject(next)) return;
    openSong(p.id, next.ln && next.ln.length ? "sync" : "lyrics");
    toast(t("from.music", { name: C.fileOf(src) }));
  }
  function takePending() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget("lyricsync");
        if (pending) window.__orosOpenAt(pending);
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 15. Boot (last, after every declaration) ----------
  function boot() {
    load();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    renderList();
    refreshAudioKeys();
    takePending();
  }
  boot();
})();
