// ============================================================
// orOS Ringtone Composer — App logic (v1.0.0)
// Write a melody note by note, as on the old phones, and hear it.
//   - keypad of an old phone (1-7 notes, 0 rest, 8/9 shorter/longer,
//     * octave, # sharp) or a piano; letters a-g on the keyboard too
//   - the melody on a small staff and as RTTTL tokens; tap to edit
//   - tempo, three sounds (phone beep, soft, bell), play again and again
//   - my melodies (synced), ready tunes (public domain), undo/redo
//   - WAV download, RTTTL download / copy / import
//   - the .orostone file (orOS bundle): save, open, unzipped folder
// Data:
//   - synced slice "ringtones" (oros-ringtones-data): melodies, LWW per
//     melody + tombstones (R5, R17, R26)
//   - device-local (R10): oros-ringtones-prefs (input, note names,
//     volume, next length and octave, loop, side panel)
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. The melody being made (edit, undo)
//   4. Screen: staff + tokens
//   5. Keypad, piano, next-note options
//   6. Sound (Web Audio)
//   7. My melodies + ready tunes
//   8. WAV, RTTTL (8b. the .orostone file)
//   9. Toasts
//  10. Keyboard (Contract Β) + panel
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C           = window.RingtonesCore;
  var STORAGE_KEY = "oros-ringtones-data";
  var PREFS_KEY   = "oros-ringtones-prefs";
  var SAVE_MS     = 500;
  var WAV_RATE    = 22050;
  var MAX_UNDO    = 100;
  var STEP_PX     = 30;            // staff: room per note

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();

  var STRINGS = {
    en: {
      "app.name": "Ringtone Composer",
      "sub.notes": "{n} notes · {s} s", "sub.notes1": "1 note · {s} s", "sub.none": "No notes yet",
      "f.name": "Name of the melody", "f.name.ph": "Untitled melody",
      "notes.label": "Notes of the melody", "empty.hint": "Press a number key, a piano key or a letter (C–B) to write the first note.",
      "sec.length": "Length", "sec.octave": "Octave", "sec.voice": "Sound", "bpm": "Tempo: {n} beats a minute",
      "len.1": "1/1", "len.2": "1/2", "len.4": "1/4", "len.8": "1/8", "len.16": "1/16", "len.32": "1/32",
      "lenname.1": "whole", "lenname.2": "half", "lenname.4": "quarter", "lenname.8": "eighth", "lenname.16": "sixteenth", "lenname.32": "thirty-second",
      "dotted": "dotted", "rest": "rest", "sharp": "sharp",
      "voice.square": "Phone beep", "voice.soft": "Soft", "voice.bell": "Bell",
      "f.loop": "Play again and again",
      "keypad.label": "Phone keypad", "piano.label": "Piano",
      "key.1": "C", "key.2": "D", "key.3": "E", "key.4": "F", "key.5": "G", "key.6": "A", "key.7": "B",
      "key.8": "shorter", "key.9": "longer", "key.star": "octave", "key.0": "rest", "key.hash": "sharp",
      "key.rest": "Rest", "key.dot": "Dot",
      "btn.del": "Delete note", "btn.left": "Previous note", "btn.right": "Next note",
      "btn.play": "Play", "btn.stop": "Stop", "btn.undo": "Undo", "btn.redo": "Redo",
      "mode.piano": "Piano: on", "mode.keys": "Piano: off (phone keypad)",
      "btn.save": "Save melody", "btn.saved": "Saved", "btn.new": "New melody",
      "btn.wav": "Download WAV", "btn.rtttl": "Download RTTTL", "btn.copy": "Copy RTTTL", "btn.import": "Import RTTTL",
      "btn.tone": "orOS file (.orostone)",
      "btn.list": "My melodies", "btn.closePanel": "Close", "btn.cancel": "Cancel",
      "sec.mine": "My melodies", "sec.ready": "Ready tunes", "sec.names": "Note names",
      "names.letters": "C D E", "names.solfege": "Do Re Mi", "f.volume": "Volume",
      "mine.empty": "Melodies you save appear here. They follow you to all your devices.",
      "item.open": "Open", "item.play": "Play", "item.dup": "Duplicate", "item.delete": "Delete melody",
      "import.title": "Import RTTTL", "import.hint": "Paste a ringtone in RTTTL text, the format of old phones, or open a .txt, .rtttl or .orostone file.",
      "import.file": "Open a file", "import.folder": "Unzipped orOS folder…",
      "import.newer": "This file was made by a newer orOS. Update orOS to open it.", "import.ok": "Import", "import.bad": "This does not look like RTTTL text.",
      "toast.saved": "Melody saved", "toast.deleted": "Melody deleted", "toast.undo": "Undo",
      "toast.copied": "RTTTL copied", "toast.copyFail": "Could not copy", "toast.file": "Saved",
      "toast.empty": "Write a few notes first", "toast.full": "A melody takes up to {n} notes",
      "toast.mineFull": "You have {n} melodies, the most there can be",
      "toast.saveFail": "Could not save: storage is full", "toast.dup": "Copy made",
      "toast.imported": "Imported: {name}", "toast.skipped": "Imported; {n} notes could not be read",
      "toast.noAudio": "This browser cannot play sound"
    },
    el: {
      "app.name": "Συνθέτης ήχων κλήσης",
      "sub.notes": "{n} νότες · {s} δ", "sub.notes1": "1 νότα · {s} δ", "sub.none": "Καμία νότα ακόμη",
      "f.name": "Όνομα μελωδίας", "f.name.ph": "Μελωδία χωρίς όνομα",
      "notes.label": "Νότες της μελωδίας", "empty.hint": "Πάτα ένα αριθμητικό πλήκτρο, ένα πλήκτρο του πιάνου ή ένα γράμμα (C–B) για την πρώτη νότα.",
      "sec.length": "Διάρκεια", "sec.octave": "Οκτάβα", "sec.voice": "Ήχος", "bpm": "Ρυθμός: {n} χτύποι το λεπτό",
      "len.1": "1/1", "len.2": "1/2", "len.4": "1/4", "len.8": "1/8", "len.16": "1/16", "len.32": "1/32",
      "lenname.1": "ολόκληρο", "lenname.2": "μισό", "lenname.4": "τέταρτο", "lenname.8": "όγδοο", "lenname.16": "δέκατο έκτο", "lenname.32": "τριακοστό δεύτερο",
      "dotted": "με τελεία", "rest": "παύση", "sharp": "δίεση",
      "voice.square": "Μπιπ κινητού", "voice.soft": "Απαλός", "voice.bell": "Καμπανάκι",
      "f.loop": "Παίξε ξανά και ξανά",
      "keypad.label": "Πληκτρολόγιο κινητού", "piano.label": "Πιάνο",
      "key.1": "ντο", "key.2": "ρε", "key.3": "μι", "key.4": "φα", "key.5": "σολ", "key.6": "λα", "key.7": "σι",
      "key.8": "κοντύτερη", "key.9": "μακρύτερη", "key.star": "οκτάβα", "key.0": "παύση", "key.hash": "δίεση",
      "key.rest": "Παύση", "key.dot": "Τελεία",
      "btn.del": "Διαγραφή νότας", "btn.left": "Προηγούμενη νότα", "btn.right": "Επόμενη νότα",
      "btn.play": "Αναπαραγωγή", "btn.stop": "Σταμάτημα", "btn.undo": "Αναίρεση", "btn.redo": "Επανάληψη",
      "mode.piano": "Πιάνο: ανοιχτό", "mode.keys": "Πιάνο: κλειστό (πληκτρολόγιο κινητού)",
      "btn.save": "Αποθήκευση", "btn.saved": "Αποθηκεύτηκε", "btn.new": "Νέα μελωδία",
      "btn.wav": "Λήψη WAV", "btn.rtttl": "Λήψη RTTTL", "btn.copy": "Αντιγραφή RTTTL", "btn.import": "Εισαγωγή RTTTL",
      "btn.tone": "Αρχείο orOS (.orostone)",
      "btn.list": "Οι μελωδίες μου", "btn.closePanel": "Κλείσιμο", "btn.cancel": "Άκυρο",
      "sec.mine": "Οι μελωδίες μου", "sec.ready": "Έτοιμες μελωδίες", "sec.names": "Ονόματα νοτών",
      "names.letters": "C D E", "names.solfege": "Ντο Ρε Μι", "f.volume": "Ένταση",
      "mine.empty": "Οι μελωδίες που αποθηκεύεις εμφανίζονται εδώ. Σε ακολουθούν σε όλες τις συσκευές σου.",
      "item.open": "Άνοιγμα", "item.play": "Αναπαραγωγή", "item.dup": "Διπλασιασμός", "item.delete": "Διαγραφή μελωδίας",
      "import.title": "Εισαγωγή RTTTL", "import.hint": "Επικόλλησε έναν ήχο κλήσης σε κείμενο RTTTL, τη μορφή των παλιών κινητών, ή άνοιξε αρχείο .txt, .rtttl ή .orostone.",
      "import.file": "Άνοιγμα αρχείου", "import.folder": "Αποσυμπιεσμένος φάκελος orOS…",
      "import.newer": "Το αρχείο φτιάχτηκε από νεότερο orOS. Ενημέρωσε το orOS για να το ανοίξεις.", "import.ok": "Εισαγωγή", "import.bad": "Αυτό δεν μοιάζει με κείμενο RTTTL.",
      "toast.saved": "Η μελωδία αποθηκεύτηκε", "toast.deleted": "Η μελωδία διαγράφηκε", "toast.undo": "Αναίρεση",
      "toast.copied": "Το RTTTL αντιγράφηκε", "toast.copyFail": "Δεν έγινε αντιγραφή", "toast.file": "Αποθηκεύτηκε",
      "toast.empty": "Γράψε πρώτα μερικές νότες", "toast.full": "Μια μελωδία χωράει έως {n} νότες",
      "toast.mineFull": "Έχεις {n} μελωδίες, όσες χωράνε",
      "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.dup": "Έγινε αντίγραφο",
      "toast.imported": "Εισήχθη: {name}", "toast.skipped": "Εισήχθη· {n} νότες δεν διαβάστηκαν",
      "toast.noAudio": "Αυτός ο browser δεν παίζει ήχο"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "ringtones", LANG);
  var SOLF = C.solfegeOf(LANG);      // solfège names in the UI language

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function setLabel(b, label) { b.setAttribute("aria-label", label); b.title = label; }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("ringtones.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = { ver: 1, melodies: [], tombs: {} };
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.melodies)) {
          data = C.mergeRingtones(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] ringtones: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = { ver: 1, melodies: [], tombs: {} };
  }

  var saveFailShown = false, saveTimer = null;
  function save() {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.saveFail")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_MS);
  }
  function flush() { if (saveTimer) save(); }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    var vol = parseInt(p.vol, 10);
    prefs = {
      input: p.input === "piano" ? "piano" : "keys",
      names: p.names === "letters" || p.names === "solfege" ? p.names : (LANG === "el" ? "solfege" : "letters"),
      vol: isFinite(vol) ? Math.max(0, Math.min(100, vol)) : 70,
      len: C.LENGTHS.indexOf(p.len) >= 0 ? p.len : 4,
      oct: C.OCTAVES.indexOf(p.oct) >= 0 ? p.oct : 5,
      loop: p.loop === true,
      cur: typeof p.cur === "string" ? p.cur : "",
      panel: p.panel !== false
    };
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 3. The melody being made ----------
  var cur = null;              // the open saved melody, or null for a new one
  var song = null;             // { name, bpm, voice, notes: [note] }
  var cursor = 0;              // insertion point 0..notes.length; the selected note is cursor-1
  var undoStack = [], redoStack = [];

  function solfege() { return prefs.names === "solfege"; }
  function snapshot() {
    return JSON.stringify({ name: song.name, bpm: song.bpm, voice: song.voice, notes: C.notesText(song.notes), cursor: cursor });
  }
  function restore(snap) {
    var s = JSON.parse(snap);
    song = { name: s.name, bpm: s.bpm, voice: s.voice, notes: C.parseNotes(s.notes) };
    cursor = Math.min(s.cursor, song.notes.length);
  }
  // Every change goes through edit(): undo point, store, redraw.
  function edit(fn, opts) {
    opts = opts || {};
    var before = snapshot();
    fn();
    var after = snapshot();
    if (after === before) { renderAll(); return; }
    if (!opts.merge || !undoStack.length) {
      undoStack.push(before);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
    }
    redoStack = [];
    changed();
  }
  function changed() {
    if (playing) stop();
    if (cur) {
      if (song.notes.length) {
        cur.name = C.normMelody({ id: cur.id, m: 0, name: song.name, notes: "4c5" }).name;
        cur.bpm = song.bpm; cur.voice = song.voice; cur.notes = C.notesText(song.notes);
        touch(cur); saveSoon(); renderMineSoon();
      }
    }
    renderAll();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    changed();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    changed();
  }
  function touch(x) { x.m = Math.max(Date.now(), (data.tombs[x.id] || 0) + 1, x.m + 1); }

  function selected() { return cursor > 0 ? song.notes[cursor - 1] : null; }

  function insertNote(note) {
    if (song.notes.length >= C.MAX_NOTES) { showToast(t("toast.full", { n: C.MAX_NOTES })); return; }
    edit(function () {
      song.notes.splice(cursor, 0, note);
      cursor++;
    });
    playOne(note);
    live(noteLabel(note));
  }
  // Change the selected note (8, 9, *, #, dot, transpose). The next
  // notes take its length and octave, as on the phones.
  function changeSelected(fn) {
    var s = selected();
    if (!s) return;
    var nn = fn(s);
    edit(function () { song.notes[cursor - 1] = nn; });
    if (!C.isRest(nn)) { prefs.oct = nn.o; }
    prefs.len = nn.d; savePrefs();
    renderNext();
    playOne(nn);
    live(noteLabel(nn));
  }
  function deleteNote() {
    if (!cursor) return;
    edit(function () { song.notes.splice(cursor - 1, 1); cursor--; });
  }
  function moveCursor(d) {
    var c = Math.max(0, Math.min(song.notes.length, cursor + d));
    if (c === cursor) return;
    cursor = c;
    renderScreen();
    var s = selected();
    if (s) { playOne(s); live(noteLabel(s)); }
  }

  function openMelody(x, keepPanel) {
    flush(); stop();
    cur = x || null;
    prefs.cur = cur ? cur.id : ""; savePrefs();
    song = x ? { name: x.name, bpm: x.bpm, voice: x.voice, notes: C.parseNotes(x.notes) }
             : { name: "", bpm: C.DEFAULT.bpm, voice: C.DEFAULT.voice, notes: [] };
    cursor = song.notes.length;
    undoStack = []; redoStack = [];
    renderAll(); renderMine();
    if (!keepPanel) closePanelOnPhone();
  }
  // A new, unsaved melody from a ready tune or an import.
  function startFrom(name, bpm, notes, voice) {
    flush(); stop();
    var before = song && song.notes.length ? snapshot() : null;
    cur = null; prefs.cur = ""; savePrefs();
    song = { name: name, bpm: bpm, voice: voice || C.DEFAULT.voice, notes: notes };
    cursor = notes.length;
    undoStack = before ? [before] : []; redoStack = [];
    renderAll(); renderMine();
    closePanelOnPhone();
  }

  function saveMelody() {
    if (cur) return;
    if (!song.notes.length) { showToast(t("toast.empty")); return; }
    if (data.melodies.length >= C.MAX_MELODIES) { showToast(t("toast.mineFull", { n: C.MAX_MELODIES })); return; }
    var x = { id: C.newId(Math.random), m: Date.now(), name: song.name, bpm: song.bpm, voice: song.voice, notes: C.notesText(song.notes) };
    data = C.mergeRingtones(data, { melodies: [x], tombs: {} });
    save();
    cur = C.findMelody(data, x.id);
    prefs.cur = cur.id; savePrefs();
    showToast(t("toast.saved"));
    renderHead(); renderMine();
  }
  function newMelody() {
    openMelody(null, true);
    focusInput();
  }

  // ---------- 4. Screen: staff + tokens ----------
  function noteLabel(note) {
    var len = t("lenname." + note.d) + (note.dot ? " " + t("dotted") : "");
    if (C.isRest(note)) return t("rest") + ", " + len;
    var nm = (solfege() ? SOLF : C.LETTERS)[note.n].replace("#", "");
    if (!solfege()) nm = nm.toUpperCase();
    var sharp = C.LETTERS[note.n].indexOf("#") > 0 ? " " + t("sharp") : "";
    return nm + sharp + " " + note.o + ", " + len;
  }

  function secs(notes, bpm) {
    var s = (C.totalMs(notes, bpm) / 1000).toFixed(1);
    var loc = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");
    return (+s).toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
  }
  function renderHead() {
    $("title-view").textContent = song.name || t("app.name");
    var n = song.notes.length, s = secs(song.notes, song.bpm);
    $("title-sub").textContent = n ? (n === 1 ? t("sub.notes1", { s: s }) : t("sub.notes", { n: n, s: s })) : t("sub.none");
    var sb = $("save-btn");
    sb.textContent = cur ? t("btn.saved") : t("btn.save");
    sb.disabled = !!cur || !n;
    sb.classList.toggle("done", !!cur);
    $("undo-btn").disabled = !undoStack.length;
    $("redo-btn").disabled = !redoStack.length;
    var ni = $("name-in");
    if (document.activeElement !== ni) ni.value = song.name;
  }

  // The staff: treble lines, one column per note. Notes from A6 up are
  // drawn an octave lower under an "8va" mark, so they stay readable.
  var LETTER_STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];   // semitone → letter (c d e f g a b)
  function renderStaff() {
    var svg = $("staff"), notes = song.notes;
    var H = 150, gap = 8, top = 52;                        // line spacing 8px: half step 4px
    var bottomY = top + 4 * gap;                           // E4 line
    var W = Math.max(svg.parentNode.clientWidth || 300, 24 + (notes.length + 1) * STEP_PX);
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    for (var l = 0; l < 5; l++) {
      svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: top + l * gap, y2: top + l * gap, "class": "sl" }));
    }
    notes.forEach(function (nt, i) {
      var x = 24 + i * STEP_PX + STEP_PX / 2, g = svgEl("g", { "class": "nt" + (i === cursor - 1 ? " sel" : "") + (i === playingIdx ? " on" : ""), "data-i": i });
      g.appendChild(svgEl("rect", { x: x - STEP_PX / 2, y: 0, width: STEP_PX, height: H, "class": "hit" }));
      if (C.isRest(nt)) drawRest(g, nt, x, top, gap);
      else {
        var step = nt.o * 7 + LETTER_STEP[nt.n], high = step >= 47;   // A6
        if (high) step -= 7;
        var y = bottomY - (step - 30) * (gap / 2);
        // ledger lines
        for (var s = 28; s >= step; s -= 2) g.appendChild(svgEl("line", { x1: x - 9, x2: x + 9, y1: bottomY - (s - 30) * gap / 2, y2: bottomY - (s - 30) * gap / 2, "class": "sl" }));
        for (var s2 = 40; s2 <= step; s2 += 2) g.appendChild(svgEl("line", { x1: x - 9, x2: x + 9, y1: bottomY - (s2 - 30) * gap / 2, y2: bottomY - (s2 - 30) * gap / 2, "class": "sl" }));
        var filled = nt.d >= 4;
        g.appendChild(svgEl("ellipse", { cx: x, cy: y, rx: 5.6, ry: 4, transform: "rotate(-20 " + x + " " + y + ")", "class": filled ? "hd" : "hd open" }));
        if (nt.d > 1) {
          var up = step < 34, sx = up ? x + 5 : x - 5, sy2 = up ? y - 26 : y + 26;
          g.appendChild(svgEl("line", { x1: sx, x2: sx, y1: y, y2: sy2, "class": "st" }));
          var flags = nt.d === 8 ? 1 : nt.d === 16 ? 2 : nt.d === 32 ? 3 : 0;
          for (var f = 0; f < flags; f++) {
            var fy = sy2 + (up ? f * 6 : -f * 6);
            g.appendChild(svgEl("path", { d: "M" + sx + " " + fy + " q 7 " + (up ? 4 : -4) + " 6 " + (up ? 11 : -11), "class": "fl" }));
          }
        }
        if (C.LETTERS[nt.n].indexOf("#") > 0) {
          var sh = svgEl("text", { x: x - 13, y: y + 4, "class": "acc" }); sh.textContent = "♯"; g.appendChild(sh);
        }
        if (nt.dot) g.appendChild(svgEl("circle", { cx: x + 9, cy: y - (step % 2 === 0 ? 3 : 0), r: 1.8, "class": "hd" }));
        if (high) { var va = svgEl("text", { x: x - 7, y: 12, "class": "va" }); va.textContent = "8va"; g.appendChild(va); }
      }
      svg.appendChild(g);
    });
    var cx = 24 + cursor * STEP_PX;
    svg.appendChild(svgEl("line", { x1: cx, x2: cx, y1: top - 14, y2: bottomY + 14, "class": "cur" }));
    // keep the cursor in view
    var wrap = $("staff-wrap");
    if (cx < wrap.scrollLeft + 20 || cx > wrap.scrollLeft + wrap.clientWidth - 20) {
      wrap.scrollLeft = Math.max(0, cx - wrap.clientWidth / 2);
    }
  }
  function drawRest(g, nt, x, top, gap) {
    if (nt.d <= 2) {
      var y = nt.d === 1 ? top + gap : top + 2 * gap - 4;   // whole hangs from line 4, half sits on line 3
      g.appendChild(svgEl("rect", { x: x - 6, y: y, width: 12, height: 4, "class": "hd" }));
    } else if (nt.d === 4) {
      g.appendChild(svgEl("path", { d: "M" + (x - 2) + " " + (top + 6) + " l5 7 l-5 6 l5 7 q-6 -2 -3 4", "class": "rs" }));
    } else {
      var n = nt.d === 8 ? 1 : nt.d === 16 ? 2 : 3;
      g.appendChild(svgEl("line", { x1: x + 3, x2: x - 2, y1: top + 10, y2: top + 28, "class": "st" }));
      for (var i = 0; i < n; i++) {
        g.appendChild(svgEl("circle", { cx: x - 3, cy: top + 11 + i * 6, r: 2, "class": "hd" }));
        g.appendChild(svgEl("line", { x1: x - 3, x2: x + 3 - i * 0.6, y1: top + 11 + i * 6, y2: top + 10 + i * 6, "class": "st" }));
      }
    }
    if (nt.dot) g.appendChild(svgEl("circle", { cx: x + 8, cy: top + 2 * gap - 2, r: 1.8, "class": "hd" }));
  }

  function renderTokens() {
    var host = $("tokens");
    host.innerHTML = "";
    song.notes.forEach(function (nt, i) {
      var b = el("button", "tok" + (i === cursor - 1 ? " sel" : "") + (i === playingIdx ? " on" : ""));
      b.type = "button";
      b.setAttribute("role", "listitem");
      var txt = nt.d + (C.isRest(nt) ? "–" : (solfege() ? SOLF[nt.n] + nt.o : C.noteName(nt, false)).toLowerCase()) + (nt.dot ? "." : "");
      b.textContent = txt;
      b.setAttribute("aria-label", (i + 1) + ". " + noteLabel(nt));
      if (i === cursor - 1) b.setAttribute("aria-current", "true");
      b.addEventListener("click", function () { selectAt(i); });
      host.appendChild(b);
    });
    $("empty-hint").hidden = song.notes.length > 0;
    var sel = host.querySelector(".tok.sel");
    if (sel && sel.scrollIntoView) { try { sel.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {} }
  }
  function selectAt(i) {
    cursor = i + 1;
    var s = selected();
    if (s) { prefs.len = s.d; if (!C.isRest(s)) prefs.oct = s.o; savePrefs(); renderNext(); playOne(s); }
    renderScreen();
  }
  function renderScreen() { renderStaff(); renderTokens(); }
  function renderAll() { renderHead(); renderScreen(); renderSong(); }

  // ---------- 5. Keypad, piano, next-note options ----------
  var ICON = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    piano: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M8 4v16M14 4v16M6 4v9h4V4M12 4v9h4V4"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    dup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
  };

  // Phone keys: [face, sub-label key, action]
  var KEYS = [
    ["1", "key.1", function () { pressNatural(1); }], ["2", "key.2", function () { pressNatural(2); }], ["3", "key.3", function () { pressNatural(3); }],
    ["4", "key.4", function () { pressNatural(4); }], ["5", "key.5", function () { pressNatural(5); }], ["6", "key.6", function () { pressNatural(6); }],
    ["7", "key.7", function () { pressNatural(7); }], ["8", "key.8", function () { changeSelected(function (n) { return C.stepLength(n, false); }); }],
    ["9", "key.9", function () { changeSelected(function (n) { return C.stepLength(n, true); }); }],
    ["*", "key.star", function () { changeSelected(C.cycleOctave); }], ["0", "key.0", function () { insertNote(C.mkNote(-1, prefs.oct, prefs.len)); }],
    ["#", "key.hash", function () { changeSelected(C.toggleSharp); }]
  ];
  function pressNatural(k) { insertNote(C.keyNote(k, prefs.len, prefs.oct)); }

  function renderKeypad() {
    var host = $("keypad");
    host.innerHTML = "";
    KEYS.forEach(function (k) {
      var b = el("button", "key");
      b.type = "button";
      b.appendChild(el("span", "kf", k[0]));
      b.appendChild(el("span", "ks", t(k[1])));
      setLabel(b, k[0] + ": " + t(k[1]));
      b.addEventListener("click", function () { k[2](); });
      host.appendChild(b);
    });
  }

  // Piano: C to the next C in the octave chosen for the next note.
  function renderPiano() {
    var host = $("piano");
    host.innerHTML = "";
    var whites = [0, 2, 4, 5, 7, 9, 11, 12];
    whites.forEach(function (s, i) {
      var b = el("button", "pk w");
      b.type = "button";
      var o = prefs.oct + (s === 12 ? 1 : 0), n = s % 12;
      if (o > 7) { b.disabled = true; }
      var lbl = solfege() ? SOLF[n] : C.LETTERS[n].toUpperCase();
      b.appendChild(el("span", "pl", lbl));
      setLabel(b, lbl + " " + o);
      b.addEventListener("click", function () { insertNote(C.mkNote(n, Math.min(o, 7), prefs.len)); });
      b.style.gridColumn = (i * 2 + 1) + " / span 2";
      host.appendChild(b);
    });
    [1, 3, 6, 8, 10].forEach(function (s) {
      var b = el("button", "pk b");
      b.type = "button";
      var pos = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }[s];
      var lbl = (solfege() ? SOLF[s] : C.LETTERS[s].toUpperCase());
      setLabel(b, lbl + " " + prefs.oct);
      b.addEventListener("click", function () { insertNote(C.mkNote(s, prefs.oct, prefs.len)); });
      b.style.gridColumn = (pos * 2 + 2) + " / span 2";
      host.appendChild(b);
    });
  }

  function radioChips(host, values, curVal, label, onPick) {
    host.innerHTML = "";
    values.forEach(function (v) {
      var on = v === curVal;
      var b = el("button", "chip" + (on ? " on" : ""), label(v));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      b.addEventListener("click", function () { onPick(v); });
      host.appendChild(b);
    });
    host.onkeydown = function (e) {
      var d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0);
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      var i = values.indexOf(curVal), j = (i + d + values.length) % values.length;
      onPick(values[j]);
      var nb = host.querySelectorAll('[role="radio"]')[j];
      if (nb) nb.focus();
    };
  }
  function renderNext() {
    radioChips($("lengths"), C.LENGTHS, prefs.len, function (v) { return t("len." + v); }, function (v) {
      prefs.len = v; savePrefs(); renderNext();
    });
    $("lengths").querySelectorAll("button").forEach(function (b, i) { b.setAttribute("aria-label", t("lenname." + C.LENGTHS[i])); });
    radioChips($("octaves"), C.OCTAVES, prefs.oct, String, function (v) {
      prefs.oct = v; savePrefs(); renderNext();
      if (prefs.input === "piano") renderPiano();
    });
    if (prefs.input === "piano") renderPiano();
  }
  function renderSong() {
    var bi = $("bpm-in");
    if (document.activeElement !== bi) bi.value = String(song.bpm);
    $("bpm-lbl").textContent = t("bpm", { n: song.bpm });
    radioChips($("voices"), C.VOICES, song.voice, function (v) { return t("voice." + v); }, function (v) {
      edit(function () { song.voice = v; });
      playOne(selected() && !C.isRest(selected()) ? selected() : C.mkNote(0, 5, 8));
    });
  }
  function renderInput() {
    var piano = prefs.input === "piano", b = $("mode-btn");
    $("keypad").hidden = piano;
    $("piano-box").hidden = !piano;
    b.setAttribute("aria-pressed", piano ? "true" : "false");
    setLabel(b, piano ? t("mode.piano") : t("mode.keys"));
    if (piano) renderPiano();
  }
  function toggleInput() {
    prefs.input = prefs.input === "piano" ? "keys" : "piano"; savePrefs(); renderInput();
    live(prefs.input === "piano" ? t("mode.piano") : t("mode.keys"));
  }
  function focusInput() {
    var first = prefs.input === "piano" ? $("piano").querySelector("button") : $("keypad").querySelector("button");
    if (first) try { first.focus({ preventScroll: true }); } catch (e) {}
  }

  // ---------- 6. Sound ----------
  var actx = null, master = null, bellWave = null;
  var playing = null, playingIdx = -1, hlTimers = [];
  function audio() {
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        actx = new AC();
        master = actx.createGain();
        master.connect(actx.destination);
        var real = new Float32Array([0, 0.7, 0.2, 0.1]), imag = new Float32Array(4);
        bellWave = actx.createPeriodicWave(real, imag);
      }
      if (actx.state === "suspended") actx.resume();
      master.gain.value = Math.pow(prefs.vol / 100, 1.6) * 0.5;
      return actx;
    } catch (e) { return null; }
  }
  // One note at time `at` (seconds), sounding for 90% of its length.
  function scheduleNote(a, nt, at, ms, voice, out) {
    var f = C.freq(nt);
    if (!f) return;
    var o = a.createOscillator(), g = a.createGain(), on = ms * 0.9 / 1000;
    if (voice === "bell") o.setPeriodicWave(bellWave); else o.type = voice === "soft" ? "sine" : "square";
    o.frequency.value = f;
    var peak = voice === "square" ? 0.22 : 0.6;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.004);
    if (voice === "bell") g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * Math.exp(-3 * on)), at + on);
    else g.gain.setValueAtTime(peak, at + Math.max(0.005, on - 0.012));
    g.gain.linearRampToValueAtTime(0, at + on);
    o.connect(g); g.connect(out);
    o.start(at); o.stop(at + on + 0.02);
    return o;
  }
  function playOne(nt) {
    if (playing) return;                               // the melody is playing: no previews over it
    var a = audio(); if (!a || !nt || C.isRest(nt)) return;
    var bus = a.createGain(); bus.connect(master);
    scheduleNote(a, nt, a.currentTime + 0.01, Math.min(C.durMs(nt, song.bpm), 600), song.voice, bus);
    setTimeout(function () { try { bus.disconnect(); } catch (e) {} }, 1200);
  }
  // Plays notes (from index `from`), highlighting each; loops if asked.
  function playNotes(notes, bpm, voice, from, onEnd) {
    stop();
    var a = audio();
    if (!a) { showToast(t("toast.noAudio")); return; }
    var bus = a.createGain(); bus.connect(master);
    var t0 = a.currentTime + 0.05, ms = 0, list = notes.slice(from);
    var me = { bus: bus, end: onEnd };
    playing = me;
    list.forEach(function (nt, k) {
      var d = C.durMs(nt, bpm);
      scheduleNote(a, nt, t0 + ms / 1000, d, voice, bus);
      if (onEnd === null) {
        (function (idx, when) {
          hlTimers.push(setTimeout(function () { if (playing === me) { playingIdx = idx; highlight(); } }, when));
        })(from + k, ms + 50);
      }
      ms += d;
    });
    hlTimers.push(setTimeout(function () {
      if (playing !== me) return;
      if (onEnd === null && prefs.loop && notes.length) { playNotes(notes, bpm, voice, 0, null); return; }
      stop();
      if (typeof onEnd === "function") onEnd();
    }, ms + 80));
    renderPlay();
  }
  function stop() {
    hlTimers.forEach(clearTimeout); hlTimers = [];
    if (playing) {
      var bus = playing.bus;
      try { bus.gain.setValueAtTime(bus.gain.value, actx.currentTime); bus.gain.linearRampToValueAtTime(0, actx.currentTime + 0.03); } catch (e) {}
      setTimeout(function () { try { bus.disconnect(); } catch (e) {} }, 60);
    }
    playing = null;
    var had = playingIdx >= 0;
    playingIdx = -1;
    if (had) highlight();
    renderPlay();
  }
  function togglePlay() {
    if (playing) { stop(); return; }
    if (!song.notes.length) { showToast(t("toast.empty")); return; }
    var from = cursor > 0 && cursor < song.notes.length ? cursor - 1 : 0;
    playNotes(song.notes, song.bpm, song.voice, from, null);
  }
  function highlight() {
    [].forEach.call(document.querySelectorAll("#tokens .tok"), function (b, i) { b.classList.toggle("on", i === playingIdx); });
    [].forEach.call(document.querySelectorAll("#staff .nt"), function (g, i) { g.classList.toggle("on", i === playingIdx); });
    var on = document.querySelector("#tokens .tok.on");
    if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {} }
    var wrap = $("staff-wrap"), x = 24 + playingIdx * STEP_PX;
    if (playingIdx >= 0 && (x < wrap.scrollLeft || x > wrap.scrollLeft + wrap.clientWidth - STEP_PX)) wrap.scrollLeft = Math.max(0, x - 40);
  }
  function renderPlay() {
    var b = $("play-btn"), on = !!playing && playing.end === null;
    b.innerHTML = on ? ICON.stop : ICON.play;
    setLabel(b, on ? t("btn.stop") : t("btn.play"));
    b.setAttribute("aria-pressed", on ? "true" : "false");
    [].forEach.call(document.querySelectorAll("#mine .play-mini"), function (pb) {
      var mine = playing && playing.end && playing.id === pb.getAttribute("data-id");
      pb.innerHTML = mine ? ICON.stop : ICON.play;
    });
  }

  // ---------- 7. My melodies + ready tunes ----------
  var mineTimer = null;
  function renderMineSoon() { clearTimeout(mineTimer); mineTimer = setTimeout(renderMine, 600); }
  function renderMine() {
    clearTimeout(mineTimer);
    var host = $("mine"), list = C.newestFirst(data.melodies);
    host.innerHTML = "";
    $("mine-empty").hidden = list.length > 0;
    $("mine-count").textContent = list.length ? String(list.length) : "";
    list.forEach(function (x) {
      var li = el("li", "row"), on = !!(cur && cur.id === x.id), title = x.name || t("f.name.ph");
      if (on) li.classList.add("on");
      var pb = el("button", "icon-btn play-mini");
      pb.type = "button"; pb.innerHTML = ICON.play; pb.setAttribute("data-id", x.id);
      setLabel(pb, t("item.play") + ": " + title);
      pb.addEventListener("click", function () {
        if (playing && playing.id === x.id) { stop(); return; }
        var m = C.findMelody(data, x.id); if (!m) return;
        playNotes(C.parseNotes(m.notes), m.bpm, m.voice, 0, function () {});
        if (playing) { playing.id = x.id; renderPlay(); }
      });
      li.appendChild(pb);
      var open = el("button", "row-open");
      open.type = "button";
      if (on) open.setAttribute("aria-current", "true");
      open.appendChild(el("span", "row-title", title));
      var notes = C.parseNotes(x.notes);
      open.appendChild(el("span", "row-desc", (notes.length === 1 ? t("sub.notes1", { s: secs(notes, x.bpm) }) : t("sub.notes", { n: notes.length, s: secs(notes, x.bpm) }))));
      open.addEventListener("click", function () { openMelody(C.findMelody(data, x.id)); });
      li.appendChild(open);
      var dup = el("button", "icon-btn");
      dup.type = "button"; dup.innerHTML = ICON.dup;
      setLabel(dup, t("item.dup") + ": " + title);
      dup.addEventListener("click", function () { duplicate(x.id); });
      li.appendChild(dup);
      var d = el("button", "icon-btn del-btn");
      d.type = "button"; d.innerHTML = ICON.del;
      setLabel(d, t("item.delete") + ": " + title);
      d.addEventListener("click", function () { deleteMelody(x.id); });
      li.appendChild(d);
      host.appendChild(li);
    });
  }
  function duplicate(id) {
    var x = C.findMelody(data, id);
    if (!x) return;
    if (data.melodies.length >= C.MAX_MELODIES) { showToast(t("toast.mineFull", { n: C.MAX_MELODIES })); return; }
    var copy = JSON.parse(JSON.stringify(x));
    copy.id = C.newId(Math.random); copy.m = Date.now();
    data = C.mergeRingtones(data, { melodies: [copy], tombs: {} });
    save();
    openMelody(C.findMelody(data, copy.id), true);
    showToast(t("toast.dup"));
  }
  function deleteMelody(id) {
    var x = C.findMelody(data, id);
    if (!x) return;
    if (playing && playing.id === id) stop();
    var snap = JSON.parse(JSON.stringify(x)), tombs = {};
    tombs[id] = Math.max(Date.now(), x.m);
    data = C.mergeRingtones(data, { melodies: [], tombs: tombs });
    save();
    if (cur && cur.id === id) { cur = null; prefs.cur = ""; savePrefs(); renderHead(); }   // the notes stay, unsaved
    renderMine();
    undoToast(t("toast.deleted"), function () {
      snap.m = Math.max(Date.now(), (data.tombs[snap.id] || 0) + 1);   // R17
      data = C.mergeRingtones(data, { melodies: [snap], tombs: {} });
      save();
      openMelody(C.findMelody(data, snap.id), true);
    });
  }
  function renderReady() {
    var host = $("ready");
    host.innerHTML = "";
    C.PRESETS.forEach(function (p) {
      var li = el("li", "row");
      var open = el("button", "row-open");
      open.type = "button";
      open.appendChild(el("span", "row-title", C.presetName(p, LANG)));
      setLabel(open, t("item.open") + ": " + (C.presetName(p, LANG)));
      open.addEventListener("click", function () {
        startFrom(C.presetName(p, LANG), p.bpm, C.parseNotes(p.notes), "square");
        playNotes(song.notes, song.bpm, song.voice, 0, null);
      });
      li.appendChild(open);
      host.appendChild(li);
    });
  }

  // ---------- 8. WAV, RTTTL ----------
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function saveBlob(blob, name, mime, desc, ext) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      var acc = {}; acc[mime] = [ext];
      dlg.saveFile({ blob: blob, filename: name, mime: mime, types: [{ description: desc, accept: acc }] })
        .then(function (r) { if (r && r.ok) showToast(t("toast.file")); });
      return;                       // cancel (ok=false) = silent exit
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast(t("toast.file"));
  }
  function songTitle() { return song.name || t("f.name.ph"); }
  function downloadWav() {
    if (!song.notes.length) { showToast(t("toast.empty")); return; }
    var smp = C.renderSamples(song.notes, song.bpm, song.voice, WAV_RATE);
    var g = Math.pow(prefs.vol / 100, 0.5) || 0.5;
    for (var i = 0; i < smp.length; i++) smp[i] *= g;
    saveBlob(new Blob([C.wavBytes(smp, WAV_RATE)], { type: "audio/wav" }), C.fileName(songTitle(), "wav"), "audio/wav", "WAV", ".wav");
  }
  function rtttl() { return C.toRTTTL(songTitle(), song.bpm, song.notes); }
  function downloadRtttl() {
    if (!song.notes.length) { showToast(t("toast.empty")); return; }
    saveBlob(new Blob([rtttl() + "\r\n"], { type: "text/plain" }), C.fileName(songTitle(), "txt"), "text/plain", "RTTTL", ".txt");
  }
  function copyRtttl() {
    if (!song.notes.length) { showToast(t("toast.empty")); return; }
    var done = function () { showToast(t("toast.copied")); }, fail = function () { showToast(t("toast.copyFail")); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(rtttl()).then(done, fail); return; }
    } catch (e) {}
    fail();
  }
  function openImport() {
    var d = $("import-dlg");
    $("import-text").value = ""; $("import-err").textContent = "";
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    $("import-text").focus();
  }
  function closeImport() { var d = $("import-dlg"); if (d.close) d.close(); else d.removeAttribute("open"); }
  function doImport(e) {
    if (e) e.preventDefault();
    var r = C.parseRTTTL($("import-text").value);
    if (!r) { $("import-err").textContent = t("import.bad"); return; }
    closeImport();
    startFrom(r.name, r.bpm, r.notes, C.DEFAULT.voice);
    showToast(r.skipped ? t("toast.skipped", { n: r.skipped }) : t("toast.imported", { name: r.name || songTitle() }));
  }
  function importFile() {
    var inp = $("import-input");
    inp.value = "";
    inp.onchange = function () { readImport(inp.files && inp.files[0]); };
    inp.click();
  }
  // A picked or handed-over file: an .orostone bundle (sniffed from
  // the first bytes, "PK…mimetype") or RTTTL text, as before.
  function readImport(f) {
    if (!f) return;
    var B = window.OrosBundle;
    if (B && f.size > 4 && f.slice) {
      f.slice(0, 128).arrayBuffer().then(function (head) {
        if (B.sniff(new Uint8Array(head)) === null) { readText(f); return; }
        if (f.size > 32 * 1024 * 1024) { $("import-err").textContent = t("import.bad"); return; }
        f.arrayBuffer()
          .then(function (ab) { return B.read(new Uint8Array(ab), { mime: C.TONE_MIME }); })
          .then(fromBundle, bundleFail);
      }, function () { readText(f); });
      return;
    }
    readText(f);
  }
  function readText(f) {
    if (f.size > 64 * 1024) { $("import-err").textContent = t("import.bad"); return; }
    var rd = new FileReader();
    rd.onload = function () { $("import-text").value = String(rd.result || ""); doImport(null); };
    rd.readAsText(f);
  }

  // ---------- 8b. The .orostone file (bundle.js) ----------
  // One melody per file; opening one always adds a NEW melody (fresh
  // id, normMelody) to My melodies and opens it, never overwriting.
  function saveTone() {
    if (!song.notes.length) { showToast(t("toast.empty")); return; }
    var B = window.OrosBundle;
    var x = cur ? cur : { id: C.newId(Math.random), m: Date.now(), name: song.name, bpm: song.bpm, voice: song.voice, notes: C.notesText(song.notes) };
    var opts = C.toneBundle(x, { title: songTitle(), lang: LANG === "el" ? "el" : "en", rate: WAV_RATE,
      gain: Math.pow(prefs.vol / 100, 0.5) || 0.5, date: new Date() });
    if (!B || !opts) { showToast(t("toast.saveFail")); return; }
    B.write(opts).then(function (bytes) {
      saveBlob(new Blob([bytes], { type: C.TONE_MIME }), C.fileName(songTitle(), "orostone"), C.TONE_MIME, t("btn.tone"), ".orostone");
    }, function () { showToast(t("toast.saveFail")); });
  }
  function fromBundle(r) {
    var x = C.toneFromBundle(r && r.content, Math.random, Date.now());
    if (!x) { $("import-err").textContent = t("import.bad"); return; }
    closeImport();
    startFrom(x.name, x.bpm, C.parseNotes(x.notes), x.voice);
    saveMelody();                 // a new item in My melodies (or a toast: full)
  }
  function bundleFail(e) {
    try { console.error("[orOS] ringtones: .orostone not read:", e && (e.code || e.message)); } catch (er) {}
    $("import-err").textContent = e && e.code === "newer" ? t("import.newer") : t("import.bad");
  }
  // An unzipped .orostone folder (maybe changed by hand)
  function importFolder() {
    var B = window.OrosBundle;
    if (!B) return;
    B.pickFolder().then(function (files) {
      if (!files) return;
      return B.readFolder(files, { mime: C.TONE_MIME }).then(fromBundle, bundleFail);
    });
  }

  // Deep link (shell __orosOpenAt / __orosTakeTarget): { openFile:
  // { token } }, a file from the system's "Open with" (shell
  // fileopen.js), taken once and read as the Import dialog reads one |
  // { importText: { text } }, RTTTL text from another app (Studio's
  // "Make a ringtone"), at most 64 KB: it only fills the Import dialog,
  // the user presses Import.
  var MAX_IMPORT_TEXT = 65536;
  function openTarget(tg) {
    if (!tg || typeof tg !== "object") return;
    if (tg.importText && typeof tg.importText === "object") {
      var tx = tg.importText.text;
      if (typeof tx !== "string" || !tx.trim() || tx.length > MAX_IMPORT_TEXT) return;
      if (!$("import-dlg").open) openImport();
      $("import-text").value = tx;
      $("import-err").textContent = "";
      return;
    }
    if (!tg.openFile || typeof tg.openFile.token !== "string") return;
    var f = null;
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeFile === "function") f = p.__orosTakeFile(tg.openFile.token);
    } catch (e) { f = null; }
    if (!f) return;
    if (!$("import-dlg").open) openImport();
    readImport(f);
  }
  window.__orosOpenAt = openTarget;

  // ---------- 9. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "ringtones", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
  }

  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 10. Keyboard + panel ----------
  var LETTER_KEYS = { c: 1, d: 2, e: 3, f: 4, g: 5, a: 6, b: 7 };
  function typing(e) {
    var tg = e.target, tag = tg && tg.tagName;
    return tag === "INPUT" && tg.type !== "checkbox" && tg.type !== "range" || tag === "TEXTAREA" || (tg && tg.isContentEditable);
  }
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && phone() && document.body.classList.contains("panel-open")) {
        e.preventDefault(); setPanel(false); $("list-btn").focus(); return;
      }
      if (e.defaultPrevented || typing(e) || e.altKey || document.querySelector("dialog[open]")) return;
      var k = e.key;
      if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === "y" || k === "Y")) { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey) return;
      var lk = k.toLowerCase();
      if (/^[1-7]$/.test(k)) { e.preventDefault(); pressNatural(parseInt(k, 10)); }
      else if (LETTER_KEYS[lk] && k.length === 1) { e.preventDefault(); pressNatural(LETTER_KEYS[lk]); }
      else if (k === "0" || lk === "p") { e.preventDefault(); KEYS[10][2](); }
      else if (k === "8") { e.preventDefault(); KEYS[7][2](); }
      else if (k === "9") { e.preventDefault(); KEYS[8][2](); }
      else if (k === "*") { e.preventDefault(); KEYS[9][2](); }
      else if (k === "#") { e.preventDefault(); KEYS[11][2](); }
      else if (k === ".") { e.preventDefault(); changeSelected(C.toggleDot); }
      else if (k === "+" || k === "=") { e.preventDefault(); changeSelected(function (n) { return C.transpose(n, 1); }); }
      else if (k === "-") { e.preventDefault(); changeSelected(function (n) { return C.transpose(n, -1); }); }
      else if (k === "Backspace" || k === "Delete") { e.preventDefault(); deleteNote(); }
      else if (k === "ArrowLeft" && !inRadio(e)) { e.preventDefault(); moveCursor(-1); }
      else if (k === "ArrowRight" && !inRadio(e)) { e.preventDefault(); moveCursor(1); }
      else if (k === "Home" && !inRadio(e)) { e.preventDefault(); moveCursor(-song.notes.length); }
      else if (k === "End" && !inRadio(e)) { e.preventDefault(); moveCursor(song.notes.length); }
      else if (k === " " && !(e.target && e.target.tagName === "BUTTON")) { e.preventDefault(); togglePlay(); }
    });
  }
  function inRadio(e) { return !!(e.target && e.target.closest && e.target.closest('[role="radiogroup"], input[type="range"]')); }

  function phone() { return window.matchMedia("(max-width: 760px)").matches; }
  function setPanel(open) {
    document.body.classList.toggle("panel-open", open);
    $("list-btn").setAttribute("aria-expanded", open ? "true" : "false");
    $("scrim").hidden = !(open && phone());
    if (!phone()) { prefs.panel = open; savePrefs(); }
    setTimeout(renderStaff, 0);
  }
  function togglePanel() {
    var open = !document.body.classList.contains("panel-open");
    setPanel(open);
    if (open && phone()) { var first = $("panel").querySelector("button"); if (first) first.focus(); }
  }
  function closePanelOnPhone() { if (phone() && document.body.classList.contains("panel-open")) setPanel(false); }

  function renderNames() {
    radioChips($("names"), ["letters", "solfege"], prefs.names, function (v) { return t("names." + v); }, function (v) {
      prefs.names = v; savePrefs(); renderNames(); renderScreen(); renderInput();
    });
  }

  // ---------- 11. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }

  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("ringtones", sliceGet, sliceSet, STORAGE_KEY, C.mergeRingtones);
  }

  function sliceGet() { flush(); return C.mergeRingtones(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.melodies)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeRingtones(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast on merge
    if (cur) {
      var fresh = C.findMelody(data, cur.id);
      if (!fresh) { cur = null; prefs.cur = ""; savePrefs(); }   // deleted elsewhere: the notes stay, unsaved
      else {
        cur = fresh;
        var mineNow = C.notesText(song.notes);
        if (fresh.notes !== mineNow || fresh.bpm !== song.bpm || fresh.voice !== song.voice ||
            (fresh.name !== song.name && document.activeElement !== $("name-in"))) {
          stop();
          song = { name: fresh.name, bpm: fresh.bpm, voice: fresh.voice, notes: C.parseNotes(fresh.notes) };
          cursor = Math.min(cursor, song.notes.length);
          renderAll();
        }
      }
    }
    renderHead(); renderMine();
  }

  // ---------- 12. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) {
      n.placeholder = t(n.getAttribute("data-i18n-ph"));
    });
    [].forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) {
      n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria")));
    });
    document.title = t("app.name") + " · orOS";
    $("list-btn").innerHTML = ICON.list; setLabel($("list-btn"), t("btn.list"));
    $("mode-btn").innerHTML = ICON.piano;
    $("undo-btn").innerHTML = ICON.undo; setLabel($("undo-btn"), t("btn.undo"));
    $("redo-btn").innerHTML = ICON.redo; setLabel($("redo-btn"), t("btn.redo"));
    $("left-btn").innerHTML = ICON.left; setLabel($("left-btn"), t("btn.left"));
    $("right-btn").innerHTML = ICON.right; setLabel($("right-btn"), t("btn.right"));
    $("close-panel").innerHTML = ICON.del; setLabel($("close-panel"), t("btn.closePanel"));
    $("new-btn").insertAdjacentHTML("afterbegin", ICON.plus);
  }

  function wire() {
    $("list-btn").addEventListener("click", togglePanel);
    $("close-panel").addEventListener("click", function () { setPanel(false); $("list-btn").focus(); });
    $("scrim").addEventListener("click", function () { setPanel(false); });
    $("mode-btn").addEventListener("click", toggleInput);
    $("play-btn").addEventListener("click", togglePlay);
    $("undo-btn").addEventListener("click", undo);
    $("redo-btn").addEventListener("click", redo);
    $("left-btn").addEventListener("click", function () { moveCursor(-1); });
    $("right-btn").addEventListener("click", function () { moveCursor(1); });
    $("del-btn").addEventListener("click", deleteNote);
    $("p-rest").addEventListener("click", function () { insertNote(C.mkNote(-1, prefs.oct, prefs.len)); });
    $("p-dot").addEventListener("click", function () { changeSelected(C.toggleDot); });
    // Typing a name or dragging the tempo is one undo step, not one per change.
    var lastField = "", lastAt = 0;
    function burst(field) {
      var now = Date.now(), merge = field === lastField && now - lastAt < 1500;
      lastField = field; lastAt = now;
      return { merge: merge };
    }
    $("name-in").addEventListener("input", function () {
      var v = $("name-in").value;
      edit(function () { song.name = v.slice(0, C.MAX_NAME); }, burst("name"));
    });
    $("bpm-in").addEventListener("input", function () {
      var v = parseInt($("bpm-in").value, 10);
      if (!isFinite(v)) return;
      $("bpm-lbl").textContent = t("bpm", { n: v });
      edit(function () { song.bpm = Math.max(C.MIN_BPM, Math.min(C.MAX_BPM, v)); }, burst("bpm"));
    });
    $("loop-in").addEventListener("change", function () { prefs.loop = $("loop-in").checked; savePrefs(); });
    $("vol-in").addEventListener("input", function () {
      prefs.vol = parseInt($("vol-in").value, 10) || 0; savePrefs();
      if (master) master.gain.value = Math.pow(prefs.vol / 100, 1.6) * 0.5;
    });
    $("vol-in").addEventListener("change", function () { playOne(C.mkNote(9, 5, 8)); });
    $("staff").addEventListener("click", function (e) {
      var g = e.target.closest && e.target.closest(".nt");
      if (g) selectAt(parseInt(g.getAttribute("data-i"), 10));
    });
    $("save-btn").addEventListener("click", saveMelody);
    $("new-btn").addEventListener("click", newMelody);
    $("wav-btn").addEventListener("click", downloadWav);
    $("rtttl-btn").addEventListener("click", downloadRtttl);
    $("copy-btn").addEventListener("click", copyRtttl);
    $("import-btn").addEventListener("click", openImport);
    $("import-form").addEventListener("submit", doImport);
    $("import-cancel").addEventListener("click", closeImport);
    $("import-file").addEventListener("click", importFile);
    $("import-folder").addEventListener("click", importFolder);
    $("tone-btn").addEventListener("click", saveTone);
    var rz = null;
    window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(renderStaff, 80); });
    window.addEventListener("pagehide", function () { flush(); stop(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    inheritPalette();
    song = { name: "", bpm: C.DEFAULT.bpm, voice: C.DEFAULT.voice, notes: [] };
    renderKeypad();
    wire();
    registerSync();
    watchPalette();
    $("loop-in").checked = prefs.loop;
    $("vol-in").value = String(prefs.vol);
    setPanel(!phone() && prefs.panel);
    renderInput();
    renderNext();
    renderNames();
    renderReady();
    var start = (prefs.cur && C.findMelody(data, prefs.cur)) || null;
    openMelody(start, true);
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("ringtones");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
  }

  boot();
})();
