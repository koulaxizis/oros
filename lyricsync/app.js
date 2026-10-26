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
  var C = window.LyricsyncCore, F = window.LyricsyncFormats;
  var MAX_AUDIO = 400 * 1024 * 1024, MAX_TEXT_FILE = 4 * 1024 * 1024, MAX_UNDO = 300;
  var LYRIC_ACCEPT = ".lrc,.elrc,.srt,.vtt,.ttml,.dfxp,.xml,.json,.txt";
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
  var dev = { mode: "tap", speed: 1 };

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function load() {
    try { data = C.normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch (e) { data = C.empty(); }
    try {
      var d = JSON.parse(localStorage.getItem(DEVICE_KEY) || "null") || {};
      if (d.mode === "hold") dev.mode = "hold";
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
    var blob = new Blob([text], { type: mime + ";charset=utf-8" });
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
  var holding = -1;            // Hold mode: the line being held
  var undoStack = [], redoStack = [];
  var tlist = null;            // C.timed() of the open song, rebuilt on change
  var audioUrl = "", audioOk = false;
  var player = null;
  var lyricsTimer = 0;

  function timedList() { if (!tlist && cur) tlist = C.timed(cur.ln, cur.dur); return tlist || []; }
  function nowMs() { return player ? Math.round(player.currentTime * 1000) : 0; }

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
      if (p.au && !haveAudio[p.id]) meta.push(t("list.noAudio"));
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
    audioOk = false;
  }
  function useBlob(blob) {
    stopAudio();
    audioUrl = URL.createObjectURL(blob);
    player.src = audioUrl;
    player.playbackRate = dev.speed;
    audioOk = true;
    renderAudio();
  }
  function loadAudio() {
    var id = cur.id;
    renderAudio();
    audioGet(id).then(function (rec) {
      if (!cur || cur.id !== id || !rec || !rec.blob) { renderAudio(); return; }
      useBlob(rec.blob);
    });
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
    if (audioOk) { nm.textContent = cur.au ? cur.au.n : ""; nm.classList.remove("warn"); }
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
      if (i === cursor) li.classList.add("cursor");
      if (i === sel) li.classList.add("sel");
      if (i === holding) li.classList.add("holding");
      if (i === nowIdx) li.classList.add("now");
      li.dataset.i = i;
      var b = el("button", "line-btn");
      b.type = "button";
      b.appendChild(el("span", "ts" + (l.s === null ? " dim" : early ? " bad" : ""), l.s === null ? "–:––.––" : C.fmt(l.s, "clock")));
      b.appendChild(el("span", "lt", l.t));
      if (l.e !== null) b.appendChild(el("span", "te dim", "→ " + C.fmt(l.e, "clock")));
      b.setAttribute("aria-label", l.t + ", " + (l.s === null ? t("sync.untimed") : C.fmt(l.s, "clock")));
      b.addEventListener("click", function () { selectLine(i); });
      li.appendChild(b);
      ol.appendChild(li);
    });
    $("no-lines").hidden = cur.ln.length > 0;
    $("progress").textContent = t("sync.progress", { n: C.timedCount(cur.ln), total: cur.ln.length });
    $("undo-btn").disabled = !undoStack.length;
    $("redo-btn").disabled = !redoStack.length;
    ["tap", "hold"].forEach(function (m) { $("mode-" + m).setAttribute("aria-checked", dev.mode === m ? "true" : "false"); });
    $("mode-hint").textContent = t(dev.mode === "tap" ? "mode.tapHint" : "mode.holdHint");
    renderTools();
    renderPad();
    scrollToLine(holding >= 0 ? holding : cursor);
  }
  function scrollToLine(i) {
    var li = $("lines").children[Math.min(i, cur.ln.length - 1)];
    if (!li) return;
    var box = li.getBoundingClientRect(), vh = window.innerHeight;
    if (box.top < 120 || box.bottom > vh - 140) li.scrollIntoView({ block: "center", behavior: "auto" });
  }
  function renderTools() {
    var on = cur && sel >= 0 && sel < cur.ln.length;
    $("line-tools").hidden = !on;
    if (!on) return;
    var l = cur.ln[sel], inp = $("line-time");
    if (document.activeElement !== inp) inp.value = l.s === null ? "" : C.fmt(l.s, "clock");
    [].forEach.call(document.querySelectorAll(".nudge"), function (b) { b.disabled = l.s === null; });
    $("line-play").disabled = l.s === null || !audioOk;
    $("line-clear").disabled = l.s === null;
  }
  function renderPad() {
    if (!cur) return;
    var done = cursor >= cur.ln.length, pad = $("pad");
    $("pad-label").textContent = !audioOk || (player && player.paused) ? t("pad.start") : t(dev.mode === "tap" ? "pad.tap" : "pad.hold");
    $("pad-next").textContent = done ? t("pad.done") : t("pad.next", { line: cur.ln[cursor].t });
    pad.classList.toggle("holding", holding >= 0);
    pad.disabled = !cur.ln.length;
    $("end-btn").disabled = !audioOk || C.prevTimed(cur.ln, Math.min(cursor, cur.ln.length)) < 0;
  }

  function selectLine(i) {
    sel = sel === i ? -1 : i;
    renderSync();
  }

  // Down: Tap times the line at the cursor; Hold starts it. Paused or
  // no audio: the first press only starts the song.
  function padDown() {
    if (!cur || !cur.ln.length) return;
    if (!audioOk) { toast(t("sync.needAudio")); return; }
    if (player.paused) { play(); toast(t("sync.started")); return; }
    if (cursor >= cur.ln.length) { toast(t("sync.allDone")); return; }
    var at = nowMs(), i = cursor;
    if (dev.mode === "hold") holding = i;
    sel = i;
    if (dev.mode === "tap") cursor = i + 1;
    setLines(C.startAt(cur.ln, i, at));
  }
  function padUp() {
    if (holding < 0 || !cur) return;
    var i = holding;
    holding = -1;
    cursor = i + 1;
    var at = nowMs();
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
    var k = C.prevTimed(cur.ln, Math.min(cursor, cur.ln.length));
    if (k < 0) { toast(t("sync.noEnd")); return; }
    setLines(C.endAt(cur.ln, k, nowMs()));
  }

  function syncFrom(i) {
    if (!cur || i < 0) return;
    cursor = i; sel = -1;
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
    var k = C.lineAt(timedList(), ms);
    if (k !== lastNow) {
      lastNow = k;
      var idx = k >= 0 ? timedList()[k].i : -1;
      [].forEach.call($("lines").children, function (li) { li.classList.toggle("now", +li.dataset.i === idx); });
      renderStage();
    }
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
    $("st-now").textContent = k >= 0 ? L[k].t : "♪";
    $("st-next").textContent = txt((k >= 0 ? k : upcoming) + 1);
    $("st-next2").textContent = txt((k >= 0 ? k : upcoming) + 2);
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
      return o;
    });
  }
  function applyImport(r, name) {
    var next = Object.assign({}, cur, { ln: linesFrom(r) });
    ["name", "ar", "al", "lg"].forEach(function (k) { if (r[k] && !cur[k]) next[k] = r[k]; });
    if (r.dur && !cur.dur) next.dur = r.dur;
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
    var n = C.timedCount(cur.ln), ul = $("export-list");
    $("export-sum").textContent = n ? t("ex.sum", { n: n, total: cur.ln.length }) : t("ex.none");
    ul.textContent = "";
    ["lrc", "srt", "vtt", "ttml", "json", "txt"].forEach(function (k) {
      var spec = F.EXPORTS[k], timedOnly = k !== "json" && k !== "txt";
      var li = el("li", "ex-row");
      var txt = el("div", "ex-txt");
      txt.appendChild(el("strong", "", t("ex." + k) + " (" + spec.ext + ")"));
      txt.appendChild(el("span", "dim", t("ex." + k + "D")));
      var b = el("button", "chip pri", t("ex.save"));
      b.type = "button";
      b.disabled = timedOnly && !n;
      b.addEventListener("click", function () {
        var name = fileTitle(cur) + spec.ext;
        saveFile(spec.fn(cur), name, spec.mime, spec.ext).then(function (ok) { if (ok) toast(t("ex.saved", { name: name })); });
      });
      li.appendChild(txt);
      li.appendChild(b);
      ul.appendChild(li);
    });
    $("export-dlg").showModal();
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

    ["tap", "hold"].forEach(function (m) {
      $("mode-" + m).addEventListener("click", function () { dev.mode = m; saveDev(); renderSync(); });
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

  // ---------- 14. Deep link: search hits open a song ----------
  // target = { song: id }. Unknown ids are ignored.
  window.__orosOpenAt = function (target) {
    var id = target && typeof target.song === "string" ? target.song : "";
    if (!id || !C.find(data, id)) return;
    if (document.querySelector("dialog[open]")) return;
    flushLyrics();
    openSong(id);
  };
  function takePending() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget(APP_ID);
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
