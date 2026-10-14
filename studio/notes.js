// ============================================================
// orOS Studio — notes (v1.0.0)
// Pure logic for MIDI clips, no DOM, no Web Audio. Loaded before
// studio.js (window.StudioNotes) and by tests/studio-midi.test.js.
//   - grid and quantize: grid steps in beats, snapping in project time
//   - edits on a list of notes with a selection: move, resize,
//     velocity, delete, copy and paste, select in a rectangle; every
//     edit returns the notes in the clip's own order (StudioCore.cmpNote)
//     and the new indices of the selected notes
//   - Standard MIDI Files: read type 0 and 1 (running status, tempo,
//     time signature, track names, program changes; SMPTE time as
//     120 BPM), write type 0 (one track) or 1 (a tempo track and one
//     track per part); notes in beats both ways
//   - General MIDI programs <-> Studio's instruments
// A note is [pitch, start, len, vel]; start and len in seconds from the
// clip's content start, as in core.js.
// ============================================================
(function (root) {
  "use strict";

  var MIN_NOTE = 0.005;
  var MAX_NOTES = 2000;
  // Grid steps, in beats (a beat is a quarter note); "off" = free.
  var GRIDS = { "1/4": 1, "1/8": 0.5, "1/16": 0.25, "1/32": 0.125, "1/8t": 1 / 3, "1/16t": 1 / 6, "off": 0 };
  var GRID_ORDER = ["1/4", "1/8", "1/16", "1/32", "1/8t", "1/16t", "off"];

  function isNum(n) { return typeof n === "number" && isFinite(n); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function round(n, d) { var f = Math.pow(10, d); return Math.round(n * f) / f; }
  function cmpNote(a, b) { return a[1] - b[1] || a[0] - b[0] || a[2] - b[2] || a[3] - b[3]; }

  // ---------- Grid ----------
  // seconds of one grid step at `bpm` (0 = free)
  function gridSec(bpm, grid) { var b = GRIDS[grid]; return b ? b * 60 / bpm : 0; }
  // Snap clip time `x` to the grid. `origin` = project time of the clip's
  // content start (clip.at - clip.off): the grid is the project's.
  function snapT(x, origin, step) {
    if (!(step > 0)) return x;
    return Math.round((origin + x) / step) * step - origin;
  }
  function floorT(x, origin, step) {
    if (!(step > 0)) return x;
    return Math.floor((origin + x) / step + 1e-6) * step - origin;
  }

  // ---------- Edits with a selection ----------
  // Run fn over { q: note copy, s: selected } items, then sort back.
  // Returns { notes, sel } (sel: indices of the selected notes).
  function apply(notes, sel, fn) {
    var on = {};
    (sel || []).forEach(function (i) { on[i] = true; });
    var items = notes.map(function (q, i) { return { q: q.slice(), s: !!on[i] }; });
    items = (fn && fn(items)) || items;
    items.forEach(function (x) {
      var q = x.q;
      q[0] = Math.round(clamp(q[0], 0, 127));
      q[1] = round(Math.max(0, q[1]), 4);
      q[2] = round(Math.max(MIN_NOTE, q[2]), 4);
      q[3] = Math.round(clamp(q[3], 1, 127));
    });
    items.sort(function (a, b) { return cmpNote(a.q, b.q) || (a.s === b.s ? 0 : a.s ? 1 : -1); });
    var out = { notes: [], sel: [] };
    items.forEach(function (x, i) { out.notes.push(x.q); if (x.s) out.sel.push(i); });
    return out;
  }
  // Move the selected notes by dt seconds and dp semitones; the group
  // keeps its shape, so the move stops at the lowest start `min`, and at
  // pitch 0 and 127.
  function moveNotes(notes, sel, dt, dp, min) {
    min = min || 0;
    var lo = Infinity, pLo = 127, pHi = 0;
    sel.forEach(function (i) { var q = notes[i]; if (!q) return; lo = Math.min(lo, q[1]); pLo = Math.min(pLo, q[0]); pHi = Math.max(pHi, q[0]); });
    if (lo === Infinity) return { notes: notes.slice(), sel: [] };
    dt = Math.max(dt, min - lo);
    dp = clamp(Math.round(dp), -pLo, 127 - pHi);
    return apply(notes, sel, function (items) { items.forEach(function (x) { if (x.s) { x.q[1] += dt; x.q[0] += dp; } }); });
  }
  // Lengthen or shorten the selected notes by dl seconds (at least `minLen`).
  function resizeNotes(notes, sel, dl, minLen) {
    minLen = Math.max(MIN_NOTE, minLen || 0);
    return apply(notes, sel, function (items) { items.forEach(function (x) { if (x.s) x.q[2] = Math.max(minLen, x.q[2] + dl); }); });
  }
  // Set the velocity of the selected notes.
  function setVel(notes, sel, v) {
    return apply(notes, sel, function (items) { items.forEach(function (x) { if (x.s) x.q[3] = v; }); });
  }
  function deleteNotes(notes, sel) {
    return apply(notes, sel, function (items) { return items.filter(function (x) { return !x.s; }); });
  }
  // Add one note; it is the new selection.
  function addNote(notes, q) {
    if (notes.length >= MAX_NOTES) return null;
    var r = apply(notes.concat([q.slice()]), [notes.length], null);
    return r;
  }
  // Quantize the starts of the selected notes (all when none are) to the
  // grid; `strength` 0..1 moves them part of the way. A note that would
  // end up shorter than a tenth of a step keeps its end.
  function quantize(notes, sel, origin, step, strength) {
    if (!(step > 0)) return { notes: notes.slice(), sel: sel.slice() };
    strength = strength == null ? 1 : clamp(strength, 0, 1);
    var all = !sel.length;
    var r = apply(notes, all ? notes.map(function (q, i) { return i; }) : sel, function (items) {
      items.forEach(function (x) {
        if (!x.s) return;
        var s = x.q[1], t = Math.max(0, snapT(s, origin, step));
        x.q[1] = s + (t - s) * strength;
      });
    });
    if (all) r.sel = [];
    return r;
  }
  // Indices of the notes inside a rectangle of time (t0..t1) and pitch (p0..p1).
  function inRect(notes, t0, t1, p0, p1) {
    var a = Math.min(t0, t1), b = Math.max(t0, t1), lo = Math.min(p0, p1), hi = Math.max(p0, p1), out = [];
    notes.forEach(function (q, i) { if (q[0] >= lo && q[0] <= hi && q[1] < b && q[1] + q[2] > a) out.push(i); });
    return out;
  }
  // Copy: the selected notes with starts from 0, and how long they span.
  function copyNotes(notes, sel) {
    var list = sel.map(function (i) { return notes[i]; }).filter(Boolean), lo = Infinity, hi = 0;
    list.forEach(function (q) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1] + q[2]); });
    if (!list.length) return null;
    return { notes: list.map(function (q) { return [q[0], round(q[1] - lo, 4), q[2], q[3]]; }), from: lo, span: hi - lo };
  }
  // Paste a copy at clip time `at`; the pasted notes are the new selection.
  function pasteNotes(notes, clip, at) {
    if (!clip || !clip.notes.length) return null;
    var room = MAX_NOTES - notes.length;
    if (room < clip.notes.length) return null;
    var add = clip.notes.map(function (q) { return [q[0], q[1] + at, q[2], q[3]]; });
    var sel = add.map(function (q, i) { return notes.length + i; });
    return apply(notes.concat(add), sel, null);
  }
  // How long a clip must be to hold every note (seconds from the content start).
  function notesEnd(notes) {
    var e = 0;
    notes.forEach(function (q) { e = Math.max(e, q[1] + q[2]); });
    return e;
  }

  // ---------- Beats <-> seconds ----------
  function toSec(beatNotes, bpm) {
    var k = 60 / bpm;
    return beatNotes.map(function (q) { return [q[0], round(q[1] * k, 4), round(Math.max(MIN_NOTE, q[2] * k), 4), q[3]]; }).sort(cmpNote);
  }
  function toBeats(secNotes, bpm) {
    var k = bpm / 60;
    return secNotes.map(function (q) { return [q[0], q[1] * k, q[2] * k, q[3]]; });
  }

  // ---------- General MIDI ----------
  // An instrument for a program (0..127) on a channel (9 = drums).
  function instFor(prog, ch) {
    if (ch === 9) return "drums";
    if (!isNum(prog)) return "piano";
    if (prog >= 4 && prog <= 7) return "epiano";
    if (prog >= 16 && prog <= 23) return "organ";
    if (prog >= 32 && prog <= 39) return "bass";
    if (prog >= 40 && prog <= 55) return "strings";
    if (prog >= 80 && prog <= 87) return "lead";
    return "piano";
  }
  var PROGRAM = { piano: 0, epiano: 4, organ: 16, bass: 33, strings: 48, lead: 81 };
  function programFor(inst) { return PROGRAM[inst] != null ? PROGRAM[inst] : 0; }

  // ---------- Standard MIDI Files: read ----------
  function smfError(why) { var e = new Error("smf"); e.why = why; return e; }
  // bytes: Uint8Array. Returns { format, ppq, bpm, sig, name,
  //   tracks: [{ name, ch, prog, notes: [[pitch, startBeats, lenBeats, vel]] }] }
  // (only tracks with notes; a type 0 file is split by channel).
  function readSmf(bytes) {
    if (!bytes || bytes.length < 14 || bytes.length > 8 * 1024 * 1024) throw smfError("size");
    var pos = 0;
    function u8() { if (pos >= bytes.length) throw smfError("eof"); return bytes[pos++]; }
    function u16() { return (u8() << 8) | u8(); }
    function u32() { return ((u8() << 24) >>> 0) + (u8() << 16) + (u8() << 8) + u8(); }
    function tag() { return String.fromCharCode(u8(), u8(), u8(), u8()); }
    function vlq() { var v = 0, b, n = 0; do { b = u8(); v = v * 128 + (b & 0x7f); if (++n > 4) throw smfError("vlq"); } while (b & 0x80); return v; }
    // find MThd (RIFF-wrapped .rmi files carry it inside)
    var start = -1;
    for (var k = 0; k + 4 <= Math.min(bytes.length, 64); k++) {
      if (bytes[k] === 0x4d && bytes[k + 1] === 0x54 && bytes[k + 2] === 0x68 && bytes[k + 3] === 0x64) { start = k; break; }
    }
    if (start < 0) throw smfError("head");
    pos = start + 4;
    var hlen = u32();
    if (hlen < 6) throw smfError("head");
    var format = u16(), ntr = u16(), div = u16();
    pos = start + 8 + hlen;
    if (format > 2) throw smfError("format");
    var ppq, smpte = false;
    if (div & 0x8000) {                                   // SMPTE: frames per second x ticks per frame, read as 120 BPM
      var fps = 256 - (div >> 8), tpf = div & 0xff;
      ppq = Math.max(1, fps * tpf / 2); smpte = true;
    } else ppq = div || 96;
    var tempos = [], sig = null, name = "", raw = [];
    for (var t = 0; t < ntr && t < 256 && pos + 8 <= bytes.length; t++) {
      var id = tag(), len = u32(), end = Math.min(bytes.length, pos + len);
      if (id !== "MTrk") { pos = end; t--; if (pos >= bytes.length) break; continue; }
      var tick = 0, status = 0, tr = { name: "", ev: [], prog: {} }, count = 0;
      while (pos < end) {
        if (++count > 400000) throw smfError("size");
        tick += vlq();
        var b = bytes[pos];
        if (b & 0x80) { status = b; pos++; }
        else if (!status) throw smfError("status");
        var hi = status & 0xf0, ch = status & 0x0f;
        if (status === 0xff) {
          var type = u8(), ml = vlq(), at = pos;
          pos = at + ml;
          if (pos > end) throw smfError("eof");
          if (type === 0x51 && ml === 3 && !smpte) tempos.push([tick, (bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2]]);
          else if (type === 0x58 && ml >= 2 && !sig) sig = [bytes[at], Math.pow(2, bytes[at + 1])];
          else if ((type === 0x03 || type === 0x04) && !tr.name) tr.name = text(bytes, at, ml);
          else if (type === 0x2f) { pos = end; break; }
          status = 0;                                     // meta and sysex cancel running status
        } else if (status === 0xf0 || status === 0xf7) {
          var sl = vlq();                                 // read first: `pos += vlq()` would add to the old pos
          pos += sl; status = 0;
        } else if (hi === 0x80 || hi === 0x90 || hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
          var d1 = u8() & 0x7f, d2 = u8() & 0x7f;
          if (hi === 0x90 && d2 > 0) tr.ev.push([tick, 1, ch, d1, d2]);
          else if (hi === 0x80 || hi === 0x90) tr.ev.push([tick, 0, ch, d1, 0]);
        } else if (hi === 0xc0 || hi === 0xd0) {
          var d = u8() & 0x7f;
          if (hi === 0xc0 && tr.prog[ch] == null) tr.prog[ch] = d;
        } else throw smfError("event");
      }
      tr.end = tick;
      pos = end;
      if (!name && tr.name) name = tr.name;
      raw.push(tr);
    }
    if (!raw.length) throw smfError("tracks");
    var bpm = tempos.length ? round(60000000 / Math.max(1, tempos.sort(function (a, b) { return a[0] - b[0]; })[0][1]), 2) : 120;
    // pair note-ons with note-offs (first in, first out) per channel and pitch
    var parts = [];
    raw.forEach(function (tr) {
      var byCh = {}, open = {};
      tr.ev.forEach(function (e, i) { e.push(i); });
      tr.ev.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1] || a[5] - b[5]; });   // offs before ons at one tick
      var last = Math.max(tr.end || 0, tr.ev.length ? tr.ev[tr.ev.length - 1][0] : 0);
      tr.ev.forEach(function (e) {
        var key = e[2] * 128 + e[3];
        if (e[1]) { (open[key] = open[key] || []).push(e); return; }
        var on = open[key] && open[key].shift();
        if (!on) return;
        (byCh[e[2]] = byCh[e[2]] || []).push([e[3], on[0] / ppq, Math.max(1, e[0] - on[0]) / ppq, on[4]]);
      });
      Object.keys(open).forEach(function (key) {        // never released: up to the track's last event
        open[key].forEach(function (on) {
          (byCh[on[2]] = byCh[on[2]] || []).push([on[3], on[0] / ppq, Math.max(ppq / 4, last - on[0]) / ppq, on[4]]);
        });
      });
      Object.keys(byCh).sort(function (a, b) { return a - b; }).forEach(function (ch) {
        var notes = byCh[ch].sort(cmpNote).slice(0, MAX_NOTES);
        if (notes.length) parts.push({ name: tr.name, ch: +ch, prog: tr.prog[ch] != null ? tr.prog[ch] : null, notes: notes });
      });
    });
    return { format: format, ppq: ppq, bpm: clamp(bpm, 30, 300), sig: sig, name: name, tracks: parts };
  }
  function text(bytes, at, n) {
    var s = "";
    for (var i = 0; i < n && i < 200; i++) { var c = bytes[at + i]; s += c >= 32 && c < 127 ? String.fromCharCode(c) : c >= 160 ? String.fromCharCode(c) : " "; }
    return s.replace(/\s+/g, " ").trim().slice(0, 40);
  }

  // ---------- Standard MIDI Files: write ----------
  // song: { bpm, sig, name, tracks: [{ name, ch, prog, notes: [[p, sBeats, lBeats, v]] }] }
  // type 0 writes one track (all parts merged); type 1 a tempo track and one per part.
  var PPQ = 480;
  function writeSmf(song, type) {
    type = type === 0 ? 0 : 1;
    var bpm = clamp(isNum(song.bpm) ? song.bpm : 120, 30, 300), sig = song.sig || 4;
    function vlqBytes(v) {
      v = Math.max(0, Math.round(v));
      var out = [v & 0x7f];
      while ((v = Math.floor(v / 128)) > 0) out.unshift((v & 0x7f) | 0x80);
      return out;
    }
    function ascii(s) {
      var out = [];
      String(s || "").slice(0, 40).split("").forEach(function (c) { var n = c.charCodeAt(0); out.push(n >= 32 && n < 127 ? n : 63); });
      return out;
    }
    function metaHead(name) {
      var us = Math.round(60000000 / bpm), ev = [];
      if (name) { var nb = ascii(name); ev.push([0, 0, [0xff, 0x03].concat(vlqBytes(nb.length), nb)]); }
      ev.push([0, 0, [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255]]);
      ev.push([0, 0, [0xff, 0x58, 4, sig, 2, 24, 8]]);
      return ev;
    }
    function partEvents(p) {
      var ev = [], ch = clamp(p.ch | 0, 0, 15);
      if (p.name && type === 1) { var nb = ascii(p.name); ev.push([0, 0, [0xff, 0x03].concat(vlqBytes(nb.length), nb)]); }
      if (ch !== 9 && isNum(p.prog)) ev.push([0, 1, [0xc0 | ch, clamp(p.prog | 0, 0, 127)]]);
      p.notes.forEach(function (q) {
        var a = Math.round(q[1] * PPQ), b = Math.max(a + 1, Math.round((q[1] + q[2]) * PPQ));
        ev.push([a, 3, [0x90 | ch, q[0] & 127, clamp(q[3] | 0, 1, 127)]]);
        ev.push([b, 2, [0x80 | ch, q[0] & 127, 64]]);
      });
      return ev;
    }
    function chunk(ev) {
      ev.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });   // at one tick: meta, program, offs, ons
      var body = [], last = 0;
      ev.forEach(function (e) { body = body.concat(vlqBytes(e[0] - last), e[2]); last = e[0]; });
      body = body.concat([0, 0xff, 0x2f, 0]);
      var n = body.length;
      return [0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255].concat(body);
    }
    var chunks = [];
    if (type === 0) {
      var all = metaHead(song.name);
      (song.tracks || []).forEach(function (p) { all = all.concat(partEvents(p)); });
      chunks.push(chunk(all));
    } else {
      chunks.push(chunk(metaHead(song.name)));
      (song.tracks || []).forEach(function (p) { chunks.push(chunk(partEvents(p))); });
    }
    var head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, type, (chunks.length >> 8) & 255, chunks.length & 255, (PPQ >> 8) & 255, PPQ & 255];
    var size = head.length;
    chunks.forEach(function (c) { size += c.length; });
    var out = new Uint8Array(size), o = 0;
    out.set(head, 0); o = head.length;
    chunks.forEach(function (c) { out.set(c, o); o += c.length; });
    return out;
  }

  var api = {
    GRIDS: GRIDS, GRID_ORDER: GRID_ORDER, MAX_NOTES: MAX_NOTES, MIN_NOTE: MIN_NOTE, PPQ: PPQ,
    gridSec: gridSec, snapT: snapT, floorT: floorT, cmpNote: cmpNote,
    apply: apply, moveNotes: moveNotes, resizeNotes: resizeNotes, setVel: setVel, deleteNotes: deleteNotes,
    addNote: addNote, quantize: quantize, inRect: inRect, copyNotes: copyNotes, pasteNotes: pasteNotes, notesEnd: notesEnd,
    toSec: toSec, toBeats: toBeats, instFor: instFor, programFor: programFor,
    readSmf: readSmf, writeSmf: writeSmf
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioNotes = api;
})(typeof window !== "undefined" ? window : this);
