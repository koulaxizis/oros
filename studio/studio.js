// ============================================================
// orOS Studio — App logic (v1.0.0)
// A small multitrack audio studio: tracks of audio clips on a
// timeline, recorded from a microphone or sound card or imported from
// files, played and looped against a click, and exported as WAV.
//   - up to 8 stereo tracks: volume, pan, mute, solo, colour, order
//   - clips: move (also to another track), trim both edges, split,
//     duplicate, delete, gain, fade in / out; snap to bar or beat
//   - transport: play / stop, back to start, loop region (drag on the
//     ruler), tempo and beats in a bar, click (metronome), master
//   - recording on the armed track, with a latency offset
//   - export of the whole song or the loop to WAV (16 or 24 bit), MP3
//     or Ogg Opus (encode.js)
//   - undo / redo, several projects
//   - effects: NULL JSFX chains on every track and the master (fx.js),
//     with sidechain keys from other tracks
//   - automation lanes per track: volume, pan and any effect slider
//   - MIDI keyboard (Web MIDI) and on-screen keys playing a built-in
//     synth (midi.js); recorded as audio on an audio track
//   - instrument (MIDI) tracks: MIDI clips of notes played by a built-in
//     instrument through the track's effects and automation, recorded
//     from the keyboard, edited in the piano roll (roll.js, notes.js),
//     imported and exported as .mid files; a loop library (loops.js)
//   - a project as one orOS file (.orosstudio, ../bundle.js +
//     package.js): saved with its audio, opened as a new project,
//     also from an unzipped folder and from the system's "Open with"
// Data:
//   - synced slice "studio" (oros-studio-data): projects, tracks,
//     audio sources and clips, one entity at a time (core.js); the
//     effect chains are part of their track or project
//   - effect files (Convolution's IR) on the orOS disk, /internal/Studio/fx/
//   - audio files on the orOS disk, /internal/Studio/audio/, which
//     Vault Drive carries to the other devices (never in localStorage)
//   - device-local (R10): oros-studio-prefs (open project, zoom, snap,
//     click, devices, recording offset, armed track, export format,
//     shown automation lanes, MIDI and synth choices, piano roll
//     grid, zoom, tool and velocity, loop browser filters)
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. The open project, edits, undo
//   4. Audio files: disk, decoding, peaks
//   5. Drawing: header, transport, tracks, clips, ruler, playhead
//   6. Pointer: clips, ruler, lanes
//   7. Engine: playback, loop, click, meter
//   8. Recording
//   9. Import, export (9b: the .orosstudio file)
//  10. Dialogs: projects, names, track, settings
//  11. Toasts
//  12. Keyboard (Contract B)
//  13. Sync slice + palette
//  14. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C           = window.StudioCore;
  var N           = window.StudioNotes;
  var STORAGE_KEY = "oros-studio-data";
  var PREFS_KEY   = "oros-studio-prefs";
  var SAVE_MS     = 400;
  var MAX_UNDO    = 100;
  var MAX_FILE    = 100 * 1024 * 1024;   // one imported file
  var MAX_REC_SEC = 30 * 60;             // one take
  var PEAKS_PER_S = 100;
  var ZOOMS       = [4, 6, 10, 16, 25, 40, 60, 100, 160, 250, 400];   // pixels per second
  var LOOKAHEAD   = 1.0;                 // seconds of audio scheduled ahead
  var TICK_MS     = 50;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app.name": "Studio", "proj.untitled": "Untitled project", "proj.default": "Project {n}",
      "sub.tracks": "{n} tracks · {t}", "sub.tracks1": "1 track · {t}", "sub.none": "No tracks yet",
      "transport.label": "Transport", "ruler.label": "Timeline: click to move the playhead, drag to set the loop",
      "f.bpm": "Tempo (BPM)", "f.sig": "Beats in a bar", "f.master": "Master",
      "sig.n": "{n}/4", "snap.bar": "Bar", "snap.beat": "Beat", "snap.off": "Free", "snap.lbl": "Snap",
      "btn.metro": "Click", "btn.home": "Back to start", "btn.play": "Play", "btn.pause": "Pause", "btn.stop": "Stop",
      "btn.rec": "Record", "btn.recStop": "Stop recording", "btn.loop": "Loop",
      "btn.zoomIn": "Zoom in", "btn.zoomOut": "Zoom out",
      "btn.projects": "Projects", "btn.undo": "Undo", "btn.redo": "Redo", "btn.import": "Import audio",
      "btn.exportOpen": "Export", "btn.more": "Studio settings", "btn.close": "Close",
      "btn.addTrack": "+ Track", "btn.split": "Split", "btn.dupClip": "Duplicate", "btn.delClip": "Delete",
      "btn.newProject": "New project", "btn.cancel": "Cancel", "btn.ok": "OK", "btn.rename": "Rename",
      "btn.up": "Move up", "btn.down": "Move down", "btn.delTrack": "Delete track", "btn.export": "Export",
      "btn.devices": "Show device names", "btn.open": "Open", "btn.delProject": "Delete project",
      "track.mute": "Mute", "track.solo": "Solo", "track.arm": "Arm for recording", "track.more": "Track settings",
      "track.default": "Track {n}", "track.vol": "Volume",
      "empty.hint": "Import audio or add a track to start.",
      "f.gain": "Gain", "f.fadeIn": "Fade in", "f.fadeOut": "Fade out", "f.name": "Name",
      "f.vol": "Volume", "f.pan": "Pan", "sec.color": "Colour",
      "pan.c": "Centre", "pan.l": "{n} L", "pan.r": "{n} R", "db": "{n} dB", "db.off": "Off", "sec": "{n} s", "ms": "{n} ms",
      "proj.title": "Projects", "proj.empty": "No projects yet.", "proj.desc": "{n} tracks · {t}",
      "name.project": "Name of the project", "name.track": "Name of the track",
      "export.title": "Export", "sec.bits": "Bit depth", "sec.rate": "Sample rate",
      "bits.16": "16 bit", "bits.24": "24 bit", "rate.44100": "44.1 kHz", "rate.48000": "48 kHz",
      "export.loop": "The loop: {a} to {b}.", "export.all": "The whole song: {a} to {b}.",
      "export.busy": "Mixing…", "export.empty": "There is nothing to export yet.",
      "more.title": "Studio settings", "sec.audio": "Sound card", "f.input": "Input (recording)", "f.output": "Output",
      "dev.default": "System default", "dev.n": "Device {n}",
      "out.hint": "This browser always plays through the system output.",
      "sec.latency": "Recording offset", "f.latency": "Move new takes earlier by",
      "lat.hint": "If takes land late against the click, raise this until they line up. The output delay the browser reports is already taken off.",
      "io.mode": "Record and play through", "io.browser": "This browser", "io.bridge": "orOS Bridge (your sound card)", "io.hint": "orOS Bridge opens your sound card itself (Windows Audio, ASIO®, JACK, PipeWire or ALSA): each take records the inputs you pick, in step with what you hear. Listen through your card's own monitoring, or through a plugin (below). The recording offset below is added on top.", "io.be": "Sound system", "io.in": "Record from the card", "io.ch": "Inputs", "io.out": "Listen through the card", "io.ex": "Sharing", "io.shared": "Shared with other programs", "io.excl": "Exclusive (lowest delay, other programs go quiet)", "io.test": "Check the inputs", "io.refresh": "Look again", "io.noBridge": "orOS Bridge is not running. Start it on this computer, then press Connect.", "io.looking": "Looking for sound cards…", "io.old": "This orOS Bridge cannot open sound cards yet. Get version 0.3.0 or newer.", "io.notRunning": "{name} (not running)", "io.nIn": "{n} channels", "io.one": "Input {n}", "io.pair": "Inputs {a} + {b} (stereo)", "io.all": "Every input, each on its own track ({n})", "io.ready": "Ready: Record now goes through {name}.", "io.none": "No sound card found. Is it plugged in? Press Look again.", "io.testing": "The card is open at {sr} Hz, about {ms} ms there and back. Play or sing to see the meters.", "io.openFail": "The sound card could not be opened. {why}", "io.prep": "Preparing the song for the sound card…", "io.pairFirst": "Pair orOS Bridge first: Settings › Record and play through.", "io.lost": "The computer could not keep up: {n} s of the take are missing.", "io.fx": "Listen through a plugin", "io.fxNone": "No plugin (the card's own monitoring)", "io.fxHint": "You hear the inputs through this plugin while you play and record, on outputs 1 and 2 of the card. Use headphones: a microphone near speakers howls. Turn your card's own direct monitoring off, or you hear yourself twice.", "io.fxGain": "Plugin level", "io.fxRec": "A take records", "io.fxDry": "The inputs as they come (the plugin stays on the track)", "io.fxWet": "The plugin's sound", "io.fxTesting": "The card is open at {sr} Hz. You hear the inputs through {name}, about {ms} ms from input to ears. Play or sing and set the sound in its window.", "io.fxOld": "This orOS Bridge cannot run a plugin on an input yet. Get version 0.5.0 or newer.", "io.fxFail": "{name} could not run on the input. The take goes on without it.", "io.fxSlow": "{name} could not keep up with the sound card and was switched off. Try a larger buffer in the card's settings.", "io.fxFailed": "{name} stopped working and was switched off.", "io.fxWinFirst": "Press Check the inputs first: the plugin opens with the card.", "io.midi": "MIDI keyboard", "io.noKeys": "No MIDI keyboard found", "io.fxInstHint": "Play your MIDI keyboard: orOS Bridge reads it itself and the instrument sounds on outputs 1 and 2 of the card. Record on an instrument track: the take keeps the notes you played, and the track keeps the instrument, ready to freeze.", "io.fxInstTesting": "The card is open at {sr} Hz. Play your keyboard: {name} answers in about {ms} ms. Set its sound in its window.", "io.fxNoKeys": "Choose the MIDI keyboard that plays {name}: Settings › Listen through a plugin.",
      "sec.metro": "Click", "f.metroVol": "Click volume",
      "disk.vault": "Audio files are kept on the orOS disk (Studio/audio) and Vault Drive carries them to your other devices.",
      "disk.local": "Audio files are kept on the orOS disk (Studio/audio), on this device. Turn on sync and Vault Drive to have them on your other devices too.",
      "clip.missing": "Audio not on this device yet", "clip.loading": "Loading…", "clip.bad": "Cannot read this audio",
      "busy.import": "Reading {name}…", "busy.saveTake": "Saving the take…",
      "toast.saveFail": "Could not save: storage is full", "toast.noAudio": "This browser cannot play sound",
      "toast.noDisk": "The orOS disk is not available, so audio cannot be kept",
      "toast.writeFail": "The audio could not be written to the orOS disk",
      "toast.tooBig": "{name} is larger than 100 MB", "toast.badFile": "{name} is not audio this browser can read",
      "toast.imported": "Imported: {name}", "toast.maxTracks": "A project has up to {n} tracks",
      "toast.maxClips": "A project has up to {n} clips", "toast.maxProjects": "You have {n} projects, the most there can be",
      "toast.noClip": "Select a clip first", "toast.noSplit": "Put the playhead inside the clip to split it",
      "toast.clipDeleted": "Clip deleted", "toast.trackDeleted": "Track deleted", "toast.projDeleted": "Project deleted",
      "lic.btn": "Sound info", "lic.title": "Where this sound comes from", "lic.hint": "Write down who made the sound and under which licence, so the song can name them. It stays with the sound on every device.",
      "lic.f.title": "Title", "lic.f.by": "Made by", "lic.f.k": "Licence", "lic.f.url": "Link (page of the sound or its licence)", "lic.none": "Not set",
      "lic.cc0": "CC0 (no rights reserved)", "lic.by": "CC BY (name the author)", "lic.by-sa": "CC BY-SA (name the author, share alike)",
      "lic.pd": "Public domain", "lic.own": "My own sound", "lic.other": "Other (follow its own terms)",
      "lic.badUrl": "The link must start with http:// or https://", "lic.saved": "Sound info saved",
      "cr.sec": "Credits", "cr.hint": "This song uses sounds whose licences ask for the author to be named. Put this text where you publish it.",
      "cr.hintAll": "Where the song's sounds come from:", "cr.copy": "Copy", "cr.save": "Save as text", "cr.copied": "Credits copied",
      "cr.head": "Sounds in “{name}”:", "cr.line": "“{title}”", "cr.by": "by {by}", "cr.lic": "licence: {lic}",
      "toast.undo": "Undo", "toast.file": "Saved", "toast.missing": "Some audio is not on this device yet",
      "oros.sec": "orOS file", "oros.save": "Save as orOS file (.orosstudio)", "oros.open": "Open orOS file…",
      "oros.folder": "Unzipped orOS folder…", "oros.hint": "One file with the whole project: tracks, clips, notes, effects, automation and the audio.",
      "oros.reading": "Reading the audio… {n}%", "oros.packing": "Packing the project… {n}%", "oros.opening": "Opening {name}… {n}%",
      "oros.copying": "Copying the audio to the disk… {n} of {m}", "oros.opened": "Opened as a new project: {name}",
      "oros.newer": "This file was made by a newer orOS. Update orOS to open it.", "oros.bad": "{name} is not a Studio project orOS can read",
      "oros.missing": "{n} audio files are not on this device yet, so they were left out", "oros.fail": "The orOS file could not be made",
      "oros.w.tempo": "Tempo", "oros.w.length": "Length", "oros.w.audio": "Audio", "oros.w.inst": "Instrument", "oros.w.clips": "clips",
      "oros.w.notes": "notes", "oros.w.muted": "muted", "oros.w.solo": "solo",
      "toast.noMic": "No microphone or input could be opened", "toast.recMax": "A take is at most 30 minutes",
      "toast.recSaved": "Take saved on {name}", "toast.recFail": "The take could not be saved",
      "toast.armed": "Recording goes to {name}", "toast.noRec": "This browser cannot record here",
      "toast.recEmpty": "Nothing was recorded",
      "live.playing": "Playing", "live.stopped": "Stopped", "live.recording": "Recording",
      "fx.btn": "FX", "fx.open": "Effects", "fx.openMaster": "Master effects", "fx.title": "Effects: {name}",
      "fx.empty": "No effects yet. Add one: they play in order, top to bottom.", "fx.addBtn": "+ Effect", "fx.add": "Add",
      "fx.search": "Search effects", "fx.none": "No effect matches.", "fx.on": "On", "fx.remove": "Remove",
      "fx.removed": "Effect removed", "fx.max": "A chain has up to {n} effects", "fx.controls": "All controls",
      "fx.gfx": "{name} interface", "fx.unknown": "Unknown effect ({id})",
      "fx.unknownHint": "This effect comes from a newer Studio. It is kept, but does not play here.",
      "fx.cat1": "One Slider", "fx.cat2": "Essentials", "fx.cat3": "Advanced", "fx.catInst": "Instruments",
      "fx.noFile": "No file", "fx.chooseFile": "Choose file", "fx.failed": "{name} stopped: it is bypassed",
      "fx.noCatalog": "The effects could not be loaded.", "fx.credit": "Effects: NULL JSFX by Christos Koulaxizis (nulljsfx.tech), MIT License.",
      "rm.title": "Remote control", "rm.sec": "Remote control", "rm.host": "Connect a tablet or phone", "rm.join": "Control Studio on another device",
      "rm.hint": "On the tablet or phone, open Studio › Settings › Control Studio on another device and type this code, or scan the QR code with the camera.",
      "rm.start": "Show a code", "rm.newCode": "New code", "rm.stop": "Disconnect", "rm.off": "Not connected.",
      "rm.connecting": "Connecting…", "rm.waitRemote": "Waiting for the tablet or phone…", "rm.waitHost": "Looking for Studio on the PC with this code…",
      "rm.direct": "Connected directly (same network).", "rm.relay": "Connected through the internet (orOS relay).", "rm.closed": "Disconnected.",
      "rm.joined": "A {dev} is now controlling Studio", "rm.dev.tablet": "tablet", "rm.dev.phone": "phone", "rm.dev.computer": "computer",
      "rm.joinTitle": "Control Studio on another device", "rm.joinHint": "On the PC, open Studio › Settings › Connect a tablet or phone, then type the 6-digit code here.",
      "rm.code": "Code", "rm.go": "Connect", "rm.badCode": "Type the 6 digits shown on the PC.", "rm.exit": "Stop controlling",
      "rm.badge.direct": "Direct", "rm.badge.relay": "Via internet", "rm.badge.lost": "Reconnecting…",
      "rm.noProject": "No project open on the PC", "rm.empty": "The project on the PC has no tracks yet.", "rm.fxOn": "on", "rm.fxOff": "bypassed",
      "rm.pos": "Position in the song", "rm.privacy": "The link is encrypted with this code and the orOS relay only passes it on. Studio asks you here before any device can control it.",
      "rm.fxFile": "Files for effects are chosen on the PC.", "rm.ask": "A {dev} wants to control Studio. Allow it only if it is yours.", "rm.allow": "Allow", "rm.deny": "Deny", "rm.waitOk": "Found Studio. Press Allow on the PC…", "rm.denied": "The PC did not allow this device. Ask for a new code.",
      "fx.n": "{n} effects", "fx.n1": "1 effect",
      "toast.tooBig20": "{name} is larger than 20 MB", "toast.noFx": "This browser cannot run the effects",
      "fx.key": "Key input (sidechain)", "fx.keyNone": "None",
      "fx.keyHint": "The effect listens to that track, after its effects and before its fader, so a muted track still works as the key.",
      "sec.format": "Format", "fmt.wav": "WAV", "fmt.mp3": "MP3", "fmt.opus": "Opus (OGG)", "sec.kbps": "Bitrate", "kbps": "{n} kbit/s",
      "export.encoding": "Encoding… {n}%", "export.noOpus": "This browser cannot make Opus files. Chrome, Edge and Firefox can.",
      "export.opusRate": "Opus files are always 48 kHz.", "export.mp3Hint": "192 kbit/s or more keeps a mix close to the WAV.",
      "toast.exportFail": "The export did not finish",
      "btn.toMusic": "Add to Music", "btn.toLyrics": "Sync lyrics", "toast.toMusic": "Added to Music", "toast.toMusicFail": "Could not add it to Music",
      "btn.ringtone": "Make a ringtone", "toast.ringNoNotes": "Ringtone Composer needs notes: add an instrument track.",
      "au.btn": "A", "au.show": "Automation", "au.title": "Automation: {name}", "au.param": "Parameter",
      "au.vol": "Volume", "au.pan": "Pan", "au.on": "Lane on", "au.delPt": "Delete point", "au.clear": "Clear lane",
      "au.hint": "Tap or click to add a point", "au.pt": "Point at {t}: {v}", "au.lane": "Automation of {name}",
      "au.cleared": "Lane cleared", "au.max": "A track has up to {n} lanes", "au.maxPts": "A lane has up to {n} points",
      "au.auto": "automated", "au.used": "{name} (has points)",
      "btn.keys": "Keyboard", "kb.connect": "Connect MIDI keyboard", "kb.none": "No MIDI keyboard is connected. Plug one in, or play the keys below.",
      "kb.inputs": "MIDI: {names}", "kb.noMidi": "This browser has no Web MIDI (Chrome and Edge do). The keys below still play.",
      "kb.denied": "MIDI was not allowed. The keys below still play.", "kb.sound": "Sound", "kb.vol": "Synth volume",
      "kb.octDown": "Octave down", "kb.octUp": "Octave up", "kb.keys": "Piano keys", "kb.oct": "Octave {n}",
      "kb.rec": "On an instrument track, Record records the notes you play into a MIDI clip. On an audio track, while this panel is open, it records the synth as audio.",
      "snd.piano": "Piano", "snd.epiano": "Electric piano", "snd.organ": "Organ", "snd.strings": "Strings", "snd.lead": "Lead synth", "snd.bass": "Bass",
      "snd.drums": "Drum kit",
      "toast.recSynth": "Recording the synth on {name}",
      "tk.title": "Add a track", "tk.audio": "Audio track", "tk.audioHint": "For recordings and audio files.",
      "tk.inst": "Instrument track", "tk.instHint": "Notes you can edit, played by a built-in instrument.", "tk.loops": "Browse loops",
      "mi.inst": "Instrument", "mi.track": "Instrument track: {inst}", "mi.newClip": "New clip", "mi.editNotes": "Edit notes",
      "mi.exportMidi": "Export MIDI", "mi.importMidi": "Import MIDI", "mi.clip": "MIDI clip", "mi.target": "Plays {name}",
      "fs.title": "Free sounds", "fs.hint": "Single sounds (drums, cymbals, small percussion) from VSCO 2 CE, CC0: free for any use, no credit needed. Add one and it becomes an audio clip at the playhead.",
      "fs.play": "Listen", "fs.stop": "Stop", "fs.add": "Add", "fs.loading": "Loading the list…", "fs.none": "The list could not be downloaded. Try again when online.",
      "fs.fail": "{name} could not be downloaded.",
      "br.btn": "Plugin on this computer", "br.title": "Your plugins (VST3, CLAP)", "br.offHint": "orOS Bridge is a small free program for Windows and Linux that lets Studio use the VST3 and CLAP plugins on this computer, the ones you bought too. Install it, start it, then press Connect.", "br.get": "Get orOS Bridge", "br.connect": "Connect", "br.connecting": "Connecting to orOS Bridge…", "br.pairHint": "orOS Bridge now shows a 6-digit code. Type it here once; this browser remembers the pairing.", "br.code": "Code from orOS Bridge", "br.pair": "Pair", "br.badCode": "Wrong code. orOS Bridge shows a new one.", "br.plugin": "Plugin", "br.instruments": "Instruments (play the notes)", "br.effects": "Effects (process the sound)", "br.scan": "Look for plugins", "br.scanning": "Looking for plugins… this can take a minute.", "br.none": "No plugins found. Install VST3 or CLAP plugins in their usual folders and press Look for plugins.", "br.window": "Show its window", "br.freeze": "Freeze to audio", "br.hint": "Set the sound in the plugin's window, then Freeze: the track plays through the plugin into a new audio track and the original is muted.", "br.again": "Frozen through {name}. Freeze again to replace the audio with the plugin's current sound.", "br.opening": "Opening {name}…", "br.rendering": "Rendering through the plugin… {n}%", "br.done": "Frozen: {name}", "br.fail": "The plugin could not render. Nothing was changed.", "br.lost": "orOS Bridge closed. Start it again and press Connect.", "br.nx": "A track with a NULL instrument cannot go through a plugin yet.", "br.empty": "This track has nothing to play.", "br.gone": "The track this one was frozen from has been deleted.",
      "smp.group": "{cat} (download)", "smp.cat.Keys": "Keys", "smp.cat.Strings": "Strings", "smp.cat.Woodwinds": "Woodwinds",
      "smp.cat.Brass": "Brass", "smp.cat.Percussion": "Percussion", "smp.loading": "Downloading {name}…", "smp.step": "Downloading {name}: {n} of {total}",
      "smp.ready": "{name} is ready", "smp.fail": "{name} could not be downloaded. The built-in sound plays until it can.",
      "smp.exportFail": "An instrument could not be downloaded, so the song was not exported. Try again when online.",
      "smp.credit": "{name} (instrument)",
      "smp.import": "Import SFZ instrument", "smp.list": "Instruments on this device", "smp.mine": "Imported",
      "smp.listHint": "Downloaded instruments stay on this device for offline use. Remove one to free space: it downloads again when a track needs it.",
      "smp.none": "No instrument has been downloaded yet.", "smp.remove": "Remove", "smp.removed": "{name} removed from this device",
      "smp.size": "{mb} MB", "smp.imported": "Imported {name}: {n} samples", "smp.skipped": "Left out, not found or not readable: {n}",
      "smp.noSfz": "Choose a folder (or files) with an .sfz file and its samples.", "smp.bad": "This .sfz has no sample Studio can play.",
      "smp.tooBig": "This instrument is larger than {mb} MB.", "smp.noDisk": "Importing an instrument needs the orOS disk (open Studio inside orOS).",
      "smp.importing": "Importing {name}…", "smp.importFail": "The instrument could not be imported.", "smp.userNote": "Imported instruments are on the orOS disk in Studio/instruments and sync like your audio files.",
      "mi.recMidi": "Recording notes on {name}", "mi.recSaved": "{n} notes recorded on {name}",
      "mi.imported": "Imported {n} notes from {name}", "mi.badMidi": "{name} is not a MIDI file Studio can read",
      "mi.noNotes": "{name} has no notes", "mi.notesN": "{n} notes", "mi.dbl": "Double-click or double-tap an empty spot to add a clip",
      "pr.title": "Notes: {name}", "pr.draw": "Draw", "pr.select": "Select", "pr.tool": "Tool", "pr.grid": "Grid",
      "pr.g4": "1/4", "pr.g8": "1/8", "pr.g16": "1/16", "pr.g32": "1/32", "pr.g8t": "1/8 triplet", "pr.g16t": "1/16 triplet", "pr.goff": "Free",
      "pr.quant": "Quantize", "pr.vel": "Velocity", "pr.copy": "Copy", "pr.paste": "Paste", "pr.del": "Delete notes", "pr.all": "Select all",
      "pr.import": "Import MIDI", "pr.export": "Export MIDI", "pr.keys": "Pitches", "pr.area": "Notes", "pr.velLane": "Velocity",
      "pr.note": "{name}, bar {bar} beat {beat}, {len} beats, velocity {v}", "pr.nSel": "{n} selected", "pr.nNotes": "{n} notes",
      "pr.deleted": "{n} notes deleted", "pr.copied": "{n} notes copied", "pr.noSel": "Select notes first", "pr.nothing": "Copy notes first",
      "pr.max": "A clip has up to {n} notes", "pr.quantized": "{n} notes quantized", "pr.play": "Play from the clip",
      "pr.hint": "Draw: tap or click to add a note, drag its right end to make it longer. Select: drag a box, or tap notes. Drag notes to move them; double-click one to delete it.",
      "lp.btn": "Loops", "lp.title": "Loops", "lp.genre": "Style", "lp.allGenres": "All styles", "lp.tempo": "Tempo", "lp.anyTempo": "Any tempo",
      "lp.slow": "Slow (under 90)", "lp.mid": "Medium (90–119)", "lp.fast": "Fast (120 and up)", "lp.all": "All", "lp.kind": "Kind",
      "lp.kdrums": "Drums", "lp.kbass": "Bass", "lp.kkeys": "Keys",
      "lp.gpop": "Pop", "lp.grock": "Rock", "lp.ghiphop": "Hip hop", "lp.ghouse": "House", "lp.gfunk": "Funk", "lp.glofi": "Lo-fi", "lp.glatin": "Latin", "lp.gballad": "Ballad",
      "lp.name": "{genre} {kind} {n}", "lp.meta": "{n} bars · {bpm} BPM · {inst}", "lp.meta1": "1 bar · {bpm} BPM · {inst}",
      "lp.play": "Listen", "lp.stop": "Stop", "lp.add": "Add at the playhead", "lp.drag": "Drag onto a track",
      "lp.hint": "Drag a loop onto a track, or press + to add it at the playhead. Loops play at the project's tempo.",
      "lp.none": "No loop matches.", "lp.added": "{name} added to {track}",
      "dr.kick": "Kick", "dr.snare": "Snare", "dr.rim": "Rim", "dr.clap": "Clap", "dr.hat": "Hi-hat", "dr.pedal": "Pedal hi-hat", "dr.ohat": "Open hi-hat",
      "dr.crash": "Crash", "dr.ride": "Ride", "dr.shaker": "Shaker", "dr.cow": "Cowbell", "dr.tom1": "Low tom", "dr.tom2": "Mid tom", "dr.tom3": "High tom",
      "as.done": "The Assistant changed {n} things in {d} projects.", "as.done1": "The Assistant changed {n} things in the project.",
      "as.done0": "Nothing needed changing.", "as.bad": "The Assistant's request could not be read. Nothing was changed.",
      "as.undone": "The Assistant's change was undone.", "as.changed": "The project was changed since, so the Assistant's change was not undone.",
      "as.gone": "There is nothing left to undo."
    },
    el: {
      "app.name": "Studio", "proj.untitled": "Έργο χωρίς όνομα", "proj.default": "Έργο {n}",
      "sub.tracks": "{n} κανάλια · {t}", "sub.tracks1": "1 κανάλι · {t}", "sub.none": "Κανένα κανάλι ακόμη",
      "transport.label": "Αναπαραγωγή", "ruler.label": "Χρονολόγιο: κλικ για να μετακινήσεις τον δείκτη, σύρε για να ορίσεις το loop",
      "f.bpm": "Ρυθμός (BPM)", "f.sig": "Χτύποι στο μέτρο", "f.master": "Master",
      "sig.n": "{n}/4", "snap.bar": "Μέτρο", "snap.beat": "Χτύπος", "snap.off": "Ελεύθερα", "snap.lbl": "Κούμπωμα",
      "btn.metro": "Κλικ", "btn.home": "Στην αρχή", "btn.play": "Αναπαραγωγή", "btn.pause": "Παύση", "btn.stop": "Σταμάτημα",
      "btn.rec": "Ηχογράφηση", "btn.recStop": "Τέλος ηχογράφησης", "btn.loop": "Loop",
      "btn.zoomIn": "Μεγέθυνση", "btn.zoomOut": "Σμίκρυνση",
      "btn.projects": "Έργα", "btn.undo": "Αναίρεση", "btn.redo": "Επανάληψη", "btn.import": "Εισαγωγή ήχου",
      "btn.exportOpen": "Εξαγωγή", "btn.more": "Ρυθμίσεις Studio", "btn.close": "Κλείσιμο",
      "btn.addTrack": "+ Κανάλι", "btn.split": "Κόψιμο", "btn.dupClip": "Αντίγραφο", "btn.delClip": "Διαγραφή",
      "btn.newProject": "Νέο έργο", "btn.cancel": "Άκυρο", "btn.ok": "OK", "btn.rename": "Μετονομασία",
      "btn.up": "Πάνω", "btn.down": "Κάτω", "btn.delTrack": "Διαγραφή καναλιού", "btn.export": "Εξαγωγή",
      "btn.devices": "Δείξε τα ονόματα των συσκευών", "btn.open": "Άνοιγμα", "btn.delProject": "Διαγραφή έργου",
      "track.mute": "Σίγαση", "track.solo": "Σόλο", "track.arm": "Ηχογράφηση σε αυτό το κανάλι", "track.more": "Ρυθμίσεις καναλιού",
      "track.default": "Κανάλι {n}", "track.vol": "Ένταση",
      "empty.hint": "Κάνε εισαγωγή ήχου ή πρόσθεσε ένα κανάλι για να ξεκινήσεις.",
      "f.gain": "Gain", "f.fadeIn": "Fade in", "f.fadeOut": "Fade out", "f.name": "Όνομα",
      "f.vol": "Ένταση", "f.pan": "Pan", "sec.color": "Χρώμα",
      "pan.c": "Κέντρο", "pan.l": "{n} Α", "pan.r": "{n} Δ", "db": "{n} dB", "db.off": "Κλειστό", "sec": "{n} δ", "ms": "{n} ms",
      "proj.title": "Έργα", "proj.empty": "Κανένα έργο ακόμη.", "proj.desc": "{n} κανάλια · {t}",
      "name.project": "Όνομα του έργου", "name.track": "Όνομα του καναλιού",
      "export.title": "Εξαγωγή", "sec.bits": "Βάθος bit", "sec.rate": "Συχνότητα δειγματοληψίας",
      "bits.16": "16 bit", "bits.24": "24 bit", "rate.44100": "44,1 kHz", "rate.48000": "48 kHz",
      "export.loop": "Το loop: από {a} έως {b}.", "export.all": "Όλο το τραγούδι: από {a} έως {b}.",
      "export.busy": "Γίνεται η μίξη…", "export.empty": "Δεν υπάρχει ακόμη κάτι για εξαγωγή.",
      "more.title": "Ρυθμίσεις Studio", "sec.audio": "Κάρτα ήχου", "f.input": "Είσοδος (ηχογράφηση)", "f.output": "Έξοδος",
      "dev.default": "Προεπιλογή συστήματος", "dev.n": "Συσκευή {n}",
      "out.hint": "Αυτός ο browser παίζει πάντα από την έξοδο του συστήματος.",
      "sec.latency": "Διόρθωση ηχογράφησης", "f.latency": "Μετακίνησε τις νέες λήψεις νωρίτερα κατά",
      "lat.hint": "Αν οι λήψεις πέφτουν αργά σε σχέση με τον μετρονόμο, ανέβασέ το μέχρι να συμπέσουν. Η καθυστέρηση εξόδου που δηλώνει ο browser αφαιρείται ήδη.",
      "io.mode": "Ηχογράφηση και ακρόαση μέσω", "io.browser": "Αυτού του browser", "io.bridge": "orOS Bridge (η κάρτα ήχου σου)", "io.hint": "Το orOS Bridge ανοίγει το ίδιο την κάρτα ήχου σου (Windows Audio, ASIO®, JACK, PipeWire ή ALSA): κάθε λήψη γράφει τις εισόδους που διαλέγεις, σε συγχρονισμό με αυτό που ακούς. Άκου από την παρακολούθηση της ίδιας της κάρτας ή μέσα από ένα plugin (πιο κάτω). Η διόρθωση ηχογράφησης πιο κάτω προστίθεται επιπλέον.", "io.be": "Σύστημα ήχου", "io.in": "Ηχογράφηση από την κάρτα", "io.ch": "Είσοδοι", "io.out": "Ακρόαση από την κάρτα", "io.ex": "Κοινή χρήση", "io.shared": "Κοινή με άλλα προγράμματα", "io.excl": "Αποκλειστική (η μικρότερη καθυστέρηση, τα άλλα προγράμματα σωπαίνουν)", "io.test": "Έλεγχος εισόδων", "io.refresh": "Ψάξε ξανά", "io.noBridge": "Το orOS Bridge δεν τρέχει. Άνοιξέ το σε αυτόν τον υπολογιστή και πάτα Σύνδεση.", "io.looking": "Αναζήτηση καρτών ήχου…", "io.old": "Αυτό το orOS Bridge δεν ανοίγει ακόμη κάρτες ήχου. Πάρε την έκδοση 0.3.0 ή νεότερη.", "io.notRunning": "{name} (δεν τρέχει)", "io.nIn": "{n} κανάλια", "io.one": "Είσοδος {n}", "io.pair": "Είσοδοι {a} + {b} (στέρεο)", "io.all": "Κάθε είσοδος σε δικό της κανάλι ({n})", "io.ready": "Έτοιμο: η Ηχογράφηση περνά τώρα από το {name}.", "io.none": "Δεν βρέθηκε κάρτα ήχου. Είναι συνδεδεμένη; Πάτα Ψάξε ξανά.", "io.testing": "Η κάρτα είναι ανοιχτή στα {sr} Hz, περίπου {ms} ms πήγαινε-έλα. Παίξε ή τραγούδησε για να δεις τους μετρητές.", "io.openFail": "Η κάρτα ήχου δεν άνοιξε. {why}", "io.prep": "Ετοιμάζεται το τραγούδι για την κάρτα ήχου…", "io.pairFirst": "Σύνδεσε πρώτα το orOS Bridge: Ρυθμίσεις › Ηχογράφηση και ακρόαση μέσω.", "io.lost": "Ο υπολογιστής δεν πρόλαβε: λείπουν {n} s από τη λήψη.", "io.fx": "Ακρόαση μέσα από plugin", "io.fxNone": "Χωρίς plugin (η παρακολούθηση της ίδιας της κάρτας)", "io.fxHint": "Ακούς τις εισόδους μέσα από αυτό το plugin όσο παίζεις και ηχογραφείς, στις εξόδους 1 και 2 της κάρτας. Φόρεσε ακουστικά: ένα μικρόφωνο κοντά σε ηχεία σφυρίζει. Κλείσε την άμεση παρακολούθηση της κάρτας, αλλιώς θα ακούς τον εαυτό σου δύο φορές.", "io.fxGain": "Ένταση του plugin", "io.fxRec": "Μια λήψη γράφει", "io.fxDry": "Τις εισόδους όπως έρχονται (το plugin μένει στο κανάλι)", "io.fxWet": "Τον ήχο του plugin", "io.fxTesting": "Η κάρτα είναι ανοιχτή στα {sr} Hz. Ακούς τις εισόδους μέσα από το {name}, περίπου {ms} ms από την είσοδο ως τα αυτιά σου. Παίξε ή τραγούδησε και ρύθμισε τον ήχο στο παράθυρό του.", "io.fxOld": "Αυτό το orOS Bridge δεν τρέχει ακόμη plugin σε είσοδο. Πάρε την έκδοση 0.5.0 ή νεότερη.", "io.fxFail": "Το {name} δεν μπόρεσε να τρέξει στην είσοδο. Η λήψη συνεχίζει χωρίς αυτό.", "io.fxSlow": "Το {name} δεν πρόλαβε την κάρτα ήχου και σταμάτησε. Δοκίμασε μεγαλύτερο buffer στις ρυθμίσεις της κάρτας.", "io.fxFailed": "Το {name} σταμάτησε να λειτουργεί και απενεργοποιήθηκε.", "io.fxWinFirst": "Πάτα πρώτα Έλεγχος εισόδων: το plugin ανοίγει μαζί με την κάρτα.", "io.midi": "Πληκτρολόγιο MIDI", "io.noKeys": "Δεν βρέθηκε πληκτρολόγιο MIDI", "io.fxInstHint": "Παίξε στο πληκτρολόγιο MIDI σου: το orOS Bridge το διαβάζει το ίδιο και το όργανο ακούγεται στις εξόδους 1 και 2 της κάρτας. Ηχογράφησε σε κανάλι οργάνου: η λήψη κρατά τις νότες που έπαιξες και το κανάλι κρατά το όργανο, έτοιμο για πάγωμα.", "io.fxInstTesting": "Η κάρτα είναι ανοιχτή στα {sr} Hz. Παίξε στο πληκτρολόγιο: το {name} απαντά σε περίπου {ms} ms. Ρύθμισε τον ήχο του στο παράθυρό του.", "io.fxNoKeys": "Διάλεξε το πληκτρολόγιο MIDI που παίζει το {name}: Ρυθμίσεις › Ακρόαση μέσα από plugin.",
      "sec.metro": "Μετρονόμος", "f.metroVol": "Ένταση μετρονόμου",
      "disk.vault": "Τα αρχεία ήχου μένουν στον δίσκο του orOS (Studio/audio) και το Vault Drive τα μεταφέρει στις άλλες συσκευές σου.",
      "disk.local": "Τα αρχεία ήχου μένουν στον δίσκο του orOS (Studio/audio), σε αυτή τη συσκευή. Άνοιξε το sync και το Vault Drive για να τα έχεις και στις άλλες συσκευές σου.",
      "clip.missing": "Ο ήχος δεν έχει φτάσει ακόμη σε αυτή τη συσκευή", "clip.loading": "Φόρτωση…", "clip.bad": "Ο ήχος δεν διαβάζεται",
      "busy.import": "Διαβάζεται το {name}…", "busy.saveTake": "Αποθηκεύεται η λήψη…",
      "toast.saveFail": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.noAudio": "Αυτός ο browser δεν παίζει ήχο",
      "toast.noDisk": "Ο δίσκος του orOS δεν είναι διαθέσιμος, οπότε ο ήχος δεν μπορεί να κρατηθεί",
      "toast.writeFail": "Ο ήχος δεν γράφτηκε στον δίσκο του orOS",
      "toast.tooBig": "Το {name} είναι μεγαλύτερο από 100 MB", "toast.badFile": "Το {name} δεν είναι ήχος που διαβάζει αυτός ο browser",
      "toast.imported": "Εισήχθη: {name}", "toast.maxTracks": "Ένα έργο έχει έως {n} κανάλια",
      "toast.maxClips": "Ένα έργο έχει έως {n} clips", "toast.maxProjects": "Έχεις {n} έργα, όσα χωράνε",
      "toast.noClip": "Διάλεξε πρώτα ένα clip", "toast.noSplit": "Βάλε τον δείκτη μέσα στο clip για να το κόψεις",
      "toast.clipDeleted": "Το clip διαγράφηκε", "toast.trackDeleted": "Το κανάλι διαγράφηκε", "toast.projDeleted": "Το έργο διαγράφηκε",
      "lic.btn": "Στοιχεία ήχου", "lic.title": "Από πού είναι αυτός ο ήχος", "lic.hint": "Γράψε ποιος έφτιαξε τον ήχο και με ποια άδεια, ώστε το τραγούδι να τον αναφέρει. Τα στοιχεία μένουν με τον ήχο σε κάθε συσκευή.",
      "lic.f.title": "Τίτλος", "lic.f.by": "Δημιουργός", "lic.f.k": "Άδεια", "lic.f.url": "Σύνδεσμος (σελίδα του ήχου ή της άδειας)", "lic.none": "Δεν έχει οριστεί",
      "lic.cc0": "CC0 (χωρίς δικαιώματα)", "lic.by": "CC BY (αναφορά δημιουργού)", "lic.by-sa": "CC BY-SA (αναφορά δημιουργού, ίδια άδεια)",
      "lic.pd": "Κοινό κτήμα", "lic.own": "Δικός μου ήχος", "lic.other": "Άλλη (ισχύουν οι δικοί της όροι)",
      "lic.badUrl": "Ο σύνδεσμος πρέπει να αρχίζει με http:// ή https://", "lic.saved": "Τα στοιχεία του ήχου αποθηκεύτηκαν",
      "cr.sec": "Αναφορές", "cr.hint": "Το τραγούδι έχει ήχους που η άδειά τους ζητά να αναφέρεται ο δημιουργός. Βάλε αυτό το κείμενο εκεί που θα το δημοσιεύσεις.",
      "cr.hintAll": "Από πού είναι οι ήχοι του τραγουδιού:", "cr.copy": "Αντιγραφή", "cr.save": "Αποθήκευση ως κείμενο", "cr.copied": "Οι αναφορές αντιγράφηκαν",
      "cr.head": "Ήχοι στο «{name}»:", "cr.line": "«{title}»", "cr.by": "από {by}", "cr.lic": "άδεια: {lic}",
      "toast.undo": "Αναίρεση", "toast.file": "Αποθηκεύτηκε", "toast.missing": "Κάποιος ήχος δεν έχει φτάσει ακόμη σε αυτή τη συσκευή",
      "oros.sec": "Αρχείο orOS", "oros.save": "Αποθήκευση ως αρχείο orOS (.orosstudio)", "oros.open": "Άνοιγμα αρχείου orOS…",
      "oros.folder": "Αποσυμπιεσμένος φάκελος orOS…", "oros.hint": "Ένα αρχείο με όλο το έργο: κανάλια, clips, νότες, εφέ, αυτοματισμούς και τον ήχο.",
      "oros.reading": "Διαβάζεται ο ήχος… {n}%", "oros.packing": "Πακετάρεται το έργο… {n}%", "oros.opening": "Ανοίγει το {name}… {n}%",
      "oros.copying": "Ο ήχος αντιγράφεται στον δίσκο… {n} από {m}", "oros.opened": "Άνοιξε ως νέο έργο: {name}",
      "oros.newer": "Το αρχείο φτιάχτηκε από νεότερο orOS. Ενημέρωσε το orOS για να το ανοίξεις.", "oros.bad": "Το {name} δεν είναι έργο Studio που διαβάζει το orOS",
      "oros.missing": "{n} αρχεία ήχου δεν έχουν φτάσει ακόμη σε αυτή τη συσκευή, οπότε έμειναν έξω", "oros.fail": "Το αρχείο orOS δεν φτιάχτηκε",
      "oros.w.tempo": "Ρυθμός", "oros.w.length": "Διάρκεια", "oros.w.audio": "Ήχος", "oros.w.inst": "Όργανο", "oros.w.clips": "clips",
      "oros.w.notes": "νότες", "oros.w.muted": "σίγαση", "oros.w.solo": "σόλο",
      "toast.noMic": "Δεν άνοιξε μικρόφωνο ή είσοδος", "toast.recMax": "Μια λήψη κρατά έως 30 λεπτά",
      "toast.recSaved": "Η λήψη αποθηκεύτηκε στο {name}", "toast.recFail": "Η λήψη δεν αποθηκεύτηκε",
      "toast.armed": "Η ηχογράφηση πάει στο {name}", "toast.noRec": "Αυτός ο browser δεν ηχογραφεί εδώ",
      "toast.recEmpty": "Δεν ηχογραφήθηκε τίποτα",
      "live.playing": "Αναπαραγωγή", "live.stopped": "Σταμάτησε", "live.recording": "Ηχογράφηση",
      "fx.btn": "FX", "fx.open": "Εφέ", "fx.openMaster": "Εφέ του master", "fx.title": "Εφέ: {name}",
      "fx.empty": "Κανένα εφέ ακόμη. Πρόσθεσε ένα: παίζουν με τη σειρά, από πάνω προς τα κάτω.", "fx.addBtn": "+ Εφέ", "fx.add": "Προσθήκη",
      "fx.search": "Αναζήτηση εφέ", "fx.none": "Κανένα εφέ δεν ταιριάζει.", "fx.on": "Ενεργό", "fx.remove": "Αφαίρεση",
      "fx.removed": "Το εφέ αφαιρέθηκε", "fx.max": "Μια αλυσίδα έχει έως {n} εφέ", "fx.controls": "Όλα τα χειριστήρια",
      "fx.gfx": "Περιβάλλον του {name}", "fx.unknown": "Άγνωστο εφέ ({id})",
      "fx.unknownHint": "Αυτό το εφέ έρχεται από νεότερο Studio. Κρατιέται, αλλά δεν παίζει εδώ.",
      "fx.cat1": "Ένα ρυθμιστικό", "fx.cat2": "Βασικά", "fx.cat3": "Προχωρημένα", "fx.catInst": "Όργανα",
      "fx.noFile": "Κανένα αρχείο", "fx.chooseFile": "Επιλογή αρχείου", "fx.failed": "Το {name} σταμάτησε: παρακάμπτεται",
      "fx.noCatalog": "Τα εφέ δεν φόρτωσαν.", "fx.credit": "Εφέ: NULL JSFX του Christos Koulaxizis (nulljsfx.tech), άδεια MIT.",
      "rm.title": "Τηλεχειρισμός", "rm.sec": "Τηλεχειρισμός", "rm.host": "Σύνδεση tablet ή κινητού", "rm.join": "Χειρισμός του Studio άλλης συσκευής",
      "rm.hint": "Στο tablet ή στο κινητό άνοιξε Studio › Ρυθμίσεις › Χειρισμός του Studio άλλης συσκευής και γράψε αυτόν τον κωδικό, ή σκάναρε το QR με την κάμερα.",
      "rm.start": "Εμφάνιση κωδικού", "rm.newCode": "Νέος κωδικός", "rm.stop": "Αποσύνδεση", "rm.off": "Χωρίς σύνδεση.",
      "rm.connecting": "Σύνδεση…", "rm.waitRemote": "Αναμονή για το tablet ή το κινητό…", "rm.waitHost": "Αναζήτηση του Studio στο PC με αυτόν τον κωδικό…",
      "rm.direct": "Απευθείας σύνδεση (ίδιο δίκτυο).", "rm.relay": "Σύνδεση μέσω internet (relay του orOS).", "rm.closed": "Αποσυνδέθηκε.",
      "rm.joined": "Συνδέθηκε {dev} και χειρίζεται το Studio", "rm.dev.tablet": "tablet", "rm.dev.phone": "κινητό", "rm.dev.computer": "υπολογιστής",
      "rm.joinTitle": "Χειρισμός του Studio άλλης συσκευής", "rm.joinHint": "Στο PC άνοιξε Studio › Ρυθμίσεις › Σύνδεση tablet ή κινητού και γράψε εδώ τον 6ψήφιο κωδικό.",
      "rm.code": "Κωδικός", "rm.go": "Σύνδεση", "rm.badCode": "Γράψε τα 6 ψηφία που δείχνει το PC.", "rm.exit": "Τέλος χειρισμού",
      "rm.badge.direct": "Απευθείας", "rm.badge.relay": "Μέσω internet", "rm.badge.lost": "Επανασύνδεση…",
      "rm.noProject": "Κανένα ανοιχτό έργο στο PC", "rm.empty": "Το έργο στο PC δεν έχει ακόμη κανάλια.", "rm.fxOn": "ενεργό", "rm.fxOff": "παρακάμπτεται",
      "rm.pos": "Θέση στο τραγούδι", "rm.privacy": "Η σύνδεση κρυπτογραφείται με αυτόν τον κωδικό και το relay του orOS απλώς τη μεταφέρει. Το Studio σε ρωτά εδώ πριν το χειριστεί οποιαδήποτε συσκευή.",
      "rm.fxFile": "Τα αρχεία των εφέ επιλέγονται στο PC.", "rm.ask": "Μια συσκευή ({dev}) θέλει να χειριστεί το Studio. Επίτρεψέ το μόνο αν είναι δική σου.", "rm.allow": "Επιτρέπεται", "rm.deny": "Όχι", "rm.waitOk": "Βρέθηκε το Studio. Πάτα «Επιτρέπεται» στο PC…", "rm.denied": "Το PC δεν επέτρεψε αυτή τη συσκευή. Ζήτα νέο κωδικό.",
      "fx.n": "{n} εφέ", "fx.n1": "1 εφέ",
      "toast.tooBig20": "Το {name} είναι μεγαλύτερο από 20 MB", "toast.noFx": "Αυτός ο browser δεν μπορεί να παίξει τα εφέ",
      "fx.key": "Είσοδος κλειδιού (sidechain)", "fx.keyNone": "Καμία",
      "fx.keyHint": "Το εφέ ακούει εκείνο το κανάλι, μετά τα εφέ του και πριν από τον fader του, οπότε και ένα κανάλι σε σίγαση κάνει για κλειδί.",
      "sec.format": "Μορφή", "fmt.wav": "WAV", "fmt.mp3": "MP3", "fmt.opus": "Opus (OGG)", "sec.kbps": "Ρυθμός bit", "kbps": "{n} kbit/s",
      "export.encoding": "Κωδικοποίηση… {n}%", "export.noOpus": "Αυτός ο browser δεν φτιάχνει αρχεία Opus. Το Chrome, το Edge και το Firefox φτιάχνουν.",
      "export.opusRate": "Τα αρχεία Opus είναι πάντα 48 kHz.", "export.mp3Hint": "Από 192 kbit/s και πάνω η μίξη μένει κοντά στο WAV.",
      "toast.exportFail": "Η εξαγωγή δεν ολοκληρώθηκε",
      "btn.toMusic": "Στη Μουσική", "btn.toLyrics": "Συγχρονισμός στίχων", "toast.toMusic": "Μπήκε στη Μουσική", "toast.toMusicFail": "Δεν μπόρεσε να μπει στη Μουσική",
      "btn.ringtone": "Κάνε το ήχο κλήσης", "toast.ringNoNotes": "Ο Ήχος κλήσης χρειάζεται νότες: πρόσθεσε ένα κανάλι οργάνου.",
      "au.btn": "A", "au.show": "Αυτοματισμός", "au.title": "Αυτοματισμός: {name}", "au.param": "Παράμετρος",
      "au.vol": "Ένταση", "au.pan": "Pan", "au.on": "Λωρίδα ενεργή", "au.delPt": "Διαγραφή σημείου", "au.clear": "Καθαρισμός λωρίδας",
      "au.hint": "Πάτα ή κάνε κλικ για να προσθέσεις σημείο", "au.pt": "Σημείο στο {t}: {v}", "au.lane": "Αυτοματισμός: {name}",
      "au.cleared": "Η λωρίδα καθαρίστηκε", "au.max": "Ένα κανάλι έχει έως {n} λωρίδες", "au.maxPts": "Μια λωρίδα έχει έως {n} σημεία",
      "au.auto": "με αυτοματισμό", "au.used": "{name} (έχει σημεία)",
      "btn.keys": "Πληκτρολόγιο", "kb.connect": "Σύνδεση πληκτρολογίου MIDI", "kb.none": "Δεν είναι συνδεδεμένο πληκτρολόγιο MIDI. Σύνδεσε ένα ή παίξε τα πλήκτρα παρακάτω.",
      "kb.inputs": "MIDI: {names}", "kb.noMidi": "Αυτός ο browser δεν έχει Web MIDI (το Chrome και το Edge έχουν). Τα πλήκτρα παρακάτω παίζουν κανονικά.",
      "kb.denied": "Το MIDI δεν επιτράπηκε. Τα πλήκτρα παρακάτω παίζουν κανονικά.", "kb.sound": "Ήχος", "kb.vol": "Ένταση συνθεσάιζερ",
      "kb.octDown": "Μία οκτάβα κάτω", "kb.octUp": "Μία οκτάβα πάνω", "kb.keys": "Πλήκτρα πιάνου", "kb.oct": "Οκτάβα {n}",
      "kb.rec": "Σε κανάλι οργάνου, η ηχογράφηση γράφει τις νότες που παίζεις σε ένα κλιπ MIDI. Σε κανάλι ήχου, όσο είναι ανοιχτό αυτό το πάνελ, γράφει το συνθεσάιζερ ως ήχο.",
      "snd.piano": "Πιάνο", "snd.epiano": "Ηλεκτρικό πιάνο", "snd.organ": "Όργανο", "snd.strings": "Έγχορδα", "snd.lead": "Συνθεσάιζερ lead", "snd.bass": "Μπάσο",
      "snd.drums": "Ντραμς",
      "toast.recSynth": "Ηχογραφείται το συνθεσάιζερ στο {name}",
      "tk.title": "Προσθήκη καναλιού", "tk.audio": "Κανάλι ήχου", "tk.audioHint": "Για ηχογραφήσεις και αρχεία ήχου.",
      "tk.inst": "Κανάλι οργάνου", "tk.instHint": "Νότες που διορθώνεις, παιγμένες από ένα ενσωματωμένο όργανο.", "tk.loops": "Περιήγηση στα loops",
      "mi.inst": "Όργανο", "mi.track": "Κανάλι οργάνου: {inst}", "mi.newClip": "Νέο κλιπ", "mi.editNotes": "Επεξεργασία νοτών",
      "mi.exportMidi": "Εξαγωγή MIDI", "mi.importMidi": "Εισαγωγή MIDI", "mi.clip": "Κλιπ MIDI", "mi.target": "Παίζει το {name}",
      "fs.title": "Ελεύθεροι ήχοι", "fs.hint": "Μεμονωμένοι ήχοι (τύμπανα, πιατίνια, μικρά κρουστά) από το VSCO 2 CE, CC0: ελεύθεροι για κάθε χρήση, χωρίς αναφορά. Πρόσθεσε έναν και γίνεται κλιπ ήχου στη θέση αναπαραγωγής.",
      "fs.play": "Άκουσε", "fs.stop": "Διακοπή", "fs.add": "Προσθήκη", "fs.loading": "Φόρτωση της λίστας…", "fs.none": "Δεν ήταν δυνατή η λήψη της λίστας. Δοκίμασε ξανά με σύνδεση.",
      "fs.fail": "Δεν ήταν δυνατή η λήψη του {name}.",
      "br.btn": "Plugin σε αυτόν τον υπολογιστή", "br.title": "Τα plugins σου (VST3, CLAP)", "br.offHint": "Το orOS Bridge είναι ένα μικρό δωρεάν πρόγραμμα για Windows και Linux που επιτρέπει στο Studio να χρησιμοποιεί τα VST3 και CLAP plugins αυτού του υπολογιστή, και όσα έχεις αγοράσει. Εγκατάστησέ το, άνοιξέ το και πάτησε Σύνδεση.", "br.get": "Κατέβασε το orOS Bridge", "br.connect": "Σύνδεση", "br.connecting": "Σύνδεση με το orOS Bridge…", "br.pairHint": "Το orOS Bridge δείχνει τώρα έναν εξαψήφιο κωδικό. Πληκτρολόγησέ τον εδώ μία φορά· αυτός ο browser θυμάται τη σύζευξη.", "br.code": "Κωδικός από το orOS Bridge", "br.pair": "Σύζευξη", "br.badCode": "Λάθος κωδικός. Το orOS Bridge δείχνει νέο.", "br.plugin": "Plugin", "br.instruments": "Όργανα (παίζουν τις νότες)", "br.effects": "Εφέ (επεξεργάζονται τον ήχο)", "br.scan": "Αναζήτηση plugins", "br.scanning": "Αναζήτηση plugins… μπορεί να πάρει ένα λεπτό.", "br.none": "Δεν βρέθηκαν plugins. Εγκατάστησε VST3 ή CLAP plugins στους συνηθισμένους φακέλους και πάτησε Αναζήτηση plugins.", "br.window": "Δείξε το παράθυρό του", "br.freeze": "Πάγωμα σε ήχο", "br.hint": "Ρύθμισε τον ήχο στο παράθυρο του plugin και πάτησε Πάγωμα: το κανάλι παίζει μέσα από το plugin σε νέο κανάλι ήχου και το αρχικό σιγάζει.", "br.again": "Παγωμένο μέσα από το {name}. Πάγωσέ το ξανά για να αντικατασταθεί ο ήχος με τον τωρινό ήχο του plugin.", "br.opening": "Άνοιγμα του {name}…", "br.rendering": "Απόδοση μέσα από το plugin… {n}%", "br.done": "Παγώθηκε: {name}", "br.fail": "Το plugin δεν μπόρεσε να αποδώσει τον ήχο. Δεν άλλαξε τίποτα.", "br.lost": "Το orOS Bridge έκλεισε. Άνοιξέ το ξανά και πάτησε Σύνδεση.", "br.nx": "Ένα κανάλι με όργανο NULL δεν μπορεί ακόμη να περάσει από plugin.", "br.empty": "Αυτό το κανάλι δεν έχει τίποτα να παίξει.", "br.gone": "Το κανάλι από το οποίο παγώθηκε αυτό έχει διαγραφεί.",
      "smp.group": "{cat} (λήψη)", "smp.cat.Keys": "Πλήκτρα", "smp.cat.Strings": "Έγχορδα", "smp.cat.Woodwinds": "Ξύλινα πνευστά",
      "smp.cat.Brass": "Χάλκινα πνευστά", "smp.cat.Percussion": "Κρουστά", "smp.loading": "Λήψη: {name}…", "smp.step": "Λήψη {name}: {n} από {total}",
      "smp.ready": "Το {name} είναι έτοιμο", "smp.fail": "Δεν ήταν δυνατή η λήψη του {name}. Παίζει ο ενσωματωμένος ήχος μέχρι να γίνει.",
      "smp.exportFail": "Δεν ήταν δυνατή η λήψη ενός οργάνου, οπότε το τραγούδι δεν εξήχθη. Δοκίμασε ξανά με σύνδεση.",
      "smp.credit": "{name} (όργανο)",
      "smp.import": "Εισαγωγή οργάνου SFZ", "smp.list": "Όργανα σε αυτή τη συσκευή", "smp.mine": "Εισηγμένα",
      "smp.listHint": "Τα όργανα που κατέβηκαν μένουν σε αυτή τη συσκευή για χρήση χωρίς σύνδεση. Αφαίρεσε ένα για να ελευθερώσεις χώρο: θα ξανακατέβει όταν το χρειαστεί ένα κανάλι.",
      "smp.none": "Δεν έχει κατέβει ακόμη κανένα όργανο.", "smp.remove": "Αφαίρεση", "smp.removed": "Το {name} αφαιρέθηκε από αυτή τη συσκευή",
      "smp.size": "{mb} MB", "smp.imported": "Εισαγωγή {name}: {n} δείγματα", "smp.skipped": "Παραλείφθηκαν, δεν βρέθηκαν ή δεν διαβάστηκαν: {n}",
      "smp.noSfz": "Διάλεξε έναν φάκελο (ή αρχεία) με ένα αρχείο .sfz και τα δείγματά του.", "smp.bad": "Αυτό το .sfz δεν έχει δείγμα που μπορεί να παίξει το Studio.",
      "smp.tooBig": "Αυτό το όργανο είναι μεγαλύτερο από {mb} MB.", "smp.noDisk": "Η εισαγωγή οργάνου χρειάζεται τον δίσκο του orOS (άνοιξε το Studio μέσα στο orOS).",
      "smp.importing": "Εισαγωγή {name}…", "smp.importFail": "Δεν ήταν δυνατή η εισαγωγή του οργάνου.", "smp.userNote": "Τα εισηγμένα όργανα είναι στον δίσκο του orOS, στο Studio/instruments, και συγχρονίζονται όπως τα αρχεία ήχου σου.",
      "mi.recMidi": "Ηχογραφούνται νότες στο {name}", "mi.recSaved": "Γράφτηκαν {n} νότες στο {name}",
      "mi.imported": "Εισήχθησαν {n} νότες από το {name}", "mi.badMidi": "Το {name} δεν είναι αρχείο MIDI που διαβάζει το Studio",
      "mi.noNotes": "Το {name} δεν έχει νότες", "mi.notesN": "{n} νότες", "mi.dbl": "Διπλό κλικ ή διπλό πάτημα σε κενό σημείο για νέο κλιπ",
      "pr.title": "Νότες: {name}", "pr.draw": "Σχεδίαση", "pr.select": "Επιλογή", "pr.tool": "Εργαλείο", "pr.grid": "Πλέγμα",
      "pr.g4": "1/4", "pr.g8": "1/8", "pr.g16": "1/16", "pr.g32": "1/32", "pr.g8t": "1/8 τρίηχο", "pr.g16t": "1/16 τρίηχο", "pr.goff": "Ελεύθερα",
      "pr.quant": "Κβαντισμός", "pr.vel": "Δυναμική", "pr.copy": "Αντιγραφή", "pr.paste": "Επικόλληση", "pr.del": "Διαγραφή νοτών", "pr.all": "Επιλογή όλων",
      "pr.import": "Εισαγωγή MIDI", "pr.export": "Εξαγωγή MIDI", "pr.keys": "Τονικά ύψη", "pr.area": "Νότες", "pr.velLane": "Δυναμική",
      "pr.note": "{name}, μέτρο {bar} χτύπος {beat}, {len} χτύποι, δυναμική {v}", "pr.nSel": "{n} επιλεγμένες", "pr.nNotes": "{n} νότες",
      "pr.deleted": "Διαγράφηκαν {n} νότες", "pr.copied": "Αντιγράφηκαν {n} νότες", "pr.noSel": "Επίλεξε πρώτα νότες", "pr.nothing": "Αντίγραψε πρώτα νότες",
      "pr.max": "Ένα κλιπ έχει έως {n} νότες", "pr.quantized": "Κβαντίστηκαν {n} νότες", "pr.play": "Αναπαραγωγή από το κλιπ",
      "pr.hint": "Σχεδίαση: πάτα ή κάνε κλικ για νέα νότα, σύρε το δεξί της άκρο για να τη μακρύνεις. Επιλογή: σύρε ένα πλαίσιο ή πάτα νότες. Σύρε νότες για να τις μετακινήσεις· διπλό κλικ σε μία τη διαγράφει.",
      "lp.btn": "Loops", "lp.title": "Loops", "lp.genre": "Στιλ", "lp.allGenres": "Όλα τα στιλ", "lp.tempo": "Τέμπο", "lp.anyTempo": "Οποιοδήποτε τέμπο",
      "lp.slow": "Αργό (κάτω από 90)", "lp.mid": "Μέτριο (90–119)", "lp.fast": "Γρήγορο (120 και πάνω)", "lp.all": "Όλα", "lp.kind": "Είδος",
      "lp.kdrums": "Ντραμς", "lp.kbass": "Μπάσο", "lp.kkeys": "Πλήκτρα",
      "lp.gpop": "Pop", "lp.grock": "Rock", "lp.ghiphop": "Hip hop", "lp.ghouse": "House", "lp.gfunk": "Funk", "lp.glofi": "Lo-fi", "lp.glatin": "Latin", "lp.gballad": "Μπαλάντα",
      "lp.name": "{kind} {genre} {n}", "lp.meta": "{n} μέτρα · {bpm} BPM · {inst}", "lp.meta1": "1 μέτρο · {bpm} BPM · {inst}",
      "lp.play": "Ακρόαση", "lp.stop": "Διακοπή", "lp.add": "Προσθήκη στη θέση αναπαραγωγής", "lp.drag": "Σύρε το σε ένα κανάλι",
      "lp.hint": "Σύρε ένα loop σε ένα κανάλι ή πάτα + για να μπει στη θέση αναπαραγωγής. Τα loops παίζουν στο τέμπο του έργου.",
      "lp.none": "Κανένα loop δεν ταιριάζει.", "lp.added": "Το {name} μπήκε στο {track}",
      "dr.kick": "Μπότα", "dr.snare": "Ταμπούρο", "dr.rim": "Στεφάνι", "dr.clap": "Παλαμάκια", "dr.hat": "Hi-hat", "dr.pedal": "Hi-hat πεντάλ", "dr.ohat": "Ανοιχτό hi-hat",
      "dr.crash": "Crash", "dr.ride": "Ride", "dr.shaker": "Shaker", "dr.cow": "Κουδούνα", "dr.tom1": "Χαμηλό tom", "dr.tom2": "Μεσαίο tom", "dr.tom3": "Ψηλό tom",
      "as.done": "Ο Βοηθός άλλαξε {n} στοιχεία σε {d} έργα.", "as.done1": "Ο Βοηθός άλλαξε {n} στοιχεία στο έργο.",
      "as.done0": "Δεν χρειάστηκε καμία αλλαγή.", "as.bad": "Το αίτημα του Βοηθού δεν διαβάστηκε. Δεν άλλαξε τίποτα.",
      "as.undone": "Η αλλαγή του Βοηθού αναιρέθηκε.", "as.changed": "Το έργο άλλαξε στο μεταξύ, γι' αυτό η αλλαγή του Βοηθού δεν αναιρέθηκε.",
      "as.gone": "Δεν έμεινε κάτι για αναίρεση."
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "studio", LANG);

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
  // Decimal comma where the language writes one (Greek, German, …).
  var DEC_COMMA = (function () {
    if (!window.orosI18n) return LANG === "el";
    try { return (1.5).toLocaleString(window.orosI18n.locale(LANG)).indexOf(",") >= 0; } catch (e) { return LANG === "el"; }
  })();
  function numTxt(n, d) {
    var s = Number(n).toFixed(d);
    return DEC_COMMA ? s.replace(".", ",") : s;
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function setLabel(b, label) { b.setAttribute("aria-label", label); b.title = label; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  var ICON = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
    import: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
    export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 21h14"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="2.5" height="14" rx="1"/><path d="M19 5v14L9 12z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    rec: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/></svg>',
    loop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
    zin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/></svg>',
    zout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 7.5a8 8 0 1 0 11.4 0"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    piano: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M12 4v16M16 4v16"/><path d="M6.5 4h3v8h-3zM14.5 4h3v8h-3z" fill="currentColor"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12M12 6v12"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/></svg>',
    cursor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l14 8-6 2-3 6z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2M9 11h6M9 15h4"/></svg>',
    selall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke-dasharray="3 2.4"/><path d="M8 10h8M8 14h5" stroke-linecap="round"/></svg>',
    grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    loops: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
    notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 7h7M9 12h9M6 17h6"/></svg>'
  };

  // BOOT MARKER
  var VER = (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("studio.js v" + (m ? m[1] : "?") + " boot");
    return m ? m[1] : "0";
  })();

  // ---------- 2. Storage + prefs ----------
  var data = C.emptyData();
  var prefs = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.projects)) {
          data = C.mergeStudio(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] studio: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = C.emptyData();
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

  // the sound card through orOS Bridge (this device only, never synced)
  function normIo(o) {
    o = o && typeof o === "object" ? o : {};
    var str = function (v, n) { return typeof v === "string" && v.length <= n ? v : ""; };
    // fx: the plugin live on the inputs (bridge 0.5.0): which one, its level (%), whether a take records its sound
    var fx = o.fx && typeof o.fx === "object" ? o.fx : {}, gain = parseInt(fx.gain, 10);
    return { on: o.on === true, be: /^[a-z0-9]{1,20}$/.test(o.be) ? o.be : "", inp: str(o.inp, 300), out: str(o.out, 300),
             ex: o.ex === true, ch: typeof o.ch === "string" && /^(all|\d{1,2}(\+\d{1,2})?)$/.test(o.ch) ? o.ch : "1",
             fx: { id: typeof fx.id === "string" && /^(vst3|clap):[\x21-\x7e]{1,200}$/.test(fx.id) ? fx.id : "", name: str(fx.name, 80),
                   gain: isFinite(gain) ? clamp(gain, 0, 200) : 100, wet: fx.wet === true, inst: fx.inst === true, midi: str(fx.midi, 200) } };
  }
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    function int(v, a, b, d) { v = parseInt(v, 10); return isFinite(v) ? clamp(v, a, b) : d; }
    prefs = {
      cur: typeof p.cur === "string" ? p.cur : "",
      zoom: ZOOMS.indexOf(p.zoom) >= 0 ? p.zoom : 40,
      snap: p.snap === "bar" || p.snap === "off" ? p.snap : "beat",
      metro: p.metro === true,
      mvol: int(p.mvol, 0, 100, 60),
      inDev: typeof p.inDev === "string" ? p.inDev : "",
      outDev: typeof p.outDev === "string" ? p.outDev : "",
      lat: int(p.lat, 0, 300, 0),
      io: normIo(p.io),
      arm: typeof p.arm === "string" ? p.arm : "",
      bits: p.bits === 16 ? 16 : 24,
      rate: p.rate === 44100 ? 44100 : 48000,
      fmt: p.fmt === "mp3" || p.fmt === "opus" ? p.fmt : "wav",
      kbps: [128, 192, 320].indexOf(p.kbps) >= 0 ? p.kbps : 192,
      okbps: [96, 128, 160, 256].indexOf(p.okbps) >= 0 ? p.okbps : 160,
      auto: idMap(p.auto, function (v) { return v === true; }),
      autoSel: idMap(p.autoSel, function (v) { return typeof v === "string" && v.length <= 40; }),
      midi: p.midi === true,
      snd: window.StudioMidi && window.StudioMidi.PRESETS[p.snd] ? p.snd : "piano",
      svol: int(p.svol, 0, 100, 80),
      oct: int(p.oct, -2, 2, 0),
      prGrid: window.StudioNotes && window.StudioNotes.GRIDS[p.prGrid] !== undefined ? p.prGrid : "1/16",
      prZoom: [12, 18, 24, 36, 48, 72, 96, 144, 192].indexOf(p.prZoom) >= 0 ? p.prZoom : 48,
      prMode: p.prMode === "select" ? "select" : "draw",
      prVel: int(p.prVel, 1, 127, 100),
      lpG: typeof p.lpG === "string" && /^[a-z]{0,12}$/.test(p.lpG) ? p.lpG : "",
      lpK: p.lpK === "drums" || p.lpK === "bass" || p.lpK === "keys" ? p.lpK : "",
      lpT: p.lpT === "slow" || p.lpT === "mid" || p.lpT === "fast" ? p.lpT : ""
    };
  }
  // { trackId: value } kept for at most 64 tracks
  function idMap(o, ok) {
    var out = {};
    if (!o || typeof o !== "object") return out;
    Object.keys(o).slice(0, 64).forEach(function (k) { if (/^t[a-z0-9]{6,20}$/.test(k) && ok(o[k])) out[k] = o[k]; });
    return out;
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 3. The open project, edits, undo ----------
  var proj = null;                 // the open project, or null (nothing made yet)
  var selClip = "";                // id of the selected clip
  var selTrack = "";               // id of the selected track (where imports go)
  var playhead = 0;                // seconds, when stopped
  var undoStack = [], redoStack = [];

  function tracks() { return proj ? C.tracksOf(data, proj.id) : []; }
  function clipsOf(tid) { return C.clipsOfTrack(data, tid); }
  function projClips() {
    if (!proj) return [];
    var ids = {};
    tracks().forEach(function (tr) { ids[tr.id] = true; });
    return data.clips.filter(function (c) { return c.p === proj.id && ids[c.t]; });
  }
  function sourceOf(sid) { return C.find(data, "sources", sid); }

  function nextM(id, old) {
    return Math.max(Date.now(), (data.tombs[id] || 0) + 1, old ? old.m + 1 : 0);
  }
  // Store a changed or new entity (stamped here: R27).
  function put(key, x) {
    var old = C.find(data, key, x.id);
    x.m = nextM(x.id, old);
    var part = C.emptyData(); part[key] = [x];
    data = C.mergeStudio(data, part);
    if (key === "projects" && proj && x.id === proj.id) proj = C.find(data, "projects", x.id);
  }
  function remove(key, id) {
    var x = C.find(data, key, id);
    if (!x) return;
    var part = C.emptyData();
    part.tombs[id] = Math.max(Date.now(), x.m);
    data = C.mergeStudio(data, part);
  }

  function snapshot() {
    if (!proj) return "";
    var pid = proj.id;
    return JSON.stringify({
      project: C.find(data, "projects", pid),
      tracks: C.ofProject(data, "tracks", pid),
      sources: C.ofProject(data, "sources", pid),
      clips: C.ofProject(data, "clips", pid)
    }, function (k, v) { return k === "m" ? undefined : v; });
  }
  // Bring the open project back to a snapshot: entities that are not in
  // it are deleted, the others are written with fresh stamps (R17).
  function restore(snap) {
    var s = JSON.parse(snap), pid = proj.id, part = C.emptyData(), now = Date.now();
    ["tracks", "sources", "clips"].forEach(function (key) {
      var keep = {};
      s[key].forEach(function (x) { keep[x.id] = true; });
      C.ofProject(data, key, pid).forEach(function (x) {
        if (!keep[x.id]) part.tombs[x.id] = Math.max(now, x.m);
      });
      s[key].forEach(function (x) {
        var n = Object.assign({}, x);
        n.m = nextM(x.id, C.find(data, key, x.id));
        part[key].push(n);
      });
    });
    if (s.project) {
      var p = Object.assign({}, s.project);
      p.m = nextM(p.id, C.find(data, "projects", p.id));
      part.projects.push(p);
    }
    data = C.mergeStudio(data, part);
    proj = C.find(data, "projects", pid);
  }
  // Every change goes through edit(): undo point, store, redraw.
  function edit(fn, opts) {
    opts = opts || {};
    var before = snapshot();
    fn();
    var after = snapshot();
    if (after === before) { renderAll(); return; }
    if (before && (!opts.merge || !undoStack.length)) {
      undoStack.push(before);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
    }
    redoStack = [];
    changed(opts);
  }
  function changed(opts) {
    saveSoon();
    renderAll();
    if (!(opts && opts.live)) replayIfPlaying();
    else updateMix();
  }
  function undo() {
    if (!undoStack.length || recording) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    fixSelection();
    changed();
    FX.render();
  }
  function redo() {
    if (!redoStack.length || recording) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    fixSelection();
    changed();
    FX.render();
  }
  // Typing a name or dragging a slider is one undo step, not one per change.
  var lastField = "", lastAt = 0;
  function burst(field, extra) {
    var now = Date.now(), merge = field === lastField && now - lastAt < 1500;
    lastField = field; lastAt = now;
    return Object.assign({ merge: merge }, extra || {});
  }

  // A project is made on the first real action (R16, R28).
  function ensureProject() {
    if (proj) return true;
    if (data.projects.length >= C.MAX_PROJECTS) { showToast(t("toast.maxProjects", { n: C.MAX_PROJECTS })); return false; }
    var p = C.normProject({ id: C.newId("p", Math.random), m: 0, name: t("proj.default", { n: data.projects.length + 1 }), bpm: C.DEFAULT.bpm, sig: C.DEFAULT.sig });
    put("projects", p);
    openProject(C.find(data, "projects", p.id));
    save();
    return true;
  }
  function openProject(p) {
    stopAll();
    flush();
    proj = p || null;
    prefs.cur = proj ? proj.id : ""; savePrefs();
    undoStack = []; redoStack = [];
    selClip = ""; selTrack = "";
    playhead = 0;
    fixSelection();
    renderAll();
    if (proj) loadProjectAudio();
  }
  function fixSelection() {
    var trs = tracks();
    if (selClip && !C.find(data, "clips", selClip)) selClip = "";
    if (selTrack && !trs.some(function (x) { return x.id === selTrack; })) selTrack = "";
    if (!selTrack && trs.length) selTrack = trs[0].id;
    if (prefs.arm && !trs.some(function (x) { return x.id === prefs.arm; })) { prefs.arm = ""; savePrefs(); }
  }

  // inst: an instrument (midi.js) for an instrument track; none = audio
  function addTrack(name, inst) {
    if (!ensureProject()) return null;
    var trs = tracks();
    if (trs.length >= C.MAX_TRACKS) { showToast(t("toast.maxTracks", { n: C.MAX_TRACKS })); return null; }
    var tr = C.normTrack({
      id: C.newId("t", Math.random), m: 0, p: proj.id,
      name: name || (inst ? t("snd." + inst) : t("track.default", { n: trs.length + 1 })),
      color: C.nextColor(trs),
      ord: trs.length ? trs[trs.length - 1].ord + 1 : 0,
      inst: inst || undefined
    });
    put("tracks", tr);
    selTrack = tr.id;
    return tr;
  }
  function deleteTrack(tid) {
    var tr = C.find(data, "tracks", tid);
    if (!tr) return;
    edit(function () {
      clipsOf(tid).forEach(function (c) { remove("clips", c.id); });
      remove("tracks", tid);
      fixSelection();
    });
    undoToast(t("toast.trackDeleted"), undo);
  }
  function moveTrack(tid, d) {
    var trs = tracks(), i = -1;
    trs.forEach(function (x, k) { if (x.id === tid) i = k; });
    var j = i + d;
    if (i < 0 || j < 0 || j >= trs.length) return;
    edit(function () {
      var a = Object.assign({}, trs[i]), b = Object.assign({}, trs[j]);
      var oa = a.ord; a.ord = b.ord; b.ord = oa;
      if (a.ord === b.ord) { a.ord = j; b.ord = i; }
      put("tracks", a); put("tracks", b);
    });
  }
  function setTrack(tid, fields, opts) {
    var tr = C.find(data, "tracks", tid);
    if (!tr) return;
    edit(function () { put("tracks", Object.assign({}, tr, fields)); }, opts);
  }
  // A new tempo moves the MIDI clips with it (same bars and beats);
  // audio clips stay where they are in time.
  function setProject(fields, opts) {
    if (!ensureProject()) return;
    edit(function () {
      var old = proj.bpm;
      put("projects", Object.assign({}, proj, fields));
      if (fields.bpm && proj.bpm !== old) retimeMidi(old / proj.bpm);
    }, opts);
  }
  function retimeMidi(r) {
    projClips().forEach(function (c) { if (C.isMidi(c)) put("clips", C.retimeClip(c, r)); });
  }
  // an instrument track, or one that holds MIDI clips (an older Studio may have dropped its instrument)
  function isInst(tr) { return !!tr && (!!tr.inst || clipsOf(tr.id).some(C.isMidi)); }
  function instOf(tr) { return (tr && tr.inst) || "piano"; }
  function instName(tr) {
    var x = nxOf(tr), i = instOf(tr), sp = smpOf(tr);
    if (x) return "NULL " + FX.nameOf(x.id);
    if (sp) return SND.find(sp) ? packName(SND.find(sp)) : sp;
    return window.StudioMidi.PRESETS[i] ? t("snd." + i) : i;
  }
  // A sample instrument (sounds.js, from oros-sounds) plays the notes when
  // the track names one in smp and no NULL instrument comes first; until
  // it is downloaded, and in an older Studio, the built-in inst plays.
  var SND = window.StudioSounds, SFZ = window.StudioSfz;
  function packName(e) { return (e.names && e.names[LANG]) || e.name; }
  function packCat(k) { var x = t("smp.cat." + k); return x === "smp.cat." + k ? k : x; }
  function smpOf(tr) { return tr && tr.smp && !nxOf(tr) ? tr.smp : ""; }
  function projSmps() { return tracks().map(smpOf).filter(Boolean); }
  var smpTold = {};
  // download what the project's tracks play; then `after` (e.g. play again)
  // (`retry`: also the ones that failed before, e.g. on Play)
  function loadSmps(a, ids, after, retry) {
    var miss = ids.filter(function (id) { return !SND.get(id) && SND.state(id) !== "gone" && (retry || SND.state(id) !== "bad"); });
    if (!miss.length) return;
    var names = function (id) { var e = SND.find(id); return e ? packName(e) : id; };
    miss.forEach(function (id) { if (SND.state(id) !== "loading") live(t("smp.loading", { name: names(id) })); });
    SND.ensure(a, miss, function (id, n, total) { if (n === total || n % 8 === 0) live(t("smp.step", { name: names(id), n: n, total: total })); }).then(function () {
      miss.forEach(function (id) { if (SND.get(id)) showToast(t("smp.ready", { name: names(id) })); });
      if (after) after();
    }, function () {
      miss.forEach(function (id) { if (!SND.get(id) && !smpTold[id]) { smpTold[id] = 1; showToast(t("smp.fail", { name: names(id) })); } });
    });
  }
  // A NULL JSFX instrument (fx.js) plays the track's notes instead of a
  // built-in sound: it is the first item of the track's chain. The
  // track keeps a built-in sound of the same kind in inst, which an
  // older Studio (and the piano roll's drum names) go by.
  function nxOf(tr) { return tr && FX ? FX.instrumentOf(tr.fx) : null; }
  function soundOf(tr) { var x = nxOf(tr); return x ? "nx:" + x.id : smpOf(tr) ? "sm:" + tr.smp : instOf(tr); }
  function nxKind(id) {
    var e = (FX.instruments() || []).filter(function (x) { return x.id === id; })[0];
    return e && /\bdrum/.test(e.tags || "") ? "drums" : "piano";
  }
  // the sound choices of a <select>: the built-in ones, then the NULL instruments
  function fillSounds(sel) {
    sel.innerHTML = "";
    M.ORDER.forEach(function (id) { var o = el("option", "", t("snd." + id)); o.value = id; sel.appendChild(o); });
    var list = FX ? FX.instruments() : [];
    if (list.length) {
      var g = el("optgroup", "");
      g.label = "NULL JSFX";
      list.forEach(function (e) { var o = el("option", "", "NULL " + e.name); o.value = "nx:" + e.id; g.appendChild(o); });
      sel.appendChild(g);
    }
    var groups = {};
    SND.list().slice().sort(function (x, y) { return packName(x).localeCompare(packName(y), LANG); }).forEach(function (e) {
      var k = e.category || "Instruments";
      if (!groups[k]) { groups[k] = el("optgroup", ""); groups[k].label = t("smp.group", { cat: packCat(k) }); sel.appendChild(groups[k]); }
      var o = el("option", "", packName(e)); o.value = "sm:" + e.id; groups[k].appendChild(o);
    });
    var mine = SND.users();
    if (mine.length) {
      var gm = el("optgroup", "");
      gm.label = t("smp.mine");
      mine.forEach(function (e) { var o = el("option", "", e.name); o.value = "sm:" + e.id; gm.appendChild(o); });
      sel.appendChild(gm);
    }
  }
  // a <select>'s value for track `tr` (or the keys' own sound `snd`)
  function soundValue(sel, tr, snd) {
    var v = tr ? soundOf(tr) : snd;
    if (sel.querySelector('option[value="' + v + '"]')) return v;
    v = tr ? instOf(tr) : snd;
    return M.PRESETS[v] ? v : "piano";
  }
  function soundCount() { return M.ORDER.length + (FX ? FX.instruments().length : 0) + SND.list().length + SND.users().length; }
  // fields for a track that takes sound `v` (a built-in id or "nx:<id>"), or null (no room)
  function soundFields(tr, v) {
    var m = /^nx:([a-z0-9_]{1,40})$/.exec(v || "");
    if (m) {
      if (!FX.isInstrument(m[1])) return null;
      var fx = FX.withInstrument(tr.fx, m[1]);
      if (!fx) { showToast(t("fx.max", { n: C.MAX_FX })); return null; }
      return { fx: fx, inst: nxKind(m[1]), smp: undefined };
    }
    var sm = /^sm:([a-z0-9][a-z0-9-]{0,39})$/.exec(v || "");
    if (sm) {
      var e = SND.find(sm[1]);
      if (!e) return null;
      return { smp: e.id, inst: e.kind, fx: FX.withInstrument(tr.fx, null) };
    }
    if (!M.PRESETS[v]) return null;
    return { inst: v, smp: undefined, fx: FX.withInstrument(tr.fx, null) };
  }
  function setSound(tr, v) {
    var f = soundFields(tr, v);
    if (!f) return;
    setTrack(tr.id, f);
    if (f.smp) { var a = audio(); if (a) loadSmps(a, [f.smp], function () { replayIfPlaying(); syncKb(); }, true); }
  }

  // ---------- 4. Audio files: disk, decoding, peaks ----------
  var buffers = {};      // source id → AudioBuffer
  var peakCache = {};    // source id → Float32Array
  var state = {};        // source id → "loading" | "ok" | "missing" | "bad"

  function fsApi() {
    try {
      var f = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return f && typeof f.readBlob === "function" && typeof f.writeBlob === "function" ? f : null;
    } catch (e) { return null; }
  }
  function vaultApi() {
    try {
      var v = window.parent && window.parent !== window ? window.parent.orosVault : null;
      return v && typeof v.status === "function" ? v : null;
    } catch (e) { return null; }
  }
  function decode(arrayBuf) {
    var a = audio();
    if (!a) return Promise.reject(new Error("no audio"));
    return new Promise(function (res, rej) {
      var p = a.decodeAudioData(arrayBuf, res, rej);
      if (p && typeof p.then === "function") p.then(res, rej);
    });
  }
  function keepBuffer(sid, buf) {
    buffers[sid] = buf;
    var chans = [];
    for (var c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c));
    peakCache[sid] = C.peaks(chans, Math.max(1, Math.ceil(buf.duration * PEAKS_PER_S)));
    state[sid] = "ok";
  }
  function loadSource(src) {
    if (state[src.id] === "ok" || state[src.id] === "loading") return Promise.resolve();
    var fs = fsApi();
    if (!fs) { state[src.id] = "missing"; return Promise.resolve(); }
    state[src.id] = "loading";
    return Promise.resolve(fs.readBlob(src.path)).then(function (blob) {
      if (!blob) throw { code: "ENOENT" };
      return blob.arrayBuffer();
    }).then(decode).then(function (buf) {
      keepBuffer(src.id, buf);
    }, function (e) {
      state[src.id] = e && typeof e.code === "string" ? "missing" : "bad";   // a disk error code, else undecodable
    });
  }
  var loadingAll = null, loadAgain = false;
  function loadProjectAudio() {
    if (!proj) return Promise.resolve();
    if (loadingAll) { loadAgain = true; return loadingAll; }
    var pid = proj.id;
    var list = C.ofProject(data, "sources", pid).filter(function (s) { return state[s.id] !== "ok"; });
    list.forEach(function (s) { delete state[s.id]; });
    if (!list.length) return Promise.resolve();
    renderLanes();
    loadingAll = list.reduce(function (p, s) {
      return p.then(function () { return loadSource(s); }).then(function () { if (proj && proj.id === pid) renderLanes(); });
    }, Promise.resolve()).then(function () {
      loadingAll = null;
      if (loadAgain) { loadAgain = false; return loadProjectAudio(); }
    });
    return loadingAll;
  }
  // Files that were missing may arrive with Vault Drive.
  var vaultUnsub = null;
  function watchVault() {
    var v = vaultApi();
    if (!v || typeof v.onStatus !== "function") return;
    try {
      vaultUnsub = v.onStatus(function (kind) {
        if (kind !== "done" || !proj) return;
        SND.scan().then(function () { renderTrackDlgIfOpen(); });
        var again = C.ofProject(data, "sources", proj.id).some(function (s) { return state[s.id] === "missing"; });
        if (again) {
          C.ofProject(data, "sources", proj.id).forEach(function (s) { if (state[s.id] === "missing") delete state[s.id]; });
          loadProjectAudio();
        }
      });
    } catch (e) {}
  }
  // Write a new audio file to the disk and make it a source.
  // lic: the sound's licence card, when it is known (free sounds)
  function addSource(name, ext, blob, buf, lic) {
    var fs = fsApi();
    if (!fs) return Promise.reject(new Error("nodisk"));
    var id = C.newId("s", Math.random), path = C.sourcePath(id, name, ext);
    return Promise.resolve(fs.writeBlob(path, blob)).then(function () {
      var src = C.normSource({ id: id, m: 0, p: proj.id, name: name, path: path, dur: buf.duration, ch: buf.numberOfChannels > 1 ? 2 : 1, lic: lic });
      put("sources", src);
      keepBuffer(id, buf);
      return C.find(data, "sources", id);
    });
  }
  // Files of a deleted project leave the disk once its Undo has passed.
  var pendingRm = {};
  function removeFilesLater(pid, paths) {
    clearTimeout(pendingRm[pid]);
    pendingRm[pid] = setTimeout(function () {
      delete pendingRm[pid];
      if (C.find(data, "projects", pid)) return;
      var fs = fsApi();
      if (!fs || typeof fs.rm !== "function") return;
      paths.forEach(function (p) { try { Promise.resolve(fs.rm(p)).catch(function () {}); } catch (e) {} });
    }, 9000);
  }

  // ---------- 5. Drawing ----------
  function zoom() { return prefs.zoom; }
  function headW() { var c = $("corner"); return c ? c.offsetWidth : 0; }
  function songLen() { return C.projectEnd(projClips()); }
  function timelineSec() {
    var view = $("view"), vis = (view.clientWidth - headW()) / zoom();
    var lp = proj && proj.loop ? proj.loop.b : 0;
    return Math.max(vis, songLen() + 30, lp + 10, playhead + 10, 30);
  }

  function renderHead() {
    $("title-view").textContent = proj ? (proj.name || t("proj.untitled")) : t("app.name");
    var n = tracks().length, tt = C.fmtTime(songLen()).replace(/\.\d+$/, "");
    $("title-sub").textContent = !n ? t("sub.none") : n === 1 ? t("sub.tracks1", { t: tt }) : t("sub.tracks", { n: n, t: tt });
    $("undo-btn").disabled = !undoStack.length || recording;
    $("redo-btn").disabled = !redoStack.length || recording;
  }
  function renderTransport() {
    var p = proj || C.normProject({ id: "pxxxxxxxx", m: 0 });
    var bi = $("bpm-in");
    if (document.activeElement !== bi) bi.value = String(p.bpm);
    $("sig-in").value = String(p.sig);
    $("snap-in").value = prefs.snap;
    var mi = $("master-in");
    if (document.activeElement !== mi) mi.value = String(p.vol);
    setLabel(mi, t("f.master") + ": " + dbTxt(p.vol));
    var mf = $("master-fx"), mn = FX.count(proj ? proj.fx : []);
    mf.classList.toggle("on", mn > 0);
    setLabel(mf, t("fx.openMaster") + (mn ? " (" + (mn === 1 ? t("fx.n1") : t("fx.n", { n: mn })) + ")" : ""));
    var lb = $("loop-btn"), lon = !!(proj && proj.loop.on);
    lb.setAttribute("aria-pressed", lon ? "true" : "false");
    lb.classList.toggle("on", lon);
    var mb = $("metro-btn");
    mb.setAttribute("aria-pressed", prefs.metro ? "true" : "false");
    mb.classList.toggle("on", prefs.metro);
    $("zoom-in").disabled = zoom() >= ZOOMS[ZOOMS.length - 1];
    $("zoom-out").disabled = zoom() <= ZOOMS[0];
    renderPlayState();
  }
  function renderPlayState() {
    var pb = $("play-btn"), rb = $("rec-btn");
    pb.innerHTML = playing && !recording ? ICON.pause : ICON.play;
    setLabel(pb, playing && !recording ? t("btn.pause") : t("btn.play"));
    pb.classList.toggle("on", !!playing && !recording);
    var fp = $("fx-play");
    fp.innerHTML = playing && !recording ? ICON.pause : ICON.play;
    setLabel(fp, playing && !recording ? t("btn.pause") : t("btn.play"));
    var pp = $("pr-play");
    pp.innerHTML = playing && !recording ? ICON.pause : ICON.play;
    setLabel(pp, playing && !recording ? t("btn.pause") : t("pr.play"));
    rb.classList.toggle("on", recording);
    setLabel(rb, recording ? t("btn.recStop") : t("btn.rec"));
    rb.setAttribute("aria-pressed", recording ? "true" : "false");
    document.body.classList.toggle("is-rec", recording);
    if (Remote) Remote.changed();
  }
  function dbTxt(db) { return db <= C.VOL_MIN ? t("db.off") : t("db", { n: (db > 0 ? "+" : "") + numTxt(db, 1) }); }
  function panTxt(p) { return p === 0 ? t("pan.c") : p < 0 ? t("pan.l", { n: -p }) : t("pan.r", { n: p }); }

  function renderRows() {
    var host = $("rows"), trs = tracks();
    host.innerHTML = "";
    var solo = C.anySolo(trs);
    trs.forEach(function (tr) {
      var row = el("div", "row track" + (tr.id === selTrack ? " sel" : ""));
      row.setAttribute("data-t", tr.id);
      row.style.setProperty("--tc", tr.color);
      var inst = isInst(tr);
      if (inst) row.classList.add("inst");
      var head = el("div", "head");
      var top = el("div", "h-top");
      var name = el("button", "h-name");
      name.type = "button";
      name.appendChild(el("span", "dot"));
      name.appendChild(el("span", "h-label", tr.name || t("track.default", { n: "" })));
      setLabel(name, inst ? tr.name + " · " + t("mi.track", { inst: instName(tr) }) : tr.name);
      name.addEventListener("click", function () { selTrack = tr.id; renderRows(); });
      top.appendChild(name);
      var more = el("button", "icon-btn small h-more");
      more.type = "button"; more.innerHTML = ICON.dots;
      setLabel(more, t("track.more") + ": " + tr.name);
      more.addEventListener("click", function () { openTrack(tr.id); });
      top.appendChild(more);
      head.appendChild(top);
      var btns = el("div", "h-btns");
      btns.appendChild(toggleBtn("ms m", "M", tr.mute, t("track.mute"), function () { setTrack(tr.id, { mute: !tr.mute }, { live: true }); }));
      btns.appendChild(toggleBtn("ms s", "S", tr.solo, t("track.solo"), function () { setTrack(tr.id, { solo: !tr.solo }, { live: true }); }));
      btns.appendChild(toggleBtn("ms r", "R", prefs.arm === tr.id, t("track.arm"), function () { armTrack(tr.id); }));
      btns.appendChild(fxBtn("ms fx", tr.fx, t("fx.open") + ": " + tr.name, function () { FX.open(tr.id); }));
      var au = toggleBtn("ms au" + ((tr.auto || []).length ? " has" : ""), t("au.btn"), !!prefs.auto[tr.id], t("au.show") + ": " + tr.name, function () { toggleAuto(tr.id); });
      btns.appendChild(au);
      head.appendChild(btns);
      var vol = el("input", "h-vol"), volAuto = !!C.activeLane(tr, "vol");
      vol.type = "range"; vol.min = String(C.VOL_MIN); vol.max = String(C.VOL_MAX); vol.step = "0.5"; vol.value = String(tr.vol);
      if (volAuto) vol.classList.add("auto");
      setLabel(vol, t("track.vol") + ": " + dbTxt(tr.vol) + (volAuto ? " (" + t("au.auto") + ")" : ""));
      vol.addEventListener("input", function () {
        var v = parseFloat(vol.value);
        setLabel(vol, t("track.vol") + ": " + dbTxt(v));
        setTrack(tr.id, { vol: v }, burst("vol" + tr.id, { live: true }));
      });
      head.appendChild(vol);
      if (solo && !tr.solo || tr.mute) row.classList.add("silent");
      row.appendChild(head);
      var lane = el("div", "lane");
      lane.setAttribute("data-t", tr.id);
      row.appendChild(lane);
      host.appendChild(row);
      if (prefs.auto[tr.id]) host.appendChild(autoRow(tr));
    });
    $("empty").hidden = trs.length > 0;
    $("add-track").disabled = trs.length >= C.MAX_TRACKS;
    renderLanes();
    syncKb();
  }
  // opens the Effects dialog; lit when the chain has effects that play
  function fxBtn(cls, items, label, fn) {
    var n = FX.count(items), b = el("button", cls + (n ? " on" : ""), t("fx.btn"));
    b.type = "button";
    b.setAttribute("aria-haspopup", "dialog");
    setLabel(b, label + (n ? " (" + (n === 1 ? t("fx.n1") : t("fx.n", { n: n })) + ")" : ""));
    b.addEventListener("click", fn);
    return b;
  }
  function toggleBtn(cls, txt, on, label, fn) {
    var b = el("button", cls + (on ? " on" : ""), txt);
    b.type = "button";
    b.setAttribute("aria-pressed", on ? "true" : "false");
    setLabel(b, label);
    b.addEventListener("click", fn);
    return b;
  }

  function renderLanes() {
    var w = Math.ceil(timelineSec() * zoom());
    $("sheet").style.setProperty("--tl-w", w + "px");
    $("sheet").style.setProperty("--beat-w", (C.beatSec(proj ? proj.bpm : 120) * zoom()) + "px");
    $("sheet").style.setProperty("--bar-w", (C.barSec(proj ? proj.bpm : 120, proj ? proj.sig : 4) * zoom()) + "px");
    [].forEach.call(document.querySelectorAll("#rows .lane"), function (lane) {
      var tid = lane.getAttribute("data-t"), list = clipsOf(tid);
      lane.innerHTML = "";
      list.forEach(function (c) { lane.appendChild(clipEl(c)); });
      if (!list.length && isInst(C.find(data, "tracks", tid))) lane.appendChild(el("span", "lane-hint", t("mi.dbl")));
    });
    [].forEach.call(document.querySelectorAll("#rows .a-lane"), drawAuto);
    renderRuler();
    renderPlayhead();
    renderClipbar();
    renderHead();
  }
  function clipEl(c) {
    if (C.isMidi(c)) return midiClipEl(c);
    var src = sourceOf(c.s), st = state[c.s] || "loading";
    var d = el("div", "clip" + (c.id === selClip ? " sel" : "") + (st !== "ok" ? " " + st : ""));
    d.setAttribute("data-c", c.id);
    d.style.left = (c.at * zoom()) + "px";
    d.style.width = Math.max(4, c.len * zoom()) + "px";
    d.tabIndex = 0;
    d.setAttribute("role", "button");
    var name = src ? src.name : "";
    d.setAttribute("aria-label", name + ", " + C.fmtTime(c.at) + " – " + C.fmtTime(C.clipEnd(c)));
    d.appendChild(el("span", "c-name", name));
    if (st === "ok") {
      var cv = el("canvas", "c-wave");
      d.appendChild(cv);
      drawWave(cv, c);
    } else {
      d.appendChild(el("span", "c-state", st === "missing" ? t("clip.missing") : st === "bad" ? t("clip.bad") : t("clip.loading")));
    }
    if (c.fi > 0) { var fi = el("span", "c-fade in"); fi.style.width = (c.fi * zoom()) + "px"; d.appendChild(fi); }
    if (c.fo > 0) { var fo = el("span", "c-fade out"); fo.style.width = (c.fo * zoom()) + "px"; d.appendChild(fo); }
    d.appendChild(el("span", "c-edge l"));
    d.appendChild(el("span", "c-edge r"));
    return d;
  }
  function clipName(c) {
    if (!C.isMidi(c)) { var src = sourceOf(c.s); return src ? src.name : ""; }
    var tr = C.find(data, "tracks", c.t);
    return c.name || (tr ? tr.name : "") || t("mi.clip");
  }
  // a MIDI clip: its notes as small bars
  function midiClipEl(c) {
    var d = el("div", "clip midi" + (c.id === selClip ? " sel" : ""));
    d.setAttribute("data-c", c.id);
    d.style.left = (c.at * zoom()) + "px";
    d.style.width = Math.max(4, c.len * zoom()) + "px";
    d.tabIndex = 0;
    d.setAttribute("role", "button");
    var name = clipName(c);
    d.setAttribute("aria-label", t("mi.clip") + ": " + name + ", " + C.fmtTime(c.at) + " – " + C.fmtTime(C.clipEnd(c)) + ", " + t("mi.notesN", { n: c.n.length }));
    d.appendChild(el("span", "c-name", name));
    var cv = el("canvas", "c-wave");
    d.appendChild(cv);
    drawNotes(cv, c);
    d.appendChild(el("span", "c-edge l"));
    d.appendChild(el("span", "c-edge r"));
    return d;
  }
  function drawNotes(cv, c) {
    var w = Math.max(1, Math.min(4096, Math.round(c.len * zoom()))), h = 48;
    cv.width = w; cv.height = h;
    var g = cv.getContext("2d");
    if (!g) return;
    var vis = c.n.filter(function (q) { return q[1] >= c.off && q[1] < c.off + c.len; });
    if (!vis.length) return;
    var lo = 127, hi = 0;
    vis.forEach(function (q) { lo = Math.min(lo, q[0]); hi = Math.max(hi, q[0]); });
    if (hi - lo < 12) { var mid = (hi + lo) / 2; lo = Math.floor(mid - 6); hi = Math.ceil(mid + 6); }
    var rows = hi - lo + 1, rh = Math.max(1, Math.min(4, (h - 4) / rows)), k = w / c.len;
    g.fillStyle = "rgba(255,255,255,0.9)";
    vis.forEach(function (q) {
      var x = (q[1] - c.off) * k, y = 2 + (hi - q[0]) * (h - 4 - rh) / Math.max(1, rows - 1);
      g.globalAlpha = 0.45 + 0.55 * q[3] / 127;
      g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(Math.min(q[2], c.off + c.len - q[1]) * k) - 1), Math.max(1, Math.round(rh)));
    });
    g.globalAlpha = 1;
  }
  function drawWave(cv, c) {
    var pk = peakCache[c.s];
    if (!pk) return;
    var w = Math.max(1, Math.min(4096, Math.round(c.len * zoom()))), h = 48;
    cv.width = w; cv.height = h;
    var g = cv.getContext("2d");
    if (!g) return;
    var n = pk.length / 2, cg = C.dbToGain(c.gain);
    g.fillStyle = "rgba(255,255,255,0.85)";
    for (var x = 0; x < w; x++) {
      var t0 = c.off + (x / w) * c.len, t1 = c.off + ((x + 1) / w) * c.len;
      var b0 = Math.floor(t0 * PEAKS_PER_S), b1 = Math.max(b0 + 1, Math.floor(t1 * PEAKS_PER_S));
      var lo = 0, hi = 0;
      for (var b = b0; b < b1 && b < n; b++) { if (pk[b * 2] < lo) lo = pk[b * 2]; if (pk[b * 2 + 1] > hi) hi = pk[b * 2 + 1]; }
      var fg = C.fadeGainAt(c, (x + 0.5) / w * c.len) * cg;
      lo = clamp(lo * fg, -1, 1); hi = clamp(hi * fg, -1, 1);
      var y0 = Math.round(h / 2 - hi * h / 2), y1 = Math.round(h / 2 - lo * h / 2);
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }

  function renderRuler() {
    var r = $("ruler"), z = zoom();
    r.innerHTML = "";
    var bpm = proj ? proj.bpm : 120, sig = proj ? proj.sig : 4;
    var bar = C.barSec(bpm, sig), every = 1;
    while (bar * every * z < 48) every *= 2;
    var total = timelineSec();
    for (var i = 0; i * bar < total; i += every) {
      var m = el("span", "tick", String(i + 1));
      m.style.left = (i * bar * z) + "px";
      r.appendChild(m);
    }
    if (proj && (proj.loop.b > proj.loop.a)) {
      var lp = el("div", "loop" + (proj.loop.on ? " on" : ""));
      lp.style.left = (proj.loop.a * z) + "px";
      lp.style.width = ((proj.loop.b - proj.loop.a) * z) + "px";
      r.appendChild(lp);
    }
    r.setAttribute("aria-valuemax", String(Math.round(total)));
  }
  function renderPlayhead() {
    var pos = playing ? position() : playhead;
    $("playhead").style.transform = "translateX(" + (headW() + pos * zoom()) + "px)";
    var r = $("ruler");
    r.setAttribute("aria-valuenow", String(Math.round(pos * 10) / 10));
    r.setAttribute("aria-valuetext", C.fmtTime(pos));
    $("clock-time").textContent = C.fmtTime(pos);
    var bb = C.barBeat(pos, proj ? proj.bpm : 120, proj ? proj.sig : 4);
    $("clock-bar").textContent = bb.bar + "." + bb.beat;
    if (!playing && Remote) Remote.changed();
  }
  // Keep the playhead in view while playing.
  function followPlayhead(pos) {
    var view = $("view"), x = headW() + pos * zoom(), left = view.scrollLeft + headW();
    if (x > view.scrollLeft + view.clientWidth - 40 || x < left) view.scrollLeft = Math.max(0, x - headW() - 40);
  }

  function renderClipbar() {
    var c = selClip ? C.find(data, "clips", selClip) : null, bar = $("clipbar");
    bar.hidden = !c;
    document.body.classList.toggle("has-clip", !!c);
    if (!c) return;
    var midi = C.isMidi(c);
    $("clip-name").textContent = clipName(c);
    $("notes-btn").hidden = !midi;
    $("lic-btn").hidden = midi;
    $("fi-field").hidden = midi;
    $("fo-field").hidden = midi;
    var gi = $("gain-in"), fi = $("fi-in"), fo = $("fo-in");
    var maxF = Math.max(0.01, Math.min(10, c.len));
    fi.max = String(maxF); fo.max = String(maxF);
    fi.step = fo.step = maxF > 2 ? "0.05" : "0.01";
    if (document.activeElement !== gi) gi.value = String(c.gain);
    if (document.activeElement !== fi) fi.value = String(c.fi);
    if (document.activeElement !== fo) fo.value = String(c.fo);
    $("gain-out").textContent = dbTxt(c.gain);
    $("fi-out").textContent = t("sec", { n: numTxt(c.fi, 2) });
    $("fo-out").textContent = t("sec", { n: numTxt(c.fo, 2) });
  }
  function renderAll() {
    renderTransport();
    renderRows();
    if (Roll && Roll.isOpen()) Roll.render();
    if (Remote) Remote.changed();
  }

  // ---------- 5b. Automation lanes ----------
  // Under a track (its "A" button, or Automation in its settings on a
  // phone): one lane at a time, picked in the list (volume, pan or an
  // effect slider); lanes with points play whichever is shown. Tap an
  // empty spot to add a point, drag a point to move it, double-click it
  // or press Delete to remove it. The line between points is what plays.
  var SVGNS = "http://www.w3.org/2000/svg";
  var A_PAD = 6;                   // px above the top and below the bottom value
  var aSel = null;                 // { tid, k, i }: the selected point
  var adrag = null;
  function toggleAuto(tid) {
    if (prefs.auto[tid]) delete prefs.auto[tid]; else prefs.auto[tid] = true;
    savePrefs();
    renderRows();
  }
  // What a lane can follow on this track: [{ k, name, min, max, sl? }]
  function laneOptions(tr) {
    var out = [{ k: "vol", name: t("au.vol"), min: C.VOL_MIN, max: C.VOL_MAX }, { k: "pan", name: t("au.pan"), min: -100, max: 100 }];
    FX.params(tr.fx, renderLanesFast).forEach(function (p) { out.push({ k: p.k, name: p.name, min: p.sl.min, max: p.sl.max, sl: p.sl }); });
    return out;
  }
  function laneOpt(tr, k) {
    var list = laneOptions(tr);
    return list.filter(function (o) { return o.k === k; })[0] || list[0];
  }
  function laneOf(tr, k) { return (tr.auto || []).filter(function (x) { return x.k === k; })[0] || null; }
  function laneKey(tr) { return laneOpt(tr, prefs.autoSel[tr.id] || "vol").k; }
  function laneText(o, v) {
    if (o.k === "vol") return dbTxt(v);
    if (o.k === "pan") return panTxt(Math.round(v));
    return FX.valueText(o.sl, v);
  }
  function lanePos(o, v) { return o.max === o.min ? 0 : clamp((v - o.min) / (o.max - o.min), 0, 1); }
  function laneVal(o, pos) {
    var v = o.min + clamp(pos, 0, 1) * (o.max - o.min);
    if (o.k === "vol") return Math.round(v * 10) / 10;
    if (o.k === "pan") return Math.round(v);
    return C.sliderStep(o.sl, v);
  }
  // the value the parameter has without automation
  function staticVal(tr, o) {
    if (o.k === "vol") return tr.vol;
    if (o.k === "pan") return tr.pan;
    var f = C.laneFx(o.k), x = (tr.fx || []).filter(function (y) { return y.u === f.u; })[0];
    return C.fxValue(x, o.sl);
  }
  function autoRow(tr) {
    var k = laneKey(tr), o = laneOpt(tr, k), lane = laneOf(tr, k);
    var row = el("div", "row auto"), head = el("div", "head a-head");
    row.setAttribute("data-t", tr.id);
    row.style.setProperty("--tc", tr.color);
    var sel = el("select", "a-sel");
    setLabel(sel, t("au.param") + ": " + tr.name);
    laneOptions(tr).forEach(function (x) {
      var has = !!laneOf(tr, x.k), op = el("option", "", has ? "● " + x.name : x.name);
      op.value = x.k;
      if (has) op.setAttribute("aria-label", t("au.used", { name: x.name }));
      sel.appendChild(op);
    });
    sel.value = k;
    sel.addEventListener("change", function () { prefs.autoSel[tr.id] = sel.value; savePrefs(); aSel = null; renderRows(); });
    head.appendChild(sel);
    var btns = el("div", "a-btns");
    var on = el("button", "ms a-on" + (lane && lane.on !== false ? " on" : ""));
    on.type = "button"; on.innerHTML = ICON.power;
    on.setAttribute("aria-pressed", lane && lane.on !== false ? "true" : "false");
    on.disabled = !lane;
    setLabel(on, t("au.on") + ": " + o.name);
    on.addEventListener("click", function () { setLaneOf(tr.id, k, { on: lane.on === false }); });
    btns.appendChild(on);
    var del = el("button", "ms a-del");
    del.type = "button"; del.innerHTML = ICON.close;
    del.disabled = !(lane && aSel && aSel.tid === tr.id && aSel.k === k && lane.p[aSel.i]);
    setLabel(del, t("au.delPt"));
    del.addEventListener("click", function () { if (aSel) delPoint(aSel.tid, aSel.k, aSel.i); });
    btns.appendChild(del);
    var clr = el("button", "ms a-clr");
    clr.type = "button"; clr.innerHTML = ICON.trash;
    clr.disabled = !lane;
    setLabel(clr, t("au.clear") + ": " + o.name);
    clr.addEventListener("click", function () {
      aSel = null;
      setLaneOf(tr.id, k, { p: [] });
      undoToast(t("au.cleared"), undo);
    });
    btns.appendChild(clr);
    head.appendChild(btns);
    row.appendChild(head);
    var area = el("div", "a-lane" + (lane && lane.on === false ? " off" : ""));
    area.setAttribute("data-t", tr.id);
    area.setAttribute("data-k", k);
    area.setAttribute("role", "group");
    setLabel(area, t("au.lane", { name: o.name }));
    row.appendChild(area);
    return row;
  }
  function svgEl(tag, cls) { var n = document.createElementNS(SVGNS, tag); if (cls) n.setAttribute("class", cls); return n; }
  // the line, its points and the hint, for one lane element
  function drawAuto(area) {
    var tr = C.find(data, "tracks", area.getAttribute("data-t"));
    if (!tr) return;
    var k = area.getAttribute("data-k"), o = laneOpt(tr, k), lane = laneOf(tr, k), z = zoom();
    var w = Math.ceil(timelineSec() * z), h = area.clientHeight || 60;
    var y = function (v) { return Math.round((A_PAD + (1 - lanePos(o, v)) * (h - 2 * A_PAD)) * 10) / 10; };
    area.innerHTML = "";
    var svg = svgEl("svg", "a-svg");
    svg.setAttribute("width", String(w)); svg.setAttribute("height", String(h));
    svg.setAttribute("aria-hidden", "true");
    var pts = lane ? lane.p : [], d;
    if (!pts.length) d = "M0," + y(staticVal(tr, o)) + "H" + w;
    else {
      d = "M0," + y(pts[0][1]);
      pts.forEach(function (q) { d += "L" + Math.round(q[0] * z * 10) / 10 + "," + y(q[1]); });
      d += "H" + w;
      var fill = svgEl("path", "a-fill");
      fill.setAttribute("d", d + "V" + h + "H0Z");
      svg.appendChild(fill);
    }
    var line = svgEl("path", "a-line" + (pts.length ? "" : " static"));
    line.setAttribute("d", d);
    svg.appendChild(line);
    area.appendChild(svg);
    pts.forEach(function (q, i) {
      var b = el("span", "a-pt" + (aSel && aSel.tid === tr.id && aSel.k === k && aSel.i === i ? " sel" : ""));
      b.style.left = (q[0] * z) + "px";
      b.style.top = y(q[1]) + "px";
      b.tabIndex = 0;
      b.setAttribute("role", "slider");
      b.setAttribute("data-i", String(i));
      b.setAttribute("aria-valuemin", String(Math.min(o.min, o.max)));
      b.setAttribute("aria-valuemax", String(Math.max(o.min, o.max)));
      b.setAttribute("aria-valuenow", String(q[1]));
      b.setAttribute("aria-valuetext", laneText(o, q[1]));
      setLabel(b, t("au.pt", { t: C.fmtTime(q[0]), v: laneText(o, q[1]) }));
      area.appendChild(b);
    });
    if (aSel && aSel.tid === tr.id && aSel.k === k && pts[aSel.i]) {
      var tip = el("span", "a-tip", laneText(o, pts[aSel.i][1]));
      tip.style.left = (pts[aSel.i][0] * z) + "px";
      tip.style.top = Math.max(0, y(pts[aSel.i][1]) - 26) + "px";
      tip.setAttribute("aria-hidden", "true");
      area.appendChild(tip);
    }
    if (!pts.length) area.appendChild(el("span", "a-hint", t("au.hint")));
  }
  function setLaneOf(tid, k, fields, opts) {
    var tr = C.find(data, "tracks", tid);
    if (!tr) return;
    if (!laneOf(tr, k) && (tr.auto || []).length >= C.MAX_LANES) { showToast(t("au.max", { n: C.MAX_LANES })); return; }
    edit(function () { put("tracks", Object.assign({}, tr, { auto: C.setLane(tr, k, fields) })); }, opts);
  }
  function delPoint(tid, k, i) {
    var tr = C.find(data, "tracks", tid), lane = tr && laneOf(tr, k);
    if (!lane || !lane.p[i]) return;
    var p = lane.p.slice(); p.splice(i, 1);
    aSel = p.length ? { tid: tid, k: k, i: Math.max(0, i - 1) } : null;
    setLaneOf(tid, k, { p: p });
    focusPoint();
  }
  function focusPoint() {
    if (!aSel) return;
    var n = document.querySelector('#rows .a-lane[data-t="' + aSel.tid + '"] .a-pt[data-i="' + aSel.i + '"]');
    if (n) n.focus();
  }
  // a pointer position in a lane -> [time, value]
  function lanePoint(area, o, clientX, clientY) {
    var r = area.getBoundingClientRect(), h = area.clientHeight || 60;
    var sec = Math.max(0, (clientX - r.left) / zoom());
    sec = C.snap(sec, proj.bpm, proj.sig, prefs.snap);
    var pos = 1 - (clientY - r.top - A_PAD) / Math.max(1, h - 2 * A_PAD);
    return [Math.min(C.MAX_SEC, Math.round(sec * 1e4) / 1e4), laneVal(o, pos)];
  }
  function autoDown(e, area) {
    var tid = area.getAttribute("data-t"), k = area.getAttribute("data-k"), tr = C.find(data, "tracks", tid);
    if (!tr || !proj) return;
    var pt = e.target.closest && e.target.closest(".a-pt");
    if (pt) {
      e.preventDefault();
      aSel = { tid: tid, k: k, i: +pt.getAttribute("data-i") };
      adrag = { mode: "pt", tid: tid, k: k, i: aSel.i, x0: e.clientX, y0: e.clientY, moved: false, pid: e.pointerId, before: snapshot(), area: area };
      try { $("rows").setPointerCapture(e.pointerId); } catch (err) {}
      renderRows();
      focusPoint();
      return;
    }
    // an empty spot: a point is added on release, unless the finger scrolled
    adrag = { mode: "add", tid: tid, k: k, x0: e.clientX, y0: e.clientY, moved: false, pid: e.pointerId, area: area };
  }
  function autoMove(e) {
    var d = adrag;
    if (!d || e.pointerId !== d.pid) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 4 && Math.abs(e.clientY - d.y0) < 4) return;
    d.moved = true;
    if (d.mode !== "pt") return;
    var tr = C.find(data, "tracks", d.tid), lane = tr && laneOf(tr, d.k);
    if (!lane || !lane.p[d.i]) return;
    var area = document.querySelector('#rows .a-lane[data-t="' + d.tid + '"]') || d.area;
    var o = laneOpt(tr, d.k), q = lanePoint(area, o, e.clientX, e.clientY), p = lane.p.slice();
    var lo = d.i > 0 ? p[d.i - 1][0] : 0, hi = d.i < p.length - 1 ? p[d.i + 1][0] : C.MAX_SEC;
    p[d.i] = [clamp(q[0], lo, hi), q[1]];
    put("tracks", Object.assign({}, tr, { auto: C.setLane(tr, d.k, { p: p }) }));
    renderLanesFast();
  }
  function autoUp(e) {
    var d = adrag;
    if (!d || e.pointerId !== d.pid) return;
    adrag = null;
    if (d.mode === "add") {
      if (d.moved || e.type === "pointercancel") return;
      var tr = C.find(data, "tracks", d.tid), lane = tr && laneOf(tr, d.k), o = tr && laneOpt(tr, d.k);
      if (!tr) return;
      var p = lane ? lane.p.slice() : [];
      if (p.length >= C.MAX_PTS) { showToast(t("au.maxPts", { n: C.MAX_PTS })); return; }
      var q = lanePoint(d.area, o, e.clientX, e.clientY), i = 0;
      while (i < p.length && p[i][0] <= q[0]) i++;
      p.splice(i, 0, q);
      aSel = { tid: d.tid, k: d.k, i: i };
      setLaneOf(d.tid, d.k, { p: p });
      focusPoint();
      return;
    }
    if (d.moved && snapshot() !== d.before) {
      undoStack.push(d.before);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      redoStack = [];
      changed();
    } else renderRows();
    focusPoint();
  }
  // keys on a focused point: arrows move it, Delete removes it
  function autoKey(e, pt) {
    var area = pt.closest(".a-lane"), tid = area.getAttribute("data-t"), k = area.getAttribute("data-k");
    var tr = C.find(data, "tracks", tid), lane = tr && laneOf(tr, k), i = +pt.getAttribute("data-i");
    if (!lane || !lane.p[i]) return;
    var o = laneOpt(tr, k), p = lane.p.slice(), q = p[i].slice(), key = e.key;
    if (key === "Delete" || key === "Backspace") { e.preventDefault(); e.stopPropagation(); delPoint(tid, k, i); return; }
    var dv = key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : 0, dt = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
    if (!dv && !dt) return;
    e.preventDefault(); e.stopPropagation();
    if (dv) q[1] = laneVal(o, lanePos(o, q[1]) + dv * (e.shiftKey ? 0.1 : 0.02));
    if (dt) {
      var step = e.shiftKey ? C.barSec(proj.bpm, proj.sig) : C.beatSec(proj.bpm) / 4;
      var lo = i > 0 ? p[i - 1][0] : 0, hi = i < p.length - 1 ? p[i + 1][0] : C.MAX_SEC;
      q[0] = clamp(Math.round((q[0] + dt * step) * 1e4) / 1e4, lo, hi);
    }
    p[i] = q;
    aSel = { tid: tid, k: k, i: i };
    setLaneOf(tid, k, { p: p }, burst("au" + tid + k + i));
    focusPoint();
  }

  // ---------- 6. Pointer: clips, ruler, lanes ----------
  function secAt(clientX) {
    var view = $("view"), rect = view.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + view.scrollLeft - headW()) / zoom());
  }
  function laneAt(clientX, clientY) {
    var n = document.elementFromPoint(clientX, clientY);
    var row = n && n.closest ? n.closest(".row.track") : null;
    return row ? row.getAttribute("data-t") : "";
  }
  var drag = null;
  // a second tap or click on the same spot soon after the first (the rows
  // are drawn anew in between, so the browser's dblclick does not reach them)
  var lastTap = { at: 0, key: "", x: 0 };
  function twice(key, x) {
    var now = Date.now(), hit = lastTap.key === key && now - lastTap.at < 450 && Math.abs(x - lastTap.x) < 24;
    lastTap = hit ? { at: 0, key: "", x: 0 } : { at: now, key: key, x: x };
    return hit;
  }
  function onRowsDown(e) {
    if (e.button !== 0 || recording) return;
    var aEl = e.target.closest && e.target.closest(".a-lane");
    if (aEl) { autoDown(e, aEl); return; }
    var cEl = e.target.closest && e.target.closest(".clip");
    var lane = e.target.closest && e.target.closest(".lane");
    if (!lane) return;
    if (!cEl) {                                            // empty lane: select the track, move the playhead
      selTrack = lane.getAttribute("data-t");
      selClip = "";
      if (twice("l" + selTrack, e.clientX) && isInst(C.find(data, "tracks", selTrack))) { newMidiClip(selTrack, secAt(e.clientX)); return; }
      seek(C.snap(secAt(e.clientX), proj.bpm, proj.sig, prefs.snap));
      renderRows();
      return;
    }
    var c = C.find(data, "clips", cEl.getAttribute("data-c"));
    if (!c) return;
    e.preventDefault();
    selClip = c.id; selTrack = c.t;
    var rect = cEl.getBoundingClientRect(), edge = Math.min(10, rect.width / 4);
    var mode = e.clientX - rect.left < edge ? "l" : rect.right - e.clientX < edge ? "r" : "move";
    drag = { id: c.id, mode: mode, x0: e.clientX, y0: e.clientY, orig: c, before: snapshot(), moved: false, pid: e.pointerId };
    try { $("rows").setPointerCapture(e.pointerId); } catch (err) {}
    renderRows();
  }
  function onRowsMove(e) {
    if (adrag) { autoMove(e); return; }
    if (!drag || e.pointerId !== drag.pid) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    drag.moved = true;
    var o = drag.orig, src = C.isMidi(o) ? null : sourceOf(o.s), dur = src ? src.dur : 0, n, ds = dx / zoom();
    if (drag.mode === "move") {
      var at = C.snap(o.at + ds, proj.bpm, proj.sig, prefs.snap);
      n = C.moveClip(o, at);
      var tid = laneAt(e.clientX, e.clientY);
      if (tid && isInst(C.find(data, "tracks", tid)) === C.isMidi(o)) n.t = tid;   // MIDI clips stay on instrument tracks, audio on audio tracks
    } else if (drag.mode === "l") {
      n = C.trimStart(o, C.snap(o.at + ds, proj.bpm, proj.sig, prefs.snap), dur);
    } else {
      n = C.trimEnd(o, C.snap(C.clipEnd(o) + ds, proj.bpm, proj.sig, prefs.snap), dur);
    }
    put("clips", n);
    selTrack = n.t;
    renderLanesFast();
  }
  function onRowsUp(e) {
    if (adrag) { autoUp(e); return; }
    if (!drag || e.pointerId !== drag.pid) return;
    var d = drag; drag = null;
    if (!d.moved) {
      if (twice("c" + d.id, e.clientX) && C.isMidi(C.find(data, "clips", d.id))) { openRoll(d.id); return; }
      renderClipbar();
      return;
    }
    if (snapshot() !== d.before) {
      undoStack.push(d.before);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      redoStack = [];
      changed();
    }
  }
  var fastTimer = 0;
  function renderLanesFast() {
    if (fastTimer) return;
    fastTimer = requestAnimationFrame(function () { fastTimer = 0; renderRows(); });
  }

  var rdrag = null;
  function onRulerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    rdrag = { x0: e.clientX, a: secAt(e.clientX), moved: false, pid: e.pointerId };
    try { $("ruler").setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onRulerMove(e) {
    if (!rdrag || e.pointerId !== rdrag.pid || !proj && !ensureProject()) return;
    if (!rdrag.moved && Math.abs(e.clientX - rdrag.x0) < 5) return;
    rdrag.moved = true;
    var a = C.snap(rdrag.a, proj.bpm, proj.sig, prefs.snap), b = C.snap(secAt(e.clientX), proj.bpm, proj.sig, prefs.snap);
    if (b < a) { var x = a; a = b; b = x; }
    rdrag.loop = { on: b - a >= C.MIN_LEN, a: a, b: b };
    proj = Object.assign({}, proj, { loop: rdrag.loop });
    renderRuler();
  }
  function onRulerUp(e) {
    if (!rdrag || e.pointerId !== rdrag.pid) return;
    var d = rdrag; rdrag = null;
    if (!d.moved) { seek(C.snap(d.a, proj ? proj.bpm : 120, proj ? proj.sig : 4, prefs.snap)); return; }
    proj = C.find(data, "projects", proj.id);
    if (d.loop) setProject({ loop: d.loop });
  }
  function onRulerKey(e) {
    var step = e.shiftKey ? C.barSec(proj ? proj.bpm : 120, proj ? proj.sig : 4) : C.beatSec(proj ? proj.bpm : 120);
    var pos = playing ? position() : playhead;
    if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); seek(Math.max(0, pos - step)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); seek(pos + step); }
  }

  // ---------- 7. Engine ----------
  var actx = null, masterGain = null, analyser = null, trackNodes = {};
  var FX = null;                 // effects (fx.js)
  var Remote = null;             // Studio Remote (remote.js)
  var fxLat = 0;                 // seconds the effects delay what is heard
  var fxFail = false;
  var playing = null;            // { t0, from, loop, passes, ... } while playing
  var recording = false;
  var tickTimer = null, rafId = 0;

  function audio() {
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        actx = new AC({ latencyHint: "interactive" });
        masterGain = actx.createGain();
        analyser = actx.createAnalyser();
        analyser.fftSize = 1024;
        masterGain.connect(analyser);
        analyser.connect(actx.destination);
        applyOutput();
      }
      return actx;
    } catch (e) { return null; }
  }
  function resume() { try { if (actx && actx.state === "suspended") return actx.resume(); } catch (e) {} return Promise.resolve(); }

  // Track nodes: clip sources → effects → tap → (automation gain) → track
  // gain → pan → master. The tap is the track after its effects and
  // before its fader: what a sidechain key hears.
  // A track whose effects delay it less than the slowest track's has its
  // clips started later by the difference (nodes[id].shift, seconds), so
  // all tracks stay in time; the faders all hear their audio `late`
  // seconds after it was scheduled. Returns the largest delay (samples).
  // extraFor(tr, shift): an export's MIDI and transport for the track's chain (fx.js insert)
  function buildTracks(a, out, nodes, offline, extraFor) {
    var trs = tracks(), solo = C.anySolo(trs), sr = a.sampleRate, lat = {}, max = 0;
    trs.forEach(function (tr) {
      lat[tr.id] = FX.isReady(a, [tr.fx]) ? FX.chainLatency(tr.fx, sr) : 0;
      max = Math.max(max, lat[tr.id]);
    });
    trs.forEach(function (tr) {
      var g = a.createGain(), pn = a.createStereoPanner ? a.createStereoPanner() : null, tap = a.createGain(), ag = null;
      g.gain.value = staticGain(tr, solo);
      if (C.activeLane(tr, "vol")) { ag = a.createGain(); tap.connect(ag); ag.connect(g); } else tap.connect(g);
      if (pn) { pn.pan.value = tr.pan / 100; g.connect(pn); pn.connect(out); } else g.connect(out);
      var shift = (max - lat[tr.id]) / sr;
      var chain = FX.insert(a, tr.id, tr.fx, tap, offline, tr.auto, extraFor ? extraFor(tr, shift) : null), meter = null;
      if (!offline && a.createAnalyser) {             // the track's level, for Studio Remote
        meter = a.createAnalyser(); meter.fftSize = 512;
        (pn || g).connect(meter);
      }
      // not a DelayNode: Chromium drops a DelayNode's tail once its source has ended
      // nx: a NULL instrument in the chain plays the notes (as MIDI), else the built-in sound
      nodes[tr.id] = { id: tr.id, gain: g, pan: pn, tap: tap, ag: ag, chain: chain, input: chain || tap, meter: meter,
                       shift: shift, late: max / sr, inst: instOf(tr), nx: !!(chain && nxOf(tr)), smp: smpOf(tr) };
    });
    wireKeys(trs, nodes);
    return max;
  }
  // Sidechain: each key input gets its track's tap (no loops, see C.keyPlan)
  function wireKeys(trs, nodes) {
    var plan = C.keyPlan(trs);
    trs.forEach(function (tr) {
      var n = nodes[tr.id];
      if (!n || !n.chain) return;
      FX.keyInputs(tr.fx).forEach(function (k) {
        if (plan[tr.id] && plan[tr.id][k.sc] && nodes[k.sc]) { try { nodes[k.sc].tap.connect(n.chain, 0, k.input); } catch (e) {} }
      });
    });
  }
  // With a volume lane the fader's own value gives way to the lane (mute and solo still count).
  function staticGain(tr, solo) {
    if (C.activeLane(tr, "vol")) return tr.mute || (solo && !tr.solo) ? 0 : 1;
    return C.trackGain(tr, solo);
  }
  // master → its effects → `to`; returns the effects' delay (samples)
  function routeMaster(a, from, to, offline, nodes, extra) {
    try { from.disconnect(); } catch (e) {}
    var n = FX.insert(a, "master", proj.fx, to, offline, null, extra);
    from.connect(n || to);
    if (n && nodes) FX.keyInputs(proj.fx).forEach(function (k) {
      if (nodes[k.sc]) { try { nodes[k.sc].tap.connect(n, 0, k.input); } catch (e) {} }
    });
    return n ? FX.chainLatency(proj.fx, a.sampleRate) : 0;
  }
  // Automation of project time from..to, which plays from context time
  // `start`: volume and pan where the faders hear it, effect sliders
  // where their chain does. `first`: drop what an earlier play left.
  function schedAuto(a, nodes, from, to, start, first) {
    tracks().forEach(function (tr) {
      var n = nodes[tr.id];
      if (!n) return;
      var vl = C.activeLane(tr, "vol"), pl = C.activeLane(tr, "pan");
      if (vl && n.ag) rampParam(a, n.ag.gain, C.autoEvents(vl.p, from, to), start + n.late, function (v) { return C.dbToGain(v); }, first, true);
      if (pl && n.pan) rampParam(a, n.pan.pan, C.autoEvents(pl.p, from, to), start + n.late, function (v) { return v / 100; }, first, false);
      if (n.chain && n.chain.parameters) FX.autoParams(tr.fx, tr.auto).forEach(function (x) {
        var prm = n.chain.parameters.get("a" + x.k);
        if (prm) rampParam(a, prm, C.autoEvents(x.lane.p, from, to), start + n.shift, function (v) { return v; }, first, false);
      });
    });
  }
  function rampParam(a, prm, ev, t0, conv, first, expo) {
    if (!ev.length) return;
    try {
      if (first) { prm.cancelScheduledValues(0); prm.setValueAtTime(conv(ev[0].v), a.currentTime); }
      // Volume (expo): even in dB. The lane's floor (-60 dB) is silence, which an
      // exponential ramp cannot reach, so ramps run to or from -60 dB and the
      // value drops to 0 where the lane rests at the floor.
      ev.forEach(function (x, i) {
        var v = conv(x.v), at = t0 + x.at, nx = ev[i + 1], q = expo ? Math.max(v, 1e-3) : v;
        if (!x.ramp || i === 0) prm.setValueAtTime(q, at);
        else if (expo) prm.exponentialRampToValueAtTime(q, at);
        else prm.linearRampToValueAtTime(v, at);
        if (expo && v === 0 && !(nx && nx.ramp && conv(nx.v) > 0)) prm.setValueAtTime(0, at);
      });
    } catch (e) { /* a value the param refuses: the lane is skipped */ }
  }
  function fxChains() { return tracks().map(function (tr) { return tr.fx; }).concat(proj ? [proj.fx] : []); }
  function updateMix() {
    if (!actx || !proj) return;
    masterGain.gain.setTargetAtTime(C.dbToGain(proj.vol), actx.currentTime, 0.01);
    var trs = tracks(), solo = C.anySolo(trs);
    trs.forEach(function (tr) {
      var n = trackNodes[tr.id];
      if (!n) return;
      n.gain.gain.setTargetAtTime(staticGain(tr, solo), actx.currentTime, 0.01);
      if (n.pan && !C.activeLane(tr, "pan")) n.pan.pan.setTargetAtTime(tr.pan / 100, actx.currentTime, 0.01);
    });
  }

  // One clip, from project time `a` to `b`, starting at context time `when`.
  function scheduleClip(a, c, from, to, when, out, list) {
    var buf = buffers[c.s];
    if (!buf) return;
    var s = Math.max(from, c.at), e = Math.min(to, C.clipEnd(c));
    if (e - s <= 0.0005) return;
    var src = a.createBufferSource(), g = a.createGain(), cg = C.dbToGain(c.gain);
    src.buffer = buf;
    var at = when + (s - from), x0 = s - c.at, x1 = e - c.at;
    g.gain.setValueAtTime(C.fadeGainAt(c, x0) * cg, at);
    if (c.fi > 0 && x0 < c.fi) g.gain.linearRampToValueAtTime(cg * C.fadeGainAt(c, Math.min(c.fi, x1)), at + (Math.min(c.fi, x1) - x0));
    if (c.fo > 0 && x1 > c.len - c.fo) {
      var foStart = Math.max(x0, c.len - c.fo);
      g.gain.setValueAtTime(cg * C.fadeGainAt(c, foStart), at + (foStart - x0));
      g.gain.linearRampToValueAtTime(cg * C.fadeGainAt(c, x1), at + (x1 - x0));
    }
    src.connect(g); g.connect(out);
    src.start(Math.max(at, a.currentTime), c.off + x0 + Math.max(0, a.currentTime - at), x1 - x0);
    if (list) list.push(src);
  }
  function scheduleClick(a, when, accent) {
    var o = a.createOscillator(), g = a.createGain(), v = Math.pow(prefs.mvol / 100, 1.5) * 0.6;
    o.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(v, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    o.connect(g); g.connect(analyser || a.destination);
    o.start(when); o.stop(when + 0.06);
    return o;
  }

  // Passes: one straight run from `from` (to the loop end or the song
  // end), then one per loop round. Each pass maps project time to the
  // context clock; clips and clicks are scheduled LOOKAHEAD ahead.
  // MIDI clips become one list of notes (scheduled one by one, like the clicks).
  function newPass(from, to, ctxStart) {
    var pending = projClips().filter(function (c) { return !C.isMidi(c) && C.clipEnd(c) > from && c.at < to; })
      .sort(function (x, y) { return x.at - y.at; });
    return { from: from, to: to, start: ctxStart, end: ctxStart + (to - from), pending: pending, notes: passNotes(from, to),
             beat: Math.ceil(from / C.beatSec(proj.bpm) - 1e-9) };
  }
  function passNotes(from, to) {
    var out = [];
    projClips().forEach(function (c) {
      if (!C.isMidi(c) || C.clipEnd(c) <= from || c.at >= to) return;
      C.clipNotes(c, from, to).forEach(function (q) { q.t = c.t; out.push(q); });
    });
    return out.sort(function (x, y) { return x.at - y.at || x.p - y.p; });
  }
  // one note on its track's instrument; `when` = context time of project time `from`
  function scheduleNote(a, q, from, when, n, list) {
    if (n.nx) { FX.midi(n.id, noteMidi(q, from, when, a.currentTime)); return; }
    var at = when + (q.at - from), dur = q.end - q.at, now = a.currentTime;
    if (at < now) { dur -= now - at; at = now; }
    if (dur <= 0.002) return;
    var si = n.smp ? SND.get(n.smp) : null;
    var h = si ? SFZ.playNote(a, n.input, si, q.p, q.v, at, dur, q.g) : M.playNote(a, n.input, n.inst, q.p, q.v, at, dur, q.g);
    if (list) list.push(h);
  }
  // a note as MIDI for a NULL instrument (channel 10, the drums' channel):
  // [[at, status, note, velocity], ...] on the audio clock. A note that
  // began before `from` is not struck again (a drum hit is its start);
  // the clip's gain and fades scale the velocity.
  function noteMidi(q, from, when, now) {
    var v = Math.round(q.v * q.g);
    if (q.s < from - 1e-6 || v < 1) return [];
    var at = Math.max(now, when + (q.at - from)), off = Math.max(at + 0.001, when + (q.end - from));
    v = Math.min(127, v);
    return [[at, 0x99, q.p, v], [off, 0x89, q.p, 0]];
  }
  function transport(pos) { return { playing: true, tempo: proj.bpm, num: proj.sig, denom: 4, position: pos }; }
  // every chain's transport starts (or jumps to `pos`) where its audio is heard from
  function timeAt(nodes, start, pos) {
    var late = 0;
    tracks().forEach(function (tr) {
      var n = nodes[tr.id];
      if (!n) return;
      late = n.late;
      FX.setTimeAt(tr.id, start + n.shift, transport(pos));
    });
    FX.setTimeAt("master", start + late, transport(pos));
  }
  function play(fromSec, opts) {
    opts = opts || {};
    var a = audio();
    if (!a) { showToast(t("toast.noAudio")); return false; }
    if (!proj) return false;
    stopNodes();
    resume();
    masterGain.gain.value = C.dbToGain(proj.vol);
    trackNodes = {};
    var chains = fxChains();
    if (!FX.isReady(a, chains) && !fxFail) {
      var pid = proj.id;                          // plays dry until the effects are loaded
      FX.ensure(a, chains).then(function () {
        if (playing && !recording && proj && proj.id === pid) replayIfPlaying();
      }, function () { fxFail = true; showToast(t("toast.noFx")); });
    }
    var smps = projSmps();
    if (!SND.isReady(smps)) {
      var pid2 = proj.id;                         // the built-in sound plays until the instrument is here
      loadSmps(a, smps, function () { if (playing && !recording && proj && proj.id === pid2) replayIfPlaying(); }, true);
    }
    var lat = buildTracks(a, masterGain, trackNodes, false);
    lat += routeMaster(a, masterGain, analyser, false, trackNodes);
    fxLat = lat / a.sampleRate;
    FX.prune(tracks().map(function (tr) { return tr.id; }).concat(["master"]));
    var loop = !opts.noLoop && proj.loop.on && fromSec < proj.loop.b ? proj.loop : null;
    var end = loop ? loop.b : Math.max(songLen(), opts.open ? C.MAX_SEC : 0);
    if (!loop && fromSec >= end) { if (opts.open) end = C.MAX_SEC; else fromSec = 0; }
    var t0 = a.currentTime + 0.06;
    playing = { t0: t0, loop: loop, passes: [newPass(fromSec, end, t0)], sources: [], clicks: [] };
    timeAt(trackNodes, t0, fromSec);
    schedAuto(a, trackNodes, fromSec, end, t0, true);
    if (projClips().some(function (c) { return !C.isMidi(c) && state[c.s] !== "ok"; })) showToast(t("toast.missing"));
    tick();
    tickTimer = setInterval(tick, TICK_MS);
    rafId = requestAnimationFrame(frame);
    renderPlayState();
    live(t("live.playing"));
    return true;
  }
  function tick() {
    var p = playing, a = actx;
    if (!p || !a) return;
    var horizon = a.currentTime + LOOKAHEAD, last = p.passes[p.passes.length - 1];
    if (p.loop && last.end < horizon) {
      p.passes.push(newPass(p.loop.a, p.loop.b, last.end));
      timeAt(trackNodes, last.end, p.loop.a);
      schedAuto(a, trackNodes, p.loop.a, p.loop.b, last.end, false);
    }
    p.passes.forEach(function (ps) {
      while (ps.pending.length && ps.start + (Math.max(ps.from, ps.pending[0].at) - ps.from) < horizon) {
        var c = ps.pending.shift(), n = trackNodes[c.t];
        if (n) scheduleClip(a, c, ps.from, ps.to, ps.start + n.shift, n.input, p.sources);
      }
      while (ps.notes.length && ps.start + (ps.notes[0].at - ps.from) < horizon) {
        var q = ps.notes.shift(), qn = trackNodes[q.t];
        if (qn) scheduleNote(a, q, ps.from, ps.start + qn.shift, qn, p.sources);
      }
      if (prefs.metro) {
        var bs = C.beatSec(proj.bpm);
        while (ps.beat * bs < ps.to && ps.start + (ps.beat * bs - ps.from) < horizon) {
          var when = ps.start + (ps.beat * bs - ps.from);
          if (when >= a.currentTime - 0.01) p.clicks.push(scheduleClick(a, when, ps.beat % proj.sig === 0));
          ps.beat++;
        }
      }
    });
    p.passes = p.passes.filter(function (ps) { return ps.end > a.currentTime - 0.5 || ps === p.passes[p.passes.length - 1]; });
    if (p.sources.length > 200) p.sources = p.sources.filter(function (s) { return !(s.end < a.currentTime - 0.2); }).slice(-600);
    if (p.clicks.length > 64) p.clicks = p.clicks.slice(-64);
    if (!p.loop && !recording && a.currentTime > last.end + 0.1) { playhead = last.to; stopAll(); renderPlayhead(); }
    if (recording && recMeta && a.currentTime - recMeta.ctx0 > MAX_REC_SEC) { showToast(t("toast.recMax")); stopRecording(); }
  }
  // Project time now (what is heard, after the output latency).
  function position() {
    var p = playing, a = actx;
    if (!p || !a) return playhead;
    var now = a.currentTime - (a.outputLatency || 0) - fxLat;
    for (var i = p.passes.length - 1; i >= 0; i--) {
      var ps = p.passes[i];
      if (now >= ps.start) return ps.from + Math.min(now - ps.start, ps.to - ps.from);
    }
    return p.passes[0].from;
  }
  function frame() {
    if (!playing) return;
    var pos = position();
    renderPlayhead();
    followPlayhead(pos);
    drawMeter();
    if (Roll) Roll.tick(pos);
    rafId = requestAnimationFrame(frame);
  }
  var meterBuf = null;
  function drawMeter() {
    var cv = $("meter"), g = cv.getContext && cv.getContext("2d");
    if (!g) return;
    if (analyser && !meterBuf) meterBuf = new Float32Array(analyser.fftSize);
    var pk = 0;
    if (playing && analyser) {
      analyser.getFloatTimeDomainData(meterBuf);
      for (var i = 0; i < meterBuf.length; i++) { var v = Math.abs(meterBuf[i]); if (v > pk) pk = v; }
    }
    var db = pk > 0 ? 20 * Math.log10(pk) : -60, f = clamp((db + 48) / 48, 0, 1);
    g.clearRect(0, 0, cv.width, cv.height);
    var css = getComputedStyle(document.documentElement);
    g.fillStyle = css.getPropertyValue("--border").trim() || "#333";
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = pk >= 0.99 ? "#e01b24" : db > -6 ? "#f6d32d" : "#33d17a";
    g.fillRect(0, 0, Math.round(cv.width * f), cv.height);
  }
  function stopNodes() {
    clearInterval(tickTimer); tickTimer = null;
    cancelAnimationFrame(rafId); rafId = 0;
    if (playing) {
      playing.sources.concat(playing.clicks).forEach(function (s) { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} });
    }
    if (FX) FX.setTime({ playing: false });          // also drops the MIDI that waits
    Object.keys(trackNodes).forEach(function (k) {
      var n = trackNodes[k];
      if (n.nx) FX.midi(k, [[0, 0xB9, 123, 0]]);     // all notes off
      [n.gain, n.pan, n.tap, n.ag].forEach(function (x) { try { if (x) x.disconnect(); } catch (e) {} });
    });
    trackNodes = {};
    if (FX) FX.disconnect();
    playing = null;
  }
  function pause() {
    if (!playing) return;
    if (recording) { stopRecording(); return; }
    playhead = position();
    stopNodes();
    renderPlayState(); renderPlayhead(); drawMeter();
    live(t("live.stopped"));
  }
  function stopAll() {
    if (recording) { stopRecording(); return; }
    var was = !!playing;
    stopNodes();
    renderPlayState(); drawMeter();
    if (was) live(t("live.stopped"));
  }
  function stopBtn() {
    if (recording) { stopRecording(); return; }
    if (playing) { stopAll(); }
    else playhead = proj && proj.loop.on ? proj.loop.a : 0;
    renderPlayhead();
  }
  function togglePlay() {
    if (recording) { stopRecording(); return; }
    if (playing) { pause(); return; }
    if (!proj) return;
    play(playhead, { open: prefs.metro });
  }
  function seek(sec) {
    playhead = Math.max(0, Math.min(C.MAX_SEC, sec));
    if (playing && !recording) play(playhead, { open: prefs.metro });
    else renderPlayhead();
  }
  function replayIfPlaying() {
    if (playing && !recording) play(position(), { open: prefs.metro });
  }
  function applyOutput() {
    if (!actx || typeof actx.setSinkId !== "function") return;
    try { Promise.resolve(actx.setSinkId(prefs.outDev || "")).catch(function () {}); } catch (e) {}
  }

  // ---------- 8. Recording ----------
  var recMeta = null;            // { stream, node, srcNode, chunks, ch, ctx0, tid, from }
  var recWorklet = null;
  function armTrack(tid) {
    prefs.arm = prefs.arm === tid ? "" : tid; savePrefs();
    renderRows();
    if (Remote) Remote.changed();
    var tr = C.find(data, "tracks", prefs.arm);
    if (tr) live(t("toast.armed", { name: tr.name }));
  }
  function startRecording() {
    if (recording) { stopRecording(); return; }
    var target = proj && (C.find(data, "tracks", prefs.arm) || C.find(data, "tracks", selTrack));
    if (target && target.p === proj.id && isInst(target)) {
      // a plugin instrument live from the keyboard the bridge reads: the take is its notes
      if (ioOn() && prefs.io.fx.id && prefs.io.fx.inst) { prefs.arm = target.id; savePrefs(); startIoRec(target); return; }
      startMidiRec(target); return;
    }
    if (ioOn() && !keysOpen()) {
      if (!ensureProject()) return;
      var it = C.find(data, "tracks", prefs.arm) || C.find(data, "tracks", selTrack);
      if (!it || it.p !== proj.id) { edit(function () { it = addTrack(); }); }
      if (!it) return;
      prefs.arm = it.id; savePrefs();
      startIoRec(it);
      return;
    }
    var a = audio(), fromSynth = keysOpen();
    if (!a || !a.audioWorklet || (!fromSynth && !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia))) { showToast(t("toast.noRec")); return; }
    if (!ensureProject()) return;
    var tr = C.find(data, "tracks", prefs.arm) || C.find(data, "tracks", selTrack);
    if (!tr || tr.p !== proj.id) { edit(function () { tr = addTrack(); }); }
    if (!tr) return;
    prefs.arm = tr.id; savePrefs();
    if (playing) { playhead = position(); stopNodes(); }
    resume();
    var cons = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
    if (prefs.inDev) cons.deviceId = { exact: prefs.inDev };
    var stream = null;
    // the keyboard panel is open: the synth is the input, no microphone is asked for
    (fromSynth ? Promise.resolve(null) : navigator.mediaDevices.getUserMedia({ audio: cons }).catch(function () {
      if (!prefs.inDev) throw new Error("nomic");
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    })).then(function (s) {
      stream = s;
      recWorklet = recWorklet || a.audioWorklet.addModule("rec.worklet.js");
      return recWorklet;
    }).then(function () {
      var srcNode = fromSynth ? synthBus(a) : a.createMediaStreamSource(stream);
      var node = new AudioWorkletNode(a, "studio-recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      var mute = a.createGain(); mute.gain.value = 0;
      srcNode.connect(node); node.connect(mute); mute.connect(a.destination);
      recMeta = { stream: stream, node: node, srcNode: srcNode, mute: mute, chunks: [], ch: 1, ctx0: 0, tid: tr.id, from: playhead, frames: 0, done: null, synth: fromSynth };
      if (fromSynth) live(t("toast.recSynth", { name: tr.name }));
      node.port.onmessage = function (e) {
        var m = e.data || {};
        if (typeof m.start === "number") { recMeta.ctx0 = m.start; recMeta.ch = m.ch; }
        if (m.chunk) { recMeta.chunks.push(m.chunk); recMeta.frames += m.chunk[0].length; }
        if (m.done && recMeta.done) recMeta.done();
      };
      recording = true;
      play(playhead, { noLoop: true, open: true });
      renderAll();
      live(t("live.recording"));
    }).catch(function () {
      if (stream) stream.getTracks().forEach(function (k) { k.stop(); });
      recording = false; recMeta = null; recWorklet = null;
      showToast(fromSynth ? t("toast.noRec") : t("toast.noMic"));
      renderPlayState();
    });
  }
  function stopRecording() {
    if (recording && midiRec) { stopMidiRec(); return; }
    if (recording && ioRec) { stopIoRec(); return; }
    if (!recording || !recMeta) return;
    var r = recMeta, a = actx, t0 = playing ? playing.t0 : 0, from = r.from;
    recording = false;
    stopNodes();
    renderPlayState();
    var finish = function () {
      try { if (r.synth) r.srcNode.disconnect(r.node); else r.srcNode.disconnect(); } catch (e) {}
      try { r.node.disconnect(); r.mute.disconnect(); } catch (e) {}
      if (r.stream) r.stream.getTracks().forEach(function (k) { k.stop(); });
      recMeta = null;
      saveTake(r, a, t0, from);
    };
    r.done = finish;
    r.node.port.postMessage("stop");
    setTimeout(function () { if (recMeta === r) finish(); }, 1500);
  }
  function saveTake(r, a, t0, from) {
    if (!r.frames) { showToast(t("toast.recEmpty")); renderAll(); return; }
    var rate = a.sampleRate, ch = r.ch > 1 ? 2 : 1, chans = [];
    for (var c = 0; c < ch; c++) chans.push(new Float32Array(r.frames));
    var o = 0;
    r.chunks.forEach(function (k) {
      for (var c2 = 0; c2 < ch; c2++) chans[c2].set(k[Math.min(c2, k.length - 1)], o);
      o += k[0].length;
    });
    // Where the first frame belongs on the timeline: the audio clock of
    // the first frame, minus the output delay and the user's offset.
    // (the synth has no input delay: no recording offset for it)
    var lat = (a.outputLatency || 0) + (a.baseLatency || 0) + (r.synth ? 0 : prefs.lat / 1000) + fxLat;
    var at = from + (r.ctx0 - t0) - lat, skip = 0;
    if (at < 0) { skip = Math.min(r.frames - 1, Math.round(-at * rate)); at = 0; }
    if (skip) chans = chans.map(function (d) { return d.subarray(skip); });
    var buf = a.createBuffer(ch, chans[0].length, rate);
    chans.forEach(function (d, k) { buf.copyToChannel(d, k); });
    var tr = C.find(data, "tracks", r.tid);
    if (!tr || !proj || tr.p !== proj.id) { showToast(t("toast.recFail")); return; }
    if (projClips().length >= C.MAX_CLIPS) { showToast(t("toast.maxClips", { n: C.MAX_CLIPS })); return; }
    busy(t("busy.saveTake"));
    var blob = new Blob([C.wavBytes(chans, rate, 24)], { type: "audio/wav" });
    var name = (tr.name || "take") + " " + new Date().toTimeString().slice(0, 5).replace(":", ".");
    var before = snapshot();
    addSource(name, "wav", blob, buf).then(function (src) {
      put("clips", C.normClip({ id: C.newId("c", Math.random), m: 0, p: proj.id, t: tr.id, s: src.id, at: at, off: 0, len: buf.duration }));
      undoStack.push(before); redoStack = [];
      playhead = from;
      busy(null);
      changed();
      showToast(t("toast.recSaved", { name: tr.name }));
    }, function (e) {
      busy(null);
      showToast(e && e.message === "nodisk" ? t("toast.noDisk") : t("toast.recFail"));
      renderAll();
    });
  }

  // ---------- 8c. Recording through the sound card (orOS Bridge) ----------
  // With Settings › "Record and play through" on orOS Bridge, the bridge
  // opens the card itself (WASAPI, JACK, PipeWire/PulseAudio, ALSA). The
  // song from the playhead is rendered first (renderMix, plus the click)
  // at the card's own rate and sent ahead; the bridge plays it and records
  // the chosen inputs in the same callback, so the take shares the card's
  // clock with what was heard. A take lands at the playhead minus the
  // bridge's round-trip estimate and the recording offset. "Every input"
  // gives one new mono track per input; all takes are one undo step.
  var IO_CLICK_TAIL = 120;       // seconds of click after the song's end
  var ioRec = null;              // { from, sr, lat, tracks: [{tr, chans}], record, pos, timer }
  var ioDevs = [], ioTest = false;
  // the plugin live on the inputs: its effects list, the open one {h, id, latency, monitor},
  // its last state (base64, this session) and the closing of the card in progress
  var ioFxList = [], ioLive = null, ioFxSt = { id: "", b64: "" }, ioClosing = null, ioFxWarned = false, ioMidiList = [];
  function ioOn() { return prefs.io.on === true; }
  function ioBackend() { return ioDevs.filter(function (b) { return b.id === prefs.io.be; })[0] || null; }
  function ioInDev() {
    var b = ioBackend();
    if (!b) return null;
    return b.inputs.filter(function (d) { return d.name === prefs.io.inp; })[0] || b.inputs.filter(function (d) { return d.def; })[0] || b.inputs[0] || null;
  }
  // the input channels a take records (from 0): one, a pair, or every input
  function ioChannels(n) {
    var ch = prefs.io.ch, out = [], i;
    if (ch === "all") { for (i = 0; i < Math.min(n, 32); i++) out.push(i); return out; }
    var m = /^(\d+)(\+(\d+))?$/.exec(ch) || ["", "1"];
    var a = Math.min(parseInt(m[1], 10), n) - 1;
    out.push(Math.max(0, a));
    if (m[3] && a + 1 < n) out.push(a + 1);
    return out;
  }
  // ASIO has one driver for input and output: the card picked for recording also plays
  function ioOutName() { return prefs.io.be === "asio" ? prefs.io.inp : prefs.io.out; }
  function ioStatus(text) { $("io-status").textContent = text || ""; }
  function ioShow(which) {
    $("io-pair").hidden = which !== "pair";
    $("io-on").hidden = which !== "on";
    $("io-off").hidden = which !== "off";
  }
  function renderIo() {
    var on = ioOn();
    $("io-mode").value = on ? "br" : "";
    $("io-sec").hidden = !on;
    ["in-dev", "dev-refresh"].forEach(function (id) { $(id).hidden = on; });
    var lbl = document.querySelector('label[for="in-dev"]');
    if (lbl) lbl.hidden = on;
    if (!on) { ioTestOff(); return; }
    ioStatus(t("br.connecting"));
    ioShow("");
    brLib().then(function () { return BRG.connect(); }).then(function (r) {
      if (r === "pair") {
        ioShow("pair"); ioStatus("");
        $("io-code").value = "";
        return BRG.pair();
      }
      return ioLoad();
    }).then(null, function () { ioShow("off"); ioStatus(t("io.noBridge")); });
  }
  function ioSendCode() {
    var code = $("io-code").value.replace(/\D/g, "");
    if (code.length !== 6) { ioStatus(t("br.badCode")); return; }
    BRG.sendCode(code).then(ioLoad, function () { ioStatus(t("br.badCode")); return BRG.pair().then(null, function () {}); });
  }
  function ioLoad() {
    ioStatus(t("io.looking"));
    return BRG.devices().then(function (list) {
      ioDevs = list;
      if (!ioBackend()) {
        var first = list.filter(function (b) { return b.ok && b.inputs.length; })[0];
        if (first) { prefs.io.be = first.id; savePrefs(); }
      }
      ioShow("on");
      ioFill();
      // the plugins the bridge knows and the keyboards it reads, for "Listen through a plugin"
      return BRG.list().then(function (pl) {
        ioFxList = pl;
        return BRG.midiDevices().then(function (m) { ioMidiList = m; }, function () { ioMidiList = []; });
      }).then(ioFxFill, function () {});
    }, function () { ioShow("off"); ioStatus(t("io.old")); });
  }
  function ioFxFill() {
    var sel = $("io-fx"), fx = prefs.io.fx, ms = $("io-midi");
    sel.innerHTML = "";
    opt(sel, "", t("io.fxNone"));
    [["br.effects", false], ["br.instruments", true]].forEach(function (g) {
      var items = ioFxList.filter(function (x) { return x.instrument === g[1]; });
      if (!items.length) return;
      var og = document.createElement("optgroup");
      og.label = t(g[0]);
      items.forEach(function (x) { opt(og, x.id, x.name + (x.vendor ? " · " + x.vendor : "") + " (" + (x.format === "clap" ? "CLAP" : "VST3") + ")"); });
      sel.appendChild(og);
    });
    sel.value = fx.id;
    if (sel.value !== fx.id) sel.value = "";
    $("io-fx-sec").hidden = !ioFxList.length;
    $("io-fx-on").hidden = !sel.value;
    // an instrument plays from a keyboard the bridge reads; its take keeps the notes
    $("io-fx-hint").textContent = t(fx.inst ? "io.fxInstHint" : "io.fxHint");
    $("io-midi-sec").hidden = !fx.inst;
    $("io-fx-wet-sec").hidden = fx.inst;
    ms.innerHTML = "";
    if (!ioMidiList.length) opt(ms, "", t("io.noKeys"));
    ioMidiList.forEach(function (n) { opt(ms, n, n); });
    if (ioMidiList.indexOf(fx.midi) < 0 && ioMidiList.length) { fx.midi = ioMidiList[0]; savePrefs(); }   // the first keyboard until one is chosen
    ms.value = fx.midi;
    $("io-fx-gain").value = String(fx.gain);
    $("io-fx-gout").textContent = fx.gain + "%";
    $("io-fx-wet").value = fx.wet ? "1" : "";
  }
  function ioFxPick() {
    var id = $("io-fx").value, x = ioFxList.filter(function (p) { return p.id === id; })[0];
    prefs.io.fx = Object.assign({}, prefs.io.fx, { id: x ? x.id : "", name: x ? C.clipLine(x.name, 80) : "", inst: !!(x && x.instrument) });
    savePrefs();
    ioTestOff();
    ioFxFill();
  }
  // The plugin goes live on the open card: the chosen inputs (one or a pair)
  // go through it and it is heard at once. Its sound is the one the track
  // keeps (or this session's last), so a freeze later sounds the same.
  // A plugin that cannot go live leaves the take as it was (a toast says so).
  function ioLiveOpen(inputs, wet, tr) {
    var fx = prefs.io.fx;
    ioLive = null;
    ioFxWarned = false;
    if (!fx.id || (!fx.inst && !inputs.length)) return Promise.resolve(null);
    if (fx.inst && !fx.midi) { showToast(t("io.fxNoKeys", { name: fx.name })); return Promise.resolve(null); }
    return ioTrackState(tr, fx.id).then(function (st) {
      if (!st && ioFxSt.id === fx.id) st = ioFxSt.b64;
      var o = { plugin: fx.id, inputs: fx.inst ? [] : inputs.slice(0, 2), out: 0, gain: fx.gain / 100, on: true, record: wet && !fx.inst ? "wet" : "dry" };
      if (fx.inst) o.midi = fx.midi;
      if (st) o.state = st;
      return BRG.liveOpen(o);
    }).then(function (j) {
      ioLive = { h: j.h, id: fx.id, name: fx.name, latency: Math.max(0, j.latency | 0), monitor: j.monitor | 0, inst: fx.inst };
      return ioLive;
    }, function (e) {
      showToast(e && /unknown op/.test(e.message || "") ? t("io.fxOld") : t("io.fxFail", { name: fx.name }));
      return null;
    });
  }
  // the state a track keeps for this plugin (a take through it, or a freeze)
  function ioTrackState(tr, id) {
    var fs = fsApi(), path = tr && tr.br && tr.br.id === id ? tr.br.st : tr && tr.lv && tr.lv.id === id ? tr.lv.st : "";
    if (!path || !fs) return Promise.resolve("");
    return Promise.resolve(fs.readBlob(path)).then(function (b) { return b.text(); }).then(function (x) { return x.trim(); }, function () { return ""; });
  }
  // keep the live plugin's sound (the person may have changed it in its window), then let it go
  function ioLiveDone() {
    var lv = ioLive;
    ioLive = null;
    if (!lv || !BRG) return Promise.resolve(null);
    return BRG.state(lv.h).then(function (b64) { ioFxSt = { id: lv.id, b64: b64 }; return { id: lv.id, name: lv.name, b64: b64 }; },
      function () { return null; });
  }
  function ioFxWindow() {
    if (!ioLive) { ioStatus(t("io.fxWinFirst")); return; }
    BRG.editor(ioLive.h).then(null, function () { ioStatus(t("br.fail")); });
  }
  function opt(sel, value, text, disabled) {
    var o = el("option", "", text);
    o.value = value;
    if (disabled) o.disabled = true;
    sel.appendChild(o);
  }
  function ioFill() {
    var be = $("io-be"), b;
    be.innerHTML = "";
    ioDevs.forEach(function (x) { opt(be, x.id, x.ok ? x.label : t("io.notRunning", { name: x.label }), !x.ok); });
    be.value = prefs.io.be;
    b = ioBackend();
    [["io-in", "inputs", "inp"], ["io-out", "outputs", "out"]].forEach(function (k) {
      var sel = $(k[0]);
      sel.innerHTML = "";
      opt(sel, "", t("dev.default"));
      (b ? b[k[1]] : []).forEach(function (d) { opt(sel, d.name, d.name + (d.channels > 2 ? " · " + t("io.nIn", { n: d.channels }) : "")); });
      sel.value = prefs.io[k[2]];
      if (sel.value !== prefs.io[k[2]]) sel.value = "";
    });
    var dev = ioInDev(), n = dev ? dev.channels : 2, ch = $("io-ch"), i;
    ch.innerHTML = "";
    for (i = 1; i <= Math.min(n, 32); i++) opt(ch, String(i), t("io.one", { n: i }));
    for (i = 1; i + 1 <= Math.min(n, 32); i += 2) opt(ch, i + "+" + (i + 1), t("io.pair", { a: i, b: i + 1 }));
    if (n > 1) opt(ch, "all", t("io.all", { n: Math.min(n, 32) }));
    ch.value = prefs.io.ch;
    if (ch.value !== prefs.io.ch) { ch.value = "1"; }
    $("io-ex-sec").hidden = !(b && b.exclusive);
    $("io-out-sec").hidden = prefs.io.be === "asio";
    // Steinberg's guidelines: the ASIO Compatible Logo in every dialog that offers ASIO
    $("io-asio").hidden = !ioDevs.some(function (x) { return x.id === "asio"; });
    $("io-ex").value = prefs.io.ex ? "1" : "";
    $("io-test").disabled = !b || !b.ok;
    ioStatus(b && b.ok ? t("io.ready", { name: b.label }) : t("io.none"));
  }
  function ioPick(key, value) {
    prefs.io[key] = value;
    if (key === "be") { prefs.io.inp = ""; prefs.io.out = ""; }
    savePrefs();
    ioTestOff();
    ioFill();
  }
  // "Check the inputs": the card opens (nothing played) and the meters move
  function ioTestToggle() {
    if (ioTest) { ioTestOff(); return; }
    var b = ioBackend();
    if (!b || recording) return;
    ioTest = true;
    $("io-test").setAttribute("aria-pressed", "true");
    $("io-test").classList.add("on");
    var j;
    Promise.resolve(ioClosing).then(function () {
      return BRG.audioOpen({ backend: b.id, input: prefs.io.inp, output: ioOutName(), exclusive: prefs.io.ex, record: [] });
    }).then(function (x) {
      j = x;
      if (!ioTest) { BRG.audioClose(); return null; }
      var dev = ioInDev();
      return ioLiveOpen(ioChannels(dev ? dev.channels : 2), false, C.find(data, "tracks", prefs.arm) || C.find(data, "tracks", selTrack));
    }).then(function (lv) {
      if (!ioTest || !j) return;
      ioMeters(j.inputs | 0);
      ioStatus(lv ? t(lv.inst ? "io.fxInstTesting" : "io.fxTesting", { sr: j.sr, ms: Math.round(lv.monitor / j.sr * 1000), name: lv.name })
        : t("io.testing", { sr: j.sr, ms: Math.round((j.latency | 0) / j.sr * 1000) }));
    }, function (e) { ioTestOff(); ioStatus(t("io.openFail", { why: (e && e.message) || "" })); });
  }
  function ioTestOff() {
    if (ioTest && BRG && !ioRec) ioClosing = ioLiveDone().then(function () { return BRG.audioClose(); }).then(function () { ioClosing = null; });
    ioTest = false;
    var b = $("io-test");
    if (b) { b.setAttribute("aria-pressed", "false"); b.classList.remove("on"); }
    if (!ioRec) $("io-meters").innerHTML = "";
  }
  function ioMeters(n) {
    var box = $("io-meters");
    box.innerHTML = "";
    for (var i = 0; i < Math.min(n, 32); i++) {
      var m = el("div", "io-meter");
      m.appendChild(el("span", "", t("io.one", { n: i + 1 })));
      var bar = el("div", "io-bar");
      bar.appendChild(document.createElement("i"));
      m.appendChild(bar);
      box.appendChild(m);
    }
  }
  function ioLevels(ev) {
    if (ioRec && typeof ev.pos === "number") ioRec.pos = ev.pos;
    var lv = ev.live;
    if (lv && ioLive && lv.h === ioLive.h && (lv.slow || lv.failed) && !ioFxWarned) {
      ioFxWarned = true;
      showToast(lv.slow ? t("io.fxSlow", { name: ioLive.name }) : t("io.fxFailed", { name: ioLive.name }));
    }
    var ms = $("io-meters").children;
    (ev.peaks || []).forEach(function (p, i) {
      if (!ms[i]) return;
      var db = p > 0 ? 20 * Math.log10(p) : -90, w = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
      ms[i].lastChild.firstChild.style.width = w + "%";
      ms[i].classList.toggle("hot", p >= 0.99);
    });
  }
  // the click as samples, added into [L, R] (the song starts at `from`)
  function ioClick(chans, from, sr) {
    var bs = C.beatSec(proj.bpm), len = chans[0].length, v = Math.pow(prefs.mvol / 100, 1.5) * 0.6;
    var n = Math.round(0.06 * sr), att = Math.max(1, Math.round(0.002 * sr)), k = Math.ceil(from / bs - 1e-9);
    for (; k * bs < from + len / sr; k++) {
      var f0 = Math.round((k * bs - from) * sr), hz = k % proj.sig === 0 ? 1600 : 1000;
      for (var i = 0; i < n && f0 + i < len; i++) {
        var env = i < att ? v * i / att : v * Math.pow(0.0001 / v, Math.min(1, (i - att) / (0.048 * sr)));
        var s = env * Math.sin(2 * Math.PI * hz * i / sr);
        chans[0][f0 + i] += s; chans[1][f0 + i] += s;
      }
    }
  }
  function ioFail(msg) {
    var r = ioRec;
    ioRec = null;
    ioLive = null;
    recording = false;
    if (r && r.timer) clearInterval(r.timer);
    if (BRG) BRG.audioClose();
    busy(null);
    renderAll();
    showToast(msg);
  }
  function startIoRec(tr) {
    var b = ioBackend() || { id: prefs.io.be }, a = audio(), from = playhead, end = songLen();
    if (!a) { showToast(t("toast.noAudio")); return; }
    if (playing) { from = playhead = position(); stopNodes(); }
    ioTestOff();
    recording = true;                            // nothing can be edited while the take is prepared
    ioRec = { from: from, sr: 0, lat: 0, tid: tr.id, record: [], pos: 0, timer: 0, ready: false };
    renderPlayState();
    busy(t("io.prep"));
    if (projClips().some(function (c) { return !C.isMidi(c) && !buffers[c.s]; })) showToast(t("toast.missing"));
    var j;
    Promise.resolve(ioClosing).then(brLib).then(function () { return BRG.connect(); }).then(function (r) {
      if (r === "pair") throw new Error("pair");
      return BRG.devices();
    }).then(function (list) {
      ioDevs = list;
      var bk = ioBackend(), dev = ioInDev();
      if (!bk || !bk.ok) throw new Error("nocard");
      ioRec.inst = isInst(tr);
      ioRec.record = ioRec.inst ? [] : ioChannels(dev ? dev.channels : 2);
      return BRG.audioOpen({ backend: bk.id, input: prefs.io.inp, output: ioOutName(), exclusive: prefs.io.ex, record: ioRec.record });
    }).then(function (x) {
      var wet = prefs.io.fx.wet;
      return ioLiveOpen(ioRec.record, wet, tr).then(function (lv) {
        if (lv && ioRec) ioRec.live = { id: lv.id, name: lv.name, latency: lv.latency, wet: wet && !lv.inst, inputs: ioRec.record.slice(0, 2), inst: lv.inst };
        if (ioRec && ioRec.inst && !(lv && lv.inst)) throw new Error("nolive");   // nothing else would record
        // a note comes in about half the round trip after the sound it was played to
        if (ioRec) ioRec.midiLat = (x.latency | 0) / 2 / x.sr;
        return x;
      });
    }).then(function (x) {
      j = x;
      ioRec.sr = j.sr;
      ioRec.lat = (j.latency | 0) / j.sr + prefs.lat / 1000;
      var songSec = Math.max(0, end - from), sec = Math.min(MAX_REC_SEC, songSec + (prefs.metro ? IO_CLICK_TAIL : 0));
      if (sec <= 0) return [];
      var len = Math.ceil(sec * j.sr);
      var mix = songSec > 0.01 ? renderMix({ a: from, b: end }, j.sr) : Promise.resolve([new Float32Array(0), new Float32Array(0)]);
      return mix.then(function (m) {
        if (m[0].length === len && !prefs.metro) return m;
        var out = [new Float32Array(len), new Float32Array(len)];
        out[0].set(m[0].subarray(0, len)); out[1].set(m[1].subarray(0, len));
        if (prefs.metro) ioClick(out, from, j.sr);
        return out;
      });
    }).then(function (chans) {
      if (!ioRec) throw new Error("gone");
      return BRG.play(chans, 0);
    }).then(function () { return BRG.start(); }).then(function () {
      if (!ioRec) return;
      busy(null);
      ioRec.ready = true;
      ioRec.timer = setInterval(function () {
        if (!ioRec) return;
        playhead = ioRec.from + ioRec.pos / ioRec.sr;
        renderPlayhead();
        if (ioRec.pos / ioRec.sr > MAX_REC_SEC) { showToast(t("toast.recMax")); stopRecording(); }
      }, 50);
      renderAll();
      live(t("live.recording"));
    }).then(null, function (e) {
      var m = e && e.message;
      ioFail(m === "pair" ? t("io.pairFirst") : m === "nocard" ? t("io.none") : m === "nobridge" || m === "closed" ? t("io.noBridge")
        : m === "nolive" ? t("io.fxFail", { name: prefs.io.fx.name }) : t("io.openFail", { why: m || "" }));
    });
  }
  function stopIoRec() {
    var r = ioRec;
    if (!r || !r.ready) return;               // still preparing: it starts, then can be stopped
    r.ready = false;
    clearInterval(r.timer);
    busy(t("busy.saveTake"));
    var lost = 0;
    BRG.stop().then(function (s) {
      lost = s.lost | 0;
      r.frames = s.frames | 0;
      if (!r.live || !r.live.inst) return BRG.take(s.frames | 0, r.record.length);
      return BRG.midiTake().then(function (ev) { r.midi = ev; return []; });
    }).then(function (chans) {
      return ioLiveDone().then(function (st) { if (r.live && st) r.live.b64 = st.b64; return chans; });
    }).then(function (chans) {
      BRG.audioClose();
      ioRec = null;
      recording = false;
      playhead = r.from;
      renderPlayState();
      if (lost) showToast(t("io.lost", { n: (lost / r.sr).toFixed(2) }));
      return ioKeep(r, chans);
    }).then(null, function () { ioFail(t("toast.recFail")); });
  }
  // the take onto its track(s): a pair as one stereo clip, every input as one track each
  function ioKeep(r, chans) {
    if (r.live && r.live.inst) return ioKeepNotes(r);
    var a = audio(), tr = C.find(data, "tracks", r.tid);
    busy(null);
    if (!chans.length || !chans[0].length) { showToast(t("toast.recEmpty")); renderAll(); return; }
    if (!tr || !proj || tr.p !== proj.id || !a) { showToast(t("toast.recFail")); renderAll(); return; }
    var at = r.from - r.lat, skip = 0;
    if (at < 0) { skip = Math.min(chans[0].length - 1, Math.round(-at * r.sr)); at = 0; }
    if (skip) chans = chans.map(function (d) { return d.subarray(skip); });
    // a take with the plugin's sound: its channels come back late by the plugin's latency
    if (r.live && r.live.wet && r.live.latency)
      chans = chans.map(function (d, k) {
        if (r.live.inputs.indexOf(r.record[k]) < 0) return d;
        var x = new Float32Array(d.length);
        x.set(d.subarray(Math.min(d.length, r.live.latency)));
        return x;
      });
    var groups = prefs.io.ch === "all" && chans.length > 1 ? chans.map(function (c) { return [c]; }) : [chans];
    if (projClips().length + groups.length > C.MAX_CLIPS) { showToast(t("toast.maxClips", { n: C.MAX_CLIPS })); renderAll(); return; }
    var before = snapshot(), stamp = new Date().toTimeString().slice(0, 5).replace(":", "."), saved = 0;
    busy(t("busy.saveTake"));
    var step = function (i) {
      if (i >= groups.length) return Promise.resolve();
      var g = groups[i], dest = i === 0 ? tr : addTrack(C.clipLine(tr.name + " · " + t("io.one", { n: r.record[i] + 1 }), C.MAX_NAME));
      if (!dest) return Promise.resolve();          // no room for more tracks
      var buf = a.createBuffer(g.length, g[0].length, r.sr);
      g.forEach(function (d, k) { buf.copyToChannel(d, k); });
      var name = (dest.name || "take") + " " + stamp;
      return addSource(name, "wav", new Blob([C.wavBytes(g, r.sr, 24)], { type: "audio/wav" }), buf).then(function (src) {
        put("clips", C.normClip({ id: C.newId("c", Math.random), m: 0, p: proj.id, t: dest.id, s: src.id, at: at, off: 0, len: buf.duration }));
        saved++;
        // recorded dry through a live plugin: the track keeps that plugin and its sound, ready to freeze
        if (i === 0 && r.live && !r.live.wet && !dest.br) return ioKeepLive(dest, r.live).then(function () { return step(i + 1); });
        return step(i + 1);
      });
    };
    return step(0).then(function () {
      busy(null);
      if (saved) { undoStack.push(before); redoStack = []; }
      changed();
      showToast(t("toast.recSaved", { name: tr.name }));
    }, function (e) {
      busy(null);
      if (saved) { undoStack.push(before); redoStack = []; changed(); }
      showToast(e && e.message === "nodisk" ? t("toast.noDisk") : t("toast.recFail"));
      renderAll();
    });
  }

  // The notes a live instrument got, as Studio notes [note, start s, length s, velocity]:
  // sustain (CC 64) holds released notes, notes still held end with the take
  function ioNotes(ev, sr, lat, endSec) {
    var open = {}, held = {}, sus = false, out = [];
    function end(n, t) {
      var o = open[n];
      delete open[n]; delete held[n];
      if (!o || out.length >= C.MAX_NOTES) return;
      out.push([n, o[0], Math.max(C.MIN_NOTE, t - o[0]), o[1]]);
    }
    ev.forEach(function (e) {
      var at = Math.max(0, e[0] / sr - lat), k = e[1] & 0xf0, n = e[2] & 127, v = e[3] & 127;
      if (k === 0x90 && v > 0) { if (open[n]) end(n, at); delete held[n]; open[n] = [at, v]; }
      else if (k === 0x80 || k === 0x90) { if (!open[n]) return; if (sus) held[n] = 1; else end(n, at); }
      else if (k === 0xb0 && n === 64) { sus = v >= 64; if (!sus) Object.keys(held).forEach(function (x) { end(+x, at); }); }
    });
    Object.keys(open).forEach(function (n) { end(+n, Math.max(endSec, open[n][0] + C.MIN_NOTE)); });
    return out.sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });
  }
  // a live instrument's take: its notes as a MIDI clip on the instrument track, which keeps the plugin
  function ioKeepNotes(r) {
    var tr = C.find(data, "tracks", r.tid), endSec = (r.frames || 0) / r.sr;
    busy(null);
    var notes = ioNotes(r.midi || [], r.sr, r.midiLat || 0, endSec);
    if (!notes.length) { showToast(t("toast.recEmpty")); renderAll(); return; }
    if (!tr || !proj || tr.p !== proj.id) { showToast(t("toast.recFail")); renderAll(); return; }
    if (projClips().length >= C.MAX_CLIPS) { showToast(t("toast.maxClips", { n: C.MAX_CLIPS })); renderAll(); return; }
    var before = snapshot(), len = Math.max(endSec, N.notesEnd(notes), C.MIN_LEN);
    put("clips", C.normClip({ id: C.newId("c", Math.random), m: 0, p: proj.id, t: tr.id, at: r.from, off: 0, len: len, n: notes }));
    return (tr.br ? Promise.resolve() : ioKeepLive(tr, r.live)).then(function () {
      undoStack.push(before); redoStack = [];
      changed();
      showToast(t("mi.recSaved", { n: notes.length, name: tr.name }));
    });
  }
  function ioKeepLive(dest, lv) {
    var fs = fsApi(), path = BR_DIR + "/" + dest.id + ".live.txt";
    var put1 = function (st) {
      put("tracks", C.normTrack(Object.assign({}, C.find(data, "tracks", dest.id), { lv: { id: lv.id, name: lv.name, st: st } })));
    };
    if (!fs || !lv.b64) { put1(""); return Promise.resolve(); }
    return Promise.resolve(fs.mkdir ? fs.mkdir(BR_DIR) : null).then(function () {
      return fs.writeBlob(path, new Blob([lv.b64], { type: "text/plain" }));
    }).then(function () { put1(path); }, function () { put1(""); });
  }

  // ---------- 8b. Keyboard: MIDI and the built-in synth ----------
  // Notes from a MIDI keyboard (Web MIDI) or from the keys on screen play
  // a small synth (midi.js) that is heard at once. With an instrument
  // track armed or selected, the keys play its instrument and Record
  // takes the notes into a MIDI clip; on an audio track, with the panel
  // open, Record takes the synth as audio.
  var M = window.StudioMidi;
  var synth = null, synthOut = null, midiAcc = null, held = {}, sLive = null;
  function synthBus(a) {
    if (!synthOut) {
      synthOut = a.createGain();
      synthOut.gain.value = Math.pow(prefs.svol / 100, 2);
      synthOut.connect(analyser || a.destination);          // heard straight away, like the click
      synth = new M.Synth(a, synthOut);
      synth.setPreset(kbSound());
    }
    return synthOut;
  }
  // the instrument track the keys play: the armed one, else the selected one
  function kbTarget() {
    if (!proj) return null;
    var a = C.find(data, "tracks", prefs.arm), s = C.find(data, "tracks", selTrack);
    if (a && a.p === proj.id) return isInst(a) ? a : null;   // the same track Record would use
    return s && s.p === proj.id && isInst(s) ? s : null;
  }
  function kbSound() { var tr = kbTarget(); return tr ? instOf(tr) : prefs.snd; }
  // keep the panel and the synth in step with the target track
  function syncKb() {
    var tr = kbTarget(), snd = kbSound(), sel = $("kb-snd");
    if (synth && synth.preset !== M.PRESETS[snd] && M.PRESETS[snd]) { synth.allOff(); held = {}; synth.setPreset(snd); }
    var sp = smpOf(tr);
    if (sLive && (!sp || sLive.inst !== SND.get(sp))) { sLive.allOff(); sLive = null; held = {}; }
    if (sp && !SND.get(sp) && actx) loadSmps(actx, [sp], syncKb);
    if (sel && FX && sel.querySelectorAll("option").length !== soundCount()) fillSounds(sel);
    if (sel && document.activeElement !== sel) sel.value = soundValue(sel, tr, snd);
    var tl = $("kb-target");
    if (tl) { tl.hidden = !tr; tl.textContent = tr ? t("mi.target", { name: tr.name }) : ""; }
  }

  // ---------- 8c. Recording notes into a MIDI clip ----------
  var midiRec = null;            // { tid, from, t0, lat, open: { note: [ctxTime, vel] }, sus, susHeld: {}, notes: [] }
  function startMidiRec(tr) {
    var a = audio();
    if (!a) { showToast(t("toast.noAudio")); return; }
    if (!keysOpen()) toggleKeys();
    prefs.arm = tr.id; savePrefs();
    if (playing) { playhead = position(); stopNodes(); }
    resume();
    getSynth();
    syncKb();
    midiRec = { tid: tr.id, from: playhead, t0: 0, lat: (a.outputLatency || 0) + (a.baseLatency || 0), open: {}, sus: false, susHeld: {}, notes: [] };
    recording = true;
    play(playhead, { noLoop: true, open: true });
    if (!playing) { recording = false; midiRec = null; renderPlayState(); return; }
    midiRec.t0 = playing.t0;
    renderAll();
    live(t("mi.recMidi", { name: tr.name }));
  }
  // project time (seconds from the take's start) of context time `ct`
  function recAt(ct) { return ct - midiRec.t0 - midiRec.lat; }
  function recEvent(type, note, vel, ct) {
    var r = midiRec;
    if (!r || !recording) return;
    if (ct == null) ct = actx.currentTime;
    if (type === "on") {
      if (r.open[note]) recEnd(note, ct);
      delete r.susHeld[note];
      r.open[note] = [ct, vel];
    } else if (type === "off") {
      if (!r.open[note]) return;
      if (r.sus) r.susHeld[note] = ct; else recEnd(note, ct);
    } else if (type === "sus") {
      r.sus = vel;
      if (!vel) Object.keys(r.susHeld).forEach(function (n) { recEnd(+n, ct); });
    }
  }
  function recEnd(note, ct) {
    var r = midiRec, o = r.open[note];
    delete r.open[note]; delete r.susHeld[note];
    if (!o || r.notes.length >= C.MAX_NOTES) return;
    var s = Math.max(0, recAt(o[0])), e = Math.max(s + C.MIN_NOTE, recAt(ct));
    r.notes.push([note, s, e - s, o[1]]);
  }
  function stopMidiRec() {
    var r = midiRec, a = actx, end = a ? recAt(a.currentTime) : 0;
    Object.keys(r.open).forEach(function (n) { recEnd(+n, a.currentTime); });
    midiRec = null;
    recording = false;
    stopNodes();
    if (synth || sLive) { kbAllOff(); renderKeys(); }
    renderPlayState();
    var tr = C.find(data, "tracks", r.tid);
    if (!r.notes.length) { showToast(t("toast.recEmpty")); renderAll(); return; }
    if (!tr || !proj || tr.p !== proj.id) { showToast(t("toast.recFail")); renderAll(); return; }
    if (projClips().length >= C.MAX_CLIPS) { showToast(t("toast.maxClips", { n: C.MAX_CLIPS })); renderAll(); return; }
    var len = Math.max(end, N.notesEnd(r.notes), C.MIN_LEN);
    edit(function () {
      put("clips", C.normClip({ id: C.newId("c", Math.random), m: 0, p: proj.id, t: tr.id, at: r.from, off: 0, len: len, n: r.notes }));
    });
    playhead = r.from;
    renderPlayhead();
    showToast(t("mi.recSaved", { n: r.notes.length, name: tr.name }));
  }
  function getSynth() { var a = audio(); if (!a) return null; resume(); synthBus(a); return synth; }
  // what the keys play: the target track's sample instrument once it is here, else the synth
  function kbPlayer() {
    var sp = smpOf(kbTarget()), si = sp ? SND.get(sp) : null, sy = getSynth();
    if (!si || !sy) return sy;
    if (!sLive || sLive.inst !== si) { if (sLive) sLive.allOff(); sLive = new SFZ.Live(actx, synthOut, si); }
    return sLive;
  }
  function kbAllOff() { if (synth) synth.allOff(); if (sLive) sLive.allOff(); held = {}; }
  function keysOpen() { return !$("keys").hidden; }
  function toggleKeys() {
    var k = $("keys"), open = k.hidden;
    k.hidden = !open;
    $("keys-btn").classList.toggle("on", open);
    $("keys-btn").setAttribute("aria-pressed", open ? "true" : "false");
    if (open) { renderKeys(); getSynth(); syncKb(); }
    else kbAllOff();
    renderLanes();
  }
  function renderKeys() {
    var host = $("kb-keys"), base = 48 + 12 * prefs.oct, whites = 0, n;
    host.innerHTML = "";
    for (n = base; n <= base + 24; n++) if (!M.isBlack(n)) whites++;
    var wi = 0;
    for (n = base; n <= base + 24; n++) {
      var black = M.isBlack(n), b = el("button", "kb-key " + (black ? "b" : "w") + (held[n] ? " on" : ""));
      b.type = "button";
      b.setAttribute("data-n", String(n));
      setLabel(b, M.noteName(n));
      if (black) { b.style.left = "calc(" + (wi / whites * 100) + "% - " + (50 / whites * 0.62) + "%)"; b.style.width = (100 / whites * 0.62) + "%"; }
      else { b.style.left = (wi / whites * 100) + "%"; b.style.width = (100 / whites) + "%"; wi++; }
      if (!black && n % 12 === 0) b.appendChild(el("span", "kb-c", M.noteName(n)));
      host.appendChild(b);
    }
    $("kb-oct").textContent = t("kb.oct", { n: prefs.oct > 0 ? "+" + prefs.oct : String(prefs.oct) });
    $("kb-oct-dn").disabled = prefs.oct <= -2;
    $("kb-oct-up").disabled = prefs.oct >= 2;
  }
  function lightKey(n, on) {
    if (on) held[n] = true; else delete held[n];
    var b = document.querySelector('#kb-keys [data-n="' + n + '"]');
    if (b) b.classList.toggle("on", !!on);
  }
  // the target track when a NULL instrument plays it (the keys go there instead of the synth)
  function nxKeys() { var tr = kbTarget(); return nxOf(tr) ? tr : null; }
  function play1(n, vel) {
    var nt = nxKeys();
    if (nt) nxNote(nt, 0x99, n, vel);
    else { var sy = kbPlayer(); if (!sy) return; sy.noteOn(n, vel); }
    lightKey(n, true); recEvent("on", n, vel);
  }
  function stop1(n) {
    var nt = nxKeys();
    if (nt) nxNote(nt, 0x89, n, 0);
    else { if (synth) synth.noteOff(n); if (sLive) sLive.noteOff(n); }
    lightKey(n, false); recEvent("off", n, 0);
  }
  function onMidi(e) {
    if (ioLive && ioLive.inst) return;          // orOS Bridge plays this keyboard's notes itself
    var m = M.parse(e.data), sy = m && kbPlayer();
    if (!sy) return;
    var nt = nxKeys();
    if (nt && (m.type === "on" || m.type === "off")) nxNote(nt, m.type === "on" ? 0x99 : 0x89, m.note, m.type === "on" ? m.vel : 0);
    else if (!nt) sy.midi(m);
    if (m.type === "on") lightKey(m.note, true);
    else if (m.type === "off") lightKey(m.note, false);
    if (midiRec) {
      // the event's own time (performance clock) on the audio clock
      var ct = actx.currentTime - (typeof e.timeStamp === "number" && e.timeStamp > 0 ? Math.max(0, Math.min(0.5, (performance.now() - e.timeStamp) / 1000)) : 0);
      if (m.type === "on" || m.type === "off") recEvent(m.type, m.note, m.vel, ct);
      else if (m.type === "cc" && m.cc === 64) recEvent("sus", 0, m.val >= 64, ct);
    }
  }
  function bindMidi() {
    if (!midiAcc) return;
    var names = [];
    midiAcc.inputs.forEach(function (inp) { inp.onmidimessage = onMidi; names.push(C.clipLine(inp.name || "MIDI", 40)); });
    $("kb-status").textContent = names.length ? t("kb.inputs", { names: names.join(", ") }) : t("kb.none");
    $("kb-connect").hidden = true;
  }
  // `ask`: from the button (this may show the browser's question)
  function midiConnect(ask) {
    if (!M.supported()) { if (ask) $("kb-status").textContent = t("kb.noMidi"); return; }
    M.access().then(function (acc) {
      midiAcc = acc;
      if (!prefs.midi) { prefs.midi = true; savePrefs(); }
      acc.onstatechange = bindMidi;
      bindMidi();
    }, function () {
      if (prefs.midi) { prefs.midi = false; savePrefs(); }
      if (ask) $("kb-status").textContent = t("kb.denied");
    });
  }
  function wireKeys2() {
    $("keys-btn").innerHTML = ICON.piano;
    setLabel($("keys-btn"), t("btn.keys"));
    $("keys-btn").addEventListener("click", toggleKeys);
    $("kb-close").innerHTML = ICON.close; setLabel($("kb-close"), t("btn.close"));
    $("kb-close").addEventListener("click", toggleKeys);
    $("kb-oct-dn").innerHTML = ICON.minus; setLabel($("kb-oct-dn"), t("kb.octDown"));
    $("kb-oct-up").innerHTML = ICON.plus; setLabel($("kb-oct-up"), t("kb.octUp"));
    $("kb-oct-dn").addEventListener("click", function () { kbAllOff(); prefs.oct = Math.max(-2, prefs.oct - 1); savePrefs(); renderKeys(); });
    $("kb-oct-up").addEventListener("click", function () { kbAllOff(); prefs.oct = Math.min(2, prefs.oct + 1); savePrefs(); renderKeys(); });
    var snd = $("kb-snd");
    fillSounds(snd);
    snd.value = prefs.snd;
    snd.addEventListener("change", function () {
      var tr = kbTarget();
      if (tr) { setSound(tr, snd.value); renderTrackDlgIfOpen(); }   // the sound of an instrument track is its instrument
      else if (M.PRESETS[snd.value]) { prefs.snd = snd.value; savePrefs(); }
      else { snd.value = prefs.snd; return; }                        // a NULL instrument needs an instrument track
      kbAllOff();
      if (synth && M.PRESETS[snd.value]) synth.setPreset(snd.value);
      syncKb();
    });
    var sv = $("kb-vol");
    sv.value = String(prefs.svol);
    sv.addEventListener("input", function () {
      prefs.svol = parseInt(sv.value, 10) || 0; savePrefs();
      if (synthOut) synthOut.gain.setTargetAtTime(Math.pow(prefs.svol / 100, 2), actx.currentTime, 0.02);
    });
    $("kb-connect").addEventListener("click", function () { midiConnect(true); });
    $("kb-status").textContent = M.supported() ? "" : t("kb.noMidi");
    $("kb-connect").hidden = !M.supported();
    // keys on screen: press, slide across with the mouse held, release
    var keys = $("kb-keys"), downs = {};
    function keyOf(e) { var b = e.target.closest && e.target.closest(".kb-key"); return b ? +b.getAttribute("data-n") : -1; }
    function velOf(e, b) { var r = b.getBoundingClientRect(); return Math.round(40 + 87 * clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1)); }
    keys.addEventListener("pointerdown", function (e) {
      var n = keyOf(e);
      if (n < 0) return;
      e.preventDefault();
      try { e.target.closest(".kb-key").releasePointerCapture(e.pointerId); } catch (err) {}
      downs[e.pointerId] = n;
      play1(n, velOf(e, e.target.closest(".kb-key")));
    });
    keys.addEventListener("pointerover", function (e) {
      if (!(e.pointerId in downs)) return;
      var n = keyOf(e);
      if (n < 0 || n === downs[e.pointerId]) return;
      stop1(downs[e.pointerId]);
      downs[e.pointerId] = n;
      play1(n, velOf(e, e.target.closest(".kb-key")));
    });
    var up = function (e) { if (e.pointerId in downs) { stop1(downs[e.pointerId]); delete downs[e.pointerId]; } };
    keys.addEventListener("pointerup", up);
    keys.addEventListener("pointercancel", up);
    keys.addEventListener("pointerleave", up);
    keys.addEventListener("keydown", function (e) {
      var n = keyOf(e);
      if (n < 0 || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat) play1(n, 100);
    });
    keys.addEventListener("keyup", function (e) {
      var n = keyOf(e);
      if (n >= 0 && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); stop1(n); }
    });
    // allowed before: reconnect without asking
    if (prefs.midi) M.known().then(function (ok) { if (ok) midiConnect(false); });
  }

  // ---------- 8d. MIDI clips: piano roll, .mid files, loops ----------
  var Roll = null;               // piano roll and loop browser (roll.js)
  var L = window.StudioLoops;
  // project time -> the bar it is in starts at / the next bar line
  function barFloor(sec) { var b = C.barSec(proj.bpm, proj.sig); return Math.max(0, Math.floor(sec / b + 1e-6) * b); }
  function barCeil(sec) { var b = C.barSec(proj.bpm, proj.sig); return Math.ceil(sec / b - 1e-6) * b; }
  function newMidiClip(tid, at) {
    var tr = C.find(data, "tracks", tid);
    if (!tr || !proj) return;
    if (projClips().length >= C.MAX_CLIPS) { showToast(t("toast.maxClips", { n: C.MAX_CLIPS })); return; }
    var c = C.normClip({ id: C.newId("c", Math.random), m: 0, p: proj.id, t: tid, at: barFloor(at), off: 0, len: C.barSec(proj.bpm, proj.sig) * 2, n: [] });
    edit(function () { put("clips", c); selClip = c.id; selTrack = tid; });
    openRoll(c.id);
  }
  function openRoll(id) {
    var c = C.find(data, "clips", id);
    if (!c || !C.isMidi(c)) return;
    selClip = id; selTrack = c.t;
    renderRows();
    Roll.open(id);
  }
  // notes of a clip changed: grow the clip to the next bar line when notes reach past its end
  function withNotes(c, notes) {
    var n = Object.assign({}, c, { n: notes }), end = N.notesEnd(notes.filter(function (q) { return q[1] >= c.off; }));
    if (end > c.off + c.len + 1e-6) n.len = Math.min(C.MAX_SEC, barCeil(c.at - c.off + end) - c.at);
    return C.normClip(n) || c;
  }
  function setNotes(cid, notes, opts) {
    var c = C.find(data, "clips", cid);
    if (!c) return;
    edit(function () { put("clips", withNotes(c, notes)); }, opts);
  }
  function liveNotes(cid, notes) {
    var c = C.find(data, "clips", cid);
    if (!c) return;
    put("clips", withNotes(c, notes));
    renderLanesFast();
  }
  // the end of a gesture made of live changes: one undo step
  function commit(before) {
    if (snapshot() === before) { renderAll(); return; }
    undoStack.push(before);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    changed();
  }
  // a short note on an instrument (piano roll keys, a note drawn); tid:
  // the track, whose NULL instrument plays it when it has one
  function audition(p, v, inst, tid) {
    var a = audio();
    if (!a) return;
    resume();
    var tr = tid ? C.find(data, "tracks", tid) : null;
    if (nxOf(tr)) { nxNote(tr, 0x99, p, v); nxNote(tr, 0x89, p, 0, 0.28); return; }
    var si = smpOf(tr) ? SND.get(tr.smp) : null;
    if (si) { SFZ.playNote(a, synthBus(a), si, p, v, a.currentTime + 0.005, 0.28, 1); return; }
    M.playNote(a, synthBus(a), inst, p, v, a.currentTime + 0.005, 0.28, 1);
  }
  // one MIDI message to a track's NULL instrument, now or `later` seconds from now (preview chain)
  function nxNote(tr, status, p, v, later) {
    var a = audio();
    if (!a) return;
    resume();
    var tid = tr.id;
    FX.preview(a, tid, synthBus(a)).then(function (ok) {
      if (ok) FX.previewMidi(tid, [[a.currentTime + (later || 0), status, p, v]]);
    });
  }

  // .mid files
  function readBytes(f) { return f.arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function isMidiFile(f) { return /\.(mid|midi|smf|kar|rmi)$/i.test(f.name || "") || /midi/.test(f.type || ""); }
  // one or more parts of a .mid file onto tracks: the selected instrument
  // track for a single part, else new instrument tracks
  function importMidi(f) {
    return readBytes(f).then(function (bytes) {
      var song;
      try { song = N.readSmf(bytes); } catch (e) { showToast(t("mi.badMidi", { name: f.name })); return false; }
      var parts = song.tracks.filter(function (p) { return p.notes.length; });
      if (!parts.length) { showToast(t("mi.noNotes", { name: f.name })); return false; }
      if (!projClips().length && Math.abs(song.bpm - proj.bpm) > 0.01) {             // an empty project takes the file's tempo
        put("projects", Object.assign({}, proj, { bpm: Math.round(song.bpm), sig: song.sig && C.SIGS.indexOf(song.sig[0]) >= 0 && song.sig[1] === 4 ? song.sig[0] : proj.sig }));
      }
      var base = C.clipLine(f.name.replace(/\.[^.]+$/, ""), C.MAX_NAME), count = 0, sel = C.find(data, "tracks", selTrack);
      parts.forEach(function (p, i) {
        if (projClips().length >= C.MAX_CLIPS) { showToast(t("toast.maxClips", { n: C.MAX_CLIPS })); return; }
        var inst = N.instFor(p.prog, p.ch), tr = parts.length === 1 && sel && sel.p === proj.id && isInst(sel) ? sel : null;
        if (!tr) tr = addTrack(C.clipLine(p.name || (parts.length > 1 ? base + " " + (i + 1) : base), C.MAX_NAME) || null, inst);
        if (!tr) return;
        var notes = N.toSec(p.notes, proj.bpm), end = N.notesEnd(notes);
        put("clips", C.normClip({ id: C.newId("c", Math.random), m: 0, p: proj.id, t: tr.id, at: playhead, off: 0,
                                  len: Math.max(C.MIN_LEN, barCeil(playhead + end) - playhead), name: p.name || base, n: notes }));
        count += notes.length;
      });
      if (count) showToast(t("mi.imported", { n: count, name: f.name }));
      return count > 0;
    });
  }
  // replace the notes of a clip with a file's (all its parts)
  function importMidiInto(cid) {
    pickFilesP(".mid,.midi,audio/midi,audio/x-midi").then(function (files) {
      var f = files && files[0], c = C.find(data, "clips", cid);
      if (!f || !c) return;
      readBytes(f).then(function (bytes) {
        var song;
        try { song = N.readSmf(bytes); } catch (e) { showToast(t("mi.badMidi", { name: f.name })); return; }
        var all = [];
        song.tracks.forEach(function (p) { all = all.concat(p.notes); });
        if (!all.length) { showToast(t("mi.noNotes", { name: f.name })); return; }
        var notes = N.toSec(all, proj.bpm).slice(0, C.MAX_NOTES).map(function (q) { return [q[0], q[1] + c.off, q[2], q[3]]; });
        setNotes(cid, notes);
        showToast(t("mi.imported", { n: notes.length, name: f.name }));
      });
    });
  }
  function midiPart(tr, notes) {
    var inst = instOf(tr);
    return { name: tr ? tr.name : "", ch: inst === "drums" ? 9 : 0, prog: inst === "drums" ? null : N.programFor(inst), notes: N.toBeats(notes, proj.bpm) };
  }
  function saveMidi(bytes, name) { saveBlob(new Blob([bytes], { type: "audio/midi" }), C.fileName(name, "mid"), "audio/midi", "MIDI", ".mid"); }
  // a clip: its window's notes from 0 (type 0)
  function exportClipMidi(cid) {
    var c = C.find(data, "clips", cid);
    if (!c || !C.isMidi(c)) return;
    var notes = C.clipNotes(c, c.at, C.clipEnd(c)).map(function (q) { return [q.p, q.at - c.at, q.end - q.at, q.v]; });
    if (!notes.length) { showToast(t("mi.noNotes", { name: clipName(c) })); return; }
    var tr = C.find(data, "tracks", c.t);
    saveMidi(N.writeSmf({ bpm: proj.bpm, sig: proj.sig, name: clipName(c), tracks: [midiPart(tr, notes)] }, 0), clipName(c));
  }
  // a track: all its MIDI clips, in project time (type 1)
  function exportTrackMidi(tid) {
    var tr = C.find(data, "tracks", tid);
    if (!tr) return;
    var notes = [];
    clipsOf(tid).forEach(function (c) { C.clipNotes(c, 0, C.MAX_SEC).forEach(function (q) { notes.push([q.p, q.at, q.end - q.at, q.v]); }); });
    if (!notes.length) { showToast(t("mi.noNotes", { name: tr.name })); return; }
    saveMidi(N.writeSmf({ bpm: proj.bpm, sig: proj.sig, name: proj.name || tr.name, tracks: [midiPart(tr, notes)] }, 1), tr.name);
  }
  function pickFilesP(accept) {
    var dlg = dialogHost();
    return Promise.resolve(dlg && typeof dlg.openFiles === "function" ? dlg.openFiles(accept) : localPickFiles(accept));
  }

  // Loops: onto an instrument track for the same kind of sound, else a new one
  function sameKind(a, b) { return (a === "drums") === (b === "drums"); }
  function addLoop(loop, tid, at) {
    if (!ensureProject()) return;
    if (projClips().length >= C.MAX_CLIPS) { showToast(t("toast.maxClips", { n: C.MAX_CLIPS })); return; }
    var name = Roll.loopName(loop), placed = null;
    edit(function () {
      var tr = tid ? C.find(data, "tracks", tid) : null;
      if (!tr) { var s = C.find(data, "tracks", selTrack); if (s && s.p === proj.id && isInst(s) && sameKind(instOf(s), loop.inst)) tr = s; }
      if (tr && !(isInst(tr) && sameKind(instOf(tr), loop.inst))) tr = null;
      if (!tr) tr = addTrack(t("snd." + loop.inst), loop.inst);
      if (!tr) return;
      var start = at == null ? barFloor(playhead) : Math.max(0, at);
      var c = C.normClip({ id: C.newId("c", Math.random), m: 0, p: proj.id, t: tr.id, at: start, off: 0,
                           len: L.beatsOf(loop) * C.beatSec(proj.bpm), name: name, n: N.toSec(L.notesOf(loop), proj.bpm) });
      put("clips", c);
      selClip = c.id; selTrack = tr.id;
      placed = tr;
    });
    if (placed) live(t("lp.added", { name: name, track: placed.name }));
  }
  function dropLoop(loop, x, y) {
    var view = $("view").getBoundingClientRect();
    if (x < view.left || x > view.right || y < view.top || y > view.bottom) return;
    var tid = laneAt(x, y);
    addLoop(loop, tid || null, C.snap(secAt(x), proj ? proj.bpm : 120, proj ? proj.sig : 4, "bar"));
  }
  function dropHint(x, y) {
    [].forEach.call(document.querySelectorAll("#rows .row.track.drop"), function (r) { r.classList.remove("drop"); });
    if (x == null) return;
    var tid = laneAt(x, y), row = tid && document.querySelector('#rows .row.track[data-t="' + tid + '"]');
    if (row) row.classList.add("drop");
  }
  function makeRoll() {
    Roll = window.StudioRoll({
      C: C, N: N, M: M, L: L, t: t, el: el, setLabel: setLabel, ICON: ICON, numTxt: numTxt,
      data: function () { return data; }, proj: function () { return proj; },
      pref: function (k, v) { if (v === undefined) return prefs[k]; prefs[k] = v; savePrefs(); return v; },
      setNotes: setNotes, liveNotes: liveNotes, snapshot: snapshot, commit: commit, burst: burst,
      undo: undo, redo: redo, canUndo: function () { return undoStack.length > 0 && !recording; }, canRedo: function () { return redoStack.length > 0 && !recording; },
      position: function () { return playing ? position() : playhead; }, isPlaying: function () { return !!playing; },
      seek: seek, togglePlay: function () { if (proj) togglePlay(); },
      audition: audition, audio: function () { var a = audio(); if (a) resume(); return a; },
      previewOut: function () { return actx ? synthBus(actx) : null; },
      showToast: showToast, live: live, showDlg: showDlg, hideDlg: hideDlg,
      importMidiInto: importMidiInto, exportClipMidi: exportClipMidi,
      addLoop: addLoop, dropLoop: dropLoop, dropHint: dropHint,
      layout: function () { renderLanes(); },
      closed: function () { renderAll(); }
    });
  }

  // Add a track: audio, or an instrument track with one of the instruments
  function openAddTrack() {
    if (proj && tracks().length >= C.MAX_TRACKS) { showToast(t("toast.maxTracks", { n: C.MAX_TRACKS })); return; }
    var host = $("add-insts");
    host.innerHTML = "";
    M.ORDER.forEach(function (id) {
      var b = el("button", "chip", t("snd." + id));
      b.type = "button";
      b.addEventListener("click", function () { hideDlg("add-dlg"); edit(function () { addTrack(null, id); }); });
      host.appendChild(b);
    });
    // the NULL JSFX instruments (once the list of effects is in)
    var nx = function () {
      FX.instruments().forEach(function (e) {
        if (host.querySelector('[data-nx="' + e.id + '"]')) return;
        var b = el("button", "chip", "NULL " + e.name);
        b.type = "button";
        b.setAttribute("data-nx", e.id);
        b.addEventListener("click", function () {
          hideDlg("add-dlg");
          edit(function () {
            var tr = addTrack("NULL " + e.name, nxKind(e.id));
            if (tr) put("tracks", Object.assign({}, tr, { fx: FX.withInstrument(tr.fx, e.id) }));
          });
        });
        host.appendChild(b);
      });
    };
    nx();
    FX.loadCatalog().then(nx, function () {});
    showDlg("add-dlg");
  }
  function renderTrackDlgIfOpen() { if ($("track-dlg").open) renderTrackDlg(); }

  // ---------- 9. Import, export ----------
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  // Standalone fallback only (no shell): a one-shot file input.
  function localPickFiles(accept) {
    return new Promise(function (res) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept; inp.multiple = true;
      inp.addEventListener("change", function () { res(inp.files ? [].slice.call(inp.files) : null); });
      inp.addEventListener("cancel", function () { res(null); });
      inp.click();
    });
  }
  function pickAudio() {
    var dlg = dialogHost(), accept = "audio/*,.wav,.mp3,.ogg,.oga,.opus,.flac,.m4a,.aac,.webm,.mid,.midi,.orosstudio";
    var p = dlg && typeof dlg.openFiles === "function" ? dlg.openFiles(accept) : localPickFiles(accept);
    Promise.resolve(p).then(function (files) { if (files && files.length) routeFiles(files); });
  }
  // audio files become clips on audio tracks, .mid files on instrument tracks (importMidi)
  // lics: licence cards by index (free sounds), optional
  function importFiles(files, lics) {
    if (!fsApi() && files.some(function (f) { return !isMidiFile(f); })) { showToast(t("toast.noDisk")); return Promise.resolve(); }
    if (!ensureProject()) return Promise.resolve();
    var before = snapshot(), any = false;
    return files.reduce(function (p, f, fi) {
      return p.then(function () {
        if (f.size > MAX_FILE) { showToast(t("toast.tooBig", { name: f.name })); return; }
        if (projClips().length >= C.MAX_CLIPS) { showToast(t("toast.maxClips", { n: C.MAX_CLIPS })); return; }
        if (isMidiFile(f)) return importMidi(f).then(function (ok) { if (ok) any = true; });
        busy(t("busy.import", { name: f.name }));
        return f.arrayBuffer().then(decode).then(function (buf) {
          var tr = C.find(data, "tracks", selTrack);
          if (tr && isInst(tr)) tr = null;                       // audio goes on an audio track
          if (!tr || tr.p !== proj.id || (files.length > 1 && clipsOf(tr.id).length)) {
            tr = tracks().length < C.MAX_TRACKS ? addTrack(C.clipLine(f.name.replace(/\.[^.]+$/, ""), C.MAX_NAME)) : tr;
          }
          if (!tr) { showToast(t("toast.maxTracks", { n: C.MAX_TRACKS })); return; }
          return addSource(f.name, C.extOf(f.name, f.type), f, buf, lics && lics[fi]).then(function (src) {
            put("clips", C.normClip({ id: C.newId("c", Math.random), m: 0, p: proj.id, t: tr.id, s: src.id, at: playhead, off: 0, len: buf.duration }));
            any = true;
            showToast(t("toast.imported", { name: f.name }));
          });
        }, function () { showToast(t("toast.badFile", { name: f.name })); });
      });
    }, Promise.resolve()).catch(function (e) {
      showToast(e && e.message === "nodisk" ? t("toast.noDisk") : t("toast.writeFail"));
    }).then(function () {
      busy(null);
      if (any) { undoStack.push(before); redoStack = []; changed(); }
      else renderAll();
    });
  }

  var E = window.StudioEncode;
  var opusOk = null;               // null: not asked yet
  function openExport() {
    // a NULL instrument's own pattern plays without clips: the loop is the song then
    var seq = proj && proj.loop.on && tracks().some(function (tr) { return !!nxOf(tr); });
    if (!proj || !(projClips().length || seq)) { showToast(t("export.empty")); return; }
    var r = C.exportRange(proj, projClips());
    $("export-range").textContent = t(proj.loop.on ? "export.loop" : "export.all", { a: C.fmtTime(r.a), b: C.fmtTime(r.b) });
    $("export-status").textContent = "";
    exportBusy(false);
    $("export-music").hidden = !musicFs() || !shellHas();
    $("export-lyrics").hidden = !musicFs() || !shellHas();
    $("export-ring").hidden = !shellHas();
    renderExportChips();
    renderCredits();
    showDlg("export-dlg");
    if (opusOk === null) E.opusSupported().then(function (ok) { opusOk = ok; if ($("export-dlg").open) renderExportChips(); });
  }
  function renderExportChips() {
    var fmt = prefs.fmt === "opus" && opusOk === false ? "wav" : prefs.fmt;
    radioChips($("export-fmt"), ["wav", "mp3", "opus"], fmt, function (v) { return t("fmt." + v); }, function (v) { prefs.fmt = v; savePrefs(); renderExportChips(); });
    var opusChip = $("export-fmt").querySelectorAll("button")[2];
    if (opusChip && opusOk === false) { opusChip.disabled = true; opusChip.setAttribute("aria-disabled", "true"); }
    radioChips($("export-bits"), [16, 24], prefs.bits, function (v) { return t("bits." + v); }, function (v) { prefs.bits = v; savePrefs(); renderExportChips(); });
    radioChips($("export-rate"), [44100, 48000], prefs.rate, function (v) { return t("rate." + v); }, function (v) { prefs.rate = v; savePrefs(); renderExportChips(); });
    var kb = fmt === "opus" ? [96, 128, 160, 256] : [128, 192, 320], cur = fmt === "opus" ? prefs.okbps : prefs.kbps;
    radioChips($("export-kbps"), kb, cur, function (v) { return t("kbps", { n: v }); }, function (v) {
      if (fmt === "opus") prefs.okbps = v; else prefs.kbps = v;
      savePrefs(); renderExportChips();
    });
    $("export-bits-sec").hidden = fmt !== "wav";
    $("export-kbps-sec").hidden = fmt === "wav";
    $("export-rate-sec").hidden = fmt === "opus";
    $("export-note").textContent = opusOk === false && prefs.fmt === "opus" ? t("export.noOpus") : fmt === "opus" ? t("export.opusRate") : fmt === "mp3" ? t("export.mp3Hint") : "";
  }
  // ---------- 9a. Where the sounds come from (source.lic) ----------
  var licSrc = null;               // id of the source the dialog edits
  function licName(k) { return k ? t("lic." + k) : t("lic.none"); }
  function openLic() {
    var c = selClip ? C.find(data, "clips", selClip) : null, src = c && !C.isMidi(c) ? sourceOf(c.s) : null;
    if (!src) return;
    licSrc = src.id;
    var l = src.lic || {}, sel = $("lic-k");
    sel.innerHTML = "";
    [""].concat(C.LICENCES).forEach(function (k) { var o = el("option", "", licName(k)); o.value = k; sel.appendChild(o); });
    sel.value = l.k || "";
    $("lic-name").value = l.title || src.name.replace(/\.[a-z0-9]{1,5}$/i, "");
    $("lic-by").value = l.by || "";
    $("lic-url").value = l.url || "";
    $("lic-err").textContent = "";
    showDlg("lic-dlg");
  }
  function saveLic() {
    var src = licSrc ? sourceOf(licSrc) : null;
    if (!src) { hideDlg("lic-dlg"); return; }
    var url = $("lic-url").value.trim();
    if (url && !/^https?:\/\//i.test(url)) { $("lic-err").textContent = t("lic.badUrl"); return; }
    var k = $("lic-k").value, lic = k ? C.normLic({ k: k, by: $("lic-by").value, title: $("lic-name").value, url: url }) : null;
    var next = Object.assign({}, src);
    delete next.lic;
    if (lic) next.lic = lic;
    hideDlg("lic-dlg");
    if (JSON.stringify(next) === JSON.stringify(src)) return;
    edit(function () { put("sources", C.normSource(next)); });
    showToast(t("lic.saved"));
  }
  // The credits text of the open project ("" when no sound has a card).
  function creditsText(list) {
    if (!list.length) return "";
    var lines = [t("cr.head", { name: (proj && proj.name) || t("proj.untitled") })];
    list.forEach(function (x) {
      var parts = [t("cr.line", { title: x.lic.title || x.name })];
      if (x.lic.by) parts.push(t("cr.by", { by: x.lic.by }));
      parts.push(t("cr.lic", { lic: licName(x.lic.k) }));
      lines.push("- " + parts.join(", ") + (x.lic.url ? " " + x.lic.url : ""));
    });
    return lines.join("\n");
  }
  // ---------- 9b. Sample instruments: import an SFZ folder, the list on this device ----------
  var SFZ_MAX_MB = 200, SFZ_MAX_FILES = 2000;
  var SFZ_EXT = /\.(wav|flac|mp3|ogg|oga|m4a)$/i;
  // the import of the files of an <input> (a folder, or picked files) for track `tid`
  function importSfz(fileList, tid) {
    var fs = fsApi();
    if (!fs) { showToast(t("smp.noDisk")); return; }
    var files = Array.prototype.slice.call(fileList || []);
    var rel = function (f) { return String(f.webkitRelativePath || f.name).replace(/\\/g, "/"); };
    var sfzs = files.filter(function (f) { return /\.sfz$/i.test(f.name); }).sort(function (a, b) { return rel(a).length - rel(b).length || rel(a).localeCompare(rel(b)); });
    if (!sfzs.length) { showToast(t("smp.noSfz")); return; }
    var main = sfzs[0], base = rel(main).replace(/[^/]*$/, ""), name = main.name.replace(/\.sfz$/i, "").slice(0, 60);
    // a sample path from the .sfz (relative to its folder) → the picked file, case-insensitively
    var byPath = {};
    files.forEach(function (f) { byPath[rel(f).toLowerCase()] = f; byPath[f.name.toLowerCase()] = byPath[f.name.toLowerCase()] || f; });
    var find = function (p) {
      var full = SFZ.samplePath(base + p);
      return (full && byPath[full.toLowerCase()]) || byPath[String(p).split("/").pop().toLowerCase()] || null;
    };
    live(t("smp.importing", { name: name }));
    main.text().then(function (text) {
      var parsed = SFZ.parse(text), names = SFZ.samples(parsed.regions), rename = {}, out = [], skipped = 0, bytes = 0;
      names.forEach(function (p) {
        var f = find(p);
        if (!f || !SFZ_EXT.test(f.name) || out.length >= SFZ_MAX_FILES) { skipped++; return; }
        var n = "s" + String(out.length + 1).padStart(4, "0") + f.name.match(SFZ_EXT)[0].toLowerCase();
        rename[p] = n; bytes += f.size;
        out.push({ name: n, blob: f });
      });
      var regions = parsed.regions.filter(function (r) { return rename[r.sample]; });
      if (!regions.length) { showToast(t("smp.bad")); return null; }
      if (bytes > SFZ_MAX_MB * 1e6) { showToast(t("smp.tooBig", { mb: SFZ_MAX_MB })); return null; }
      var tr = C.find(data, "tracks", tid), kind = tr ? instOf(tr) : "piano";
      var sfz = SFZ.write(regions, rename, [name + " (imported into orOS Studio from " + main.name + ")"]);
      return SND.save(name, kind, sfz, out).then(function (e) {
        var msg = t("smp.imported", { name: e.name, n: out.length }) + (skipped ? ". " + t("smp.skipped", { n: skipped }) : "");
        var tr2 = C.find(data, "tracks", tid), f = tr2 ? soundFields(tr2, "sm:" + e.id) : null, a = audio();
        if (f) setTrack(tr2.id, f);
        renderTrackDlgIfOpen();
        // the import's own message last (after "ready"), with what was left out
        if (f && a) loadSmps(a, [e.id], function () { showToast(msg); replayIfPlaying(); syncKb(); }, true);
        else showToast(msg);
      });
    }).then(null, function () { showToast(t("smp.importFail")); });
  }
  function renderSmpList() {
    var ul = $("smp-items");
    ul.innerHTML = "";
    var packs = SND.list();
    Promise.all(packs.map(function (e) { return SND.kept(e.id).then(function (k) { return k ? e : null; }); })).then(function (kept) {
      kept = kept.filter(Boolean);
      kept.forEach(function (e) {
        var li = el("li", "smp-item"), nm = el("span", "smp-name", packName(e)), sz = el("span", "hint small", t("smp.size", { mb: (e.bytes / 1e6).toFixed(1) }));
        var b = el("button", "chip", t("smp.remove"));
        b.type = "button";
        b.addEventListener("click", function () {
          SND.forget(e.id).then(function () { showToast(t("smp.removed", { name: packName(e) })); renderSmpList(); });
        });
        li.appendChild(nm); li.appendChild(sz); li.appendChild(b);
        ul.appendChild(li);
      });
      SND.users().forEach(function (e) {
        var li = el("li", "smp-item");
        li.appendChild(el("span", "smp-name", e.name));
        li.appendChild(el("span", "hint small", t("smp.mine") + " · " + t("smp.size", { mb: (e.bytes / 1e6).toFixed(1) })));
        ul.appendChild(li);
      });
      $("smp-none").hidden = kept.length + SND.users().length > 0;
      $("smp-user-note").hidden = !SND.users().length;
    });
  }
  // Free sounds: single sounds from oros-sounds, added as audio clips with their licence card
  var fsAudio = null, fsBtn = null;
  function fsStop() {
    if (fsAudio) { fsAudio.pause(); URL.revokeObjectURL(fsAudio.src); fsAudio = null; }
    if (fsBtn) { fsBtn.textContent = t("fs.play"); fsBtn = null; }
  }
  function fsName(x) { return (x.names && x.names[LANG]) || x.name; }
  function fsPlay(x, b) {
    var again = fsBtn === b;
    fsStop();
    if (again) return;
    fsBtn = b; b.textContent = t("fs.stop");
    SND.sampleBlob(x).then(function (blob) {
      if (fsBtn !== b) return;
      fsAudio = new Audio(URL.createObjectURL(blob));
      fsAudio.addEventListener("ended", function () { if (fsBtn === b) fsStop(); });
      return fsAudio.play();
    }).then(null, function () { if (fsBtn === b) fsStop(); showToast(t("fs.fail", { name: fsName(x) })); });
  }
  function fsAdd(x) {
    var name = fsName(x);
    busy(t("busy.import", { name: name }));
    SND.sampleBlob(x).then(function (blob) {
      busy(null);
      var f = new File([blob], C.clipLine(name, C.MAX_NAME - 4) + ".mp3", { type: "audio/mpeg" });
      return importFiles([f], [{ k: x.lic, by: x.by, title: x.name, url: x.url }]);
    }, function () { busy(null); showToast(t("fs.fail", { name: name })); });
  }
  function openFreeSounds() {
    var host = $("fs-groups");
    host.innerHTML = "";
    $("fs-status").textContent = t("fs.loading");
    showDlg("fs-dlg");
    SND.samples().then(function (groups) {
      $("fs-status").textContent = groups.length ? "" : t("fs.none");
      groups.forEach(function (g) {
        host.appendChild(el("h3", "", (g.names && g.names[LANG]) || g.name));
        var ul = el("ul", "smp-items");
        g.items.forEach(function (x) {
          var li = el("li", "smp-item"), p = el("button", "chip", t("fs.play")), ad = el("button", "chip", t("fs.add"));
          p.type = ad.type = "button";
          p.addEventListener("click", function () { fsPlay(x, p); });
          ad.addEventListener("click", function () { fsStop(); hideDlg("fs-dlg"); fsAdd(x); });
          li.appendChild(el("span", "smp-name", fsName(x)));
          li.appendChild(el("span", "hint small", x.dur.toFixed(1).replace(".", LANG === "en" ? "." : ",") + " s"));
          li.appendChild(p); li.appendChild(ad);
          ul.appendChild(li);
        });
        host.appendChild(ul);
      });
    });
  }
  // ---------- 9c. Plugins on this computer (orOS Bridge) ----------
  // The person's own VST3 and CLAP plugins, hosted by orOS Bridge on
  // this computer (bridge.js). A track is "frozen" through one: its
  // dry sound (clips and notes, before effects, fader and pan) or, for
  // an instrument plugin, its notes as MIDI, rendered offline at 48 kHz
  // into a new audio track; the original is muted, all one undo step.
  // The frozen track keeps br {id, name, st, from}: the plugin, its
  // state on the disk (st) and the track it came from, so it can be
  // frozen again with the same sound.
  var BRG = null, BR_RATE = 48000, BR_BLOCK = 4096, BR_TAIL = 2, BR_MAX_TAIL = 10;
  var BR_DIR = "/internal/Studio/bridge";
  var brTrack = "", brOpen = null, brList = [], brBusy = false, brEditors = false;
  function brTr() { return C.find(data, "tracks", brTrack); }
  // the track whose sound goes through the plugin
  function brSource(tr) { return tr && tr.br ? C.find(data, "tracks", tr.br.from) : tr; }
  function brStatus(text) { $("br-status").textContent = text || ""; }
  function brShow(which) {
    ["off", "pair", "on"].forEach(function (k) { $("br-" + k).hidden = k !== which; });
    brSetBusy(brBusy);
  }
  function brSetBusy(on) {
    brBusy = on;
    ["br-connect", "br-pair-go", "br-scan", "br-window", "br-freeze", "br-plugin"].forEach(function (id) { $(id).disabled = on; });
    if (!on) $("br-window").hidden = !brEditors;
  }
  function brClose() {
    if (brOpen && BRG) { BRG.close(brOpen.h); brOpen = null; }
  }
  // bridge.js is loaded the first time the dialog opens (first-open budget)
  var brP = null;
  function brLib() {
    if (BRG) return Promise.resolve(BRG);
    if (!brP) {
      brP = new Promise(function (ok, fail) {
        var s = document.createElement("script");
        s.src = "bridge.js?v=" + VER;
        s.onload = function () { if (window.StudioBridge) ok(window.StudioBridge); else fail(new Error("bridge")); };
        s.onerror = function () { fail(new Error("bridge")); };
        document.head.appendChild(s);
      }).then(function (b) { BRG = b; BRG.on(brEvent); return b; });
      brP.catch(function () { brP = null; });
    }
    return brP;
  }
  function brEvent(ev) {
    if (ev.event === "hello") { brEditors = ev.editors === true; if (!brBusy) $("br-window").hidden = !brEditors; }
    else if (ev.event === "levels") ioLevels(ev);
    else if (ev.event === "closed") {
      if (ioRec) ioFail(t("io.noBridge"));
      ioTest = false;
      brOpen = null;
      if ($("br-dlg").open) { brSetBusy(false); brShow("off"); brStatus(t("br.lost")); }
    }
  }
  function openBridge(tid) {
    brTrack = tid;
    brStatus(t("br.connecting"));
    brShow("");
    showDlg("br-dlg");
    brLib().then(brConnect, function () { brShow("off"); brStatus(t("br.lost")); });
  }
  function brConnect() {
    brSetBusy(true);
    BRG.connect().then(function (r) {
      brSetBusy(false);
      if (r === "pair") {
        $("br-code").value = "";
        brShow("pair");
        brStatus("");
        return BRG.pair().then(function () { $("br-code").focus(); });
      }
      brShow("on");
      return brLoad(false);
    }).then(null, function () { brSetBusy(false); brShow("off"); brStatus(""); });
  }
  function brSendCode() {
    var code = $("br-code").value.replace(/\D/g, "");
    if (code.length !== 6) { brStatus(t("br.badCode")); return; }
    brSetBusy(true);
    BRG.sendCode(code).then(function () {
      brSetBusy(false);
      brShow("on");
      return brLoad(false);
    }, function () {
      brSetBusy(false);
      brStatus(t("br.badCode"));
      return BRG.pair().then(null, function () {});
    });
  }
  // fills the plugin list (a scan when asked, or when nothing is known yet)
  function brLoad(scan) {
    brSetBusy(true);
    if (scan) brStatus(t("br.scanning"));
    return (scan ? BRG.scan() : BRG.list()).then(function (list) {
      if (!list.length && !scan) return brLoad(true);
      brList = list;
      brSetBusy(false);
      brFill();
    }, function () { brSetBusy(false); brStatus(t("br.lost")); });
  }
  function brFill() {
    var tr = brTr(), src = brSource(tr), sel = $("br-plugin"), inst = isInst(src);
    sel.innerHTML = "";
    var want = tr && tr.br ? tr.br.id : tr && tr.lv ? tr.lv.id : (brOpen ? brOpen.id : "");
    [["br.instruments", true], ["br.effects", false]].forEach(function (g) {
      if (g[1] && !inst) return;                 // an audio track has no notes to play
      var items = brList.filter(function (p) { return p.instrument === g[1]; });
      if (!items.length) return;
      var og = document.createElement("optgroup");
      og.label = t(g[0]);
      items.forEach(function (p) {
        var o = el("option", "", p.name + (p.vendor ? " · " + p.vendor : "") + " (" + (p.format === "clap" ? "CLAP" : "VST3") + ")");
        o.value = p.id;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    if (want && brList.some(function (p) { return p.id === want; })) sel.value = want;
    var any = sel.querySelectorAll("option").length > 0;
    $("br-window").disabled = $("br-freeze").disabled = !any;
    brStatus(any ? (tr && tr.br ? t("br.again", { name: tr.br.name }) : t("br.hint")) : t("br.none"));
  }
  function brPicked() { var id = $("br-plugin").value; return brList.filter(function (p) { return p.id === id; })[0] || null; }
  // the picked plugin, open on the bridge (with the frozen track's sound when it is the same plugin)
  function brEnsure() {
    var p = brPicked(), tr = brTr();
    if (!p) return Promise.reject(new Error("none"));
    if (brOpen && brOpen.id === p.id) return Promise.resolve(brOpen);
    brClose();
    brStatus(t("br.opening", { name: p.name }));
    return BRG.open(p.id, BR_RATE, BR_BLOCK).then(function (j) {
      brOpen = { id: p.id, name: p.name, h: j.h, instrument: j.instrument === true || p.instrument, latency: j.latency | 0 };
      return ioTrackState(tr, p.id).then(function (b64) { return b64 ? BRG.setState(brOpen.h, b64) : null; })
        .then(function () { return brOpen; }, function () { return brOpen; });   // a lost state: the plugin's own sound
    }).then(function (o) { brStatus(""); return o; });
  }
  function brWindow() {
    brSetBusy(true);
    brEnsure().then(function (o) { return BRG.editor(o.h); }).then(function () { brSetBusy(false); },
      function () { brSetBusy(false); brStatus(t("br.fail")); });
  }
  // The source track's dry sound, from 0 to its end: [L, R] Float32Arrays
  function brDry(src, end) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return Promise.reject(new Error("noaudio"));
    var len = Math.ceil(end * BR_RATE), oc = new OAC(2, len, BR_RATE), sp = smpOf(src);
    return (sp ? SND.ensure(audio() || oc, [sp]) : Promise.resolve()).then(function () {
      var out = oc.createGain();
      out.connect(oc.destination);
      clipsOf(src.id).forEach(function (c) { if (!C.isMidi(c)) scheduleClip(oc, c, 0, end, 0, out, null); });
      var n = { id: src.id, nx: false, input: out, inst: instOf(src), smp: sp };
      passNotes(0, end).forEach(function (q) { if (q.t === src.id) scheduleNote(oc, q, 0, 0, n, null); });
      var p = oc.startRendering();
      if (!p || typeof p.then !== "function") p = new Promise(function (res) { oc.oncomplete = function (e) { res(e.renderedBuffer); }; });
      return p;
    }).then(function (b) { return [b.getChannelData(0), b.getChannelData(1)]; });
  }
  // the source track's notes as MIDI (channel 1), note-offs first on a shared frame
  function brEvents(src, end) {
    var ev = [];
    passNotes(0, end).forEach(function (q) {
      var v = Math.min(127, Math.round(q.v * q.g));
      if (q.t !== src.id || v < 1) return;
      var on = Math.round(q.at * BR_RATE), off = Math.max(on + 1, Math.round(q.end * BR_RATE));
      ev.push([on, 0x90, q.p, v], [off, 0x80, q.p, 0]);
    });
    return ev.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  }
  // frames after `keep` that are below -100 dB are cut
  function brTrim(chans, keep) {
    var n = chans[0].length;
    while (n > keep && chans.every(function (c) { return Math.abs(c[n - 1]) < 1e-5; })) n--;
    return chans.map(function (c) { return c.subarray(0, n); });
  }
  function brFreeze() {
    var tr = brTr(), src = brSource(tr), fs = fsApi(), a = audio();
    if (!tr || !proj) return;
    if (!src) { brStatus(t("br.gone")); return; }
    if (!fs) { brStatus(t("toast.noDisk")); return; }
    if (nxOf(src)) { brStatus(t("br.nx")); return; }
    var clips = clipsOf(src.id), end = clips.reduce(function (m, c) { return Math.max(m, C.clipEnd(c)); }, 0);
    if (end < C.MIN_LEN) { brStatus(t("br.empty")); return; }
    if (clips.some(function (c) { return !C.isMidi(c) && !buffers[c.s]; })) { brStatus(t("toast.missing")); return; }
    if (!a) { brStatus(t("toast.noAudio")); return; }
    var o, len = Math.ceil(end * BR_RATE), plugin;
    brSetBusy(true);
    brEnsure().then(function (x) {
      o = x; plugin = { id: o.id, name: o.name };
      return BRG.info(o.h);
    }).then(function (inf) {
      var tail = inf.tail > 0 ? Math.min(inf.tail, BR_MAX_TAIL * BR_RATE) : BR_TAIL * BR_RATE;
      o.latency = inf.latency | 0;
      return BRG.reset(o.h).then(function () { return o.instrument ? [] : brDry(src, end); }).then(function (input) {
        brStatus(t("br.rendering", { n: 0 }));
        return BRG.renderAll(o.h, input, o.instrument ? brEvents(src, end) : [], len + tail, o.latency, BR_BLOCK,
          function (x) { brStatus(t("br.rendering", { n: Math.floor(x * 100) })); });
      });
    }).then(function (outs) {
      if (!outs.length) throw new Error("silent");
      var chans = brTrim([outs[0], outs[1] || outs[0]], len);
      return BRG.state(o.h).then(function (st) { return brKeep(tr, src, plugin, chans, st); });
    }).then(function (name) {
      brSetBusy(false);
      brStatus("");
      hideDlg("br-dlg");
      showToast(t("br.done", { name: name }));
    }, function (e) {
      brSetBusy(false);
      brStatus(e && e.message === "noaudio" ? t("toast.noAudio") : t("br.fail"));
    });
  }
  // The render becomes a source on the disk and a clip at 0: on the
  // frozen track again, or on a new track after the source (muted then).
  function brKeep(tr, src, plugin, chans, st) {
    var fs = fsApi(), a = audio(), before = snapshot();
    var buf = a.createBuffer(2, chans[0].length, BR_RATE);
    buf.getChannelData(0).set(chans[0]); buf.getChannelData(1).set(chans[1]);
    var dest = tr.br ? tr : null, name = C.clipLine(src.name + " · " + plugin.name, C.MAX_NAME);
    if (!dest && tracks().length >= C.MAX_TRACKS) throw new Error("full");
    var blob = new Blob([C.wavBytes(chans, BR_RATE, 24)], { type: "audio/wav" });
    return addSource(name + ".wav", "wav", blob, buf, null).then(function (s) {
      var mix = {};
      if (!dest) {                               // a new track hears what the source's fader and effects did
        dest = addTrack(name);
        if (!dest) throw new Error("full");
        mix = { vol: src.vol, pan: src.pan, fx: src.fx, auto: src.auto };
        put("tracks", Object.assign({}, src, { mute: true }));
      }
      var path = BR_DIR + "/" + dest.id + ".txt";
      return Promise.resolve(fs.mkdir ? fs.mkdir(BR_DIR) : null).then(function () {
        return st ? fs.writeBlob(path, new Blob([st], { type: "text/plain" })) : null;
      }).then(function () {
        clipsOf(dest.id).forEach(function (c) { remove("clips", c.id); });
        put("tracks", C.normTrack(Object.assign({}, C.find(data, "tracks", dest.id), mix,
          { br: { id: plugin.id, name: plugin.name, st: st ? path : "", from: src.id } })));
        put("clips", C.normClip({ id: C.newId("c", Math.random), m: 0, p: proj.id, t: dest.id, s: s.id, at: 0, off: 0, len: buf.duration }));
        selTrack = dest.id;
        undoStack.push(before); redoStack = [];
        changed();
        return name;
      });
    });
  }
  function openSmpList() {
    showDlg("smp-dlg");
    renderSmpList();
  }

  // the sample instruments the song's tracks play, as credit lines
  function smpCredits() {
    var seen = {}, out = [];
    projSmps().forEach(function (id) {
      var e = SND.find(id);
      if (!e || seen[id]) return;
      seen[id] = 1;
      var k = ["cc0", "by", "by-sa", "pd"].indexOf(e.lic) >= 0 ? e.lic : "other";
      var lic = { k: k, title: t("smp.credit", { name: packName(e) }) };
      if (e.by) lic.by = e.by;
      if (e.url) lic.url = e.url;
      out.push({ id: id, name: e.name, lic: lic, credit: k !== "cc0" && k !== "pd" });
    });
    return out;
  }
  function renderCredits() {
    var list = proj ? C.credits(data, proj.id).concat(smpCredits()) : [], txt = creditsText(list);
    $("export-cr-sec").hidden = !txt;
    $("export-cr").value = txt;
    $("export-cr-hint").textContent = list.some(function (x) { return x.credit; }) ? t("cr.hint") : t("cr.hintAll");
  }
  function copyCredits() {
    var txt = $("export-cr").value, done = function () { showToast(t("cr.copied")); };
    var fallback = function () { var a = $("export-cr"); a.focus(); a.select(); try { if (document.execCommand("copy")) done(); } catch (e) {} };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback);
    else fallback();
  }
  function saveCredits() {
    var txt = $("export-cr").value;
    if (!txt) return;
    saveBlob(new Blob([txt + "\n"], { type: "text/plain" }), C.fileName(((proj && proj.name) || t("proj.untitled")) + " " + t("cr.sec"), "txt"), "text/plain", t("cr.sec"), ".txt");
  }
  // The song from r.a to r.b as it is heard (effects, master), at `rate`:
  // → [L, R] Float32Arrays. The effects' delay is rendered too and cut
  // from the start. Every instrument is downloaded first: a render never
  // falls back to the built-in sound.
  function renderMix(r, rate) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return Promise.reject(new Error("noaudio"));
    var clips = projClips(), oc, chains = fxChains(), skip = 0, len = Math.ceil((r.b - r.a) * rate);
    return FX.preparePage(chains).then(function () {
      var trLat = tracks().reduce(function (m, tr) { return Math.max(m, FX.chainLatency(tr.fx, rate)); }, 0);
      skip = trLat + FX.chainLatency(proj.fx, rate);
      oc = new OAC(2, len + skip, rate);
      return FX.ensure(oc, chains);
    }).then(function () {
      return SND.ensure(audio() || oc, projSmps()).then(null, function (e) { showToast(t("smp.exportFail")); throw e; });
    }).then(function () {
      var master = oc.createGain(); master.gain.value = C.dbToGain(proj.vol);
      var nodes = {}, notes = passNotes(r.a, r.b);
      // the chains get their transport (and a NULL instrument its notes) up front
      var late = buildTracks(oc, master, nodes, true, function (tr, shift) {
        var ev = [];
        if (nxOf(tr)) notes.forEach(function (q) { if (q.t === tr.id) ev = ev.concat(noteMidi(q, r.a, shift, 0)); });
        return { times: [Object.assign({ at: shift }, transport(r.a))], midi: ev.length ? ev : null };
      }) / rate;
      routeMaster(oc, master, oc.destination, true, nodes, { times: [Object.assign({ at: late }, transport(r.a))] });
      schedAuto(oc, nodes, r.a, r.b, 0, true);
      clips.forEach(function (c) { var n = nodes[c.t]; if (n && !C.isMidi(c)) scheduleClip(oc, c, r.a, r.b, n.shift, n.input, null); });
      notes.forEach(function (q) { var n = nodes[q.t]; if (n && !n.nx) scheduleNote(oc, q, r.a, n.shift, n, null); });
      var p = oc.startRendering();
      if (p && typeof p.then === "function") return p;
      return new Promise(function (res) { oc.oncomplete = function (e) { res(e.renderedBuffer); }; });
    }).then(function (out) { return [out.getChannelData(0).subarray(skip, skip + len), out.getChannelData(1).subarray(skip, skip + len)]; });
  }
  function exportBusy(on) { ["export-go", "export-music", "export-lyrics", "export-ring"].forEach(function (id) { $(id).disabled = on; }); }
  // dest "music": the file goes onto the orOS disk under /internal/Music
  // and plays in Music ("lyrics": opens in Lyric Sync instead);
  // otherwise the save dialog, as always.
  function doExport(dest) {
    var clips = projClips(), r = C.exportRange(proj, clips);
    if (r.b - r.a < C.MIN_LEN) { showToast(t("export.empty")); return; }
    if (clips.some(function (c) { return !C.isMidi(c) && C.clipEnd(c) > r.a && c.at < r.b && !buffers[c.s]; })) { showToast(t("toast.missing")); return; }
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) { showToast(t("toast.noAudio")); return; }
    var fmt = prefs.fmt === "opus" && opusOk === false ? "wav" : prefs.fmt;
    var rate = fmt === "opus" ? 48000 : prefs.rate;
    var fail = function () { exportBusy(false); $("export-status").textContent = ""; showToast(t("toast.noAudio")); };
    $("export-status").textContent = t("export.busy");
    exportBusy(true);
    renderMix(r, rate).then(function (chans) { done(chans); }, fail);
    var title = proj.name || t("proj.untitled");
    var done = function (chans) {
      var finish = function (bytes, mime, ext, desc) {
        exportBusy(false);
        $("export-status").textContent = "";
        hideDlg("export-dlg");
        if (dest === "music" || dest === "lyrics") addToMusic(new Blob([bytes], { type: mime }), C.fileName(title, ext), dest === "lyrics" ? title : null);
        else saveBlob(new Blob([bytes], { type: mime }), C.fileName(title, ext), mime, desc, "." + ext);
      };
      var broke = function () { exportBusy(false); $("export-status").textContent = ""; showToast(t("toast.exportFail")); };
      var pct = function (x) { $("export-status").textContent = t("export.encoding", { n: Math.floor(x * 100) }); };
      if (fmt === "mp3") {
        var enc;
        try { enc = new E.Mp3Encoder(chans, rate, prefs.kbps, { title: title }); } catch (e) { broke(); return; }
        var step = function () {                   // a slice at a time, so the page stays responsive
          try {
            if (enc.step(60)) { finish(enc.bytes(), "audio/mpeg", "mp3", "MP3"); return; }
          } catch (e) { broke(); return; }
          pct(enc.progress());
          setTimeout(step, 0);
        };
        pct(0);
        setTimeout(step, 0);
      } else if (fmt === "opus") {
        pct(0);
        E.encodeOpus([new Float32Array(chans[0]), new Float32Array(chans[1])], prefs.okbps, { title: title, onProgress: pct })
          .then(function (bytes) { finish(bytes, "audio/ogg", "opus", "Opus"); }, broke);
      } else finish(C.wavBytes(chans, rate, prefs.bits), "audio/wav", "wav", "WAV");
    };
  }
  // ---------- 9a. To other apps: Music, Ringtone Composer ----------
  var MUSIC_DIR = "/internal/Music";
  function shellHas() {
    try { var w = window.parent; return !!w && w !== window && typeof w.__orosOpenAt === "function"; } catch (e) { return false; }
  }
  function shellOpen(app, target) {
    try { if (shellHas()) { window.parent.__orosOpenAt(app, target); return true; } } catch (e) {}
    return false;
  }
  function musicFs() { var f = fsApi(); return f && typeof f.mkdir === "function" && typeof f.stat === "function" ? f : null; }
  // "name.mp3", or "name (2).mp3", "name (3).mp3"… when taken. → path or null
  function freeMusicPath(fs, name) {
    var dot = name.lastIndexOf("."), base = name.slice(0, dot), ext = name.slice(dot), n = 1;
    var next = function () {
      var p = MUSIC_DIR + "/" + (n === 1 ? name : base + " (" + n + ")" + ext);
      return Promise.resolve(fs.stat(p)).then(function () { return true; }, function () { return false; }).then(function (taken) {
        if (!taken) return p;
        n++;
        return n > 500 ? null : next();
      });
    };
    return next();
  }
  // lyricsFor: a title → the mix opens in Lyric Sync (wave 3 of Lyric
  // Sync) instead of Music, to time its lyrics.
  function addToMusic(blob, name, lyricsFor) {
    var fs = musicFs();
    if (!fs) { showToast(t("toast.toMusicFail")); return; }
    Promise.resolve(fs.mkdir(MUSIC_DIR)).then(function () { return freeMusicPath(fs, name); }).then(function (p) {
      if (!p) throw new Error("full");
      return Promise.resolve(fs.writeBlob(p, blob)).then(function () { return p; });
    }).then(function (p) {
      showToast(t("toast.toMusic"));
      if (lyricsFor != null) shellOpen("lyricsync", { musicPath: p, title: String(lyricsFor).slice(0, 200) });
      else shellOpen("music", { playPath: p });
    }, function () { showToast(t("toast.toMusicFail")); });
  }
  // The audible instrument notes of the export range (no drum kit) as
  // one RTTTL melody, handed to Ringtone Composer's Import dialog.
  function makeRingtone() {
    if (!proj) return;
    var r = C.exportRange(proj, projClips()), trs = tracks(), solo = C.anySolo(trs), keep = {};
    trs.forEach(function (tr) { if (instOf(tr) !== "drums" && !tr.mute && !(solo && !tr.solo)) keep[tr.id] = true; });
    var notes = passNotes(r.a, r.b).filter(function (q) { return keep[q.t]; });
    var text = C.toRtttl(notes, proj.bpm, proj.name || t("proj.untitled"));
    if (!text) { showToast(t("toast.ringNoNotes")); return; }
    hideDlg("export-dlg");
    shellOpen("ringtones", { importText: { text: text } });
  }
  function saveBlob(blob, name, mime, desc, ext) {
    saveFileP(blob, name, mime, desc, ext).then(function (ok) { if (ok) showToast(t("toast.file")); });   // cancel = silent exit
  }
  // → Promise<true when saved>. The shell's dialog takes any Blob, a
  // multi-GB one too (written a piece at a time).
  function saveFileP(blob, name, mime, desc, ext) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      var acc = {}; acc[mime] = [ext];
      return Promise.resolve(dlg.saveFile({ blob: blob, filename: name, mime: mime, types: [{ description: desc, accept: acc }] }))
        .then(function (res) { return !!(res && res.ok); }, function () { return false; });
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 40000);
    return Promise.resolve(true);
  }

  // ---------- 9b. orOS file (.orosstudio) ----------
  // One project = one orOS bundle (../bundle.js, package.js):
  // content.json is the project in core.js's model (tracks, clips,
  // MIDI notes, effect chains with their settings, automation, tempo,
  // loop), media/<sha256>.<ext> the audio its clips play and the
  // effects' files (Convolution's IR), taken from the disk as Blobs and
  // never read whole into memory (writeBlob; read(file, { big: true })
  // to open), preview/tracks.txt + song.mid (the instrument tracks) +
  // thumbnail.png (the timeline). Opening one always makes a NEW
  // project with fresh ids; the audio is copied to the disk.
  var OROS_MIME = "application/x-oros-studio", OROS_EXT = ".orosstudio";
  function bundleApi() { return window.OrosBundle && window.StudioPackage ? window.OrosBundle : null; }
  function pctOf(d, tot) { return tot > 0 ? Math.min(100, Math.floor(d * 100 / tot)) : 0; }
  function pathExt(p) { var m = /\.([a-z0-9]{1,5})$/i.exec(p || ""); return m ? m[1].toLowerCase() : "wav"; }
  // disk files the effect chains of a project use
  function fxFilesOf(pid) {
    var p = C.find(data, "projects", pid), out = [];
    [p ? p.fx : []].concat(C.tracksOf(data, pid).map(function (tr) { return tr.fx; })).forEach(function (items) {
      (items || []).forEach(function (x) {
        Object.keys(x.f || {}).forEach(function (k) { if (out.indexOf(x.f[k]) < 0) out.push(x.f[k]); });
      });
    });
    return out;
  }
  // preview/song.mid: every instrument track, in project time (type 1)
  function songMidi(pid) {
    var parts = [];
    C.tracksOf(data, pid).forEach(function (tr) {
      var notes = [];
      clipsOf(tr.id).forEach(function (c) { C.clipNotes(c, 0, C.MAX_SEC).forEach(function (q) { notes.push([q.p, q.at, q.end - q.at, q.v]); }); });
      if (notes.length && parts.length < 15) parts.push(midiPart(tr, notes));
    });
    if (!parts.length) return null;
    try { return N.writeSmf({ bpm: proj.bpm, sig: proj.sig, name: proj.name || t("proj.untitled"), tracks: parts }, 1); } catch (e) { return null; }
  }
  // preview/thumbnail.png: the timeline, one row per track
  function songThumb(pid) {
    var trs = C.tracksOf(data, pid), end = Math.max(1, C.projectEnd(C.ofProject(data, "clips", pid)));
    var W = 512, RH = 40, H = Math.max(64, 12 + trs.length * RH);
    var cv = document.createElement("canvas"), g = cv.getContext && cv.getContext("2d");
    if (!g || !cv.toBlob) return Promise.resolve(null);
    cv.width = W; cv.height = H;
    g.fillStyle = "#1c1d22"; g.fillRect(0, 0, W, H);
    var k = (W - 12) / end;
    trs.forEach(function (tr, i) {
      var y = 6 + i * RH;
      g.fillStyle = "rgba(255,255,255,0.04)"; g.fillRect(0, y, W, RH - 4);
      clipsOf(tr.id).forEach(function (c) {
        var x = 6 + c.at * k, w = Math.max(2, c.len * k), h = RH - 8;
        g.globalAlpha = 0.85; g.fillStyle = tr.color; g.fillRect(x, y + 2, w, h);
        g.globalAlpha = 1; g.fillStyle = "rgba(0,0,0,0.45)";
        if (C.isMidi(c)) {
          C.clipNotes(c, c.at, C.clipEnd(c)).forEach(function (q) {
            g.fillRect(6 + q.at * k, y + 2 + h - (q.p / 127) * h, Math.max(2, (q.end - q.at) * k - 1), 3);
          });
        } else {
          var pk = peakCache[c.s];
          if (pk) {
            for (var px = 0; px < w; px += 2) {
              var b = Math.floor((c.off + px / k) * PEAKS_PER_S) * 2;
              var v = Math.min(1, Math.max(Math.abs(pk[b] || 0), Math.abs(pk[b + 1] || 0)));
              g.fillRect(x + px, y + 2 + h / 2 - v * h / 2, 1.5, Math.max(1, v * h));
            }
          }
        }
      });
    });
    return new Promise(function (res) {
      cv.toBlob(function (b) {
        if (!b) { res(null); return; }
        b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }, function () { res(null); });
      }, "image/png");
    });
  }
  function fileTitle(s) {
    return String(s || "").replace(/[\u0000-\u001f\u007f\/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Studio";
  }
  function saveOros() {
    var B = bundleApi(), SP = window.StudioPackage;
    if (!B || !proj || recording) return;
    flush();
    hideDlg("proj-dlg");
    var pid = proj.id, p0 = proj, fs = fsApi();
    var used = {};
    projClips().forEach(function (c) { if (c.s) used[c.s] = true; });
    var items = C.ofProject(data, "sources", pid).filter(function (s) { return used[s.id]; })
      .map(function (s) { return { src: s.id, path: s.path }; })
      .concat(fxFilesOf(pid).map(function (path) { return { fx: path, path: path }; }));
    var keys = { src: {}, fx: {} }, media = {}, missing = 0, total = 0, done = 0;
    busy(t("oros.reading", { n: 0 }));
    var chain = Promise.resolve();
    items.forEach(function (it) {
      chain = chain.then(function () {
        if (!fs) return null;
        return Promise.resolve(fs.readBlob(it.path)).then(function (b) { return b || null; }, function () { return null; });
      }).then(function (b) { it.blob = b; if (b) total += b.size; });
    });
    items.forEach(function (it) {
      chain = chain.then(function () {
        if (!it.blob) { missing++; return; }
        return B.digest(it.blob, function (n) { done += n; busy(t("oros.reading", { n: pctOf(done, total) })); }).then(function (d) {
          var key = d.sha + "." + pathExt(it.path);
          media[key] = it.blob;
          if (it.src) keys.src[it.src] = key; else keys.fx[it.fx] = key;
        });
      });
    });
    var built = null;
    chain.then(function () {
      built = SP.build(data, pid, keys, {
        fxName: function (id) { return FX.nameOf(id); },
        instName: function (id) { return window.StudioMidi.PRESETS[id] ? t("snd." + id) : id; },
        words: { untitled: t("proj.untitled"), tempo: t("oros.w.tempo"), length: t("oros.w.length"), master: t("f.master"), fx: t("fx.open"),
                 audio: t("oros.w.audio"), inst: t("oros.w.inst"), clips: t("oros.w.clips"), notes: t("oros.w.notes"),
                 mute: t("oros.w.muted"), solo: t("oros.w.solo"), midi: t("mi.clip") }
      });
      return songThumb(pid).catch(function () { return null; });
    }).then(function (thumb) {
      var preview = [{ name: "tracks.txt", data: built.tracksTxt, type: "text/plain" }];
      var mid = songMidi(pid);
      if (mid) preview.push({ name: "song.mid", data: mid, type: "audio/midi" });
      busy(t("oros.packing", { n: 0 }));
      return B.writeBlob({
        mime: OROS_MIME, app: "studio", schema: "studio/1",
        content: built.content,
        meta: { title: p0.name || "", modified: new Date(p0.m || Date.now()).toISOString(), id: pid, language: LANG, generator: "orOS Studio" },
        generator: "orOS Studio",
        media: media, thumbnail: thumb, preview: preview, date: new Date(),
        onProgress: function (d, tot) { busy(t("oros.packing", { n: pctOf(d, tot) })); }
      });
    }).then(function (blob) {
      busy(null);
      if (missing) showToast(t("oros.missing", { n: missing }));
      return saveFileP(blob, fileTitle(p0.name || t("proj.untitled")) + OROS_EXT, OROS_MIME, "orOS Studio", OROS_EXT);
    }).then(function (ok) {
      if (ok && !missing) showToast(t("toast.file"));
    }, function (e) {
      busy(null);
      try { console.error("[orOS] studio: .orosstudio", e); } catch (x) {}
      showToast(t("oros.fail"));
    });
  }

  // Picked or dropped files: .orosstudio bundles (by their first bytes;
  // a ZIP named .orosstudio too, so a broken one gets a message) open as
  // new projects, after the audio and MIDI files are imported.
  function isOros(f) {
    var B = bundleApi();
    if (!B || isMidiFile(f) || typeof f.slice !== "function") return Promise.resolve(false);
    return f.slice(0, 128).arrayBuffer().then(function (ab) {
      var k = B.sniff(new Uint8Array(ab));
      return k === OROS_MIME || (k !== null && /\.orosstudio$/i.test(f.name || ""));
    }, function () { return false; });
  }
  function routeFiles(files) {
    return Promise.all(files.map(isOros)).then(function (flags) {
      var ours = files.filter(function (f, i) { return flags[i]; });
      var rest = files.filter(function (f, i) { return !flags[i]; });
      return Promise.resolve(rest.length ? importFiles(rest) : null).then(function () {
        return ours.reduce(function (p, f) { return p.then(function () { return openOros(f); }); }, Promise.resolve());
      });
    });
  }
  function orosFail(name) {
    return function (e) {
      busy(null);
      showToast(e && e.code === "newer" ? t("oros.newer") : t("oros.bad", { name: name }));
    };
  }
  function openOros(f) {
    var B = bundleApi(), name = f.name || OROS_EXT;
    if (!B) return Promise.resolve();
    busy(t("oros.opening", { name: name, n: 0 }));
    return B.read(f, { mime: OROS_MIME, big: true, onProgress: function (d, tot) { busy(t("oros.opening", { name: name, n: pctOf(d, tot) })); } })
      .then(function (r) { return addOros(r, name); }, orosFail(name));
  }
  function openOrosFolder() {
    var B = bundleApi();
    if (!B) return;
    hideDlg("proj-dlg");
    B.pickFolder().then(function (files) {
      if (!files || !files.length) return;
      var first = files[0], name = String(first.webkitRelativePath || first.name || "").split("/")[0] || OROS_EXT;
      busy(t("oros.opening", { name: name, n: 0 }));
      return B.readFolder(files, { mime: OROS_MIME, big: true, onProgress: function (d, tot) { busy(t("oros.opening", { name: name, n: pctOf(d, tot) })); } })
        .then(function (r) { return addOros(r, name); }, orosFail(name));
    });
  }
  function pickOros() {
    hideDlg("proj-dlg");
    pickFilesP(OROS_EXT + "," + OROS_MIME).then(function (files) { if (files && files.length) routeFiles(files); });
  }
  // A read bundle → a NEW project: its audio onto the disk first, then
  // the project, tracks, sources and clips into the data.
  function addOros(r, name) {
    var SP = window.StudioPackage, parsed;
    try {
      parsed = SP.parse(r.content, { newId: function (k) { return C.newId(k, Math.random); }, now: Date.now(), title: r.meta && r.meta.title });
    } catch (e) { orosFail(name)(e); return; }
    if (data.projects.length >= C.MAX_PROJECTS) { busy(null); showToast(t("toast.maxProjects", { n: C.MAX_PROJECTS })); return; }
    var fs = fsApi(), files = parsed.files.filter(function (x) { return r.media[x.key]; }), written = [];
    if (files.length && !fs) { busy(null); showToast(t("toast.noDisk")); return; }
    if (!parsed.project.name) parsed.project.name = t("proj.default", { n: data.projects.length + 1 });
    return files.reduce(function (p, x, i) {
      return p.then(function () {
        busy(t("oros.copying", { n: i + 1, m: files.length }));
        var m = r.media[x.key];
        var blob = m.blob || new Blob([m.bytes], { type: m.type });
        return Promise.resolve(fs.writeBlob(x.path, blob)).then(function () { written.push(x.path); });
      });
    }, Promise.resolve()).then(function () {
      var part = C.emptyData();
      part.projects = [parsed.project]; part.tracks = parsed.tracks; part.sources = parsed.sources; part.clips = parsed.clips;
      data = C.mergeStudio(data, part);
      save();
      busy(null);
      openProject(C.find(data, "projects", parsed.project.id));
      if ($("proj-dlg").open) renderProjects();
      showToast(t("oros.opened", { name: parsed.project.name }));
    }, function () {
      busy(null);
      written.forEach(function (p) { try { Promise.resolve(fs.rm(p)).catch(function () {}); } catch (e) {} });
      showToast(t("toast.writeFail"));
    });
  }

  // Target { openFile: { token } }: an .orosstudio (or an audio or MIDI
  // file) from the system's "Open with" (shell fileopen.js), taken once
  // from the shell and opened as a picked file is.
  function openFileTarget(o) {
    var f = null;
    try {
      var w = window.parent;
      if (o && typeof o.token === "string" && w && w !== window && typeof w.__orosTakeFile === "function")
        f = w.__orosTakeFile(o.token);
    } catch (e) { f = null; }
    if (f) routeFiles([f]);
  }
  function openTarget(tg) {
    if (!tg || typeof tg !== "object") return;
    if (tg.edit || tg.editUndo) { assistRun(tg); return; }
    // a search hit (search.js)
    if (typeof tg.project === "string") { var hit = C.find(data, "projects", tg.project); if (hit) openProject(hit); return; }
    if (tg.openFile) openFileTarget(tg.openFile);
  }
  window.__orosOpenAt = openTarget;

  // The Assistant's changes (AS-EDIT, assist.js), loaded on the first
  // request with commands.js.
  window.StudioAssistHost = {
    t: t, toast: showToast, undoToast: undoToast,
    data: function () { flush(); return data; },
    pid: function () { return proj ? proj.id : ""; },
    busy: function () { return recording || !!(drag || rdrag || adrag) || !!(Roll && Roll.busy()); },
    open: function (id) { var p = C.find(data, "projects", id); if (p) openProject(p); },
    // next = the whole data; withUndo = the open project changed (one
    // step of Studio's own Undo).
    set: function (next, withUndo) {
      if (withUndo) {
        undoStack.push(snapshot());
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        redoStack = [];
      }
      data = next;
      if (proj) proj = C.find(data, "projects", proj.id);
      if (!proj) { openProject(null); save(); return; }
      fixSelection();
      save();
      renderAll();
      FX.render();
      replayIfPlaying();
      if ($("proj-dlg").open) renderProjects();
      if ($("track-dlg").open) renderTrackDlg();
    }
  };
  var assistP = null;
  function assistLoad() {
    if (window.StudioAssist) return Promise.resolve(window.StudioAssist);
    if (!assistP) {
      var load = function (f) {
        return new Promise(function (ok, fail) {
          var s = document.createElement("script");
          s.src = f + "?v=" + VER;
          s.onload = ok; s.onerror = function () { fail(new Error(f)); };
          document.head.appendChild(s);
        });
      };
      assistP = (window.orosRecipes ? Promise.resolve() : load("../recipes/core.js"))
        .then(function () { return load("commands.js"); }).then(function () { return load("assist.js"); }).then(function () {
          if (!window.StudioAssist) throw new Error("assist");
          return window.StudioAssist;
        });
      assistP.catch(function () { assistP = null; });
    }
    return assistP;
  }
  // { edit: { key, chat, docs, steps } } | { editUndo: { key, tok } }
  function assistRun(tg) {
    assistLoad().then(function (A) {
      if (tg.edit) A.edit(tg.edit); else A.undo(tg.editUndo);
    }, function () { showToast(t("as.bad")); });
  }

  // ---------- Clip actions ----------
  function selectedClip() {
    var c = selClip ? C.find(data, "clips", selClip) : null;
    if (!c) showToast(t("toast.noClip"));
    return c;
  }
  function splitSel() {
    var c = selectedClip();
    if (!c) return;
    var at = playing ? position() : playhead, parts = C.splitClip(c, at, C.newId("c", Math.random));
    if (!parts) { showToast(t("toast.noSplit")); return; }
    if (projClips().length >= C.MAX_CLIPS) { showToast(t("toast.maxClips", { n: C.MAX_CLIPS })); return; }
    edit(function () { put("clips", parts[0]); put("clips", parts[1]); selClip = parts[1].id; });
  }
  function dupSel() {
    var c = selectedClip();
    if (!c) return;
    if (projClips().length >= C.MAX_CLIPS) { showToast(t("toast.maxClips", { n: C.MAX_CLIPS })); return; }
    var n = Object.assign({}, c, { id: C.newId("c", Math.random), at: C.clipEnd(c) });
    edit(function () { put("clips", n); selClip = n.id; });
  }
  function delSel() {
    var c = selectedClip();
    if (!c) return;
    edit(function () { remove("clips", c.id); selClip = ""; });
    undoToast(t("toast.clipDeleted"), undo);
  }
  function setClip(fields, field) {
    var c = selClip ? C.find(data, "clips", selClip) : null;
    if (!c) return;
    edit(function () { put("clips", C.normClip(Object.assign({}, c, fields))); }, burst(field + c.id));
  }

  // ---------- 10. Dialogs ----------
  function showDlg(id) {
    var d = $(id);
    if (d.open) return;
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  }
  function hideDlg(id) { var d = $(id); if (d.close) d.close(); else d.removeAttribute("open"); }

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

  // Projects
  function openProjects() { renderProjects(); showDlg("proj-dlg"); }
  function renderProjects() {
    var host = $("proj-list"), list = C.newestFirst(data.projects);
    if ($("oros-save")) $("oros-save").disabled = !proj;
    host.innerHTML = "";
    $("proj-empty").hidden = list.length > 0;
    list.forEach(function (p) {
      var li = el("li", "row-item" + (proj && proj.id === p.id ? " on" : ""));
      var open = el("button", "row-open");
      open.type = "button";
      open.appendChild(el("span", "row-title", p.name || t("proj.untitled")));
      var n = C.ofProject(data, "tracks", p.id).length;
      var len = C.fmtTime(C.projectEnd(C.ofProject(data, "clips", p.id))).replace(/\.\d+$/, "");
      open.appendChild(el("span", "row-desc", t("proj.desc", { n: n, t: len })));
      if (proj && proj.id === p.id) open.setAttribute("aria-current", "true");
      setLabel(open, t("btn.open") + ": " + (p.name || t("proj.untitled")));
      open.addEventListener("click", function () { hideDlg("proj-dlg"); openProject(C.find(data, "projects", p.id)); });
      li.appendChild(open);
      var del = el("button", "icon-btn del-btn");
      del.type = "button"; del.innerHTML = ICON.close;
      setLabel(del, t("btn.delProject") + ": " + (p.name || t("proj.untitled")));
      del.addEventListener("click", function () { deleteProject(p.id); });
      li.appendChild(del);
      host.appendChild(li);
    });
  }
  function newProject() {
    if (data.projects.length >= C.MAX_PROJECTS) { showToast(t("toast.maxProjects", { n: C.MAX_PROJECTS })); return; }
    hideDlg("proj-dlg");
    proj = null;
    ensureProject();
  }
  function deleteProject(pid) {
    var p = C.find(data, "projects", pid);
    if (!p) return;
    var keep = {};
    C.LISTS.forEach(function (key) { keep[key] = key === "projects" ? [p] : C.ofProject(data, key, pid).map(function (x) { return Object.assign({}, x); }); });
    var paths = keep.sources.map(function (s) { return s.path; });
    if (proj && proj.id === pid) openProject(null);
    var part = C.emptyData(), now = Date.now();
    C.LISTS.forEach(function (key) { keep[key].forEach(function (x) { part.tombs[x.id] = Math.max(now, x.m); }); });
    data = C.mergeStudio(data, part);
    save();
    renderProjects(); renderAll();
    removeFilesLater(pid, paths);
    undoToast(t("toast.projDeleted"), function () {
      clearTimeout(pendingRm[pid]); delete pendingRm[pid];
      var back = C.emptyData();
      C.LISTS.forEach(function (key) {
        keep[key].forEach(function (x) { x.m = Math.max(Date.now(), (data.tombs[x.id] || 0) + 1); back[key].push(x); });
      });
      data = C.mergeStudio(data, back);
      save();
      openProject(C.find(data, "projects", pid));
      renderProjects();
    });
  }

  // Name prompt
  var nameDone = null;
  function askName(title, value, done) {
    $("name-title").textContent = title;
    $("name-in").value = value || "";
    nameDone = done;
    showDlg("name-dlg");
    setTimeout(function () { $("name-in").focus(); $("name-in").select(); }, 0);
  }
  function renameProject() {
    if (!ensureProject()) return;
    askName(t("name.project"), proj.name, function (v) { setProject({ name: v }); });
  }

  // Track settings
  var dlgTrack = "";
  function openTrack(tid) {
    dlgTrack = tid; selTrack = tid;
    renderTrackDlg();
    showDlg("track-dlg");
  }
  function renderTrackDlg() {
    var tr = C.find(data, "tracks", dlgTrack);
    if (!tr) { hideDlg("track-dlg"); return; }
    $("track-title").textContent = tr.name;
    var host = $("track-colors");
    radioChips(host, C.COLORS, tr.color, function () { return ""; }, function (v) { setTrack(tr.id, { color: v }); renderTrackDlg(); });
    [].forEach.call(host.querySelectorAll("button"), function (b, i) {
      b.className += " swatch"; b.style.background = C.COLORS[i]; setLabel(b, t("sec.color") + " " + (i + 1));
    });
    var vi = $("tvol-in"), pi = $("tpan-in");
    if (document.activeElement !== vi) vi.value = String(tr.vol);
    if (document.activeElement !== pi) pi.value = String(tr.pan);
    $("tvol-out").textContent = dbTxt(tr.vol);
    $("tpan-out").textContent = panTxt(tr.pan);
    var n = FX.count(tr.fx);
    $("track-fx").textContent = t("fx.open") + (n ? " · " + n : "");
    $("track-auto").textContent = t("au.show") + ((tr.auto || []).length ? " · " + tr.auto.length : "");
    var inst = isInst(tr), is = $("track-inst");
    $("track-inst-sec").hidden = !inst;
    $("track-midi-row").hidden = !inst;
    if (inst) {
      if (is.querySelectorAll("option").length !== soundCount()) fillSounds(is);
      is.value = soundValue(is, tr);
      $("track-midi").disabled = !clipsOf(tr.id).some(C.isMidi);
    }
    var trs = tracks();
    $("track-up").disabled = trs[0] && trs[0].id === tr.id;
    $("track-down").disabled = trs.length && trs[trs.length - 1].id === tr.id;
  }

  // Settings
  function openMore() {
    renderDevices();
    renderIo();
    $("lat-in").value = String(prefs.lat); $("lat-out").textContent = t("ms", { n: prefs.lat });
    $("mvol-in").value = String(prefs.mvol); $("mvol-out").textContent = prefs.mvol + "%";
    var v = vaultApi(), usable = false;
    try { usable = !!(v && v.status().usable); } catch (e) {}
    $("disk-info").textContent = usable ? t("disk.vault") : t("disk.local");
    showDlg("more-dlg");
  }
  function renderDevices() {
    var md = navigator.mediaDevices;
    var outOk = !!(audio() && typeof actx.setSinkId === "function");
    $("out-dev").disabled = !outOk;
    $("out-hint").hidden = outOk;
    if (!md || typeof md.enumerateDevices !== "function") return;
    md.enumerateDevices().then(function (list) {
      fill($("in-dev"), list.filter(function (d) { return d.kind === "audioinput"; }), prefs.inDev);
      fill($("out-dev"), list.filter(function (d) { return d.kind === "audiooutput"; }), prefs.outDev);
    }).catch(function () {});
  }
  function fill(sel, devs, cur) {
    sel.innerHTML = "";
    var o = el("option", "", t("dev.default")); o.value = ""; sel.appendChild(o);
    devs.forEach(function (d, i) {
      if (!d.deviceId || d.deviceId === "default") return;
      var op = el("option", "", d.label || t("dev.n", { n: i + 1 }));
      op.value = d.deviceId;
      sel.appendChild(op);
    });
    sel.value = cur;
    if (sel.value !== cur) sel.value = "";
  }
  function askDeviceNames() {
    var md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) { showToast(t("toast.noRec")); return; }
    md.getUserMedia({ audio: true }).then(function (s) {
      s.getTracks().forEach(function (k) { k.stop(); });
      renderDevices();
    }, function () { showToast(t("toast.noMic")); });
  }

  // Busy overlay (import / saving a take)
  function busy(text) {
    $("busy").hidden = !text;
    $("busy-text").textContent = text || "";
  }

  // ---------- 11. Toasts ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "studio", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    var host = document.querySelector("dialog[open]") || document.body;
    if (box.parentNode !== host) host.appendChild(box);
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

  // ---------- 12. Keyboard ----------
  function typing(e) {
    var tg = e.target, tag = tg && tg.tagName;
    return tag === "INPUT" && tg.type !== "checkbox" && tg.type !== "range" || tag === "TEXTAREA" || tag === "SELECT" || (tg && tg.isContentEditable);
  }
  function setZoom(d) {
    var i = ZOOMS.indexOf(zoom()), j = clamp(i + d, 0, ZOOMS.length - 1);
    if (i === j) return;
    var view = $("view"), pos = playing ? position() : playhead;
    var anchor = headW() + pos * zoom() - view.scrollLeft;
    prefs.zoom = ZOOMS[j]; savePrefs();
    renderAll();
    view.scrollLeft = Math.max(0, headW() + pos * zoom() - anchor);
  }
  function toggleLoop() {
    if (!ensureProject()) return;
    var lp = proj.loop;
    if (!(lp.b - lp.a >= C.MIN_LEN)) {                   // no region yet: four bars from the playhead
      var bar = C.barSec(proj.bpm, proj.sig), a = Math.floor(playhead / bar) * bar;
      setProject({ loop: { on: true, a: a, b: a + 4 * bar } });
    } else setProject({ loop: { on: !lp.on, a: lp.a, b: lp.b } });
  }
  function toggleMetro() {
    prefs.metro = !prefs.metro; savePrefs();
    renderTransport();
    if (playing && !recording) replayIfPlaying();
  }
  function wireKeyboard() {
    // Contract B: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      var dlg = document.querySelector("dialog[open]");
      if (dlg && dlg.id === "fx-dlg" && e.key === " " && !e.defaultPrevented && !typing(e) &&
          !(e.target && /^(BUTTON|SELECT|SUMMARY|INPUT)$/.test(e.target.tagName))) { e.preventDefault(); togglePlay(); return; }
      if (e.defaultPrevented || typing(e) || e.altKey || dlg) return;
      var k = e.key, lk = k.length === 1 ? k.toLowerCase() : k;
      if ((e.ctrlKey || e.metaKey) && (lk === "z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (lk === "y")) { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey) return;
      if (k === " " && !(e.target && e.target.tagName === "BUTTON")) { e.preventDefault(); togglePlay(); }
      else if (k === "Home") { e.preventDefault(); seek(0); }
      else if (lk === "r") { e.preventDefault(); startRecording(); }
      else if (lk === "l") { e.preventDefault(); toggleLoop(); }
      else if (lk === "k") { e.preventDefault(); toggleMetro(); }
      else if (lk === "s" && selClip) { e.preventDefault(); splitSel(); }
      else if (lk === "d" && selClip) { e.preventDefault(); dupSel(); }
      else if ((k === "Delete" || k === "Backspace") && selClip) { e.preventDefault(); delSel(); }
      else if (lk === "e" && selClip) { e.preventDefault(); openRoll(selClip); }
      else if (k === "+" || k === "=") { e.preventDefault(); setZoom(1); }
      else if (k === "-") { e.preventDefault(); setZoom(-1); }
      else if (k === "Escape" && selClip) { selClip = ""; renderRows(); }
    });
  }

  // ---------- 13. Sync slice + palette ----------
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
    api.registerSlice("studio", sliceGet, sliceSet, STORAGE_KEY, C.mergeStudio);
  }

  function sliceGet() { flush(); return C.mergeStudio(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.projects)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeStudio(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast on merge
    keepFxOffline();
    if (drag || rdrag || adrag || recording || (Roll && Roll.busy())) return;   // the gesture finishes on the local copy; the next edit merges
    if (proj) {
      var fresh = C.find(data, "projects", proj.id);
      if (!fresh) { openProject(null); return; }   // deleted elsewhere
      proj = fresh;
    } else if (prefs.cur) {
      var p = C.find(data, "projects", prefs.cur);
      if (p) { openProject(p); return; }
    }
    fixSelection();
    renderAll();
    loadProjectAudio();
    if ($("proj-dlg").open) renderProjects();
    if ($("track-dlg").open) renderTrackDlg();
    FX.render();
    if (playing && !recording) replayIfPlaying();
  }

  // ---------- 14. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    [].forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) {
      n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria")));
    });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) {
      n.setAttribute("placeholder", t(n.getAttribute("data-i18n-ph")));
    });
    document.title = t("app.name") + " · orOS";
    var icons = [["proj-btn", "list", "btn.projects"], ["undo-btn", "undo", "btn.undo"], ["redo-btn", "redo", "btn.redo"],
                 ["import-btn", "import", "btn.import"], ["export-btn", "export", "btn.exportOpen"], ["more-btn", "more", "btn.more"],
                 ["home-btn", "home", "btn.home"], ["stop-btn", "stop", "btn.stop"], ["rec-btn", "rec", "btn.rec"],
                 ["loop-btn", "loop", "btn.loop"], ["zoom-in", "zin", "btn.zoomIn"], ["zoom-out", "zout", "btn.zoomOut"],
                 ["clip-close", "close", "btn.close"], ["proj-close", "close", "btn.close"], ["track-close", "close", "btn.close"],
                 ["export-close", "close", "btn.close"], ["more-close", "close", "btn.close"], ["fx-close", "close", "btn.close"],
                 ["add-close", "close", "btn.close"], ["pr-play", "play", "pr.play"]];
    icons.forEach(function (x) { $(x[0]).innerHTML = ICON[x[1]]; setLabel($(x[0]), t(x[2])); });
    var sig = $("sig-in");
    C.SIGS.forEach(function (n) { var o = el("option", "", t("sig.n", { n: n })); o.value = String(n); sig.appendChild(o); });
    var sn = $("snap-in");
    ["bar", "beat", "off"].forEach(function (v) { var o = el("option", "", t("snap." + v)); o.value = v; sn.appendChild(o); });
    setLabel($("title-btn"), t("name.project"));
  }

  function wire() {
    $("proj-btn").addEventListener("click", openProjects);
    $("title-btn").addEventListener("click", renameProject);
    $("undo-btn").addEventListener("click", undo);
    $("redo-btn").addEventListener("click", redo);
    $("import-btn").addEventListener("click", pickAudio);
    $("export-btn").addEventListener("click", openExport);
    $("more-btn").addEventListener("click", openMore);
    $("home-btn").addEventListener("click", function () { seek(0); });
    $("play-btn").addEventListener("click", function () { if (!proj) { ensureProject(); } togglePlay(); });
    $("stop-btn").addEventListener("click", stopBtn);
    $("rec-btn").addEventListener("click", startRecording);
    $("loop-btn").addEventListener("click", toggleLoop);
    $("metro-btn").addEventListener("click", toggleMetro);
    $("zoom-in").addEventListener("click", function () { setZoom(1); });
    $("zoom-out").addEventListener("click", function () { setZoom(-1); });
    $("bpm-in").addEventListener("change", function () {
      var v = parseFloat($("bpm-in").value);
      if (!isFinite(v)) { renderTransport(); return; }
      setProject({ bpm: clamp(Math.round(v), C.MIN_BPM, C.MAX_BPM) });
    });
    $("sig-in").addEventListener("change", function () { setProject({ sig: parseInt($("sig-in").value, 10) }); });
    $("snap-in").addEventListener("change", function () { prefs.snap = $("snap-in").value; savePrefs(); });
    $("master-in").addEventListener("input", function () {
      var v = parseFloat($("master-in").value);
      setLabel($("master-in"), t("f.master") + ": " + dbTxt(v));
      setProject({ vol: v }, burst("master", { live: true }));
    });
    $("add-track").addEventListener("click", openAddTrack);
    var rows = $("rows");
    rows.addEventListener("pointerdown", onRowsDown);
    rows.addEventListener("pointermove", onRowsMove);
    rows.addEventListener("pointerup", onRowsUp);
    rows.addEventListener("pointercancel", onRowsUp);
    rows.addEventListener("dblclick", function (e) {
      var pt = e.target.closest && e.target.closest(".a-pt"), area = pt && pt.closest(".a-lane");
      if (pt && area) { delPoint(area.getAttribute("data-t"), area.getAttribute("data-k"), +pt.getAttribute("data-i")); return; }
    });
    rows.addEventListener("keydown", function (e) {
      var pt = e.target.closest && e.target.closest(".a-pt");
      if (pt) { autoKey(e, pt); return; }
      var cEl = e.target.closest && e.target.closest(".clip");
      if (cEl && e.key === "Enter" && cEl.classList.contains("midi") && selClip === cEl.getAttribute("data-c")) { e.preventDefault(); e.stopPropagation(); openRoll(selClip); return; }
      if (cEl && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); selClip = cEl.getAttribute("data-c"); renderRows(); var f = document.querySelector('.clip[data-c="' + selClip + '"]'); if (f) f.focus(); }
    });
    var ruler = $("ruler");
    ruler.addEventListener("pointerdown", onRulerDown);
    ruler.addEventListener("pointermove", onRulerMove);
    ruler.addEventListener("pointerup", onRulerUp);
    ruler.addEventListener("pointercancel", function () { rdrag = null; if (proj) proj = C.find(data, "projects", proj.id); renderRuler(); });
    ruler.addEventListener("keydown", onRulerKey);
    $("view").addEventListener("wheel", function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    // Files dropped from the desktop
    var view = $("view");
    view.addEventListener("dragover", function (e) { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], "Files") >= 0) { e.preventDefault(); view.classList.add("drop"); } });
    view.addEventListener("dragleave", function () { view.classList.remove("drop"); });
    view.addEventListener("drop", function (e) {
      view.classList.remove("drop");
      var fl = e.dataTransfer && e.dataTransfer.files;
      if (!fl || !fl.length) return;
      e.preventDefault();
      var lane = e.target.closest && e.target.closest(".row.track");
      if (lane) selTrack = lane.getAttribute("data-t");
      routeFiles([].slice.call(fl));
    });
    // Clip bar
    $("split-btn").addEventListener("click", splitSel);
    $("dupclip-btn").addEventListener("click", dupSel);
    $("delclip-btn").addEventListener("click", delSel);
    $("clip-close").addEventListener("click", function () { selClip = ""; renderRows(); });
    $("gain-in").addEventListener("input", function () { setClip({ gain: parseFloat($("gain-in").value) }, "gain"); });
    $("fi-in").addEventListener("input", function () { setClip({ fi: parseFloat($("fi-in").value) }, "fi"); });
    $("fo-in").addEventListener("input", function () { setClip({ fo: parseFloat($("fo-in").value) }, "fo"); });
    // Dialogs
    $("proj-close").addEventListener("click", function () { hideDlg("proj-dlg"); });
    $("proj-new").addEventListener("click", newProject);
    if (bundleApi()) {
      $("oros-sec").hidden = false;
      $("oros-save").addEventListener("click", saveOros);
      $("oros-open").addEventListener("click", pickOros);
      $("oros-folder").addEventListener("click", openOrosFolder);
    }
    $("name-cancel").addEventListener("click", function () { nameDone = null; hideDlg("name-dlg"); });
    $("name-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = C.clipLine($("name-in").value, C.MAX_NAME), fn = nameDone;
      nameDone = null;
      hideDlg("name-dlg");
      if (fn && v) fn(v);
    });
    $("track-close").addEventListener("click", function () { hideDlg("track-dlg"); });
    $("track-rename").addEventListener("click", function () {
      var tr = C.find(data, "tracks", dlgTrack);
      if (tr) askName(t("name.track"), tr.name, function (v) { setTrack(tr.id, { name: v }); renderTrackDlg(); });
    });
    $("tvol-in").addEventListener("input", function () {
      var v = parseFloat($("tvol-in").value);
      $("tvol-out").textContent = dbTxt(v);
      setTrack(dlgTrack, { vol: v }, burst("vol" + dlgTrack, { live: true }));
    });
    $("tpan-in").addEventListener("input", function () {
      var v = parseInt($("tpan-in").value, 10);
      $("tpan-out").textContent = panTxt(v);
      setTrack(dlgTrack, { pan: v }, burst("pan" + dlgTrack, { live: true }));
    });
    $("track-up").addEventListener("click", function () { moveTrack(dlgTrack, -1); renderTrackDlg(); });
    $("track-down").addEventListener("click", function () { moveTrack(dlgTrack, 1); renderTrackDlg(); });
    $("track-del").addEventListener("click", function () { var id = dlgTrack; hideDlg("track-dlg"); deleteTrack(id); });
    $("track-fx").addEventListener("click", function () { var id = dlgTrack; hideDlg("track-dlg"); FX.open(id); });
    $("master-fx").addEventListener("click", function () { if (ensureProject()) FX.open("master"); });
    $("more-fx").addEventListener("click", function () { hideDlg("more-dlg"); if (ensureProject()) FX.open("master"); });
    $("fx-play").addEventListener("click", function () { togglePlay(); });
    FX.wire();
    wireKeys2();
    $("track-inst").addEventListener("change", function () {
      var tr = C.find(data, "tracks", dlgTrack);
      if (tr) setSound(tr, $("track-inst").value);
      renderTrackDlg();
    });
    $("track-sfz").addEventListener("click", function () { var f = $("sfz-file"); f.value = ""; f.click(); });
    $("sfz-file").addEventListener("change", function () { importSfz($("sfz-file").files, dlgTrack); });
    $("track-smps").addEventListener("click", openSmpList);
    $("smp-close").addEventListener("click", function () { hideDlg("smp-dlg"); });
    $("fs-close").addEventListener("click", function () { fsStop(); hideDlg("fs-dlg"); });
    $("fs-dlg").addEventListener("close", fsStop);
    $("add-free").addEventListener("click", function () { hideDlg("add-dlg"); openFreeSounds(); });
    $("track-br").addEventListener("click", function () { var id = dlgTrack; hideDlg("track-dlg"); openBridge(id); });
    $("br-connect").addEventListener("click", function () { brLib().then(brConnect, function () { brStatus(t("br.lost")); }); });
    $("br-pair-go").addEventListener("click", brSendCode);
    $("br-code").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); brSendCode(); } });
    $("br-scan").addEventListener("click", function () { brLoad(true); });
    $("br-plugin").addEventListener("change", function () { brClose(); });
    $("br-window").addEventListener("click", brWindow);
    $("br-freeze").addEventListener("click", brFreeze);
    $("br-close").addEventListener("click", function () { hideDlg("br-dlg"); });
    $("br-dlg").addEventListener("close", brClose);
    $("track-newclip").addEventListener("click", function () { var id = dlgTrack; hideDlg("track-dlg"); newMidiClip(id, playhead); });
    $("track-midi").addEventListener("click", function () { exportTrackMidi(dlgTrack); });
    $("notes-btn").addEventListener("click", function () { if (selClip) openRoll(selClip); });
    $("add-audio").addEventListener("click", function () { hideDlg("add-dlg"); edit(function () { addTrack(); }); });
    $("add-loops").addEventListener("click", function () { hideDlg("add-dlg"); Roll.toggleLoops(true); });
    $("add-close").addEventListener("click", function () { hideDlg("add-dlg"); });
    Roll.wire();
    $("track-auto").addEventListener("click", function () { var id = dlgTrack; hideDlg("track-dlg"); prefs.auto[id] = true; savePrefs(); renderRows(); });
    $("export-close").addEventListener("click", function () { hideDlg("export-dlg"); });
    $("export-go").addEventListener("click", function () { doExport("file"); });
    $("export-cr-copy").addEventListener("click", copyCredits);
    $("export-cr-save").addEventListener("click", saveCredits);
    $("lic-btn").addEventListener("click", openLic);
    $("lic-cancel").addEventListener("click", function () { hideDlg("lic-dlg"); });
    $("lic-form").addEventListener("submit", function (e) { e.preventDefault(); saveLic(); });
    $("export-music").addEventListener("click", function () { doExport("music"); });
    $("export-lyrics").addEventListener("click", function () { doExport("lyrics"); });
    $("export-ring").addEventListener("click", makeRingtone);
    $("more-close").addEventListener("click", function () { hideDlg("more-dlg"); });
    $("more-dlg").addEventListener("close", ioTestOff);
    $("io-mode").addEventListener("change", function () { prefs.io.on = $("io-mode").value === "br"; savePrefs(); renderIo(); });
    $("io-connect").addEventListener("click", renderIo);
    $("io-refresh").addEventListener("click", function () { ioTestOff(); ioLoad(); });
    $("io-pair-go").addEventListener("click", ioSendCode);
    $("io-code").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ioSendCode(); } });
    $("io-be").addEventListener("change", function () { ioPick("be", $("io-be").value); });
    $("io-in").addEventListener("change", function () { ioPick("inp", $("io-in").value); });
    $("io-out").addEventListener("change", function () { ioPick("out", $("io-out").value); });
    $("io-ch").addEventListener("change", function () { ioPick("ch", $("io-ch").value); });
    $("io-ex").addEventListener("change", function () { ioPick("ex", $("io-ex").value === "1"); });
    $("io-test").addEventListener("click", ioTestToggle);
    $("io-fx").addEventListener("change", ioFxPick);
    $("io-fx-win").addEventListener("click", ioFxWindow);
    $("io-midi").addEventListener("change", function () { prefs.io.fx.midi = $("io-midi").value; savePrefs(); ioTestOff(); });
    $("io-fx-wet").addEventListener("change", function () { prefs.io.fx.wet = $("io-fx-wet").value === "1"; savePrefs(); });
    $("io-fx-gain").addEventListener("input", function () {
      prefs.io.fx.gain = clamp(parseInt($("io-fx-gain").value, 10) || 0, 0, 200);
      $("io-fx-gout").textContent = prefs.io.fx.gain + "%";
      savePrefs();
      if (ioLive && BRG) BRG.liveSet({ gain: prefs.io.fx.gain / 100 }).then(null, function () {});
    });
    $("in-dev").addEventListener("change", function () { prefs.inDev = $("in-dev").value; savePrefs(); });
    $("out-dev").addEventListener("change", function () { prefs.outDev = $("out-dev").value; savePrefs(); applyOutput(); });
    $("dev-refresh").addEventListener("click", askDeviceNames);
    $("lat-in").addEventListener("input", function () { prefs.lat = parseInt($("lat-in").value, 10) || 0; savePrefs(); $("lat-out").textContent = t("ms", { n: prefs.lat }); });
    $("mvol-in").addEventListener("input", function () { prefs.mvol = parseInt($("mvol-in").value, 10) || 0; savePrefs(); $("mvol-out").textContent = prefs.mvol + "%"; });
    // Dialogs close on the backdrop
    [].forEach.call(document.querySelectorAll("dialog"), function (d) {
      d.addEventListener("click", function (e) { if (e.target === d) { if (d.id === "name-dlg") nameDone = null; hideDlg(d.id); } });
      d.addEventListener("close", function () { var box = $("toast"); if (box && box.parentNode === d) document.body.appendChild(box); });
    });
    var rz = null;
    window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(renderLanes, 80); });
    window.addEventListener("pagehide", function () {
      flush();
      if (recording) stopRecording();
      stopNodes();
      kbAllOff();
      if (FX) FX.dropPreview();
      if (Roll) Roll.stopPreview();
      if (vaultUnsub) { try { vaultUnsub(); } catch (e) {} vaultUnsub = null; }
    });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
    wireKeyboard();
  }

  // what fx.js needs from here
  function makeFx() {
    FX = window.StudioFX({
      C: C, t: t, el: el, setLabel: setLabel, numTxt: numTxt, version: VER,
      data: function () { return data; }, proj: function () { return proj; },
      audio: function () { return actx; }, isPlaying: function () { return !!playing; },
      previewOut: function (a) { return synthBus(a); },
      fsApi: fsApi, decode: decode, showToast: showToast, burst: burst,
      undoToast: function (text) { undoToast(text, function () { undo(); }); },
      showDlg: showDlg, hideDlg: hideDlg,
      pickFiles: function (accept) {
        var dlg = dialogHost();
        return Promise.resolve(dlg && typeof dlg.openFiles === "function" ? dlg.openFiles(accept) : localPickFiles(accept));
      },
      setFx: function (key, items, opts) {
        if (key === "master") setProject({ fx: items }, opts);
        else setTrack(key, { fx: items }, opts);
      }
    });
  }

  // what remote.js needs from here: the console, nothing else
  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = mail.js
  var peakBuf = null;
  function peakOf(an) {
    if (!an) return 0;
    if (!peakBuf || peakBuf.length !== an.fftSize) peakBuf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(peakBuf);
    var pk = 0;
    for (var i = 0; i < peakBuf.length; i++) { var v = Math.abs(peakBuf[i]); if (v > pk) pk = v; }
    return pk;
  }
  function fxList(items) {
    return (items || []).map(function (x) { return { u: x.u, id: x.id, on: x.on, name: FX.nameOf(x.id) }; });
  }
  function makeRemote() {
    Remote = window.StudioRemote({
      C: C, t: t, el: el, setLabel: setLabel, ICON: ICON, relay: RELAY,
      showToast: showToast, showDlg: showDlg, hideDlg: hideDlg, dbTxt: dbTxt, panTxt: panTxt,
      wakeAudio: function () { if (audio()) resume(); },
      fx: FX, data: function () { return data; }, numTxt: numTxt,
      srate: function () { return actx ? actx.sampleRate : 48000; },
      isPlaying: function () { return !!playing; },
      snapshot: function () {
        if (!proj) return null;
        return {
          name: proj.name || t("proj.untitled"), bpm: proj.bpm, sig: proj.sig, vol: proj.vol, loop: !!proj.loop.on,
          metro: !!prefs.metro, playing: !!playing, rec: recording, pos: playing ? position() : playhead, len: songLen(),
          mfx: fxList(proj.fx),
          tracks: tracks().map(function (tr) {
            return { id: tr.id, name: tr.name, color: tr.color, vol: tr.vol, pan: tr.pan, mute: !!tr.mute, solo: !!tr.solo,
                     arm: prefs.arm === tr.id, fx: fxList(tr.fx) };
          })
        };
      },
      meters: function () {
        return {
          pos: playing ? position() : playhead,
          tracks: tracks().map(function (tr) { var n = trackNodes[tr.id]; return playing && n ? peakOf(n.meter) : 0; }),
          master: playing ? peakOf(analyser) : 0
        };
      },
      togglePlay: togglePlay, stop: stopBtn, record: startRecording, toggleLoop: toggleLoop, toggleMetro: toggleMetro,
      seek: function (sec) { seek(sec); Remote.changed(); },
      setBpm: function (v) { setProject({ bpm: v }); },
      setMaster: function (v) { setProject({ vol: v }, burst("master", { live: true })); },
      setTrack: function (id, f) { setTrack(id, f, burst("r" + Object.keys(f).join("") + id, { live: true })); },
      arm: armTrack,
      toggleFx: function (key, u, on) {
        var tr = key === "master" ? null : C.find(data, "tracks", key);
        var items = key === "master" ? (proj ? proj.fx : []) : (tr ? tr.fx : []);
        if (!items.some(function (x) { return x.u === u && x.on !== on; })) return;
        items = items.map(function (x) { return x.u === u ? Object.assign({}, x, { on: on }) : x; });
        if (key === "master") setProject({ fx: items }); else setTrack(key, { fx: items });
        FX.render();
      }
    });
  }

  function boot() {
    load();
    loadPrefs();
    makeFx();
    makeRoll();
    makeRemote();
    applyI18n();
    wire();
    Remote.wire();
    registerSync();
    inheritPalette();
    watchPalette();
    watchVault();
    var start = (prefs.cur && C.find(data, "projects", prefs.cur)) || C.newestFirst(data.projects)[0] || null;
    openProject(start);
    drawMeter();
    // a file from the system's "Open with" that arrived before Studio did
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("studio");
        if (pending) openTarget(pending);
      }
    } catch (e) {}
    // the catalog also names the NULL instruments the tracks play
    FX.loadCatalog().then(function () { if (proj) { renderRows(); syncKb(); renderTrackDlgIfOpen(); } keepFxOffline(); }, function () {});
    // the instrument packs (oros-sounds): their names and the sound lists
    SND.catalog().then(function (l) { if (l.length && proj) { renderRows(); syncKb(); renderTrackDlgIfOpen(); } });
    SND.useDisk(fsApi);
    SND.scan().then(function (l) { if (l.length && proj) { renderRows(); syncKb(); renderTrackDlgIfOpen(); } });
  }
  // every effect the projects use, kept for offline use (fx.js keepOffline)
  function keepFxOffline() {
    if (!FX) return;
    var ids = {};
    data.projects.concat(data.tracks).forEach(function (x) { (x.fx || []).forEach(function (f) { if (f && f.id) ids[f.id] = true; }); });
    FX.keepOffline(Object.keys(ids));
  }

  boot();
})();
