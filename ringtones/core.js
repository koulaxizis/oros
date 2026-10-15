// ============================================================
// orOS Ringtone Composer — core (v1.0.0)
// Pure logic, no DOM: notes and their names, pitch and length, the
// RTTTL text of old phones (read and write), the sound of a melody
// as samples and as a WAV file, the ready tunes, and the melodies
// merge. Loaded by ringtones.js (window.RingtonesCore) and the tests.
//
// A note is { n, o, d, dot }: n the semitone 0..11 from C (-1 a
// rest), o the octave 4..7 (A4 = 440 Hz), d the length 1, 2, 4, 8,
// 16 or 32 (a whole note, a half, …), dot a dotted length (x1.5).
// Melodies are kept as text, one token per note, as in RTTTL with the
// length and octave always written: "8c#6.", "4p".
//
// Melodies (sync slice "ringtones"):
//   { ver: 1, melodies: [{ id, m, name, bpm, voice, notes }],
//     tombs: { id: deletedAt } }
//
// The .orostone file (an orOS bundle, bundle.js, docs/oros-bundle.md):
//   content.json { kind: "oros-ringtones-package", ver: 1,
//                  melody: { id, m, name, bpm, voice, notes } }
//   preview/tone.rtttl, and preview/tone.wav when the melody is short
// toneBundle() builds the options for OrosBundle.write; toneFromBundle()
// reads content.json back as a NEW melody (fresh id, through
// normMelody), or null.
// ============================================================
(function (root) {
  "use strict";

  var MAX_NOTES    = 255;
  var MAX_MELODIES = 200;
  var MAX_NAME     = 40;
  var MIN_BPM      = 40;
  var MAX_BPM      = 300;
  var DATA_VER     = 1;
  var ID_RE        = /^r[a-z0-9]{6,20}$/;
  var LENGTHS      = [1, 2, 4, 8, 16, 32];
  var OCTAVES      = [4, 5, 6, 7];
  var VOICES       = ["square", "soft", "bell"];
  var DEFAULT      = { bpm: 120, voice: "square" };

  var LETTERS  = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
  var SOLFEGE  = ["ντο", "ντο#", "ρε", "ρε#", "μι", "φα", "φα#", "σολ", "σολ#", "λα", "λα#", "σι"];
  var NATURALS = [0, 2, 4, 5, 7, 9, 11];        // keys 1..7: c d e f g a b

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function clipLine(s, n) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
  }

  // ---------- Notes ----------
  function mkNote(n, o, d, dot) {
    return {
      n: isInt(n) && n >= -1 && n <= 11 ? n : -1,
      o: OCTAVES.indexOf(o) >= 0 ? o : 5,
      d: LENGTHS.indexOf(d) >= 0 ? d : 4,
      dot: !!dot
    };
  }
  function isRest(note) { return note.n < 0; }

  // Pitch in Hz (equal temperament, A4 = 440).
  function freq(note) {
    if (isRest(note)) return 0;
    return 440 * Math.pow(2, (note.n - 9) / 12 + (note.o - 4));
  }
  // Length in ms: bpm counts quarter notes, as in RTTTL.
  function durMs(note, bpm) {
    var ms = (60000 / clamp(bpm || DEFAULT.bpm, MIN_BPM, MAX_BPM)) * 4 / note.d;
    return note.dot ? ms * 1.5 : ms;
  }
  function totalMs(notes, bpm) {
    return notes.reduce(function (s, x) { return s + durMs(x, bpm); }, 0);
  }

  // Name for the screen: "C#6" or "ντο#6"; a rest is "–".
  function noteName(note, solfege) {
    if (isRest(note)) return "–";
    var nm = (solfege ? SOLFEGE : LETTERS)[note.n];
    return (solfege ? nm : nm.toUpperCase()) + note.o;
  }

  // ---------- Tokens ("8c#6.", "4p") ----------
  function token(note) {
    return note.d + (isRest(note) ? "p" : LETTERS[note.n] + note.o) + (note.dot ? "." : "");
  }
  // One RTTTL note with defaults d and o. Lenient: any case, spaces,
  // "_" for a sharp, the dot before or after the octave, and "h" for
  // the German B. Returns null when the token cannot be a note.
  var TOK_RE = /^(\d{0,2})([a-hp])([#_]?)(\.?)(\d?)(\.?)$/;
  function parseToken(tok, defD, defO) {
    var m = TOK_RE.exec(String(tok).toLowerCase().replace(/\s+/g, ""));
    if (!m) return null;
    var d = m[1] ? parseInt(m[1], 10) : defD;
    if (LENGTHS.indexOf(d) < 0) return null;
    var dot = !!(m[4] || m[6]);
    if (m[2] === "p") return mkNote(-1, 5, d, dot);
    var letter = m[2] === "h" ? "b" : m[2];
    var n = LETTERS.indexOf(letter + (m[3] ? "#" : ""));
    if (n < 0) {                                   // e# and b# (not on the keys): the next natural
      n = LETTERS.indexOf(letter) + 1;
    }
    var o = m[5] ? parseInt(m[5], 10) : defO;
    if (n > 11) { n = 0; o++; }
    o = clamp(o, 4, 7);
    return mkNote(n, o, d, dot);
  }
  function parseNotes(str) {
    if (typeof str !== "string" || !str) return [];
    var out = [];
    str.split(",").forEach(function (tk) {
      if (out.length >= MAX_NOTES) return;
      var nt = parseToken(tk, 4, 5);
      if (nt) out.push(nt);
    });
    return out;
  }
  function notesText(notes) { return notes.map(token).join(","); }

  // ---------- RTTTL ----------
  // "name:d=4,o=5,b=125:8e6,p,…" → { name, bpm, notes } or null.
  function parseRTTTL(text) {
    if (typeof text !== "string") return null;
    var s = text.replace(/\r?\n/g, "").trim();
    var parts = s.split(":");
    if (parts.length < 3) return null;
    var name = clipLine(parts[0], MAX_NAME);
    var defs = parts[1], body = parts.slice(2).join(":");
    var d = 4, o = 6, b = 63;                      // the defaults of the RTTTL spec
    defs.split(",").forEach(function (kv) {
      var m = /^\s*([dob])\s*=\s*(\d+)\s*$/i.exec(kv);
      if (!m) return;
      var v = parseInt(m[2], 10), k = m[1].toLowerCase();
      if (k === "d" && LENGTHS.indexOf(v) >= 0) d = v;
      if (k === "o" && v >= 4 && v <= 7) o = v;
      if (k === "b" && v > 0) b = v;
    });
    var notes = [], bad = 0;
    body.split(",").forEach(function (tk) {
      if (!tk.trim()) return;
      var nt = parseToken(tk, d, o);
      if (!nt) { bad++; return; }
      if (notes.length < MAX_NOTES) notes.push(nt);
    });
    if (!notes.length) return null;
    return { name: name, bpm: clamp(b, MIN_BPM, MAX_BPM), notes: notes, skipped: bad };
  }

  // RTTTL with the most common length and octave as defaults, so the
  // text is as short as the phones made it.
  function toRTTTL(name, bpm, notes) {
    function most(list) {
      var c = {}, best = null;
      list.forEach(function (v) { c[v] = (c[v] || 0) + 1; if (best === null || c[v] > c[best] || (c[v] === c[best] && v < best)) best = v; });
      return best;
    }
    var d = most(notes.map(function (x) { return x.d; })) || 4;
    var o = most(notes.filter(function (x) { return !isRest(x); }).map(function (x) { return x.o; })) || 5;
    var title = clipLine(name, MAX_NAME).replace(/[:,]/g, " ").replace(/\s+/g, " ").trim() || "orOS";
    var body = notes.map(function (x) {
      return (x.d === d ? "" : x.d) + (isRest(x) ? "p" : LETTERS[x.n] + (x.o === o ? "" : x.o)) + (x.dot ? "." : "");
    }).join(",");
    return title + ":d=" + d + ",o=" + o + ",b=" + clamp(Math.round(bpm), MIN_BPM, MAX_BPM) + ":" + body;
  }

  // ---------- Editing (the keys of an old phone) ----------
  // Key 1..7 → that natural note; with a length and octave.
  function keyNote(key, d, o) { return mkNote(NATURALS[key - 1], o, d, false); }
  // Sharp on or off (# key). E and B have none: the key does nothing.
  function toggleSharp(note) {
    if (isRest(note)) return note;
    var nat = NATURALS.indexOf(note.n) >= 0;
    if (nat) {
      if (note.n === 4 || note.n === 11) return note;
      return mkNote(note.n + 1, note.o, note.d, note.dot);
    }
    return mkNote(note.n - 1, note.o, note.d, note.dot);
  }
  // Octave round (* key): 4 → 5 → 6 → 7 → 4.
  function cycleOctave(note) {
    if (isRest(note)) return note;
    return mkNote(note.n, note.o >= 7 ? 4 : note.o + 1, note.d, note.dot);
  }
  // Longer (9) or shorter (8): one step along the lengths.
  function stepLength(note, longer) {
    var i = LENGTHS.indexOf(note.d) + (longer ? -1 : 1);
    return mkNote(note.n, note.o, LENGTHS[clamp(i, 0, LENGTHS.length - 1)], note.dot);
  }
  function toggleDot(note) { return mkNote(note.n, note.o, note.d, !note.dot); }
  // Same note, one semitone up or down (staying in 4..7).
  function transpose(note, st) {
    if (isRest(note)) return note;
    var abs = clamp(note.o * 12 + note.n + st, 48, 95);
    return mkNote(abs % 12, Math.floor(abs / 12), note.d, note.dot);
  }

  // ---------- Sound ----------
  // The melody as mono samples in -1..1. Each note sounds for 90% of
  // its length (the phones played a little detached), with a short
  // attack and release so nothing clicks.
  function renderSamples(notes, bpm, voice, rate) {
    rate = rate || 22050;
    var total = Math.ceil(totalMs(notes, bpm) / 1000 * rate) + Math.round(rate * 0.05);
    var out = new Float32Array(total), pos = 0;
    notes.forEach(function (nt) {
      var len = Math.round(durMs(nt, bpm) / 1000 * rate);
      var f = freq(nt);
      if (f > 0) {
        var on = Math.round(len * 0.9), att = Math.min(Math.round(rate * 0.004), on >> 2);
        var rel = Math.min(Math.round(rate * 0.012), on >> 2);
        for (var i = 0; i < on && pos + i < total; i++) {
          var ph = (i * f / rate) % 1, v;
          if (voice === "soft") v = Math.sin(2 * Math.PI * ph) * 0.8;
          else if (voice === "bell") {
            v = (Math.sin(2 * Math.PI * ph) * 0.7 + Math.sin(4 * Math.PI * ph) * 0.2 + Math.sin(6 * Math.PI * ph) * 0.1) *
                Math.exp(-3 * i / rate);
          } else v = ph < 0.5 ? 0.42 : -0.42;     // square: the phone beep
          var env = 1;
          if (i < att) env = i / att;
          else if (i > on - rel) env = Math.max(0, (on - i) / rel);
          out[pos + i] = v * env;
        }
      }
      pos += len;
    });
    return out;
  }

  // 16-bit mono PCM WAV.
  function wavBytes(samples, rate) {
    var n = samples.length, buf = new Uint8Array(44 + n * 2), dv = new DataView(buf.buffer);
    function str(off, s) { for (var i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i); }
    str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
    str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, "data"); dv.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(clamp(samples[i], -1, 1) * 32767), true);
    return buf;
  }

  // ---------- Ready tunes (public domain, written out here) ----------
  var PRESETS = [
    { key: "granvals", en: "Gran Vals (Tárrega)", el: "Gran Vals (Τάρεγκα)", bpm: 180,
      notes: "8e6,8d6,4f#5,4g#5,8c#6,8b5,4d5,4e5,8b5,8a5,4c#5,4e5,2a5" },
    { key: "elise", en: "Für Elise (Beethoven)", el: "Για την Ελίζα (Μπετόβεν)", bpm: 125,
      notes: "8e6,8d#6,8e6,8d#6,8e6,8b5,8d6,8c6,4a5.,8c5,8e5,8a5,4b5.,8e5,8g#5,8b5,4c6.,8e5,8e6,8d#6,8e6,8d#6,8e6,8b5,8d6,8c6,4a5.,8c5,8e5,8a5,4b5.,8e5,8c6,8b5,2a5" },
    { key: "joy", en: "Ode to Joy (Beethoven)", el: "Ωδή στη Χαρά (Μπετόβεν)", bpm: 120,
      notes: "4e5,4e5,4f5,4g5,4g5,4f5,4e5,4d5,4c5,4c5,4d5,4e5,4e5.,8d5,2d5,4e5,4e5,4f5,4g5,4g5,4f5,4e5,4d5,4c5,4c5,4d5,4e5,4d5.,8c5,2c5" },
    { key: "mountain", en: "In the Hall of the Mountain King (Grieg)", el: "Στη σπηλιά του βασιλιά του βουνού (Γκριγκ)", bpm: 140,
      notes: "8b4,8c#5,8d5,8e5,8f#5,8d5,4f#5,8f5,8c#5,4f5,8e5,8c5,4e5,8b4,8c#5,8d5,8e5,8f#5,8d5,8f#5,8b5,8a5,8f#5,8d5,8f#5,2a5" },
    { key: "jingle", en: "Jingle Bells", el: "Jingle Bells", bpm: 180,
      notes: "4e5,4e5,2e5,4e5,4e5,2e5,4e5,4g5,4c5.,8d5,1e5,4f5,4f5,4f5.,8f5,4f5,4e5,4e5,8e5,8e5,4g5,4g5,4f5,4d5,1c5" },
    { key: "twinkle", en: "Twinkle, Twinkle, Little Star", el: "Λάμπει, λάμπει τ' αστεράκι", bpm: 120,
      notes: "4c5,4c5,4g5,4g5,4a5,4a5,2g5,4f5,4f5,4e5,4e5,4d5,4d5,2c5,4g5,4g5,4f5,4f5,4e5,4e5,2d5,4g5,4g5,4f5,4f5,4e5,4e5,2d5,4c5,4c5,4g5,4g5,4a5,4a5,2g5,4f5,4f5,4e5,4e5,4d5,4d5,2c5" },
    { key: "jacques", en: "Frère Jacques", el: "Frère Jacques", bpm: 120,
      notes: "4c5,4d5,4e5,4c5,4c5,4d5,4e5,4c5,4e5,4f5,2g5,4e5,4f5,2g5,8g5,8a5,8g5,8f5,4e5,4c5,8g5,8a5,8g5,8f5,4e5,4c5,4c5,4g4,2c5,4c5,4g4,2c5" }
  ];

  // ---------- Melodies: normalise + merge ----------
  function normMelody(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    var notes = parseNotes(x.notes);
    if (!notes.length) return null;
    return {
      id: x.id, m: x.m,
      name: clipLine(x.name, MAX_NAME),
      bpm: isInt(x.bpm) ? clamp(x.bpm, MIN_BPM, MAX_BPM) : DEFAULT.bpm,
      voice: VOICES.indexOf(x.voice) >= 0 ? x.voice : DEFAULT.voice,
      notes: notesText(notes)
    };
  }

  // LWW per melody (newer m wins; equal m: the larger canonical JSON),
  // tombstones max-merged, delete wins ties, a newer edit resurrects (R17).
  function mergeRingtones(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var best = {};
    [a.melodies, b.melodies].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normMelody(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m ||
            (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    var melodies = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      melodies.push(best[id]);
    });
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    return { ver: DATA_VER, melodies: melodies, tombs: sortedTombs };
  }

  function findMelody(dat, id) {
    for (var i = 0; i < dat.melodies.length; i++) if (dat.melodies[i].id === id) return dat.melodies[i];
    return null;
  }
  function newestFirst(list) {
    return list.slice().sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); });
  }
  function newId(r) {
    var s = "r";
    for (var i = 0; i < 12; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(r() * 36));
    return s;
  }
  function fileName(name, ext) {
    var base = clipLine(name, 40).replace(/[\\/:*?"<>|.]+/g, "").replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
    return (base || "ringtone") + "." + ext;
  }

  // ---------- The .orostone file ----------
  var TONE_MIME = "application/x-oros-tone";
  var TONE_KIND = "oros-ringtones-package";
  var WAV_PREVIEW_MS = 60000;      // a longer melody gets no WAV preview (size)
  // x: a melody as the slice holds it. o: { title, lang, rate, gain, date }.
  function toneBundle(x, o) {
    o = o || {};
    var mel = normMelody(x);
    if (!mel) return null;
    var notes = parseNotes(mel.notes), title = mel.name || o.title || "";
    var preview = [{ name: "tone.rtttl", data: toRTTTL(title, mel.bpm, notes) + "\r\n", type: "audio/x-rtttl" }];
    var rate = o.rate || 22050;
    if (totalMs(notes, mel.bpm) <= WAV_PREVIEW_MS) {
      var smp = renderSamples(notes, mel.bpm, mel.voice, rate), g = typeof o.gain === "number" ? o.gain : 1;
      if (g !== 1) for (var i = 0; i < smp.length; i++) smp[i] *= g;
      preview.push({ name: "tone.wav", data: wavBytes(smp, rate), type: "audio/wav" });
    }
    return {
      mime: TONE_MIME, app: "ringtones", schema: "ringtones/1",
      content: { kind: TONE_KIND, ver: 1, melody: mel },
      meta: { title: title, created: mel.m, modified: mel.m, id: mel.id,
        language: o.lang === "el" ? "el" : "en", generator: "orOS Ringtones" },
      preview: preview, date: o.date
    };
  }
  // content.json → a new melody { id, m, name, bpm, voice, notes } or null.
  function toneFromBundle(content, rnd, now) {
    if (!content || typeof content !== "object" || content.kind !== TONE_KIND) return null;
    var src = content.melody;
    if (!src || typeof src !== "object") return null;
    var x = normMelody({ id: newId(rnd || Math.random), m: isInt(now) ? now : Date.now(),
      name: src.name, bpm: src.bpm, voice: src.voice, notes: src.notes });
    return x;
  }

  var api = {
    TONE_MIME: TONE_MIME, toneBundle: toneBundle, toneFromBundle: toneFromBundle,
    MAX_NOTES: MAX_NOTES, MAX_MELODIES: MAX_MELODIES, MAX_NAME: MAX_NAME, MIN_BPM: MIN_BPM, MAX_BPM: MAX_BPM,
    ID_RE: ID_RE, LENGTHS: LENGTHS, OCTAVES: OCTAVES, VOICES: VOICES, DEFAULT: DEFAULT,
    LETTERS: LETTERS, SOLFEGE: SOLFEGE, NATURALS: NATURALS, PRESETS: PRESETS,
    mkNote: mkNote, isRest: isRest, freq: freq, durMs: durMs, totalMs: totalMs, noteName: noteName,
    token: token, parseToken: parseToken, parseNotes: parseNotes, notesText: notesText,
    parseRTTTL: parseRTTTL, toRTTTL: toRTTTL,
    keyNote: keyNote, toggleSharp: toggleSharp, cycleOctave: cycleOctave, stepLength: stepLength,
    toggleDot: toggleDot, transpose: transpose,
    renderSamples: renderSamples, wavBytes: wavBytes,
    normMelody: normMelody, mergeRingtones: mergeRingtones, findMelody: findMelody,
    newestFirst: newestFirst, newId: newId, fileName: fileName
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RingtonesCore = api;
})(typeof window !== "undefined" ? window : this);
