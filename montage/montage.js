// ============================================================
// orOS Montage — App logic (v1.0.0): a video editor.
//   - Projects: list, new (ratio, frame rate), rename, duplicate,
//     delete with Undo
//   - Editor: preview on top, timeline with a fixed centre playhead
//     (scrolls under it, as on phones), tools at the bottom that
//     change with the selected clip
//   - Tracks: Text, Overlay, Main (magnetic), Music, Voice
//   - Clip tools: split, speed, volume, fades, transition, adjust +
//     filters, fit / rotate / mirror / opacity, position, text,
//     detach sound, move between main and overlay, duplicate, delete
//   - Export: MP4 (or WebM) frame by frame (export.js), then Save or a
//     copy in Files › Videos
// Data:
//   - synced slice "montage" (oros-montage): MontageCore.merge
//   - media: MontageMedia (device store; project "Sync media" copies
//     them to the orOS disk for Vault Drive)
//   - device-local (R10): oros-montage-prefs (zoom, export size, keep,
//     speech language)
// Deep link: __orosOpenAt("montage", { project } | { openFile: path | { token } })
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage, prefs, edits + undo
//   3. Projects view
//   4. Editor: player, transport, time
//   5. Timeline: draw, select, drag, trim, zoom
//   6. Tools bar + clip panels
//   7. Adding media, text, sound
//   8. Project settings, media, relink
//   9. Export
//  10. Keyboard (Contract Β)
//  11. Sync slice + palette + deep link
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.MontageCore, MM = window.MontageMedia, MX = window.MontageExport;
  var STORAGE_KEY = "oros-montage", PREFS_KEY = "oros-montage-prefs";
  var UNDO_MAX = 60;
  var ROWS = ["tt", "ov", "main", "a1", "a2"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var LOCALE = LANG === "el" ? "el-GR" : "en-GB";

  var STRINGS = {
    en: {
      "aria.tools": "Tools",
      "app.name": "Montage",
      "home.title": "Your projects", "home.emptyTitle": "No projects yet",
      "home.empty": "Start a project, add your videos, pictures and music, and export a video file.",
      "home.storage": "Media on this device: {u} (browser space: {q})",
      "btn.new": "New project", "btn.export": "Export", "btn.cancel": "Cancel", "btn.close": "Close",
      "btn.back": "Projects", "btn.undo": "Undo", "btn.redo": "Redo", "btn.project": "Project settings",
      "btn.play": "Play", "btn.pause": "Pause", "btn.prev": "Previous frame", "btn.next": "Next frame",
      "btn.zin": "Zoom in", "btn.zout": "Zoom out", "btn.more": "More", "btn.create": "Create",
      "btn.save": "Save", "btn.done": "Done", "btn.rename": "Rename", "btn.duplicate": "Duplicate", "btn.delete": "Delete",
      "btn.apply": "Apply", "btn.relink": "Find file", "btn.clean": "Free space", "btn.playVideo": "Play it",
      "proj.untitled": "My video", "proj.sub": "{r} · {d} · {when}", "proj.copy": "{n} (copy)",
      "new.title": "New project", "f.name": "Name", "f.ratio": "Shape", "f.fps": "Frames per second",
      "ratio.16:9": "Wide 16:9", "ratio.9:16": "Tall 9:16", "ratio.1:1": "Square 1:1", "ratio.4:5": "Portrait 4:5",
      "ed.empty": "Add your first video or picture",
      "tr.tt": "Text", "tr.ov": "Overlay", "tr.main": "Main", "tr.a1": "Music", "tr.a2": "Voice",
      "tool.media": "Media", "tool.overlay": "Overlay", "tool.audio": "Sound", "tool.text": "Text", "tool.voice": "Voice", "tool.project": "Project",
      "tool.split": "Split", "tool.grab": "Grab frame", "tool.speed": "Speed", "tool.volume": "Volume", "tool.fade": "Fade",
      "tool.transition": "Transition", "tool.adjust": "Adjust", "tool.frame": "Frame", "tool.position": "Position",
      "tool.edit": "Edit text", "tool.bg": "Background", "tool.detach": "Extract sound", "tool.mute": "Mute", "tool.unmute": "Sound on",
      "tool.toOv": "To overlay", "tool.toMain": "To main", "tool.dup": "Duplicate", "tool.del": "Delete", "tool.done": "Done",
      "p.speed": "Speed", "p.speedHint": "Speed also changes the pitch of the sound.",
      "p.volume": "Volume", "p.fadeIn": "Fade in", "p.fadeOut": "Fade out",
      "p.tx": "Transition into this clip", "p.txLen": "Length",
      "tx.none": "None", "tx.fade": "Dissolve", "tx.black": "Through black", "tx.slide": "Slide", "tx.wipe": "Wipe",
      "p.bright": "Brightness", "p.contrast": "Contrast", "p.sat": "Saturation", "p.temp": "Warmth", "p.filter": "Filter",
      "flt.none": "None", "flt.mono": "Mono", "flt.sepia": "Sepia", "flt.warm": "Warm", "flt.cool": "Cool",
      "flt.vivid": "Vivid", "flt.fade": "Faded", "flt.noir": "Noir", "flt.film": "Film",
      "p.fit": "Fit", "fit.fit": "Whole picture", "fit.fill": "Fill the frame", "p.rotate": "Rotate", "p.mirror": "Mirror",
      "p.opacity": "Opacity", "p.x": "Left – right", "p.y": "Top – bottom", "p.size": "Size", "p.duration": "Duration",
      "p.text": "Text", "p.font": "Font", "p.textSize": "Text size", "p.color": "Colour", "p.outline": "Outline",
      "p.box": "Box behind the text", "p.align": "Alignment", "p.anim": "Entrance",
      "al.l": "Left", "al.c": "Centre", "al.r": "Right",
      "an.none": "None", "an.fade": "Fade", "an.rise": "Rise", "an.pop": "Pop",
      "font.sans": "Sans", "font.serif": "Serif", "font.mono": "Mono", "font.display": "Bold",
      "p.bgColor": "Background colour", "col.none": "None",
      "text.default": "Your text",
      "set.title": "Project settings", "set.bg": "Colour behind the picture", "set.sync": "Sync this project's media",
      "set.syncHint": "Off: your videos stay on this device and only the edit travels with orOS sync. On: they are copied to Files › Assets and Vault Drive syncs them (encrypted). Big videos take long to upload.",
      "set.media": "Media in this project", "set.missing": "Missing on this device", "set.ok": "On this device",
      "set.cleanHint": "Free space removes media that no project on this device uses.",
      "exp.title": "Export video", "exp.size": "Size", "exp.keep": "Also keep a copy in Files › Videos",
      "exp.go": "Export", "exp.working": "Exporting… {p}%", "exp.ready": "Your video is ready",
      "exp.readyHint": "{f} · {s}. Save it to your device, or play it here first.",
      "exp.k4": "4K", "exp.noCodec": "This browser cannot make a video file of this size.",
      "exp.empty": "Add a clip first: there is nothing to export.",
      "imp.working": "Adding {n}…", "imp.hashing": "Reading {n}… {p}%",
      "toast.saveFail": "Could not save: browser storage is full.", "toast.deleted": "Project deleted",
      "toast.clipDeleted": "Clip deleted", "toast.saved": "Saved", "toast.kept": "A copy is in Files › Videos",
      "toast.splitEdge": "Move the playhead inside the clip, away from its edges, to split it.",
      "toast.noSound": "This clip has no sound.", "toast.cleaned": "{n} unused files removed",
      "toast.relinked": "Media found", "toast.grabbed": "The frame is in Files › Pictures", "toast.notFound": "That project no longer exists.",
      "toast.synced": "Media of this project are being copied to Files › Assets",
      "toast.cancelled": "Export cancelled", "toast.fail": "Export failed: {e}",
      "err.type": "This file is not a video, picture or sound Montage can use.",
      "err.decode": "This browser cannot play this file.", "err.big": "This file is too big (4 GB at most).",
      "err.full": "Browser storage is full. Free some space and try again.", "err.fail": "The file could not be added.",
      "err.noweb": "This browser cannot edit video here (WebGL2 is missing).",
      "kind.video": "Video", "kind.image": "Picture", "kind.audio": "Sound", "kind.title": "Text",
      "a11y.timeline": "Timeline. Scroll to move the playhead; tap a clip to select it.",
      "rec.title": "Record your voice", "rec.start": "Record", "rec.stop": "Stop", "rec.level": "Microphone level",
      "rec.hint": "Recording starts at the playhead after a short count and the video plays along. Use headphones so its sound does not get into the recording.",
      "rec.none": "This browser cannot record sound here.", "rec.denied": "Montage may not use the microphone. Allow it in the browser's site settings and try again.",
      "rec.name": "Voice {n}",
      "tx.push": "Push up", "tx.zoom": "Zoom", "tx.circle": "Circle",
      "flt.vintage": "Vintage", "flt.chrome": "Chrome", "flt.dusk": "Dusk", "flt.golden": "Golden",
      "tool.subs": "Subtitles", "tool.freeze": "Freeze frame",
      "sub.title": "Subtitles", "sub.count": "{n} text clips on the Text row. Each one becomes a subtitle line when you save an SRT file.",
      "sub.add": "Add a subtitle", "sub.import": "Open an SRT file", "sub.export": "Save as SRT",
      "sub.hint": "SRT files (and WebVTT) from YouTube, subtitle sites or other editors come in as text clips you can edit.",
      "sub.none": "No subtitles found in this file.", "sub.added": "{n} subtitles added", "sub.big": "This subtitle file is too big.",
      "sub.empty": "There are no text clips to save yet.",
      "asr.head": "Subtitles from speech",
      "asr.hint": "Montage listens to the project's sound and writes what is said as subtitles, on this device: the sound is not sent anywhere. Check the lines afterwards; names and quiet speech can come out wrong.",
      "asr.need": "The first time, Montage downloads the speech model (Whisper, about {mb} MB, from Hugging Face) and the speech runtime (about {rt} MB, from this site) and keeps them on this device. After that it works offline.",
      "asr.ready": "The speech model is on this device.", "asr.lang": "Language",
      "asr.auto": "Find it", "asr.go": "Make subtitles", "asr.forget": "Remove the speech model",
      "asr.gone": "The speech model was removed from this device.",
      "asr.mixing": "Reading the sound… {p}%", "asr.download": "Downloading the speech model… {p}%",
      "asr.working": "Writing subtitles… {p}%", "asr.none": "No speech was found in the sound.",
      "asr.fail": "Could not make subtitles.", "asr.net": "Could not download the speech model. Check the connection and try again.",
      "asr.long": "Only the first {m} minutes are listened to.",
      "frz.working": "Freezing the frame…", "frz.fail": "Could not read this frame.",
      "set.duck": "Lower the music when someone speaks",
      "set.duckHint": "While anything plays on the Voice row, the Music row gets quieter, then comes back.",
      "duck.0": "Off", "duck.40": "A little", "duck.60": "Medium", "duck.80": "A lot",
      "exp.what": "Export", "exp.video": "Video", "exp.sound": "Sound only",
      "exp.keepSound": "Also keep a copy in Files › Music", "exp.readySound": "Your sound file is ready",
      "exp.noSound": "Nothing in this project makes sound.", "toast.keptSound": "A copy is in Files › Music",
      "tool.kf": "Keyframes",
      "kf.at": "{t} into this clip", "kf.here": "Key here", "kf.none": "No key here",
      "kf.prev": "Previous key", "kf.next": "Next key", "kf.back": "−½ s", "kf.fwd": "+½ s",
      "kf.add": "Add key", "kf.del": "Remove key", "kf.clear": "Remove all keys",
      "kf.hint": "Move the playhead and change a value: a key is set there. Montage glides from one key to the next.",
      "kf.x": "Left – right", "kf.y": "Top – bottom", "kf.s": "Size", "kf.o": "Opacity", "kf.v": "Volume",
      "kf.full": "{n} keys: the most a clip can have.",
      "tool.reverse": "Reverse", "tool.forward": "Forwards", "toast.reversed": "This clip now plays backwards, without sound.",
      "lut.title": "Colour look (.cube)", "lut.open": "Open a .cube file", "lut.remove": "Remove the look",
      "lut.hint": "A 3D LUT from a colour-grading app or a LUT pack (.cube, up to 64 points a side).",
      "lut.on": "A colour look is on.", "lut.bad": "This is not a 3D .cube file Montage can use.",
      "exp.gif": "GIF", "exp.gifSize": "Size", "exp.gifSmall": "Small (320 px)", "exp.gifMedium": "Medium (480 px)",
      "exp.gifHint": "A silent loop for chats and web pages, up to 30 seconds. Big GIF files are normal: keep it short.",
      "exp.gifLong": "A GIF can be at most 30 seconds long. Make the project shorter or export a video.",
      "exp.keepGif": "Also keep a copy in Files › Pictures", "exp.readyGif": "Your GIF is ready", "toast.keptGif": "A copy is in Files › Pictures",
      "px.title": "Smoother preview", "px.make": "Make light copies", "px.drop": "Remove light copies",
      "px.hint": "For big videos (4K, long phone videos) that stutter while you edit: Montage makes small copies on this device just for the preview. The export always uses the originals.",
      "px.working": "Making light copy {i} of {n}… {p}%", "px.done": "{n} light copies ready", "px.none": "These videos are light enough already.",
      "px.dropped": "{n} light copies removed", "px.stopped": "Stopped. Light copies made so far are kept.", "px.has": "light copy",
      "tool.shapes": "Stickers", "tool.style": "Style", "kind.shape": "Shape",
      "shp.title": "Stickers and shapes", "shp.shapes": "Shapes", "shp.stickers": "Stickers",
      "shp.hint": "They go on the Overlay row (shapes) or the Text row (stickers) at the playhead. Move them with Position, animate them with Keyframes.",
      "shape.rect": "Rectangle", "shape.round": "Rounded", "shape.ellipse": "Circle", "shape.triangle": "Triangle",
      "shape.star": "Star", "shape.heart": "Heart", "shape.arrow": "Arrow", "shape.bubble": "Speech bubble",
      "shp.kind": "Shape", "shp.fill": "Fill", "shp.outline": "Outline", "shp.width": "Outline width",
      "p.curve": "Speed curve", "p.curveShort": "curve", "ramp.none": "None", "ramp.hero": "Hero", "ramp.bullet": "Bullet",
      "ramp.montage": "Montage", "ramp.jump": "Jump cut", "ramp.flashin": "Flash in", "ramp.flashout": "Flash out", "ramp.custom": "Your own",
      "ramp.here": "Speed at the playhead", "ramp.len": "The clip now lasts {d}.",
      "ramp.hint": "Move the playhead along the clip and change the speed there: a point is set at that moment of the video. Between points the speed changes smoothly, in the preview and in the export.",
      "ramp.graph": "Speed along the clip, from 0.1× at the bottom to 10× at the top",
      "tool.chroma": "Chroma key", "ck.title": "Chroma key", "ck.on": "Remove a colour (green or blue screen)",
      "ck.color": "Colour to remove", "ck.green": "Green", "ck.blue": "Blue", "ck.pick": "Pick from the picture",
      "ck.pickHint": "Tap the colour to remove in the picture. Esc cancels.", "ck.tol": "Tolerance", "ck.soft": "Soft edge", "ck.spill": "Remove colour spill",
      "ck.hint": "Put the clip on the Overlay row over another video or picture, or on Main over the colour behind the picture (Project settings).",
      "p.border": "Border", "p.borderCol": "Border colour", "p.corners": "Rounded corners",
      "tool.reframe": "Reframe", "rf.title": "Reframe",
      "rf.hint": "When the picture is cropped to the project's shape, this point stays in the middle. Auto reframe follows faces (where this browser can find them) or what moves, and sets keys you can still change here.",
      "rf.auto": "Auto reframe", "rf.clear": "Remove reframing", "rf.x": "Focus left – right", "rf.y": "Focus top – bottom",
      "rf.keys": "{n} keys", "rf.none": "Centred (no keys yet)", "rf.working": "Finding the subject… {p}%",
      "rf.done": "Reframed: {n} keys", "rf.allDone": "{n} clips reframed", "rf.fail": "Could not read this clip.",
      "rf.faces": "Faces found by the browser are followed.", "rf.motion": "This browser cannot find faces here: Montage follows what moves, near the middle.",
      "set.reframe": "Reframe all clips", "set.reframeHint": "Auto reframe every video and picture on the Main row, so the subject stays in view in this shape.",
      "tool.denoise": "Reduce noise", "nr.title": "Reduce noise",
      "nr.hint": "Takes steady background noise (fans, traffic, hum, wind) out of this clip's sound, on this device. Montage makes a cleaned copy of the sound and keeps it like your other media; the original stays as it is.",
      "nr.go": "Reduce noise", "nr.on": "Noise is reduced on this clip.", "nr.off": "Back to the original sound",
      "nr.working": "Cleaning the sound… {p}%", "nr.done": "Noise reduced", "nr.fail": "Could not clean this sound.",
      "rel.today": "today", "rel.yesterday": "yesterday"
    },
    el: {
      "aria.tools": "Εργαλεία",
      "app.name": "Μοντάζ",
      "home.title": "Τα έργα σου", "home.emptyTitle": "Κανένα έργο ακόμα",
      "home.empty": "Ξεκίνα ένα έργο, πρόσθεσε βίντεο, φωτογραφίες και μουσική και βγάλε ένα αρχείο βίντεο.",
      "home.storage": "Πολυμέσα σε αυτή τη συσκευή: {u} (χώρος του browser: {q})",
      "btn.new": "Νέο έργο", "btn.export": "Εξαγωγή", "btn.cancel": "Ακύρωση", "btn.close": "Κλείσιμο",
      "btn.back": "Έργο", "btn.undo": "Αναίρεση", "btn.redo": "Ξανά", "btn.project": "Ρυθμίσεις έργου",
      "btn.play": "Αναπαραγωγή", "btn.pause": "Παύση", "btn.prev": "Προηγούμενο καρέ", "btn.next": "Επόμενο καρέ",
      "btn.zin": "Μεγέθυνση", "btn.zout": "Σμίκρυνση", "btn.more": "Περισσότερα", "btn.create": "Δημιουργία",
      "btn.save": "Αποθήκευση", "btn.done": "Τέλος", "btn.rename": "Μετονομασία", "btn.duplicate": "Αντίγραφο", "btn.delete": "Διαγραφή",
      "btn.apply": "Εφαρμογή", "btn.relink": "Βρες το αρχείο", "btn.clean": "Ελευθέρωσε χώρο", "btn.playVideo": "Δες το",
      "proj.untitled": "Το βίντεό μου", "proj.sub": "{r} · {d} · {when}", "proj.copy": "{n} (αντίγραφο)",
      "new.title": "Νέο έργο", "f.name": "Όνομα", "f.ratio": "Σχήμα", "f.fps": "Καρέ ανά δευτερόλεπτο",
      "ratio.16:9": "Φαρδύ 16:9", "ratio.9:16": "Ψηλό 9:16", "ratio.1:1": "Τετράγωνο 1:1", "ratio.4:5": "Πορτρέτο 4:5",
      "ed.empty": "Πρόσθεσε το πρώτο σου βίντεο ή φωτογραφία",
      "tr.tt": "Κείμενο", "tr.ov": "Επικάλυψη", "tr.main": "Κύριο", "tr.a1": "Μουσική", "tr.a2": "Φωνή",
      "tool.media": "Πολυμέσα", "tool.overlay": "Επικάλυψη", "tool.audio": "Ήχος", "tool.text": "Κείμενο", "tool.voice": "Φωνή", "tool.project": "Έργο",
      "tool.split": "Κόψιμο", "tool.grab": "Κράτα καρέ", "tool.speed": "Ταχύτητα", "tool.volume": "Ένταση", "tool.fade": "Σβήσιμο",
      "tool.transition": "Μετάβαση", "tool.adjust": "Ρυθμίσεις", "tool.frame": "Κάδρο", "tool.position": "Θέση",
      "tool.edit": "Κείμενο", "tool.bg": "Φόντο", "tool.detach": "Ξεχώρισε ήχο", "tool.mute": "Σίγαση", "tool.unmute": "Με ήχο",
      "tool.toOv": "Σε επικάλυψη", "tool.toMain": "Στο κύριο", "tool.dup": "Αντίγραφο", "tool.del": "Διαγραφή", "tool.done": "Τέλος",
      "p.speed": "Ταχύτητα", "p.speedHint": "Η ταχύτητα αλλάζει και τον τόνο του ήχου.",
      "p.volume": "Ένταση", "p.fadeIn": "Σταδιακή είσοδος", "p.fadeOut": "Σταδιακό σβήσιμο",
      "p.tx": "Μετάβαση προς αυτό το clip", "p.txLen": "Διάρκεια",
      "tx.none": "Καμία", "tx.fade": "Διάλυση", "tx.black": "Μέσα από μαύρο", "tx.slide": "Σύρσιμο", "tx.wipe": "Σκούπισμα",
      "p.bright": "Φωτεινότητα", "p.contrast": "Αντίθεση", "p.sat": "Κορεσμός", "p.temp": "Θερμότητα", "p.filter": "Φίλτρο",
      "flt.none": "Κανένα", "flt.mono": "Ασπρόμαυρο", "flt.sepia": "Σέπια", "flt.warm": "Ζεστό", "flt.cool": "Ψυχρό",
      "flt.vivid": "Ζωντανό", "flt.fade": "Ξεθωριασμένο", "flt.noir": "Νουάρ", "flt.film": "Φιλμ",
      "p.fit": "Προσαρμογή", "fit.fit": "Όλη η εικόνα", "fit.fill": "Γέμισε το κάδρο", "p.rotate": "Περιστροφή", "p.mirror": "Καθρέφτης",
      "p.opacity": "Αδιαφάνεια", "p.x": "Αριστερά – δεξιά", "p.y": "Πάνω – κάτω", "p.size": "Μέγεθος", "p.duration": "Διάρκεια",
      "p.text": "Κείμενο", "p.font": "Γραμματοσειρά", "p.textSize": "Μέγεθος γραμμάτων", "p.color": "Χρώμα", "p.outline": "Περίγραμμα",
      "p.box": "Πλαίσιο πίσω από το κείμενο", "p.align": "Στοίχιση", "p.anim": "Εμφάνιση",
      "al.l": "Αριστερά", "al.c": "Κέντρο", "al.r": "Δεξιά",
      "an.none": "Καμία", "an.fade": "Σβήσιμο", "an.rise": "Ανέβασμα", "an.pop": "Σκάσιμο",
      "font.sans": "Απλή", "font.serif": "Πατούρες", "font.mono": "Σταθερή", "font.display": "Έντονη",
      "p.bgColor": "Χρώμα φόντου", "col.none": "Κανένα",
      "text.default": "Το κείμενό σου",
      "set.title": "Ρυθμίσεις έργου", "set.bg": "Χρώμα πίσω από την εικόνα", "set.sync": "Συγχρονισμός πολυμέσων του έργου",
      "set.syncHint": "Κλειστό: τα βίντεό σου μένουν σε αυτή τη συσκευή και ταξιδεύει μόνο το μοντάζ με τον συγχρονισμό του orOS. Ανοιχτό: αντιγράφονται στα Αρχεία › Assets και τα συγχρονίζει το Vault Drive (κρυπτογραφημένα). Τα μεγάλα βίντεο ανεβαίνουν αργά.",
      "set.media": "Πολυμέσα του έργου", "set.missing": "Λείπει σε αυτή τη συσκευή", "set.ok": "Σε αυτή τη συσκευή",
      "set.cleanHint": "Το «Ελευθέρωσε χώρο» σβήνει πολυμέσα που δεν χρησιμοποιεί κανένα έργο σε αυτή τη συσκευή.",
      "exp.title": "Εξαγωγή βίντεο", "exp.size": "Μέγεθος", "exp.keep": "Κράτα και αντίγραφο στα Αρχεία › Videos",
      "exp.go": "Εξαγωγή", "exp.working": "Εξαγωγή… {p}%", "exp.ready": "Το βίντεό σου είναι έτοιμο",
      "exp.readyHint": "{f} · {s}. Αποθήκευσέ το στη συσκευή σου ή δες το πρώτα εδώ.",
      "exp.k4": "4K", "exp.noCodec": "Αυτός ο browser δεν μπορεί να φτιάξει βίντεο σε αυτό το μέγεθος.",
      "exp.empty": "Πρόσθεσε πρώτα ένα clip: δεν υπάρχει κάτι για εξαγωγή.",
      "imp.working": "Προσθήκη: {n}…", "imp.hashing": "Διάβασμα: {n}… {p}%",
      "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος του browser γέμισε.", "toast.deleted": "Το έργο διαγράφηκε",
      "toast.clipDeleted": "Το clip διαγράφηκε", "toast.saved": "Αποθηκεύτηκε", "toast.kept": "Υπάρχει αντίγραφο στα Αρχεία › Videos",
      "toast.splitEdge": "Βάλε την κεφαλή μέσα στο clip, μακριά από τις άκρες του, για να το κόψεις.",
      "toast.noSound": "Αυτό το clip δεν έχει ήχο.", "toast.cleaned": "Σβήστηκαν {n} αχρησιμοποίητα αρχεία",
      "toast.relinked": "Το αρχείο βρέθηκε", "toast.grabbed": "Το καρέ είναι στα Αρχεία › Pictures", "toast.notFound": "Αυτό το έργο δεν υπάρχει πια.",
      "toast.synced": "Τα πολυμέσα του έργου αντιγράφονται στα Αρχεία › Assets",
      "toast.cancelled": "Η εξαγωγή ακυρώθηκε", "toast.fail": "Η εξαγωγή απέτυχε: {e}",
      "err.type": "Αυτό το αρχείο δεν είναι βίντεο, φωτογραφία ή ήχος που μπορεί να χρησιμοποιήσει το Μοντάζ.",
      "err.decode": "Αυτός ο browser δεν μπορεί να παίξει αυτό το αρχείο.", "err.big": "Το αρχείο είναι πολύ μεγάλο (έως 4 GB).",
      "err.full": "Ο χώρος του browser γέμισε. Ελευθέρωσε λίγο χώρο και ξαναδοκίμασε.", "err.fail": "Το αρχείο δεν μπόρεσε να προστεθεί.",
      "err.noweb": "Αυτός ο browser δεν μπορεί να επεξεργαστεί βίντεο εδώ (λείπει το WebGL2).",
      "kind.video": "Βίντεο", "kind.image": "Φωτογραφία", "kind.audio": "Ήχος", "kind.title": "Κείμενο",
      "a11y.timeline": "Χρονολόγιο. Κύλισε για να μετακινήσεις την κεφαλή· πάτα ένα clip για να το επιλέξεις.",
      "rec.title": "Ηχογράφηση φωνής", "rec.start": "Ηχογράφηση", "rec.stop": "Διακοπή", "rec.level": "Ένταση μικροφώνου",
      "rec.hint": "Η ηχογράφηση ξεκινά από την κεφαλή μετά από μια σύντομη αντίστροφη μέτρηση, και το βίντεο παίζει μαζί. Βάλε ακουστικά για να μη γραφτεί και ο ήχος του.",
      "rec.none": "Αυτός ο browser δεν μπορεί να ηχογραφήσει εδώ.", "rec.denied": "Το Μοντάζ δεν έχει άδεια για το μικρόφωνο. Δώσε άδεια στις ρυθμίσεις του site στον browser και ξαναδοκίμασε.",
      "rec.name": "Φωνή {n}",
      "tx.push": "Σπρώξιμο πάνω", "tx.zoom": "Ζουμ", "tx.circle": "Κύκλος",
      "flt.vintage": "Παλιό", "flt.chrome": "Χρώμιο", "flt.dusk": "Σούρουπο", "flt.golden": "Χρυσό",
      "tool.subs": "Υπότιτλοι", "tool.freeze": "Πάγωμα καρέ",
      "sub.title": "Υπότιτλοι", "sub.count": "{n} κείμενα στη γραμμή Κείμενο. Το καθένα γίνεται μια γραμμή υποτίτλων όταν αποθηκεύεις αρχείο SRT.",
      "sub.add": "Πρόσθεσε υπότιτλο", "sub.import": "Άνοιξε αρχείο SRT", "sub.export": "Αποθήκευση ως SRT",
      "sub.hint": "Αρχεία SRT (και WebVTT) από το YouTube, σελίδες υποτίτλων ή άλλα προγράμματα μπαίνουν ως κείμενα που μπορείς να αλλάξεις.",
      "sub.none": "Δεν βρέθηκαν υπότιτλοι σε αυτό το αρχείο.", "sub.added": "Προστέθηκαν {n} υπότιτλοι", "sub.big": "Αυτό το αρχείο υποτίτλων είναι πολύ μεγάλο.",
      "sub.empty": "Δεν υπάρχουν ακόμα κείμενα για αποθήκευση.",
      "asr.head": "Υπότιτλοι από την ομιλία",
      "asr.hint": "Το Μοντάζ ακούει τον ήχο του έργου και γράφει όσα λέγονται ως υπότιτλους, σε αυτή τη συσκευή: ο ήχος δεν στέλνεται πουθενά. Έλεγξε τις γραμμές μετά· ονόματα και σιγανή ομιλία μπορεί να βγουν λάθος.",
      "asr.need": "Την πρώτη φορά το Μοντάζ κατεβάζει το μοντέλο ομιλίας (Whisper, περίπου {mb} MB, από το Hugging Face) και το πρόγραμμα που το τρέχει (περίπου {rt} MB, από αυτόν τον ιστότοπο) και τα κρατά σε αυτή τη συσκευή. Μετά δουλεύει και χωρίς σύνδεση.",
      "asr.ready": "Το μοντέλο ομιλίας είναι σε αυτή τη συσκευή.", "asr.lang": "Γλώσσα",
      "asr.auto": "Αυτόματα", "asr.go": "Φτιάξε υπότιτλους", "asr.forget": "Αφαίρεση του μοντέλου ομιλίας",
      "asr.gone": "Το μοντέλο ομιλίας αφαιρέθηκε από αυτή τη συσκευή.",
      "asr.mixing": "Διαβάζω τον ήχο… {p}%", "asr.download": "Κατεβάζω το μοντέλο ομιλίας… {p}%",
      "asr.working": "Γράφω υπότιτλους… {p}%", "asr.none": "Δεν βρέθηκε ομιλία στον ήχο.",
      "asr.fail": "Δεν έγιναν υπότιτλοι.", "asr.net": "Δεν κατέβηκε το μοντέλο ομιλίας. Έλεγξε τη σύνδεση και δοκίμασε ξανά.",
      "asr.long": "Ακούγονται μόνο τα πρώτα {m} λεπτά.",
      "frz.working": "Παγώνω το καρέ…", "frz.fail": "Δεν διαβάστηκε αυτό το καρέ.",
      "set.duck": "Χαμήλωνε τη μουσική όταν μιλάει κάποιος",
      "set.duckHint": "Όσο παίζει κάτι στη γραμμή Φωνή, η γραμμή Μουσική χαμηλώνει και μετά ξαναδυναμώνει.",
      "duck.0": "Όχι", "duck.40": "Λίγο", "duck.60": "Μέτρια", "duck.80": "Πολύ",
      "exp.what": "Εξαγωγή", "exp.video": "Βίντεο", "exp.sound": "Μόνο ήχος",
      "exp.keepSound": "Κράτα και αντίγραφο στα Αρχεία › Music", "exp.readySound": "Το αρχείο ήχου είναι έτοιμο",
      "exp.noSound": "Τίποτα σε αυτό το έργο δεν έχει ήχο.", "toast.keptSound": "Ένα αντίγραφο είναι στα Αρχεία › Music",
      "tool.kf": "Καρέ-κλειδιά",
      "kf.at": "{t} μέσα στο clip", "kf.here": "Υπάρχει key εδώ", "kf.none": "Κανένα key εδώ",
      "kf.prev": "Προηγούμενο key", "kf.next": "Επόμενο key", "kf.back": "−½ δ", "kf.fwd": "+½ δ",
      "kf.add": "Πρόσθεσε key", "kf.del": "Αφαίρεσε key", "kf.clear": "Αφαίρεσε όλα τα key",
      "kf.hint": "Μετακίνησε την κεφαλή και άλλαξε μια τιμή: μπαίνει key εκεί. Το Μοντάζ περνά ομαλά από το ένα key στο επόμενο.",
      "kf.x": "Αριστερά – δεξιά", "kf.y": "Πάνω – κάτω", "kf.s": "Μέγεθος", "kf.o": "Αδιαφάνεια", "kf.v": "Ένταση",
      "kf.full": "{n} key: τα περισσότερα που χωράει ένα clip.",
      "tool.reverse": "Ανάποδα", "tool.forward": "Κανονικά", "toast.reversed": "Αυτό το clip παίζει πια ανάποδα, χωρίς ήχο.",
      "lut.title": "Χρωματικό look (.cube)", "lut.open": "Άνοιξε αρχείο .cube", "lut.remove": "Βγάλε το look",
      "lut.hint": "Ένα 3D LUT από πρόγραμμα χρωματικής διόρθωσης ή πακέτο LUT (.cube, έως 64 σημεία ανά πλευρά).",
      "lut.on": "Υπάρχει χρωματικό look.", "lut.bad": "Αυτό δεν είναι αρχείο 3D .cube που μπορεί να χρησιμοποιήσει το Μοντάζ.",
      "exp.gif": "GIF", "exp.gifSize": "Μέγεθος", "exp.gifSmall": "Μικρό (320 px)", "exp.gifMedium": "Μεσαίο (480 px)",
      "exp.gifHint": "Ένα βουβό loop για συνομιλίες και ιστοσελίδες, έως 30 δευτερόλεπτα. Τα GIF βγαίνουν μεγάλα αρχεία: κράτα το σύντομο.",
      "exp.gifLong": "Ένα GIF μπορεί να είναι έως 30 δευτερόλεπτα. Κάνε το έργο πιο σύντομο ή βγάλε βίντεο.",
      "exp.keepGif": "Κράτα και αντίγραφο στα Αρχεία › Pictures", "exp.readyGif": "Το GIF σου είναι έτοιμο", "toast.keptGif": "Ένα αντίγραφο είναι στα Αρχεία › Pictures",
      "px.title": "Πιο ομαλή προεπισκόπηση", "px.make": "Φτιάξε ελαφριά αντίγραφα", "px.drop": "Σβήσε τα ελαφριά αντίγραφα",
      "px.hint": "Για μεγάλα βίντεο (4K, μεγάλα βίντεο κινητού) που κολλάνε την ώρα που τα επεξεργάζεσαι: το Μοντάζ φτιάχνει μικρά αντίγραφα σε αυτή τη συσκευή μόνο για την προεπισκόπηση. Η εξαγωγή χρησιμοποιεί πάντα τα πρωτότυπα.",
      "px.working": "Φτιάχνω ελαφρύ αντίγραφο {i} από {n}… {p}%", "px.done": "Έτοιμα {n} ελαφριά αντίγραφα", "px.none": "Αυτά τα βίντεο είναι ήδη αρκετά ελαφριά.",
      "px.dropped": "Σβήστηκαν {n} ελαφριά αντίγραφα", "px.stopped": "Σταμάτησε. Όσα ελαφριά αντίγραφα έγιναν μένουν.", "px.has": "ελαφρύ αντίγραφο",
      "tool.shapes": "Αυτοκόλλητα", "tool.style": "Στυλ", "kind.shape": "Σχήμα",
      "shp.title": "Αυτοκόλλητα και σχήματα", "shp.shapes": "Σχήματα", "shp.stickers": "Αυτοκόλλητα",
      "shp.hint": "Μπαίνουν στη γραμμή Επικάλυψη (σχήματα) ή στη γραμμή Κείμενο (αυτοκόλλητα) στην κεφαλή. Μετακίνησέ τα με τη Θέση, κίνησέ τα με τα Καρέ-κλειδιά.",
      "shape.rect": "Ορθογώνιο", "shape.round": "Στρογγυλεμένο", "shape.ellipse": "Κύκλος", "shape.triangle": "Τρίγωνο",
      "shape.star": "Αστέρι", "shape.heart": "Καρδιά", "shape.arrow": "Βέλος", "shape.bubble": "Συννεφάκι διαλόγου",
      "shp.kind": "Σχήμα", "shp.fill": "Γέμισμα", "shp.outline": "Περίγραμμα", "shp.width": "Πάχος περιγράμματος",
      "p.curve": "Καμπύλη ταχύτητας", "p.curveShort": "καμπύλη", "ramp.none": "Καμία", "ramp.hero": "Ήρωας", "ramp.bullet": "Σφαίρα",
      "ramp.montage": "Μοντάζ", "ramp.jump": "Άλμα", "ramp.flashin": "Γρήγορη είσοδος", "ramp.flashout": "Γρήγορη έξοδος", "ramp.custom": "Δική σου",
      "ramp.here": "Ταχύτητα στην κεφαλή", "ramp.len": "Το clip κρατά τώρα {d}.",
      "ramp.hint": "Μετακίνησε την κεφαλή μέσα στο clip και άλλαξε εκεί την ταχύτητα: μπαίνει ένα σημείο σε εκείνη τη στιγμή του βίντεο. Ανάμεσα στα σημεία η ταχύτητα αλλάζει ομαλά, στην προεπισκόπηση και στην εξαγωγή.",
      "ramp.graph": "Η ταχύτητα κατά μήκος του clip, από 0,1× κάτω έως 10× πάνω",
      "tool.chroma": "Κλειδί χρώματος", "ck.title": "Κλειδί χρώματος", "ck.on": "Αφαίρεση ενός χρώματος (πράσινο ή μπλε φόντο)",
      "ck.color": "Χρώμα που φεύγει", "ck.green": "Πράσινο", "ck.blue": "Μπλε", "ck.pick": "Διάλεξε από την εικόνα",
      "ck.pickHint": "Πάτα στην εικόνα το χρώμα που θα φύγει. Το Esc ακυρώνει.", "ck.tol": "Ανοχή", "ck.soft": "Απαλή άκρη", "ck.spill": "Αφαίρεση ανταύγειας",
      "ck.hint": "Βάλε το clip στη γραμμή Επικάλυψη πάνω από άλλο βίντεο ή φωτογραφία, ή στο Κύριο πάνω από το χρώμα πίσω από την εικόνα (Ρυθμίσεις έργου).",
      "p.border": "Περίγραμμα", "p.borderCol": "Χρώμα περιγράμματος", "p.corners": "Στρογγυλεμένες γωνίες",
      "tool.reframe": "Καδράρισμα", "rf.title": "Καδράρισμα",
      "rf.hint": "Όταν η εικόνα κόβεται για να χωρέσει στο σχήμα του έργου, αυτό το σημείο μένει στη μέση. Το αυτόματο καδράρισμα ακολουθεί πρόσωπα (όπου ο browser μπορεί να τα βρει) ή ό,τι κινείται και βάζει key που μπορείς ακόμα να αλλάξεις εδώ.",
      "rf.auto": "Αυτόματο καδράρισμα", "rf.clear": "Αφαίρεση καδραρίσματος", "rf.x": "Εστίαση αριστερά – δεξιά", "rf.y": "Εστίαση πάνω – κάτω",
      "rf.keys": "{n} key", "rf.none": "Στο κέντρο (κανένα key ακόμα)", "rf.working": "Βρίσκω το θέμα… {p}%",
      "rf.done": "Καδραρίστηκε: {n} key", "rf.allDone": "Καδραρίστηκαν {n} clip", "rf.fail": "Δεν διαβάστηκε αυτό το clip.",
      "rf.faces": "Ακολουθούνται τα πρόσωπα που βρίσκει ο browser.", "rf.motion": "Αυτός ο browser δεν βρίσκει πρόσωπα εδώ: το Μοντάζ ακολουθεί ό,τι κινείται, κοντά στη μέση.",
      "set.reframe": "Καδράρισε όλα τα clip", "set.reframeHint": "Αυτόματο καδράρισμα για κάθε βίντεο και φωτογραφία στη γραμμή Κύριο, ώστε το θέμα να φαίνεται σε αυτό το σχήμα.",
      "tool.denoise": "Μείωση θορύβου", "nr.title": "Μείωση θορύβου",
      "nr.hint": "Βγάζει τον σταθερό θόρυβο του φόντου (ανεμιστήρες, κίνηση, βουητό, αέρα) από τον ήχο του clip, σε αυτή τη συσκευή. Το Μοντάζ φτιάχνει ένα καθαρό αντίγραφο του ήχου και το κρατά όπως τα άλλα πολυμέσα σου· το πρωτότυπο μένει όπως είναι.",
      "nr.go": "Μείωση θορύβου", "nr.on": "Ο θόρυβος έχει μειωθεί σε αυτό το clip.", "nr.off": "Πίσω στον αρχικό ήχο",
      "nr.working": "Καθαρίζω τον ήχο… {p}%", "nr.done": "Ο θόρυβος μειώθηκε", "nr.fail": "Δεν καθάρισε αυτός ο ήχος.",
      "rel.today": "σήμερα", "rel.yesterday": "χθες"
    }
  };
  function t(key, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function setLabel(n, s) { n.setAttribute("aria-label", s); n.title = s; }
  function uid() {
    var a = new Uint8Array(8), s = "";
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36);
    return Date.now().toString(36) + s;
  }
  function fmtMB(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
    return n >= 1048576 ? Math.round(n / 1048576) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  }
  function whenText(ms) {
    var d = new Date(ms), now = new Date();
    var day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff === 0) return t("rel.today") + " " + d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
    if (diff === 1) return t("rel.yesterday");
    try { return d.toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" }); }
    catch (e) { return d.toDateString(); }
  }

  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("montage.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage, prefs, edits + undo ----------
  var data = C.merge(null, null);
  var prefs = { pps: 40, short: 1080, keep: false, what: "video", gif: 480, asr: "auto" };

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.projects && typeof parsed.projects === "object") { data = C.merge(parsed, null); return; }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] montage: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = C.merge(null, null);
  }
  var saveFailShown = false;
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); saveFailShown = false; }
    catch (e) { if (!saveFailShown) { saveFailShown = true; showToast(t("toast.saveFail")); } }   // R30
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (typeof p.pps === "number" && p.pps >= 4 && p.pps <= 400) prefs.pps = p.pps;
        if ([720, 1080, 2160].indexOf(p.short) >= 0) prefs.short = p.short;
        prefs.keep = p.keep === true;
        prefs.what = p.what === "sound" || p.what === "gif" ? p.what : "video";
        prefs.gif = p.gif === 320 ? 320 : 480;
        prefs.asr = p.asr === "en" || p.asr === "el" ? p.asr : "auto";
      }
    } catch (e) {}
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }

  var pid = null, sel = null;
  var undoStack = [], redoStack = [];
  function cur() { return pid ? data.projects[pid] || null : null; }
  function snapshot() { var p = cur(); return p ? JSON.stringify(p) : null; }
  function pushUndo() {
    var s = snapshot();
    if (!s) return;
    if (undoStack.length && undoStack[undoStack.length - 1] === s) return;
    undoStack.push(s);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];
  }
  // Every edit goes through here. opts.undo false = part of an edit
  // whose undo point was pushed already (sliders in a panel).
  function commit(next, opts) {
    var before = snapshot();
    if (!opts || opts.undo !== false) pushUndo();
    data = next;
    var after = snapshot();
    if (before === after) { if (!opts || opts.undo !== false) undoStack.pop(); return false; }
    save();
    if (sel && cur() && !cur().items[sel]) sel = null;
    refreshEditor();
    return true;
  }
  function undo() {
    if (!undoStack.length || !cur()) return;
    redoStack.push(snapshot());
    data = C.restoreProject(data, pid, JSON.parse(undoStack.pop()), Date.now());
    save();
    if (sel && !cur().items[sel]) sel = null;
    refreshEditor();
  }
  function redo() {
    if (!redoStack.length || !cur()) return;
    undoStack.push(snapshot());
    data = C.restoreProject(data, pid, JSON.parse(redoStack.pop()), Date.now());
    save();
    if (sel && !cur().items[sel]) sel = null;
    refreshEditor();
  }

  // ---------- 3. Projects view ----------
  var view = "home";
  function showHome() {
    closeDialog();
    if (player) { player.dispose(); player = null; }
    view = "home"; pid = null; sel = null; undoStack = []; redoStack = [];
    picking = null; $("stage-wrap").classList.remove("picking");
    $("home").hidden = false; $("editor").hidden = true;
    ["back-btn", "undo-btn", "redo-btn", "proj-btn", "export-btn"].forEach(function (k) { $(k).hidden = true; });
    $("title-main").textContent = t("app.name");
    $("title-sub").textContent = "";
    renderHome();
  }
  function renderHome() {
    var list = $("proj-list"), ps = C.projectList(data);
    list.innerHTML = "";
    $("home-empty").hidden = ps.length > 0;
    ps.forEach(function (p) {
      var li = el("li", "proj");
      var open = el("button", "proj-open");
      open.type = "button";
      var th = el("div", "proj-thumb");
      var first = C.mainSeq(p)[0];
      if (first && first.it.src) {
        MM.thumb(first.it.src, first.it.k === "video" ? first.it["in"] : 0).then(function (u) {
          if (u) { th.innerHTML = ""; var im = el("img"); im.alt = ""; im.src = u; th.appendChild(im); }
        });
      }
      th.appendChild(el("span", "ratio", p.ar));
      var meta = el("div", "proj-meta");
      meta.appendChild(el("span", "proj-name", p.name));
      meta.appendChild(el("span", "proj-sub", t("proj.sub", { r: p.ar, d: C.fmtTime(C.duration(p)), when: whenText(C.lastEdit(p)) })));
      open.appendChild(th); open.appendChild(meta);
      open.addEventListener("click", function () { openProject(p.id); });
      var acts = el("div", "proj-actions");
      var more = el("button", "icon-btn");
      more.type = "button"; more.innerHTML = ICON.more; setLabel(more, t("btn.more"));
      more.addEventListener("click", function () { projectMenu(p.id); });
      acts.appendChild(more);
      li.appendChild(open); li.appendChild(acts);
      list.appendChild(li);
    });
    MM.usage().then(function (u) {
      $("storage").textContent = u && u.quota ? t("home.storage", { u: fmtMB(u.usage || 0), q: fmtMB(u.quota) }) : "";
    }, function () {});
  }

  function newProjectDialog() {
    var body = openDialog(t("new.title"));
    var name = textField(body, "np-name", t("f.name"), t("proj.untitled"));
    var ar = "16:9", fps = 30;
    chipField(body, t("f.ratio"), C.RATIOS.map(function (r) { return [r, t("ratio." + r)]; }), ar, function (v) { ar = v; });
    chipField(body, t("f.fps"), [[30, "30"], [60, "60"]], fps, function (v) { fps = v; });
    actions(body, [[t("btn.create"), "primary", function () {
      var id = uid();
      data = C.newProject(data, { name: name.value || t("proj.untitled"), ar: ar, fps: fps }, Date.now(), id);
      save();
      closeDialog();
      openProject(id);
    }]]);
    name.select();
  }
  function projectMenu(id) {
    var p = data.projects[id];
    if (!p) return;
    var body = openDialog(p.name);
    var name = textField(body, "pm-name", t("f.name"), p.name);
    actions(body, [
      [t("btn.delete"), "danger", function () {
        var before = data;
        data = C.delProject(data, id, Date.now());
        save(); closeDialog(); renderHome();
        undoToast(t("toast.deleted"), function () {
          var back = before.projects[id];
          if (!back) return;
          data = C.undeleteProject(data, back, Date.now());
          save(); renderHome();
        });
      }],
      [t("btn.duplicate"), "", function () {
        var nid = uid(), now = Date.now();
        var d = C.newProject(data, { name: t("proj.copy", { n: p.name }), ar: p.ar, fps: p.fps, bg: p.bg }, now, nid);
        Object.keys(p.items).forEach(function (k) {
          var it = JSON.parse(JSON.stringify(p.items[k]));
          var opts2 = it.tr === "main" ? { after: undefined } : null;
          d = C.addItem(d, nid, it, now, opts2);
        });
        data = d; save(); closeDialog(); renderHome();
      }],
      [t("btn.rename"), "primary", function () {
        data = C.setProject(data, id, { name: name.value }, Date.now());
        save(); closeDialog(); renderHome();
      }]
    ]);
  }

  // ---------- 4. Editor: player, transport, time ----------
  var player = null, tNow = 0;
  function openProject(id) {
    if (!data.projects[id]) { showToast(t("toast.notFound")); showHome(); return; }
    closeDialog();
    pid = id; sel = null; undoStack = []; redoStack = []; tNow = 0;
    view = "editor";
    $("home").hidden = true; $("editor").hidden = false;
    ["back-btn", "undo-btn", "redo-btn", "proj-btn", "export-btn"].forEach(function (k) { $(k).hidden = false; });
    try {
      player = MontagePlayer.create({
        canvas: $("stage"), media: MM.get, proxy: MM.proxy,
        onTime: function (tt) { tNow = tt; followPlayhead(); },
        onState: function (on) { $("play-btn").innerHTML = on ? ICON.pause : ICON.play; setLabel($("play-btn"), t(on ? "btn.pause" : "btn.play")); }
      });
    } catch (e) {
      player = null;
      showToast(t("err.noweb"));
    }
    refreshEditor();
    setTime(0);
  }
  function refreshEditor() {
    if (view !== "editor") return;
    var p = cur();
    if (!p) { showToast(t("toast.notFound")); showHome(); return; }
    $("title-main").textContent = p.name;
    $("title-sub").textContent = p.ar + " · " + C.fmtTime(C.duration(p));
    $("undo-btn").disabled = !undoStack.length;
    $("redo-btn").disabled = !redoStack.length;
    $("stage-empty").hidden = Object.keys(p.items).length > 0;
    if (player) player.setProject(p);
    renderTimeline();
    renderTools();
    updateTC();
  }
  function duration() { var p = cur(); return p ? C.duration(p) : 0; }
  function setTime(tt) {
    tNow = Math.max(0, Math.min(duration(), tt));
    if (player) player.seek(tNow);
    followPlayhead();
  }
  function updateTC() {
    var p = cur();
    $("tc").innerHTML = "";
    var b = el("b", null, C.fmtTime(tNow, true, p ? p.fps : 30));
    $("tc").appendChild(b);
    $("tc").appendChild(document.createTextNode(" / " + C.fmtTime(duration())));
  }
  function stepFrame(n) {
    var p = cur();
    if (!p) return;
    if (player && player.playing()) player.pause();
    setTime(Math.round(tNow * p.fps + n) / p.fps);
  }

  // ---------- 5. Timeline: draw, select, drag, trim, zoom ----------
  var ignoreScroll = 0, preview = null;          // preview: a not-yet-committed data copy while dragging
  function pad() { return $("timeline").clientWidth / 2; }
  function pps() { return prefs.pps; }
  function xOf(time) { return pad() + time * pps(); }

  function followPlayhead() {
    var tl = $("timeline"), want = Math.round(tNow * pps());
    if (Math.abs(tl.scrollLeft - want) >= 1) { ignoreScroll++; tl.scrollLeft = want; }
    updateTC();
  }
  function placePlayhead() {
    var ph = $("playhead"), tl = $("timeline");
    ph.style.left = (tl.offsetLeft + tl.clientWidth / 2) + "px";
  }

  var thumbCache = {}, missingCache = {};
  function clipLabel(it) {
    if (it.k === "title") return it.text.t.split("\n")[0] || t("kind.title");
    if (it.k === "shape") return t("shape." + it.sh.k);
    var d = C.fmtTime(C.itemDur(it));
    if (it.k === "audio") return t("kind.audio") + " · " + d;
    var spd = C.hasRamp(it) ? " · " + t("p.curveShort") : (it.sp !== undefined && it.sp !== 1 ? " · " + it.sp + "×" : "");
    return d + spd + (it.mu ? " · 🔇" : "");
  }
  function renderTimeline() {
    var p = preview || cur();
    if (!p) return;
    var tracks = $("tracks"), heads = $("tl-heads");
    tracks.innerHTML = ""; heads.innerHTML = "";
    var total = C.duration(p), width = pad() * 2 + Math.max(total, 1) * pps();
    $("tl-inner").style.width = width + "px";
    // ruler
    var ruler = $("ruler"); ruler.innerHTML = "";
    var steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600], step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) if (steps[i] * pps() >= 64) { step = steps[i]; break; }
    for (var s = 0; s <= total + step; s += step) {
      var tk = el("span", "tick", C.fmtTime(s));
      tk.style.left = xOf(s) + "px";
      ruler.appendChild(tk);
    }
    ROWS.forEach(function (tr) {
      var thin = tr !== "main";
      var h = el("div", "th" + (thin ? " thin" : ""));
      h.innerHTML = ICON["tr_" + tr]; setLabel(h, t("tr." + tr));
      heads.appendChild(h);
      var row = el("div", "track" + (thin ? " thin" : ""));
      row.setAttribute("data-tr", tr);
      if (tr === "main") {
        C.mainSeq(p).forEach(function (sq) { row.appendChild(clipBlock(p, sq.it, sq.start, sq.end, sq.tx)); });
      } else {
        C.trackItems(p, tr).forEach(function (it) { row.appendChild(clipBlock(p, it, it.at, it.at + C.itemDur(it), 0)); });
      }
      tracks.appendChild(row);
    });
    placePlayhead();
  }
  function clipBlock(p, it, start, end, tx) {
    var b = el("div", "clip " + it.tr + (it.id === sel ? " sel" : ""));
    b.setAttribute("data-id", it.id);
    b.style.left = xOf(start) + "px";
    b.style.width = Math.max(6, (end - start) * pps()) + "px";
    b.appendChild(el("span", null, clipLabel(it)));
    if (tx > 0) { var m = el("i", "tx-mark"); m.style.width = (tx * pps()) + "px"; b.appendChild(m); }
    (it.kf || []).forEach(function (k) { var d = el("i", "kf-mark"); d.style.left = (k.t * pps()) + "px"; b.appendChild(d); });
    if (it.src) {
      if (missingCache[it.src]) b.classList.add("missing");
      var key = it.src + "@" + (it.k === "video" ? it["in"] : 0);
      if ((it.k === "video" || it.k === "image")) {
        if (thumbCache[key]) b.style.backgroundImage = "url(" + thumbCache[key] + ")";
        else if (thumbCache[key] !== null) {
          thumbCache[key] = null;
          MM.thumb(it.src, it.k === "video" ? it["in"] : 0).then(function (u) {
            if (u) { thumbCache[key] = u; renderTimelineSoon(); } else { delete thumbCache[key]; }
          });
        }
      }
      if (it.k === "audio") drawPeaks(b, it, end - start);
      if (missingCache[it.src] === undefined) {
        missingCache[it.src] = false;
        MM.get(it.src).then(function (blob) { if (!blob) { missingCache[it.src] = true; renderTimelineSoon(); } });
      }
    }
    var hl = el("span", "handle l"), hr = el("span", "handle r");
    hl.setAttribute("data-h", "l"); hr.setAttribute("data-h", "r");
    b.appendChild(hl); b.appendChild(hr);
    return b;
  }
  // Waveform of a sound clip: the peaks of its in…out part, one bar per
  // 2 px (a canvas at most 4096 px wide, stretched beyond that).
  var peakCache = {};
  function drawPeaks(b, it, dur) {
    var pk = peakCache[it.src];
    if (pk === undefined) {
      peakCache[it.src] = null;
      MM.peaks(it.src).then(function (a) { peakCache[it.src] = a || false; if (a) renderTimelineSoon(); });
      return;
    }
    if (!pk) return;
    var w = Math.max(6, dur * pps()), cw = Math.min(4096, Math.ceil(w)), ch = 32;
    var c = el("canvas", "wave"), g = c.getContext("2d");
    c.width = cw; c.height = ch;
    g.fillStyle = "rgba(255,255,255,0.55)";
    var R = MM.PEAK_RATE, from = it["in"] * R, span = (it.out - it["in"]) * R;
    for (var x = 0; x < cw; x += 2) {
      var a = Math.floor(from + span * x / cw), z = Math.max(a + 1, Math.floor(from + span * (x + 2) / cw)), m = 0;
      for (var k = a; k < z && k < pk.length; k++) if (pk[k] > m) m = pk[k];
      var h = Math.max(1, Math.round(Math.sqrt(m / 255) * (ch - 2)));
      g.fillRect(x, (ch - h) / 2, 1.5, h);
    }
    b.insertBefore(c, b.firstChild);
  }
  var tlTimer = 0;
  function renderTimelineSoon() { clearTimeout(tlTimer); tlTimer = setTimeout(renderTimeline, 60); }

  function select(id) {
    sel = id;
    renderTimeline();
    renderTools();
  }

  // Pointer work on the timeline: tap selects, a selected clip drags
  // (move) or trims (its edge handles); empty space deselects.
  var gesture = null;
  function timeAtX(clientX) {
    var tl = $("timeline"), r = tl.getBoundingClientRect();
    return (clientX - r.left + tl.scrollLeft - pad()) / pps();
  }
  function rowAtY(clientY) {
    var rows = $("tracks").children;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return rows[i].getAttribute("data-tr");
    }
    return null;
  }
  function onTlDown(e) {
    if (e.button && e.button !== 0) return;
    var blk = e.target.closest && e.target.closest(".clip");
    var id = blk ? blk.getAttribute("data-id") : null;
    gesture = { x: e.clientX, y: e.clientY, id: id, pointer: e.pointerId, moved: false, mode: "tap", handle: null };
    if (id && id === sel) {
      var h = e.target.getAttribute && e.target.getAttribute("data-h");
      gesture.mode = h ? "trim" : "move";
      gesture.handle = h;
      gesture.orig = data;
      gesture.t0 = timeAtX(e.clientX);
      try { $("timeline").setPointerCapture(e.pointerId); } catch (x) {}
      if (player && player.playing()) player.pause();
      e.preventDefault();
    }
  }
  function onTlMove(e) {
    if (!gesture || e.pointerId !== gesture.pointer) return;
    var dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    if (!gesture.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    gesture.moved = true;
    if (gesture.mode === "tap") return;
    e.preventDefault();
    var dt = timeAtX(e.clientX) - gesture.t0;
    var d = gesture.mode === "trim" ? trimmed(gesture.orig, gesture.id, gesture.handle, dt) : moved(gesture.orig, gesture.id, dt, rowAtY(e.clientY), timeAtX(e.clientX));
    preview = d.projects[pid];
    renderTimeline();
    if (player) player.setProject(preview);
  }
  function onTlUp(e) {
    if (!gesture || e.pointerId !== gesture.pointer) return;
    var g = gesture; gesture = null;
    if (g.mode === "tap") {
      if (!g.moved) {
        if (g.id) select(g.id === sel ? sel : g.id);
        else if (sel) select(null);
        else if (e.target === $("ruler") || (e.target.closest && e.target.closest("#ruler"))) setTime(timeAtX(e.clientX));
      }
      return;
    }
    if (!preview) return;
    var dt = timeAtX(e.clientX) - g.t0;
    var d = g.mode === "trim" ? trimmed(g.orig, g.id, g.handle, dt) : moved(g.orig, g.id, dt, rowAtY(e.clientY), timeAtX(e.clientX));
    preview = null;
    data = g.orig;
    commit(d);
  }
  function onTlCancel(e) {
    if (gesture && e.pointerId === gesture.pointer) { gesture = null; if (preview) { preview = null; refreshEditor(); } }
  }

  // Snap a time to the playhead and clip edges nearby (10 px).
  function snap(p, time, skipId) {
    var best = time, lim = 10 / pps(), cands = [0, tNow];
    Object.keys(p.items).forEach(function (k) {
      if (k === skipId) return;
      var pl = C.placeOf(p, k);
      if (pl) { cands.push(pl.start); cands.push(pl.end); }
    });
    cands.forEach(function (c) { if (Math.abs(c - time) < lim && Math.abs(c - time) < Math.abs(best - time) + 1e-9) best = c; });
    return best;
  }
  function moved(base, id, dt, row, at) {
    var p = base.projects[pid], it = p && p.items[id];
    if (!it) return base;
    var now = Date.now();
    if (it.tr === "main" && (!row || row === "main")) {
      // reorder: drop before the first clip whose middle is after the pointer
      var seq = C.mainSeq(p).filter(function (s) { return s.it.id !== id; }), after = null;
      for (var i = 0; i < seq.length; i++) {
        if ((seq[i].start + seq[i].end) / 2 > at) break;
        after = seq[i].it.id;
      }
      return C.moveMain(base, pid, id, after, now);
    }
    var target = row && C.TRACK_KINDS[row] && C.TRACK_KINDS[row].indexOf(it.k) >= 0 ? row : it.tr;
    if (target === "main") {
      var d0 = C.setItem(base, pid, id, { tr: "main" }, now);
      return moved(d0, id, 0, "main", at);
    }
    var start = it.tr === "main" ? (C.placeOf(p, id) || { start: 0 }).start : it.at;
    var na = snap(p, Math.max(0, start + dt), id);
    var end = na + C.itemDur(it), ne = snap(p, end, id);
    if (ne !== end) na = Math.max(0, ne - C.itemDur(it));
    return C.setItem(base, pid, id, { tr: target, at: na }, now);
  }
  function trimmed(base, id, h, dt) {
    var p = base.projects[pid], it = p && p.items[id];
    if (!it) return base;
    var patch = {}, now = Date.now();
    if (it.k === "video" || it.k === "audio") {
      // C.trimSrc follows the clip's speed (and its speed curve)
      var minSrc = C.MIN * (C.hasRamp(it) ? 1 : it.sp);
      if (h === "l") {
        var ni = Math.max(0, Math.min(it.out - minSrc, C.trimSrc(it, "l", dt)));
        if (it.tr !== "main") { var shift = C.fwdLocal(it, ni); if (it.at + shift < 0) { ni = Math.max(0, C.fwdPos(it, -it.at)); shift = C.fwdLocal(it, ni); } patch.at = Math.max(0, it.at + shift); }
        patch["in"] = ni;
      } else {
        var lim = it.len > 0 ? it.len : Infinity;
        patch.out = Math.max(it["in"] + minSrc, Math.min(lim, C.trimSrc(it, "r", dt)));
      }
    } else {
      if (h === "l") {
        var dd = Math.min(it.d - C.MIN, dt);
        if (it.tr !== "main") { if (it.at + dd < 0) dd = -it.at; patch.at = it.at + dd; }
        patch.d = it.d - dd;
      } else patch.d = Math.max(C.MIN, it.d + dt);
    }
    return C.setItem(base, pid, id, patch, now);
  }

  function zoom(f, keepTime) {
    var np = Math.max(4, Math.min(400, prefs.pps * f));
    if (np === prefs.pps) return;
    prefs.pps = np; savePrefs();
    renderTimeline();
    setTime(keepTime == null ? tNow : keepTime);
  }

  function onTlScroll() {
    if (ignoreScroll) { ignoreScroll--; return; }
    if (gesture && gesture.mode !== "tap") return;
    if (player && player.playing()) player.pause();
    tNow = Math.max(0, Math.min(duration(), $("timeline").scrollLeft / pps()));
    if (player) player.seek(tNow);
    updateTC();
  }
  function onTlWheel(e) {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); return; }
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); $("timeline").scrollLeft += e.deltaY; }
  }

  // ---------- 6. Tools bar + clip panels ----------
  function toolBtn(icon, label, fn, cls, disabled) {
    var b = el("button", "tool" + (cls ? " " + cls : ""));
    b.type = "button";
    b.innerHTML = ICON[icon] || "";
    b.appendChild(el("span", null, label));
    if (disabled) b.disabled = true;
    b.addEventListener("click", fn);
    return b;
  }
  function renderTools() {
    var bar = $("tools");
    bar.innerHTML = "";
    var p = cur(), it = p && sel ? p.items[sel] : null;
    if (!it) {
      bar.appendChild(toolBtn("media", t("tool.media"), function () { addMedia("main"); }));
      bar.appendChild(toolBtn("overlay", t("tool.overlay"), function () { addMedia("ov"); }));
      bar.appendChild(toolBtn("audio", t("tool.audio"), addSound));
      bar.appendChild(toolBtn("text", t("tool.text"), addText));
      bar.appendChild(toolBtn("cc", t("tool.subs"), subtitlesDialog));
      bar.appendChild(toolBtn("shapes", t("tool.shapes"), shapesDialog));
      bar.appendChild(toolBtn("tr_a2", t("tool.voice"), recordVoice));
      bar.appendChild(toolBtn("split", t("tool.split"), splitAtPlayhead, null, !clipAt(tNow)));
      bar.appendChild(toolBtn("frame", t("tool.grab"), grabFrame, null, !C.duration(p)));
      bar.appendChild(toolBtn("settings", t("tool.project"), projectSettings));
      return;
    }
    bar.appendChild(toolBtn("back", t("tool.done"), function () { select(null); }, "back"));
    bar.appendChild(toolBtn("split", t("tool.split"), function () { splitClip(sel); }));
    if (it.k === "video" || it.k === "audio") {
      bar.appendChild(toolBtn("speed", t("tool.speed"), panelSpeed));
      bar.appendChild(toolBtn("volume", t("tool.volume"), panelVolume));
    } else {
      bar.appendChild(toolBtn("clock", t("p.duration"), panelDuration));
    }
    bar.appendChild(toolBtn("fade", t("tool.fade"), panelFade));
    bar.appendChild(toolBtn("kf", t("tool.kf"), panelKeys));
    if (it.tr === "main" && C.mainSeq(p)[0].it.id !== it.id) bar.appendChild(toolBtn("transition", t("tool.transition"), panelTransition));
    if (it.k === "shape") bar.appendChild(toolBtn("palette", t("tool.style"), panelShape));
    if (it.k === "title") {
      bar.appendChild(toolBtn("text", t("tool.edit"), function () { panelText(); }));
      if (it.tr === "main") bar.appendChild(toolBtn("palette", t("tool.bg"), panelTitleBg));
    }
    if (it.k === "video" || it.k === "image") {
      bar.appendChild(toolBtn("adjust", t("tool.adjust"), panelAdjust));
      bar.appendChild(toolBtn("frame", t("tool.frame"), panelFrame));
      bar.appendChild(toolBtn("chroma", t("tool.chroma"), panelChroma));
      bar.appendChild(toolBtn("reframe", t("tool.reframe"), panelReframe));
    }
    if (it.tr === "ov" || it.tr === "tt") bar.appendChild(toolBtn("move", t("tool.position"), panelPosition));
    if ((it.k === "video" && !it.mu && !it.rv) || it.k === "audio") bar.appendChild(toolBtn("denoise", t("tool.denoise"), panelNoise));
    if (it.k === "video") {
      bar.appendChild(toolBtn(it.mu ? "volume" : "mute", t(it.mu ? "tool.unmute" : "tool.mute"), function () { edit({ mu: !it.mu }); }));
      if (!it.mu) bar.appendChild(toolBtn("detach", t("tool.detach"), detachSound));
      if (it.tr === "main") bar.appendChild(toolBtn("freeze", t("tool.freeze"), freezeFrame));
      bar.appendChild(toolBtn("reverse", t(it.rv ? "tool.forward" : "tool.reverse"), function () {
        if (edit({ rv: !it.rv }) && !it.rv) showToast(t("toast.reversed"));
      }));
    }
    if (it.k === "video" || it.k === "image") {
      if (it.tr === "main") bar.appendChild(toolBtn("overlay", t("tool.toOv"), function () { edit({ tr: "ov" }); }));
      else bar.appendChild(toolBtn("media", t("tool.toMain"), function () { edit({ tr: "main" }); }));
    }
    bar.appendChild(toolBtn("copy", t("tool.dup"), duplicateClip));
    bar.appendChild(toolBtn("trash", t("tool.del"), deleteClip, "danger"));
  }
  function edit(patch, opts) { return commit(C.setItem(data, pid, sel, patch, Date.now()), opts); }
  function selItem() { var p = cur(); return p && sel ? p.items[sel] : null; }

  function clipAt(time) {
    var p = cur();
    if (!p) return null;
    var hit = null;
    C.mainSeq(p).forEach(function (s) { if (time > s.start + C.MIN && time < s.end - C.MIN) hit = s.it.id; });
    return hit;
  }
  function splitClip(id) {
    var nid = uid();
    if (!commit(C.split(data, pid, id, tNow, Date.now(), nid))) { showToast(t("toast.splitEdge")); return; }
    select(nid);
  }
  function splitAtPlayhead() { var id = clipAt(tNow); if (id) splitClip(id); else showToast(t("toast.splitEdge")); }
  function duplicateClip() { var nid = uid(); if (commit(C.duplicate(data, pid, sel, Date.now(), nid))) select(nid); }
  function deleteClip() {
    var id = sel;
    if (commit(C.delItem(data, pid, id, Date.now()))) { sel = null; refreshEditor(); undoToast(t("toast.clipDeleted"), undo); }
  }
  function detachSound() {
    var it = selItem(), p = cur(), nid = uid();
    if (!it) return;
    var pl = C.placeOf(p, it.id), busy = C.trackItems(p, "a1").some(function (a) { return a.at < pl.end && a.at + C.itemDur(a) > pl.start; });
    commit(C.detachSound(data, pid, it.id, Date.now(), nid, busy ? "a2" : "a1"));
  }

  // Panels: one undo point when opened; every change applies at once.
  function panel(title) {
    pushUndo();
    var mark = undoStack.length;
    var body = openDialog(title);
    onDialogClose = function () {
      if (undoStack.length === mark && undoStack[mark - 1] === snapshot()) undoStack.pop();
      refreshEditor();
    };
    return body;
  }
  function live(patch) { edit(patch, { undo: false }); }

  function panelSpeed() {
    var it = selItem(), p = cur(), body = panel(t("tool.speed"));
    if (!C.hasRamp(it)) {
      rangeField(body, t("p.speed"), 0.25, 4, 0.05, it.sp, function (v) { return v.toFixed(2) + "×"; }, function (v) { live({ sp: v }); });
      chipField(body, "", [[0.5, "0.5×"], [1, "1×"], [1.5, "1.5×"], [2, "2×"], [3, "3×"]], null, function (v) { live({ sp: v }); closeDialog(); });
    }
    // speed curve: a preset, then points set at the playhead
    var name = "none";
    if (C.hasRamp(it)) {
      name = "custom";
      C.RAMPS.forEach(function (r) { if (JSON.stringify(C.rampPreset(it, r)) === JSON.stringify(it.sr)) name = r; });
    }
    var opts = [["none", t("ramp.none")]].concat(C.RAMPS.map(function (r) { return [r, t("ramp." + r)]; }));
    if (name === "custom") opts.push(["custom", t("ramp.custom")]);
    chipField(body, t("p.curve"), opts, name, function (v) {
      if (v === "custom") return;
      live({ sr: v === "none" ? null : C.rampPreset(selItem(), v) });
      closeDialog();
      panelSpeed();
    });
    if (C.hasRamp(it)) {
      var pl = C.placeOf(p, it.id);
      if (tNow < pl.start || tNow > pl.end) setTime(pl.start);
      var local = Math.min(pl.end - pl.start, Math.max(0, tNow - pl.start)), s = C.srcTime(it, local), near = (it.out - it["in"]) * 0.04;
      var cv = el("canvas", "ramp-graph");
      cv.width = 600; cv.height = 150;
      cv.setAttribute("role", "img"); setLabel(cv, t("ramp.graph"));
      body.appendChild(cv);
      var lenP = el("p", "hint small");
      function redraw() {
        var cur0 = selItem();
        if (!cur0 || !C.hasRamp(cur0)) return;
        drawRamp(cv, cur0, s);
        lenP.textContent = t("ramp.len", { d: C.fmtTime(C.itemDur(cur0), true, p.fps) });
      }
      // log scale: the slider runs -100..100 for 0.1×..10×
      var v0 = C.srAt(it.sr, s);
      rangeField(body, t("ramp.here"), -100, 100, 1, Math.round(Math.log(v0) / Math.LN10 * 100), function (x) { return (Math.round(Math.pow(10, x / 100) * 100) / 100) + "×"; },
        function (x) { live({ sr: C.srSet(selItem(), s, Math.round(Math.pow(10, x / 100) * 100) / 100, near) }); redraw(); });
      body.appendChild(lenP);
      body.appendChild(el("p", "hint small", t("ramp.hint")));
      redraw();
    }
    body.appendChild(el("p", "hint small", t("p.speedHint")));
  }
  // The speed curve of a clip over its in…out (log scale 0.1×..10×), its
  // points, and a line where the playhead is (s = file seconds).
  function drawRamp(cv, it, s) {
    var g = cv.getContext("2d"), W = cv.width, H = cv.height, a = it["in"], b = it.out;
    var css = getComputedStyle(document.documentElement);
    var accent = css.getPropertyValue("--accent").trim() || "#f08c3a", dim = css.getPropertyValue("--text-dim").trim() || "#999";
    var y = function (v) { return H - 8 - (Math.log(v) / Math.LN10 + 1) / 2 * (H - 16); };
    var x = function (sv) { return (sv - a) / (b - a) * W; };
    g.clearRect(0, 0, W, H);
    g.strokeStyle = dim; g.globalAlpha = 0.4; g.lineWidth = 1;
    [0.1, 1, 10].forEach(function (v) { g.beginPath(); g.moveTo(0, y(v)); g.lineTo(W, y(v)); g.stroke(); });
    g.globalAlpha = 1; g.fillStyle = dim; g.font = "20px sans-serif";
    g.fillText("1×", 4, y(1) - 4);
    g.strokeStyle = accent; g.lineWidth = 4; g.beginPath();
    for (var i = 0; i <= 120; i++) { var sv = a + (b - a) * i / 120, py = y(C.srAt(it.sr, sv)); if (i) g.lineTo(i / 120 * W, py); else g.moveTo(0, py); }
    g.stroke();
    g.fillStyle = accent;
    it.sr.forEach(function (k) { if (k.s >= a && k.s <= b) { g.beginPath(); g.arc(x(k.s), y(k.v), 7, 0, Math.PI * 2); g.fill(); } });
    g.strokeStyle = dim; g.lineWidth = 2; g.beginPath(); g.moveTo(x(s), 0); g.lineTo(x(s), H); g.stroke();
  }
  function panelVolume() {
    var it = selItem(), body = panel(t("tool.volume"));
    rangeField(body, t("p.volume"), 0, 200, 1, it.vol, function (v) { return v + "%"; }, function (v) { live({ vol: v, mu: false }); });
  }
  function panelDuration() {
    var it = selItem(), body = panel(t("p.duration"));
    rangeField(body, t("p.duration"), 0.5, 30, 0.1, Math.min(30, it.d), function (v) { return v.toFixed(1) + " s"; }, function (v) { live({ d: v }); });
  }
  function panelFade() {
    var it = selItem(), body = panel(t("tool.fade"));
    var max = Math.min(10, C.itemDur(it) / 2);
    rangeField(body, t("p.fadeIn"), 0, max, 0.1, it.fi, secs, function (v) { live({ fi: v }); });
    rangeField(body, t("p.fadeOut"), 0, max, 0.1, it.fo, secs, function (v) { live({ fo: v }); });
  }
  function secs(v) { return v.toFixed(1) + " s"; }
  function panelTransition() {
    var it = selItem(), body = panel(t("tool.transition"));
    var kind = it.tx ? it.tx.k : "none", len = it.tx ? it.tx.d : 0.5;
    chipField(body, t("p.tx"), [["none", t("tx.none")]].concat(C.TRANSITIONS.map(function (k) { return [k, t("tx." + k)]; })), kind, function (v) {
      kind = v; live({ tx: v === "none" ? null : { k: v, d: len } });
    });
    rangeField(body, t("p.txLen"), 0.1, 2, 0.1, len, secs, function (v) { len = v; if (kind !== "none") live({ tx: { k: kind, d: v } }); });
  }
  function panelAdjust() {
    var it = selItem(), body = panel(t("tool.adjust")), lk = JSON.parse(JSON.stringify(it.lk));
    [["b", "p.bright"], ["c", "p.contrast"], ["s", "p.sat"], ["t", "p.temp"]].forEach(function (f) {
      rangeField(body, t(f[1]), -100, 100, 1, lk[f[0]], function (v) { return (v > 0 ? "+" : "") + v; }, function (v) { lk[f[0]] = v; live({ lk: JSON.parse(JSON.stringify(lk)) }); });
    });
    chipField(body, t("p.filter"), C.FILTERS.map(function (f) { return [f, t("flt." + f)]; }), it.flt, function (v) { live({ flt: v }); });
    var lf = el("div", "field");
    lf.appendChild(el("span", "lbl", t("lut.title")));
    lf.appendChild(el("p", "hint small", it.lut ? t("lut.on") : t("lut.hint")));
    body.appendChild(lf);
    actions(body, (it.lut ? [[t("lut.remove"), "", function () { live({ lut: null }); closeDialog(); }]] : [])
      .concat([[t("lut.open"), "", function () { closeDialog(); openLut(); }]]));
  }
  // A .cube file → a picture of its table (n² × n PNG), stored like any
  // picture (device, optional media sync), set as the clip's look.
  function openLut() {
    var id = sel;
    pickFiles(".cube,text/plain", false).then(function (files) {
      var f = files && files[0];
      if (!f) return;
      if (f.size > 16 * 1024 * 1024) { showToast(t("lut.bad")); return; }
      f.text().then(function (txt) {
        var lut = C.parseCube(txt);
        if (!lut) { showToast(t("lut.bad")); return; }
        var px = C.lutPixels(lut), cv = document.createElement("canvas");
        cv.width = px.w; cv.height = px.h;
        cv.getContext("2d").putImageData(new ImageData(px.data, px.w, px.h), 0, 0);
        cv.toBlob(function (png) {
          if (!png) { showToast(t("err.fail")); return; }
          var name = String(f.name || "look").replace(/\.cube$/i, "") + ".png";
          importMany([new File([png], name, { type: "image/png" })], function (info) {
            if (!cur() || !cur().items[id]) return;
            sel = id;
            edit({ lut: info.id });
          });
        }, "image/png");
      }, function () { showToast(t("lut.bad")); });
    });
  }
  function panelFrame() {
    var it = selItem(), body = panel(t("tool.frame"));
    chipField(body, t("p.fit"), [["fit", t("fit.fit")], ["fill", t("fit.fill")]], it.fit, function (v) { live({ fit: v }); });
    chipField(body, t("p.rotate"), [[0, "0°"], [90, "90°"], [180, "180°"], [270, "270°"]], it.rot, function (v) { live({ rot: v }); });
    checkField(body, t("p.mirror"), it.fl, function (v) { live({ fl: v }); });
    rangeField(body, t("p.opacity"), 0, 100, 1, it.op, function (v) { return v + "%"; }, function (v) { live({ op: v }); });
  }
  function panelPosition() {
    var it = selItem(), body = panel(t("tool.position")), box = JSON.parse(JSON.stringify(it.box));
    function upd() { live({ box: JSON.parse(JSON.stringify(box)) }); }
    rangeField(body, t("p.size"), 5, 100, 1, Math.round(box.w * 100), function (v) { return v + "%"; }, function (v) {
      var cx = box.x + box.w / 2, cy = box.y + box.h / 2, r = box.h / box.w;
      box.w = v / 100; box.h = box.w * r; box.x = cx - box.w / 2; box.y = cy - box.h / 2; upd();
    });
    rangeField(body, t("p.x"), -50, 150, 1, Math.round((box.x + box.w / 2) * 100), function (v) { return v + "%"; }, function (v) { box.x = v / 100 - box.w / 2; upd(); });
    rangeField(body, t("p.y"), -50, 150, 1, Math.round((box.y + box.h / 2) * 100), function (v) { return v + "%"; }, function (v) { box.y = v / 100 - box.h / 2; upd(); });
    if (it.k !== "title") rangeField(body, t("p.opacity"), 0, 100, 1, it.op, function (v) { return v + "%"; }, function (v) { live({ op: v }); });
    // picture in picture: a border and rounded corners
    if (it.k === "video" || it.k === "image") {
      var bd = it.bd ? JSON.parse(JSON.stringify(it.bd)) : { w: 0, col: "#ffffff", r: 0 };
      var updBd = function () { live({ bd: JSON.parse(JSON.stringify(bd)) }); };
      rangeField(body, t("p.border"), 0, 10, 0.5, bd.w, function (v) { return v.toFixed(1) + "%"; }, function (v) { bd.w = v; updBd(); });
      colorField(body, t("p.borderCol"), bd.col, false, function (v) { bd.col = v; if (!bd.w) bd.w = 1; updBd(); });
      rangeField(body, t("p.corners"), 0, 50, 1, bd.r, function (v) { return v + "%"; }, function (v) { bd.r = v; updBd(); });
    }
  }

  // ---------- 6a. Chroma key (green / blue screen) ----------
  var CK_GREEN = "#00b140", CK_BLUE = "#0047bb", picking = null;
  function panelChroma() {
    var it = selItem(), body = panel(t("ck.title"));
    var ck = it.ck ? JSON.parse(JSON.stringify(it.ck)) : { col: CK_GREEN, tol: 40, soft: 25, sp: 50 };
    var box = el("div", "ck-box");
    function upd() { live({ ck: JSON.parse(JSON.stringify(ck)) }); }
    checkField(body, t("ck.on"), !!it.ck, function (v) { live({ ck: v ? JSON.parse(JSON.stringify(ck)) : null }); box.hidden = !v; });
    body.appendChild(box);
    box.hidden = !it.ck;
    var f = el("div", "field");
    f.appendChild(el("span", "lbl", t("ck.color")));
    var row = el("div", "colors");
    var sw = el("span", "sw ck-now");
    sw.style.background = ck.col;
    row.appendChild(sw);
    [[CK_GREEN, t("ck.green")], [CK_BLUE, t("ck.blue")]].forEach(function (c) {
      var b = el("button", "chip", c[1]);
      b.type = "button";
      b.addEventListener("click", function () { ck.col = c[0]; sw.style.background = ck.col; pick.value = ck.col; upd(); });
      row.appendChild(b);
    });
    var pick = el("input");
    pick.type = "color"; pick.value = ck.col; setLabel(pick, t("ck.color"));
    pick.addEventListener("input", function () { ck.col = pick.value.toLowerCase(); sw.style.background = ck.col; upd(); });
    row.appendChild(pick);
    var pb = el("button", "btn", t("ck.pick"));
    pb.type = "button";
    pb.addEventListener("click", function () { upd(); closeDialog(); startPick(); });
    row.appendChild(pb);
    f.appendChild(row); box.appendChild(f);
    rangeField(box, t("ck.tol"), 0, 100, 1, ck.tol, function (v) { return v + "%"; }, function (v) { ck.tol = v; upd(); });
    rangeField(box, t("ck.soft"), 0, 100, 1, ck.soft, function (v) { return v + "%"; }, function (v) { ck.soft = v; upd(); });
    rangeField(box, t("ck.spill"), 0, 100, 1, ck.sp, function (v) { return v + "%"; }, function (v) { ck.sp = v; upd(); });
    body.appendChild(el("p", "hint small", t("ck.hint")));
  }
  // Pick the key colour: the preview shows the clip without its key
  // until the user taps the picture.
  function startPick() {
    var p = cur(), it = selItem();
    if (!p || !it || !player) return;
    if (player.playing()) player.pause();
    picking = { id: it.id };
    var shown = JSON.parse(JSON.stringify(p));
    delete shown.items[it.id].ck;
    player.setProject(shown);
    $("stage-wrap").classList.add("picking");
    showToast(t("ck.pickHint"));
  }
  function endPick(rgb) {
    var id = picking && picking.id;
    picking = null;
    $("stage-wrap").classList.remove("picking");
    if (player && cur()) player.setProject(cur());
    if (!id || !cur() || !cur().items[id]) return;
    if (rgb) {
      sel = id;
      var ck = cur().items[id].ck ? JSON.parse(JSON.stringify(cur().items[id].ck)) : { tol: 40, soft: 25, sp: 50 };
      ck.col = "#" + rgb.map(function (v) { return (v < 16 ? "0" : "") + v.toString(16); }).join("");
      edit({ ck: ck });
    }
    select(id);
    panelChroma();
  }
  // Average colour of a 5×5 patch of the preview under the pointer.
  function pickAt(e) {
    var cv = $("stage"), r = cv.getBoundingClientRect();
    var x = Math.round((e.clientX - r.left) / r.width * cv.width), y = Math.round((e.clientY - r.top) / r.height * cv.height);
    try {
      var c2 = document.createElement("canvas");
      c2.width = 5; c2.height = 5;
      var g = c2.getContext("2d", { willReadFrequently: true });
      g.drawImage(cv, x - 2, y - 2, 5, 5, 0, 0, 5, 5);
      var d = g.getImageData(0, 0, 5, 5).data, s = [0, 0, 0];
      for (var i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
      return s.map(function (v) { return Math.round(v / 25); });
    } catch (x2) { return null; }
  }

  // ---------- 6b. Reframe: keep the subject in a cropped picture ----------
  function panelReframe() {
    var it = selItem(), p = cur();
    if (!it || !p) return;
    var pl = C.placeOf(p, it.id);
    if (tNow < pl.start || tNow > pl.end) setTime(pl.start);
    var local = Math.min(pl.end - pl.start, Math.max(0, tNow - pl.start)), mt = C.mediaTime(it, local);
    var body = panel(t("rf.title"));
    body.appendChild(el("p", "hint small", t("rf.hint")));
    var info = el("p", "hint");
    body.appendChild(info);
    function showInfo() { var n = (selItem().fc || []).length; info.textContent = n ? t("rf.keys", { n: n }) : t("rf.none"); }
    showInfo();
    // the sliders work in the picture as shown (after rotate / mirror)
    var f = C.fcAt(it.fc, mt), shown = C.shownPoint(f.x, f.y, it.rot, it.fl), pt = { x: shown[0], y: shown[1] };
    function set() {
      var cur0 = selItem(), uv = C.uvOf(pt.x, pt.y, cur0.rot, cur0.fl);
      live({ fit: "fill", fc: C.fcSet(cur0.fc, mt, { x: uv[0], y: uv[1] }, 0.25) });
      showInfo();
    }
    var pct = function (v) { return v + "%"; };
    rangeField(body, t("rf.x"), 0, 100, 1, Math.round(pt.x * 100), pct, function (v) { pt.x = v / 100; set(); });
    rangeField(body, t("rf.y"), 0, 100, 1, Math.round(pt.y * 100), pct, function (v) { pt.y = v / 100; set(); });
    body.appendChild(el("p", "hint small", t(window.MontageReframe && MontageReframe.hasFaceDetector() ? "rf.faces" : "rf.motion")));
    actions(body, [
      [t("rf.clear"), "", function () { live({ fc: [] }); closeDialog(); }],
      [t("rf.auto"), "primary", function () { var id = sel; closeDialog(); autoReframe([id]); }]
    ]);
  }
  // Auto reframe some clips, one after the other, as one undo step.
  function autoReframe(ids) {
    if (!window.MontageReframe || !ids.length) return;
    if (player && player.playing()) player.pause();
    var stop = false, done = 0, lastKeys = 0, cancel = function () { stop = true; };
    pushUndo();
    ids.reduce(function (ch, id, i) {
      return ch.then(function () {
        var it = cur() && cur().items[id];
        if (stop || !it || (it.k !== "video" && it.k !== "image")) return;
        var pre = ids.length > 1 ? (i + 1) + "/" + ids.length + " · " : "";
        busy(pre + t("rf.working", { p: 0 }), 0, cancel);
        return MM.get(it.src).then(function (blob) {
          if (!blob) throw new Error("missing");
          return MontageReframe.analyse({
            blob: blob, kind: it.k, "in": it["in"] || 0, out: it.out || 0,
            progress: function (q) { busy(pre + t("rf.working", { p: Math.round(q * 100) }), q, cancel); },
            cancelled: function () { return stop; }
          });
        }).then(function (keys) {
          if (stop || !cur() || !cur().items[id]) return;
          commit(C.setItem(data, pid, id, { fit: "fill", fc: keys }, Date.now()), { undo: false });
          done++; lastKeys = keys.length;
        }, function (e) { if (!stop) showToast(t("rf.fail")); });
      });
    }, Promise.resolve()).then(function () {
      busy(null);
      if (undoStack.length && undoStack[undoStack.length - 1] === snapshot()) undoStack.pop();
      refreshEditor();
      if (done) showToast(ids.length > 1 ? t("rf.allDone", { n: done }) : t("rf.done", { n: lastKeys }));
    });
  }

  // ---------- 6c. Reduce noise (RNNoise) ----------
  function panelNoise() {
    var it = selItem(), body = panel(t("nr.title"));
    body.appendChild(el("p", "hint small", t("nr.hint")));
    if (it.na) {
      body.appendChild(el("p", "hint", t("nr.on")));
      actions(body, [[t("nr.off"), "", function () { live({ na: null }); closeDialog(); }]]);
    } else {
      actions(body, [[t("nr.go"), "primary", function () { var id = sel; closeDialog(); cleanSound(id); }]]);
    }
  }
  function cleanSound(id) {
    var p = cur(), it = p && p.items[id];
    if (!it || !window.MontageDenoise) return;
    if (player && player.playing()) player.pause();
    // the same file cleaned already (another clip of it)
    var have = null;
    Object.keys(p.items).forEach(function (k) { if (p.items[k].src === it.src && p.items[k].na) have = p.items[k].na; });
    if (have) { sel = id; edit({ na: have }); showToast(t("nr.done")); return; }
    var stop = false, cancel = function () { stop = true; };
    busy(t("nr.working", { p: 0 }), 0, cancel);
    MM.get(it.src).then(function (blob) {
      if (!blob) throw new Error("missing");
      return MontageDenoise.clean(blob, {
        name: p.name, cancelled: function () { return stop; },
        progress: function (q) { busy(t("nr.working", { p: Math.round(q * 100) }), q, cancel); }
      });
    }).then(function (file) {
      busy(null);
      pushUndo();
      importMany([file], function (info) {
        if (!cur() || !cur().items[id] || !C.isSound(info.id)) return;
        sel = id;
        commit(C.setItem(data, pid, id, { na: info.id }, Date.now()), { undo: false });
        showToast(t("nr.done"));
      });
    }, function (e) {
      busy(null);
      if (stop) return;
      showToast(e && e.code === "nosound" ? t("toast.noSound") : t("nr.fail"));
    });
  }
  // Keyframes: the values at the playhead; changing one sets a key there.
  function panelKeys() {
    var it = selItem(), p = cur();
    if (!it || !p) return;
    var pl = C.placeOf(p, it.id), dur = pl.end - pl.start;
    if (tNow < pl.start || tNow > pl.end) setTime(pl.start);
    var local = Math.min(dur, Math.max(0, tNow - pl.start)), body = panel(t("tool.kf"));
    function keyAt() { return (selItem().kf || []).filter(function (k) { return Math.abs(k.t - local) <= 1 / 120; })[0] || null; }
    function go(tt) { closeDialog(); setTime(pl.start + Math.min(dur, Math.max(0, tt))); panelKeys(); }
    var info = el("p", "hint");
    body.appendChild(info);
    function showInfo() {
      info.textContent = t("kf.at", { t: C.fmtTime(local, true, p.fps) }) + " · " + t(keyAt() ? "kf.here" : "kf.none");
      var btn = body.querySelector(".actions .btn.primary");
      if (btn) btn.textContent = t(keyAt() ? "kf.del" : "kf.add");
    }
    showInfo();
    var keys = it.kf || [];
    var prev = keys.filter(function (k) { return k.t < local - 1 / 120; }).pop(), next = keys.filter(function (k) { return k.t > local + 1 / 120; })[0];
    var nav = el("div", "actions kf-nav");
    [[t("kf.prev"), prev ? function () { go(prev.t); } : null], [t("kf.back"), function () { go(local - 0.5); }],
     [t("kf.fwd"), function () { go(local + 0.5); }], [t("kf.next"), next ? function () { go(next.t); } : null]].forEach(function (a) {
      var b = el("button", "btn", a[0]); b.type = "button";
      if (a[1]) b.addEventListener("click", a[1]); else b.disabled = true;
      nav.appendChild(b);
    });
    body.appendChild(nav);
    var v = C.kfAt(it, local), props = C.kfProps(it);
    function set(k, val) {
      var cur0 = selItem(), vals = {};
      vals[k] = val;
      if (!keyAt() && (cur0.kf || []).length >= C.MAX_KEYS) { showToast(t("kf.full", { n: C.MAX_KEYS })); return; }
      live({ kf: C.kfSet(cur0, local, vals) });
      showInfo();
    }
    var pct = function (x) { return Math.round(x) + "%"; };
    if (props.indexOf("x") >= 0) {
      rangeField(body, t("kf.x"), -100, 100, 1, Math.round(v.x * 100), pct, function (x) { set("x", x / 100); });
      rangeField(body, t("kf.y"), -100, 100, 1, Math.round(v.y * 100), pct, function (x) { set("y", x / 100); });
      rangeField(body, t("kf.s"), 10, 400, 1, Math.round(v.s * 100), pct, function (x) { set("s", x / 100); });
      rangeField(body, t("kf.o"), 0, 100, 1, Math.round(v.o), pct, function (x) { set("o", x); });
    }
    if (props.indexOf("v") >= 0) rangeField(body, t("kf.v"), 0, 200, 1, Math.round(v.v), pct, function (x) { set("v", x); });
    body.appendChild(el("p", "hint small", t("kf.hint")));
    actions(body, [
      [t("kf.clear"), "", function () { live({ kf: [] }); go(local); }],
      [t("kf.add"), "primary", function () {
        var cur0 = selItem();
        if (!keyAt() && (cur0.kf || []).length >= C.MAX_KEYS) { showToast(t("kf.full", { n: C.MAX_KEYS })); return; }
        live({ kf: C.kfSet(cur0, local, keyAt() ? null : {}) });
        go(local);
      }]
    ]);
    showInfo();
  }
  var COLORS = ["#ffffff", "#000000", "#f8d14a", "#f08c3a", "#e04848", "#e868b0", "#7c5cf0", "#3b82f6", "#2fb87e", "#7a7a7a"];
  function panelText(isNew) {
    var it = selItem(), body = panel(t("tool.text")), tx = JSON.parse(JSON.stringify(it.text));
    if (isNew) undoStack.pop();                      // the add itself is the undo point
    function upd() { live({ text: JSON.parse(JSON.stringify(tx)) }); }
    var ta = el("textarea"); ta.id = "tx-text"; ta.value = tx.t; ta.maxLength = 500;
    var f = el("div", "field"), lb = el("label", null, t("p.text")); lb.htmlFor = "tx-text";
    f.appendChild(lb); f.appendChild(ta); body.appendChild(f);
    ta.addEventListener("input", function () { tx.t = ta.value; upd(); });
    chipField(body, t("p.font"), ["sans", "serif", "mono", "display"].map(function (k) { return [k, t("font." + k)]; }), tx.f, function (v) { tx.f = v; upd(); });
    rangeField(body, t("p.textSize"), 2, 30, 0.5, tx.sz, function (v) { return v.toFixed(1); }, function (v) { tx.sz = v; upd(); });
    colorField(body, t("p.color"), tx.col, false, function (v) { tx.col = v; upd(); });
    colorField(body, t("p.outline"), tx.ol, true, function (v) { tx.ol = v; upd(); });
    colorField(body, t("p.box"), tx.bx, true, function (v) { tx.bx = v; upd(); });
    chipField(body, t("p.align"), [["l", t("al.l")], ["c", t("al.c")], ["r", t("al.r")]], tx.al, function (v) { tx.al = v; upd(); });
    chipField(body, t("p.anim"), C.ANIMS.map(function (a) { return [a, t("an." + a)]; }), tx.an, function (v) { tx.an = v; upd(); });
    setTimeout(function () { ta.focus(); if (isNew) ta.select(); }, 30);
  }
  function panelTitleBg() {
    var it = selItem(), body = panel(t("tool.bg"));
    colorField(body, t("p.bgColor"), it.bg, false, function (v) { live({ bg: v }); });
  }

  // ---------- 7. Adding media, text, sound ----------
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function localPickFiles(accept, multi) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept; inp.multiple = !!multi;
      inp.addEventListener("change", function () { resolve(inp.files && inp.files.length ? [].slice.call(inp.files) : null); });
      inp.addEventListener("cancel", function () { resolve(null); });
      inp.click();
    });
  }
  function pickFiles(accept, multi) {
    var dlg = dialogHost();
    if (dlg && multi && typeof dlg.openFiles === "function") return dlg.openFiles(accept);
    if (dlg && typeof dlg.openFile === "function") return dlg.openFile(accept).then(function (f) { return f ? [f] : null; });
    return localPickFiles(accept, multi);
  }
  var ACCEPT_PIC = "video/*,image/*,.mp4,.webm,.mov,.m4v,.mkv,.jpg,.jpeg,.png,.webp,.gif";
  var ACCEPT_SND = "audio/*,video/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.weba,.mp4,.webm";

  function errText(e) {
    var c = e && (e.code || e.message);
    return ({ type: t("err.type"), decode: t("err.decode"), big: t("err.big"), full: t("err.full") })[c] || t("err.fail");
  }
  // Files → media → clips, one after the other.
  function importMany(files, place) {
    var added = [];
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        var name = String(f.name || "").slice(0, 40);
        busy(t("imp.working", { n: name }), 0);
        return MM.importFile(f, function (q) { busy(t("imp.hashing", { n: name, p: Math.round(q * 100) }), q); }).then(function (info) {
          added.push(info);
          place(info);
        }, function (e) { showToast(errText(e)); });
      });
    });
    return chain.then(function () { busy(null); missingCache = {}; return added; });
  }
  function clipFrom(info, tr, extra) {
    var it = { id: uid(), k: info.kind === "image" ? "image" : (tr === "a1" || tr === "a2" ? "audio" : info.kind), tr: tr, src: info.id };
    if (info.kind === "video" || info.kind === "audio") { it.len = info.len; it["in"] = 0; it.out = info.len; }
    else it.d = 4;
    Object.keys(extra || {}).forEach(function (k) { it[k] = extra[k]; });
    return it;
  }
  function addMedia(tr) {
    if (!cur()) return;
    pickFiles(ACCEPT_PIC, tr === "main").then(function (files) {
      if (!files || !files.length) return;
      pushUndo();
      var after = clipAt(tNow) || (function () { var s = C.mainSeq(cur()); var a = null; s.forEach(function (x) { if (x.start <= tNow) a = x.it.id; }); return a; })();
      var first = null;
      importMany(files, function (info) {
        if (info.kind === "audio") { placeSound(info); return; }
        var it = tr === "main" ? clipFrom(info, "main") : clipFrom(info, "ov", { at: tNow });
        var opts = tr === "main" ? { after: after === null && C.mainSeq(cur()).length ? null : (after || undefined) } : null;
        if (tr === "main" && after === null && !C.mainSeq(cur()).length) opts = null;
        data = C.addItem(data, pid, it, Date.now(), opts);
        if (tr === "main") after = it.id;
        if (!first) first = it.id;
        save();
        refreshEditor();
      }).then(function () {
        if (first) { var pl = C.placeOf(cur(), first); select(first); if (pl) setTime(pl.start); }
        refreshEditor();
      });
    });
  }
  function freeTrack(p, from, len) {
    var clash = function (tr) { return C.trackItems(p, tr).some(function (a) { return a.at < from + len && a.at + C.itemDur(a) > from; }); };
    return !clash("a1") ? "a1" : (!clash("a2") ? "a2" : "a1");
  }
  function placeSound(info) {
    var p = cur(), len = info.len || 1;
    var it = clipFrom(info, freeTrack(p, tNow, len), { at: tNow });
    it.k = "audio";
    data = C.addItem(data, pid, it, Date.now());
    save();
    refreshEditor();
    return it.id;
  }
  function addSound() {
    if (!cur()) return;
    pickFiles(ACCEPT_SND, false).then(function (files) {
      if (!files || !files.length) return;
      pushUndo();
      var id = null;
      importMany(files, function (info) { id = placeSound(info); }).then(function () { if (id) select(id); });
    });
  }
  function addText() {
    var p = cur();
    if (!p) return;
    var it = { id: uid(), k: "title", tr: "tt", at: tNow, d: 3, text: { t: t("text.default"), sz: 8, an: "rise" } };
    if (!commit(C.addItem(data, pid, it, Date.now()))) return;
    sel = it.id;
    refreshEditor();
    panelText(true);
  }

  // ---------- 7a. Subtitles: text clips on the Text row ⇄ SRT files ----------
  var SUB_MAX_BYTES = 2 * 1024 * 1024;
  function subtitlesDialog() {
    var p = cur();
    if (!p) return;
    if (player && player.playing()) player.pause();
    var n = C.trackItems(p, "tt").length, body = openDialog(t("sub.title"));
    body.appendChild(el("p", "hint", t("sub.count", { n: n })));
    body.appendChild(el("p", "hint small", t("sub.hint")));
    actions(body, [
      [t("sub.import"), "", function () { closeDialog(); importSubtitles(); }],
      [t("sub.export"), "", function () { closeDialog(); exportSubtitles(); }],
      [t("sub.add"), "primary", function () { closeDialog(); addSubtitle(); }]
    ]);
    if (!window.MontageASR || !MX.speech16k) return;
    // subtitles from speech (Whisper on the device)
    var f = el("div", "field");
    f.appendChild(el("span", "lbl", t("asr.head")));
    f.appendChild(el("p", "hint small", t("asr.hint")));
    var need = el("p", "hint small", t("asr.need", { mb: MontageASR.MODEL_MB, rt: MontageASR.RUNTIME_MB }));
    f.appendChild(need);
    body.appendChild(f);
    var lang = ["auto", "en", "el"].indexOf(prefs.asr) >= 0 ? prefs.asr : "auto";
    chipField(body, t("asr.lang"), [["auto", t("asr.auto")], ["en", "English"], ["el", "Ελληνικά"]], lang, function (v) {
      lang = v; prefs.asr = v; savePrefs();
    });
    var row = el("div", "actions");
    body.appendChild(row);
    var go = el("button", "btn primary", t("asr.go"));
    go.type = "button";
    go.addEventListener("click", function () { closeDialog(); autoSubtitles(lang); });
    row.appendChild(go);
    MontageASR.ready().then(function (yes) {
      if (!yes) return;
      need.textContent = t("asr.ready");
      var rm = el("button", "btn", t("asr.forget"));
      rm.type = "button";
      rm.addEventListener("click", function () {
        MontageASR.forget().then(function () { closeDialog(); showToast(t("asr.gone")); });
      });
      row.insertBefore(rm, go);
    });
  }
  function autoSubtitles(lang) {
    var p = cur();
    if (!p) return;
    if (!C.soundPlan(p).length) { showToast(t("asr.none")); return; }
    if (player && player.playing()) player.pause();
    var stop = false, ctl = typeof AbortController === "function" ? new AbortController() : null;
    var cancel = function () { stop = true; if (ctl) ctl.abort(); };
    var cancelled = function () { return stop; };
    var long = C.duration(p) > MX.SPEECH_MAX_SEC;
    busy(t("asr.mixing", { p: 0 }), 0, cancel);
    MX.speech16k({
      project: p, file: MM.get, cancelled: cancelled,
      progress: function (q) { busy(t("asr.mixing", { p: Math.round(q * 100) }), q, cancel); }
    }).then(function (samples) {
      return MontageASR.run(samples, {
        lang: lang, cancelled: cancelled, signal: ctl ? ctl.signal : undefined,
        progress: function (q, stage) {
          busy(t(stage === "download" ? "asr.download" : "asr.working", { p: Math.round(q * 100) }), q, cancel);
        }
      });
    }).then(function (r) {
      busy(null);
      if (stop || !cur()) return;
      var cues = r.cues || [];
      if (!cues.length) { showToast(t("asr.none")); return; }
      var before = Object.keys(cur().items).length;
      if (commit(C.addSubtitles(data, pid, cues, Date.now(), cues.map(function () { return uid(); })))) {
        showToast(t("sub.added", { n: Object.keys(cur().items).length - before }) + (long ? " · " + t("asr.long", { m: Math.round(MX.SPEECH_MAX_SEC / 60) }) : ""));
        setTime(cues[0].start);
      }
    }, function (e) {
      busy(null);
      if (stop) return;
      showToast(e && /^http|fetch|network/i.test(String(e.message || e)) ? t("asr.net") : t("asr.fail"));
    });
  }
  function addSubtitle() {
    var b = C.SUB_BOX;
    var it = { id: uid(), k: "title", tr: "tt", at: tNow, d: 2.5, box: { x: b.x, y: b.y, w: b.w, h: b.h },
      text: { t: t("text.default"), sz: 5.5, col: "#ffffff", ol: "#000000", an: "none" } };
    if (!commit(C.addItem(data, pid, it, Date.now()))) return;
    sel = it.id;
    refreshEditor();
    panelText(true);
  }
  function importSubtitles() {
    pickFiles(".srt,.vtt,text/plain,application/x-subrip,text/vtt", false).then(function (files) {
      var f = files && files[0];
      if (!f) return;
      if (f.size > SUB_MAX_BYTES) { showToast(t("sub.big")); return; }
      f.text().then(function (txt) {
        var cues = C.parseSrt(txt);
        if (!cues.length) { showToast(t("sub.none")); return; }
        var before = Object.keys(cur().items).length;
        if (commit(C.addSubtitles(data, pid, cues, Date.now(), cues.map(function () { return uid(); })))) {
          showToast(t("sub.added", { n: Object.keys(cur().items).length - before }));
          setTime(cues[0].start);
        }
      }, function () { showToast(t("err.fail")); });
    });
  }
  function exportSubtitles() {
    var p = cur(), srt = p ? C.toSrt(p) : "";
    if (!srt) { showToast(t("sub.empty")); return; }
    saveBlob(new Blob([srt], { type: "application/x-subrip" }), C.exportName(p.name, "srt"), "application/x-subrip", "srt");
  }

  // Freeze frame: the frame at the playhead (full size, from the file)
  // becomes a 2 s picture between the two halves of the clip.
  function freezeFrame() {
    var p = cur(), it = selItem();
    if (!p || !it || it.k !== "video" || it.tr !== "main") return;
    if (player && player.playing()) player.pause();
    var pl = C.placeOf(p, it.id), at = Math.min(Math.max(tNow, pl.start), pl.end - 1 / p.fps);
    var srcT = C.srcTime(it, at - pl.start), vid = it.id;
    busy(t("frz.working"), 0);
    MM.frameAt(it.src, srcT).then(function (png) {
      if (!png) { busy(null); showToast(t("frz.fail")); return; }
      var file = new File([png], C.exportName(p.name + " " + C.fmtTime(at).replace(/:/g, "-"), "png"), { type: "image/png" });
      var ids = { tail: uid(), still: uid() };
      importMany([file], function (info) {
        if (commit(C.freezeAt(data, pid, vid, at, info.id, 2, Date.now(), ids))) {
          var still = C.placeOf(cur(), ids.still);
          select(ids.still);
          if (still) setTime(still.start);
        }
      });
    }, function () { busy(null); showToast(t("frz.fail")); });
  }

  // ---------- 7c. Stickers (big emoji texts) and shapes ----------
  var STICKERS = ["😀", "😂", "😍", "😎", "🥳", "😮", "😢", "😡", "👍", "👏", "🙌", "❤️", "🔥", "⭐", "✨", "🎉",
    "🎂", "🎵", "📍", "☀️", "🌙", "🌊", "🌸", "🐶", "🐱", "⚽", "✈️", "🚗", "📷", "💡", "✅", "❗"];
  function shapesDialog() {
    var p = cur();
    if (!p) return;
    if (player && player.playing()) player.pause();
    var body = openDialog(t("shp.title"));
    body.appendChild(el("p", "hint small", t("shp.hint")));
    chipField(body, t("shp.shapes"), C.SHAPES.map(function (k) { return [k, t("shape." + k)]; }), null, function (k) { closeDialog(); addShape(k); });
    var f = el("div", "field"), grid = el("div", "stickers");
    f.appendChild(el("span", "lbl", t("shp.stickers")));
    STICKERS.forEach(function (e) {
      var b = el("button", "sticker", e);
      b.type = "button";
      b.addEventListener("click", function () { closeDialog(); addSticker(e); });
      grid.appendChild(b);
    });
    f.appendChild(grid); body.appendChild(f);
  }
  function placeBox(p, w, h) {
    // a square-looking box in the middle of the frame
    var sz = C.outputSize(p.ar, 1000), hh = h * sz.w / sz.h;
    return { x: 0.5 - w / 2, y: 0.5 - hh / 2, w: w, h: hh };
  }
  function addShape(k) {
    var p = cur(), it = { id: uid(), k: "shape", tr: "ov", at: tNow, d: 4, box: placeBox(p, 0.3, 0.3), sh: { k: k, col: k === "bubble" ? "#ffffff" : "#f8d14a", ol: k === "bubble" ? "#000000" : "", ow: k === "bubble" ? 3 : 0 } };
    if (k === "arrow") it.box = placeBox(p, 0.3, 0.15);
    if (!commit(C.addItem(data, pid, it, Date.now()))) return;
    select(it.id);
  }
  function addSticker(e) {
    var p = cur(), it = { id: uid(), k: "title", tr: "tt", at: tNow, d: 3, box: placeBox(p, 0.24, 0.24), text: { t: e, sz: 18, an: "pop" } };
    if (!commit(C.addItem(data, pid, it, Date.now()))) return;
    select(it.id);
  }
  function panelShape() {
    var it = selItem(), body = panel(t("tool.style")), sh = JSON.parse(JSON.stringify(it.sh));
    function upd() { live({ sh: JSON.parse(JSON.stringify(sh)) }); }
    chipField(body, t("shp.kind"), C.SHAPES.map(function (k) { return [k, t("shape." + k)]; }), sh.k, function (v) { sh.k = v; upd(); });
    colorField(body, t("shp.fill"), sh.col, true, function (v) { sh.col = v; upd(); });
    colorField(body, t("shp.outline"), sh.ol, true, function (v) { sh.ol = v; if (v && !sh.ow) sh.ow = 4; upd(); });
    rangeField(body, t("shp.width"), 0, 20, 1, sh.ow, function (v) { return v + "%"; }, function (v) { sh.ow = v; upd(); });
    rangeField(body, t("p.opacity"), 0, 100, 1, it.op, function (v) { return v + "%"; }, function (v) { live({ op: v }); });
  }

  // ---------- 7b. Voice-over: record the microphone while the project plays ----------
  // The take starts at the playhead and lands on the Voice row (Music
  // when Voice is taken there). MediaRecorder writes WebM/Opus (MP4/AAC
  // on Safari); the file goes through the normal import (hash, device
  // store), so it syncs and relinks like any other sound.
  function recMime() {
    var R = window.MediaRecorder;
    if (!R) return null;
    var list = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    for (var i = 0; i < list.length; i++) if (!R.isTypeSupported || R.isTypeSupported(list[i])) return list[i];
    return "";
  }
  function voiceTrack(p, from, len) {
    var clash = function (tr) { return C.trackItems(p, tr).some(function (a) { return a.at < from + len && a.at + C.itemDur(a) > from; }); };
    return !clash("a2") ? "a2" : (!clash("a1") ? "a1" : "a2");
  }
  function recordVoice() {
    var p = cur();
    if (!p) return;
    var mime = recMime();
    if (mime === null || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showToast(t("rec.none")); return; }
    if (player && player.playing()) player.pause();
    var body = openDialog(t("rec.title"));
    body.appendChild(el("p", "hint", t("rec.hint")));
    var big = el("p", "rec-time", "0:00.0"), meter = el("div", "rec-meter"), bar = el("i");
    meter.appendChild(bar); setLabel(meter, t("rec.level"));
    body.appendChild(big); body.appendChild(meter);
    var row = el("div", "actions"), btn = el("button", "btn primary", t("rec.start"));
    btn.type = "button"; btn.disabled = true;
    row.appendChild(btn); body.appendChild(row);

    var stream = null, actx = null, an = null, raf = 0, rec = null, chunks = [], startAt = 0, wall0 = 0, timer = 0, count = 0, closed = false, took = 0;
    function cleanup() {
      closed = true;
      cancelAnimationFrame(raf); clearInterval(timer); clearTimeout(count);
      if (rec && rec.state !== "inactive") { try { rec.onstop = null; rec.stop(); } catch (e) {} }
      if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); });
      if (actx) { try { actx.close(); } catch (e) {} }
      if (player && player.playing()) player.pause();
    }
    onDialogClose = cleanup;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) {
      if (closed) { s.getTracks().forEach(function (tr) { tr.stop(); }); return; }
      stream = s;
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        an = actx.createAnalyser(); an.fftSize = 1024;
        actx.createMediaStreamSource(s).connect(an);
        var buf = new Float32Array(an.fftSize);
        (function level() {
          an.getFloatTimeDomainData(buf);
          var peak = 0;
          for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
          bar.style.width = Math.min(100, Math.round(Math.sqrt(peak) * 100)) + "%";
          bar.classList.toggle("hot", peak > 0.9);
          raf = requestAnimationFrame(level);
        })();
      } catch (e) { an = null; }
      btn.disabled = false;
    }, function () { closeDialog(); showToast(t("rec.denied")); });

    btn.addEventListener("click", function () {
      if (rec) { stop(); return; }
      // 3-2-1, then record and play together
      btn.disabled = true;
      var n = 3;
      big.textContent = String(n);
      (function tick() {
        count = setTimeout(function () {
          if (closed) return;
          if (--n > 0) { big.textContent = String(n); tick(); return; }
          start();
        }, 700);
      })();
    });
    function start() {
      try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
      catch (e) { closeDialog(); showToast(t("rec.none")); return; }
      chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstart = function () {
        startAt = tNow; wall0 = performance.now();
        if (player && duration() > tNow + 0.05) player.play();
        btn.disabled = false; btn.textContent = t("rec.stop"); btn.classList.add("danger");
        timer = setInterval(function () { var sec = (performance.now() - wall0) / 1000; big.textContent = C.fmtTime(sec) + "." + Math.floor((sec % 1) * 10); }, 100);
      };
      rec.onstop = finish;
      rec.start(1000);
    }
    function stop() {
      btn.disabled = true;
      took = (performance.now() - wall0) / 1000;
      clearInterval(timer);
      if (player && player.playing()) player.pause();
      try { rec.stop(); } catch (e) { finish(); }
    }
    function finish() {
      var type = (rec && rec.mimeType) || mime || "audio/webm";
      var blob = new Blob(chunks, { type: type.split(";")[0] });
      var at = startAt, len = took;
      closeDialog();
      if (!blob.size || len < C.MIN) return;
      var ext = /mp4/.test(type) ? "m4a" : (/ogg/.test(type) ? "ogg" : "weba");
      var file = new File([blob], t("rec.name", { n: new Date().toTimeString().slice(0, 5) }) + "." + ext, { type: blob.type });
      pushUndo();
      importMany([file], function (info) {
        if (!(info.len > 0) || !isFinite(info.len)) info.len = len;  // recorder files may carry no duration
        var it = clipFrom(info, voiceTrack(cur(), at, info.len), { at: at });
        it.k = "audio";
        data = C.addItem(data, pid, it, Date.now());
        save();
        refreshEditor();
        select(it.id);
        setTime(at);
      });
    }
  }

  // Grab frame: the frame at the playhead → Files › Pictures as PNG,
  // then Photo Lab opens it (aligned with its plan §6).
  function grabFrame() {
    var p = cur();
    if (!p || !player) return;
    if (player.playing()) player.pause();
    MX.still({ project: p, file: MM.get, t: tNow, short: 1080 }).then(null, function () { return null; }).then(function (png) {
      if (!png) { showToast(t("err.fail")); return; }
      var name = C.exportName(p.name + " " + C.fmtTime(tNow).replace(/:/g, "-"), "png");
      var F = fsApi();
      if (!F) { saveBlob(png, name, "image/png", "png"); return; }
      var base = name.replace(/\.png$/, ""), n = 1;
      (function tryName() {
        var path = "/internal/Pictures/" + (n === 1 ? name : base + " (" + n + ").png");
        F.stat(path).then(function () { n++; if (n < 100) tryName(); }, function () {
          F.write(path, png).then(function () {
            showToast(t("toast.grabbed"));
            try { if (window.parent && window.parent !== window && typeof window.parent.__orosOpenAt === "function") window.parent.__orosOpenAt("photolab", { openFile: path }); } catch (e) {}
          }, function () { showToast(t("toast.saveFail")); });
        });
      })();
    });
  }

  // ---------- 8. Project settings, media, relink ----------
  function projectSettings() {
    var p = cur();
    if (!p) return;
    var body = panel(t("set.title"));
    var name = textField(body, "ps-name", t("f.name"), p.name);
    name.addEventListener("change", function () { commit(C.setProject(data, pid, { name: name.value }, Date.now()), { undo: false }); });
    chipField(body, t("f.ratio"), C.RATIOS.map(function (r) { return [r, t("ratio." + r)]; }), p.ar, function (v) { commit(C.setProject(data, pid, { ar: v }, Date.now()), { undo: false }); });
    chipField(body, t("f.fps"), [[30, "30"], [60, "60"]], p.fps, function (v) { commit(C.setProject(data, pid, { fps: v }, Date.now()), { undo: false }); });
    colorField(body, t("set.bg"), p.bg, false, function (v) { commit(C.setProject(data, pid, { bg: v }, Date.now()), { undo: false }); });
    var dk = p.dk || 0;
    chipField(body, t("set.duck"), [0, 40, 60, 80].map(function (v) { return [v, t("duck." + v)]; }), [0, 40, 60, 80].indexOf(dk) >= 0 ? dk : 60,
      function (v) { commit(C.setProject(data, pid, { dk: v }, Date.now()), { undo: false }); });
    body.appendChild(el("p", "hint small", t("set.duckHint")));
    var mainPics = C.trackItems(p, "main").filter(function (it) { return it.k === "video" || it.k === "image"; });
    if (mainPics.length) {
      body.appendChild(el("p", "hint small", t("set.reframeHint")));
      actions(body, [[t("set.reframe"), "", function () { closeDialog(); autoReframe(mainPics.map(function (it) { return it.id; })); }]]);
    }
    checkField(body, t("set.sync"), p.vs, function (v) {
      commit(C.setProject(data, pid, { vs: v }, Date.now()), { undo: false });
      if (v) shareMedia();
    });
    body.appendChild(el("p", "hint small", t("set.syncHint")));
    var mh = el("div", "field");
    mh.appendChild(el("span", "lbl", t("set.media")));
    var list = el("div");
    mh.appendChild(list);
    body.appendChild(mh);
    C.mediaOf(p).forEach(function (id) {
      var row = el("div", "media-row"), nm = el("span", "nm", kindOf(id) + " · " + id.slice(0, 8));
      var st = el("span", "hint small", "…");
      row.appendChild(nm); row.appendChild(st);
      list.appendChild(row);
      MM.get(id).then(function (b) {
        if (b) {
          st.textContent = t("set.ok") + " · " + fmtMB(b.size);
          MM.proxy(id).then(function (px) { if (px) st.textContent += " · " + t("px.has"); });
          return;
        }
        st.textContent = t("set.missing");
        st.className = "hint small";
        var rb = el("button", "btn", t("btn.relink"));
        rb.type = "button";
        rb.addEventListener("click", function () { relink(id); });
        row.appendChild(rb);
      });
    });
    if (C.mediaOf(p).some(C.isVideo)) {
      var pf = el("div", "field");
      pf.appendChild(el("span", "lbl", t("px.title")));
      pf.appendChild(el("p", "hint small", t("px.hint")));
      body.appendChild(pf);
      actions(body, [[t("px.drop"), "", function () {
        MM.dropProxies().then(function (n) { if (player) player.retry(); showToast(t("px.dropped", { n: n })); });
      }], [t("px.make"), "", function () { closeDialog(); makeLightCopies(); }]]);
    }
    body.appendChild(el("p", "hint small", t("set.cleanHint")));
    actions(body, [[t("btn.clean"), "", function () {
      var used = {};
      Object.keys(data.projects).forEach(function (k) { C.mediaOf(data.projects[k]).forEach(function (i) { used[i] = 1; }); });
      MM.cleanUnused(Object.keys(used)).then(function (n) { showToast(t("toast.cleaned", { n: n })); });
    }]]);
  }
  // Light copies of the project's videos, one after the other.
  function makeLightCopies() {
    var p = cur();
    if (!p) return;
    var vids = C.mediaOf(p).filter(C.isVideo), made = 0, stop = false, sig = {};
    var cancel = function () { stop = true; if (sig.cancel) sig.cancel(); };
    vids.reduce(function (ch, id, i) {
      return ch.then(function () {
        if (stop) return;
        busy(t("px.working", { i: i + 1, n: vids.length, p: 0 }), 0, cancel);
        return MM.makeProxy(id, function (f) { busy(t("px.working", { i: i + 1, n: vids.length, p: Math.round(f * 100) }), f, cancel); }, sig)
          .then(function (r) { if (r === "made") made++; }, function () {});
      });
    }, Promise.resolve()).then(function () {
      busy(null);
      if (player) player.retry();
      showToast(stop ? t("px.stopped") : (made ? t("px.done", { n: made }) : t("px.none")));
    });
  }
  function kindOf(id) {
    if (C.isPicture(id)) return t("kind.image");
    if (C.isVideo(id)) return t("kind.video");
    return t("kind.audio");
  }
  function shareMedia() {
    var p = cur();
    if (!p) return;
    showToast(t("toast.synced"));
    C.mediaOf(p).reduce(function (ch, id) { return ch.then(function () { return MM.share(id); }); }, Promise.resolve()).then(null, function () {});
  }
  function relink(id) {
    pickFiles(C.isSound(id) ? ACCEPT_SND : ACCEPT_PIC, false).then(function (files) {
      if (!files || !files.length) return;
      busy(t("imp.working", { n: files[0].name || "" }), 0);
      MM.relink(id, files[0], function (q) { busy(t("imp.hashing", { n: files[0].name || "", p: Math.round(q * 100) }), q); }).then(function (info) {
        busy(null);
        if (!info.same) commit(C.replaceSrc(data, pid, id, info.id, info.len, Date.now()));
        missingCache = {}; thumbCache = {};
        if (player) player.retry();
        closeDialog();
        showToast(t("toast.relinked"));
      }, function (e) { busy(null); showToast(errText(e)); });
    });
  }

  // ---------- 9. Export ----------
  var exportCancel = false, lastExport = null;
  function exportDialog() {
    var p = cur();
    if (!p) return;
    if (!Object.keys(p.items).length) { showToast(t("exp.empty")); return; }
    if (player && player.playing()) player.pause();
    var body = openDialog(t("exp.title"));
    var sizes = [[720, "720p"], [1080, "1080p"], [2160, t("exp.k4")]], sizeRow = null, keep = null;
    chipField(body, t("exp.what"), [["video", t("exp.video")], ["sound", t("exp.sound")], ["gif", t("exp.gif")]], prefs.what, function (v) { prefs.what = v; savePrefs(); show(); });
    sizeRow = chipField(body, t("exp.size"), sizes, prefs.short, function (v) { prefs.short = v; savePrefs(); });
    var gifRow = chipField(body, t("exp.gifSize"), [[320, t("exp.gifSmall")], [480, t("exp.gifMedium")]], prefs.gif, function (v) { prefs.gif = v; savePrefs(); });
    var gifHint = el("p", "hint small", t("exp.gifHint"));
    body.appendChild(gifHint);
    keep = checkField(body, t("exp.keep"), prefs.keep, function (v) { prefs.keep = v; savePrefs(); });
    function show() {
      sizeRow.parentNode.hidden = prefs.what !== "video";
      gifRow.parentNode.hidden = gifHint.hidden = prefs.what !== "gif";
      keep.nextSibling.textContent = t(prefs.what === "sound" ? "exp.keepSound" : (prefs.what === "gif" ? "exp.keepGif" : "exp.keep"));
    }
    show();
    if (!fsApi()) keep.closest(".check").hidden = true;
    actions(body, [[t("exp.go"), "primary", runExport]]);
  }
  function fsApi() {
    try { return (window.parent && window.parent.orosFS) || window.orosFS || null; }
    catch (e) { return window.orosFS || null; }
  }
  function runExport() {
    var p = cur(), sound = prefs.what === "sound", gif = prefs.what === "gif";
    closeDialog();
    if (sound && !C.soundPlan(p).length) { showToast(t("exp.noSound")); return; }
    if (gif && C.duration(p) > MX.GIF_MAX_SEC + 0.01) { showToast(t("exp.gifLong")); return; }
    var size = C.outputSize(p.ar, prefs.short);
    (gif ? Promise.resolve({ ext: "gif" }) : sound ? MX.pickSoundFormat() : MX.pickFormat(size.w, size.h)).then(function (fmt) {
      if (!fmt) { showToast(t("exp.noCodec")); return; }
      exportCancel = false;
      busy(t("exp.working", { p: 0 }), 0, function () { exportCancel = true; });
      var lock = null;
      try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (l) { lock = l; }, function () {}); } catch (e) {}
      return MX.run({
        project: p, short: prefs.short, file: MM.get, soundOnly: sound, gif: gif, gifSide: prefs.gif,
        progress: function (f) { busy(t("exp.working", { p: Math.round(f * 100) }), f, function () { exportCancel = true; }); },
        cancelled: function () { return exportCancel; }
      }).then(function (r) {
        busy(null);
        if (lock) lock.release().then(null, function () {});
        var name = C.exportName(p.name, r.ext);
        lastExport = { blob: r.blob, name: name, mime: r.mime, ext: r.ext, sound: sound, gif: gif };
        if (prefs.keep) keepInFiles(lastExport);
        exportReady();
      }, function (e) {
        busy(null);
        if (lock) lock.release().then(null, function () {});
        showToast(e && e.message === "cancelled" ? t("toast.cancelled") : t("toast.fail", { e: (e && e.message) || e }));
      });
    });
  }
  function keepInFiles(x) {
    var F = fsApi();
    if (!F) return;
    var base = x.name.replace(/\.[^.]+$/, ""), n = 1;
    function tryName() {
      var path = (x.sound ? "/internal/Music/" : (x.gif ? "/internal/Pictures/" : "/internal/Videos/")) + (n === 1 ? x.name : base + " (" + n + ")." + x.ext);
      return F.stat(path).then(function () { n++; return n < 100 ? tryName() : null; }, function () {
        return F.write(path, x.blob).then(function () { showToast(t(x.sound ? "toast.keptSound" : (x.gif ? "toast.keptGif" : "toast.kept"))); });
      });
    }
    tryName().then(null, function () { showToast(t("toast.saveFail")); });
  }
  function exportReady() {
    var x = lastExport, body = openDialog(t(x.sound ? "exp.readySound" : (x.gif ? "exp.readyGif" : "exp.ready")));
    body.appendChild(el("p", "hint", t("exp.readyHint", { f: x.name, s: fmtMB(x.blob.size) })));
    var v = el(x.sound ? "audio" : (x.gif ? "img" : "video"));
    v.style.width = "100%";
    if (x.gif) { v.alt = x.name; v.play = function () { return Promise.resolve(); }; v.pause = function () {}; }
    else v.controls = true;
    if (!x.sound && !x.gif) { v.playsInline = true; v.style.borderRadius = "8px"; v.style.background = "#000"; }
    var u = URL.createObjectURL(x.blob);
    v.src = u; v.hidden = true;
    body.appendChild(v);
    onDialogClose = function () { v.pause(); v.removeAttribute("src"); URL.revokeObjectURL(u); };
    actions(body, [
      [t("btn.playVideo"), "", function () { v.hidden = false; v.play().then(null, function () {}); }],
      [t("btn.save"), "primary", function () { saveBlob(x.blob, x.name, x.mime, x.ext); }]
    ]);
  }
  function saveBlob(blob, name, mime, ext) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      var acc = {}; acc[mime] = ["." + ext];
      dlg.saveFile({ blob: blob, filename: name, mime: mime, types: [{ description: ext.toUpperCase(), accept: acc }] })
        .then(function (r) { if (r && r.ok) showToast(t("toast.saved")); });
      return;
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 40000);
  }

  // ---------- dialogs, fields, busy, toasts ----------
  var onDialogClose = null, lastFocus = null;
  function openDialog(title) {
    closeDialog();
    lastFocus = document.activeElement;
    $("dlg-title").textContent = title;
    var body = $("dlg-body");
    body.innerHTML = "";
    $("dlg").hidden = false; $("scrim").hidden = false;
    setTimeout(function () { var f = body.querySelector("input,textarea,button"); if (f && !$("dlg").hidden && document.activeElement === document.body) f.focus(); }, 0);
    return body;
  }
  function closeDialog() {
    if ($("dlg").hidden) return;
    $("dlg").hidden = true; $("scrim").hidden = true;
    var f = onDialogClose; onDialogClose = null;
    if (f) f();
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }
  var fieldN = 0;
  function textField(body, id, label, value) {
    var f = el("div", "field"), lb = el("label", null, label), inp = el("input");
    inp.type = "text"; inp.id = id; inp.value = value || ""; inp.maxLength = 80; lb.htmlFor = id;
    f.appendChild(lb); f.appendChild(inp); body.appendChild(f);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { var b = $("dlg-body").querySelector(".actions .primary"); if (b) b.click(); } });
    return inp;
  }
  function rangeField(body, label, min, max, step, value, fmt, onInput) {
    var id = "rf" + (++fieldN), f = el("div", "field"), lb = el("label", null, label);
    var row = el("div", "range-row"), inp = el("input"), out = el("output");
    inp.type = "range"; inp.id = id; inp.min = min; inp.max = max; inp.step = step; inp.value = value; lb.htmlFor = id;
    out.textContent = fmt(+value);
    inp.addEventListener("input", function () { out.textContent = fmt(+inp.value); onInput(+inp.value); });
    row.appendChild(inp); row.appendChild(out);
    f.appendChild(lb); f.appendChild(row); body.appendChild(f);
    return inp;
  }
  function chipField(body, label, opts, value, onPick) {
    var f = el("div", "field");
    if (label) f.appendChild(el("span", "lbl", label));
    var row = el("div", "chips");
    opts.forEach(function (o) {
      var b = el("button", "chip", o[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", String(o[0] === value));
      b.addEventListener("click", function () {
        [].forEach.call(row.children, function (c) { c.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        onPick(o[0]);
      });
      row.appendChild(b);
    });
    f.appendChild(row); body.appendChild(f);
    return row;
  }
  function checkField(body, label, value, onChange) {
    var id = "cf" + (++fieldN), lb = el("label", "check"), inp = el("input");
    inp.type = "checkbox"; inp.id = id; inp.checked = !!value; lb.htmlFor = id;
    lb.appendChild(inp); lb.appendChild(el("span", null, label));
    inp.addEventListener("change", function () { onChange(inp.checked); });
    body.appendChild(lb);
    return inp;
  }
  function colorField(body, label, value, allowNone, onPick) {
    var f = el("div", "field");
    f.appendChild(el("span", "lbl", label));
    var row = el("div", "colors"), list = (allowNone ? [""] : []).concat(COLORS);
    if (value && list.indexOf(value) < 0) list.push(value);
    list.forEach(function (c) {
      var b = el("button", "sw" + (c ? "" : " none"));
      b.type = "button";
      if (c) b.style.background = c;
      setLabel(b, c || t("col.none"));
      b.setAttribute("aria-pressed", String(c === (value || "")));
      b.addEventListener("click", function () {
        [].forEach.call(row.querySelectorAll(".sw"), function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        onPick(c);
      });
      row.appendChild(b);
    });
    var pick = el("input");
    pick.type = "color"; pick.value = value || "#ffffff"; setLabel(pick, label);
    pick.addEventListener("input", function () { onPick(pick.value.toLowerCase()); });
    row.appendChild(pick);
    f.appendChild(row); body.appendChild(f);
  }
  function actions(body, list) {
    var row = el("div", "actions");
    list.forEach(function (a) {
      var b = el("button", "btn" + (a[1] ? " " + a[1] : ""), a[0]);
      b.type = "button";
      b.addEventListener("click", a[2]);
      row.appendChild(b);
    });
    body.appendChild(row);
  }
  function busy(text, frac, onCancel) {
    if (text == null) { $("busy").hidden = true; return; }
    $("busy").hidden = false;
    $("busy-text").textContent = text;
    $("busy-prog").value = frac || 0;
    var c = $("busy-cancel");
    c.hidden = !onCancel;
    c.onclick = onCancel || null;
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" && n.transient({ ns: "montage", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  function undoToast(text, onUndo) { localToast(text, onUndo); }
  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    box.innerHTML = "";
    box.appendChild(el("span", null, text));
    if (onUndo) {
      var b = el("button", null, t("btn.undo"));
      b.type = "button";
      b.addEventListener("click", function () { box.classList.remove("show"); onUndo(); });
      box.appendChild(b);
    }
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 3500);
  }

  // ---------- 10. Keyboard (Contract Β) ----------
  function typing(e) {
    var n = e.target;
    return n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT" || n.isContentEditable);
  }
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (picking) { e.preventDefault(); endPick(null); return; }
        if (!$("dlg").hidden) { e.preventDefault(); closeDialog(); return; }
        if (sel) { e.preventDefault(); select(null); return; }
      }
      if (view !== "editor" || !$("dlg").hidden || typing(e) || e.altKey) return;
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.code === "KeyY") { e.preventDefault(); redo(); return; }
      if (mod) return;
      if (e.code === "Space" || e.code === "KeyK") { e.preventDefault(); if (player) player.toggle(); return; }
      if (e.code === "ArrowLeft") { e.preventDefault(); if (e.shiftKey) setTime(tNow - 1); else stepFrame(-1); return; }
      if (e.code === "ArrowRight") { e.preventDefault(); if (e.shiftKey) setTime(tNow + 1); else stepFrame(1); return; }
      if (e.code === "Home") { e.preventDefault(); setTime(0); return; }
      if (e.code === "End") { e.preventDefault(); setTime(duration()); return; }
      if (e.code === "KeyS") { e.preventDefault(); if (sel) splitClip(sel); else splitAtPlayhead(); return; }
      if ((e.code === "Delete" || e.code === "Backspace") && sel) { e.preventDefault(); deleteClip(); return; }
      if (e.code === "Equal" || e.code === "NumpadAdd") { e.preventDefault(); zoom(1.25); return; }
      if (e.code === "Minus" || e.code === "NumpadSubtract") { e.preventDefault(); zoom(0.8); return; }
    });
  }

  // ---------- 11. Sync slice + palette + deep link ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim", "--accent", "--accent-hover", "--accent-soft", "--panel-bg", "--border", "--shadow", "--danger"];
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
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function registerSync() {
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () { if (this._suppress) return; if (api && typeof api.markDirty === "function") api.markDirty(); }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("montage", sliceGet, sliceSet, STORAGE_KEY, C.merge);
  }
  function sliceGet() { return C.merge(data, null); }                  // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !incoming.projects || typeof incoming.projects !== "object") return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;                             // R6
    try {
      data = C.merge(incoming, null);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally { window.__orosSyncApi._suppress = false; }
    if (JSON.stringify(data) === before) return;
    if (view === "home") renderHome();
    else if (!gesture) { if (!cur()) { showToast(t("toast.notFound")); showHome(); } else refreshEditor(); }
  }

  // Deep link: { project } opens it; { openFile: "/internal/…" } adds
  // that orOS disk file, { openFile: { token } } a device file handed
  // over by the shell (BR-FILE-OPEN), to the open project (or to a new
  // one named after the file).
  function openTarget(target) {
    if (!target || typeof target !== "object") return;
    if (typeof target.project === "string") { if (data.projects[target.project]) openProject(target.project); else showToast(t("toast.notFound")); return; }
    var f = target.openFile;
    if (f && typeof f === "object" && typeof f.token === "string") {
      var file = null;
      try { file = window.parent.__orosTakeFile(f.token); } catch (e) {}
      if (file) addOpenedFile(file); else showToast(t("err.fail"));
      return;
    }
    if (typeof f === "string" && /^\/internal\//.test(f)) {
      var F = fsApi();
      if (!F) return;
      F.read(f).then(function (b) {
        var name = f.split("/").pop();
        addOpenedFile(b instanceof File ? b : new File([b], name, { type: b.type || "" }));
      }, function () { showToast(t("err.fail")); });
    }
  }
  function addOpenedFile(file) {
    if (view !== "editor" || !cur()) {
      var id = uid();
      data = C.newProject(data, { name: String(file.name || "").replace(/\.[^.]+$/, "") || t("proj.untitled") }, Date.now(), id);
      save();
      openProject(id);
    }
    pushUndo();
    importMany([file], function (info) {
      if (info.kind === "audio") { placeSound(info); return; }
      data = C.addItem(data, pid, clipFrom(info, "main"), Date.now());
      save(); refreshEditor();
    });
  }
  window.__orosOpenAt = function (target) { openTarget(target); };

  // ---------- 12. Wiring & boot ----------
  var SV = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>"; };
  var ICON = {
    back: SV('<path d="M15 18l-6-6 6-6"/>'),
    undo: SV('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    redo: SV('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
    settings: SV('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
    play: SV('<path d="M7 4l13 8-13 8z" fill="currentColor"/>'),
    pause: SV('<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>'),
    prev: SV('<path d="M18 6l-8 6 8 6V6zM6 6v12"/>'),
    next: SV('<path d="M6 6l8 6-8 6V6zM18 6v12"/>'),
    zin: SV('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4M8 11h6M11 8v6"/>'),
    zout: SV('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4M8 11h6"/>'),
    more: SV('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
    close: SV('<path d="M6 6l12 12M18 6L6 18"/>'),
    media: SV('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>'),
    overlay: SV('<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="8" width="6" height="5" rx="1"/>'),
    audio: SV('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
    text: SV('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
    split: SV('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>'),
    speed: SV('<path d="M12 21a9 9 0 1 1 9-9"/><path d="M12 12l5-3"/>'),
    volume: SV('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
    mute: SV('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>'),
    fade: SV('<path d="M3 20L10 6h4l7 14"/>'),
    transition: SV('<rect x="2" y="6" width="9" height="12" rx="1"/><rect x="13" y="6" width="9" height="12" rx="1"/><path d="M9 12h6"/>'),
    adjust: SV('<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>'),
    frame: SV('<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>'),
    move: SV('<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>'),
    palette: SV('<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/>'),
    detach: SV('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><path d="M3 3l18 18"/>'),
    copy: SV('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
    trash: SV('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
    clock: SV('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    tr_tt: SV('<path d="M5 6V4h14v2M12 4v16"/>'),
    tr_ov: SV('<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="8" width="6" height="5" rx="1"/>'),
    tr_main: SV('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>'),
    tr_a1: SV('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
    cc: SV('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3"/>'),
    freeze: SV('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 8v8M8.5 10l7 4M15.5 10l-7 4"/>'),
    kf: SV('<path d="M12 3l6 9-6 9-6-9z"/><path d="M2 12h3M19 12h3"/>'),
    reverse: SV('<path d="M20 7H8l3-3M8 7l3 3"/><path d="M4 17h12l-3-3M16 17l-3 3"/>'),
    shapes: SV('<circle cx="8" cy="8" r="5"/><rect x="11" y="11" width="10" height="10" rx="1"/>'),
    chroma: SV('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="10" r="2.6"/><path d="M7.5 20c.6-3.4 2.4-5.2 4.5-5.2s3.9 1.8 4.5 5.2"/>'),
    reframe: SV('<path d="M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4"/><rect x="9" y="7" width="6" height="10" rx="1"/>'),
    denoise: SV('<path d="M2 12h3l2-4 3 9 3-12 3 12 2-5h4"/>'),
    tr_a2: SV('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>')
  };

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) { n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria"))); });
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    document.title = t("app.name") + " · orOS";
    var icons = { "back-btn": ["back", "btn.back"], "undo-btn": ["undo", "btn.undo"], "redo-btn": ["redo", "btn.redo"], "proj-btn": ["settings", "btn.project"],
      "prev-btn": ["prev", "btn.prev"], "play-btn": ["play", "btn.play"], "next-btn": ["next", "btn.next"],
      "zin-btn": ["zin", "btn.zin"], "zout-btn": ["zout", "btn.zout"], "dlg-close": ["close", "btn.close"] };
    Object.keys(icons).forEach(function (k) { $(k).innerHTML = ICON[icons[k][0]]; setLabel($(k), t(icons[k][1])); });
    $("timeline").setAttribute("aria-label", t("a11y.timeline"));
  }

  function wire() {
    $("back-btn").addEventListener("click", showHome);
    $("new-btn").addEventListener("click", newProjectDialog);
    $("undo-btn").addEventListener("click", undo);
    $("redo-btn").addEventListener("click", redo);
    $("proj-btn").addEventListener("click", projectSettings);
    $("export-btn").addEventListener("click", exportDialog);
    $("first-add").addEventListener("click", function () { addMedia("main"); });
    $("play-btn").addEventListener("click", function () { if (player) player.toggle(); });
    $("prev-btn").addEventListener("click", function () { stepFrame(-1); });
    $("next-btn").addEventListener("click", function () { stepFrame(1); });
    $("zin-btn").addEventListener("click", function () { zoom(1.4); });
    $("zout-btn").addEventListener("click", function () { zoom(1 / 1.4); });
    $("dlg-close").addEventListener("click", closeDialog);
    $("scrim").addEventListener("click", closeDialog);
    var tl = $("timeline");
    tl.addEventListener("pointerdown", onTlDown);
    tl.addEventListener("pointermove", onTlMove);
    tl.addEventListener("pointerup", onTlUp);
    tl.addEventListener("pointercancel", onTlCancel);
    tl.addEventListener("scroll", onTlScroll, { passive: true });
    tl.addEventListener("wheel", onTlWheel, { passive: false });
    $("stage").addEventListener("click", function (e) {
      if (picking) { endPick(pickAt(e)); return; }
      if (player) player.toggle();
    });
    window.addEventListener("resize", function () { if (view === "editor") { renderTimeline(); followPlayhead(); } });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && player && player.playing()) player.pause(); });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    inheritPalette();
    wire();
    registerSync();
    watchPalette();
    showHome();
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("montage");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
  }

  boot();
})();
