// ============================================================
// orOS Studio — core (v1.0.0)
// Pure logic, no DOM, no Web Audio: the project data and its merge,
// time in bars and beats, clip editing (move, trim, split), mute and
// solo, waveform peaks and WAV files. Loaded by studio.js
// (window.StudioCore) and the tests.
//
// Data (sync slice "studio", oros-studio-data), four flat lists merged
// one entity at a time, last change wins (R5, R17, R26):
//   { ver: 1,
//     projects: [{ id, m, name, bpm, sig, vol, loop: { on, a, b }, fx }],
//     tracks:   [{ id, m, p, name, color, vol, pan, mute, solo, ord, fx }],
//     sources:  [{ id, m, p, name, path, dur, ch }],
//     clips:    [{ id, m, p, t, s, at, off, len, gain, fi, fo }],
//     tombs:    { id: deletedAt } }
// p = project, t = track, s = source. A source is one audio file on
// the orOS disk (path); a clip plays part of a source on a track.
// Times are in seconds; volumes and gains in dB; pan -100..100.
// fx: the effect chain (NULL JSFX) of a track, or of the master on the
// project: [{ u, id, on, s: { slider: value }, f: { slider: path } }],
// u = the slot's own id, id = the effect (nullfx/fx/<id>.js), on =
// false when bypassed, f = audio files on the disk for file sliders
// (Convolution's IR). At most 8 per chain.
// The audio itself is never in this slice: it lives on the disk and
// travels with Vault Drive.
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER     = 1;
  var MAX_PROJECTS = 50;
  var MAX_TRACKS   = 8;
  var MAX_CLIPS    = 500;          // per project
  var MAX_NAME     = 40;
  var MIN_BPM      = 30;
  var MAX_BPM      = 300;
  var SIGS         = [2, 3, 4, 5, 6, 7];
  var MAX_SEC      = 3600;         // a project is at most one hour long
  var MIN_LEN      = 0.01;         // shortest clip
  var VOL_MIN      = -60;          // dB; at the bottom the fader is silent
  var VOL_MAX      = 6;
  var GAIN_MIN     = -24;
  var GAIN_MAX     = 12;
  var COLORS       = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf", "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];
  var ID_RE        = /^[ptsc][a-z0-9]{6,20}$/;
  var PATH_RE      = /^\/internal\/Studio\/[^\u0000-\u001f\\]{1,200}$/;
  var DEFAULT      = { bpm: 120, sig: 4 };
  var MAX_FX       = 8;            // effects in one chain
  var FX_ID_RE     = /^[a-z0-9_]{1,40}$/;
  var FXU_RE       = /^f[a-z0-9]{6,20}$/;
  var SLIDER_RE    = /^[1-9][0-9]?$/;  // slider1 .. slider64

  function isNum(n) { return typeof n === "number" && isFinite(n); }
  function isInt(n) { return isNum(n) && Math.floor(n) === n; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function round(n, d) { var f = Math.pow(10, d); return Math.round(n * f) / f; }
  function num(v, a, b, def, d) { return isNum(v) ? round(clamp(v, a, b), d) : def; }
  function clipLine(s, n) {
    return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  }
  function okId(id, kind) { return typeof id === "string" && ID_RE.test(id) && id.charAt(0) === kind; }
  function okM(m) { return isInt(m) && m >= 0; }

  // ---------- Normalise (every field bounded; unknown fields dropped) ----------
  // An effect chain; effects this version does not know are kept, so a
  // newer device's chain survives a round trip through an older one.
  function normFx(list) {
    var out = [], seen = {};
    if (!Array.isArray(list)) return out;
    list.forEach(function (x) {
      if (out.length >= MAX_FX || !x || typeof x !== "object") return;
      if (typeof x.u !== "string" || !FXU_RE.test(x.u) || seen[x.u]) return;
      if (typeof x.id !== "string" || !FX_ID_RE.test(x.id)) return;
      seen[x.u] = true;
      var s = {}, f = {}, hasF = false;
      if (x.s && typeof x.s === "object") {
        Object.keys(x.s).filter(function (k) { return SLIDER_RE.test(k) && +k <= 64 && isNum(x.s[k]); })
          .sort(function (a, b) { return a - b; })
          .forEach(function (k) { s[k] = round(clamp(x.s[k], -1e9, 1e9), 6); });
      }
      if (x.f && typeof x.f === "object") {
        Object.keys(x.f).filter(function (k) {
          return SLIDER_RE.test(k) && +k <= 64 && typeof x.f[k] === "string" && PATH_RE.test(x.f[k]) && x.f[k].indexOf("/..") < 0;
        }).sort(function (a, b) { return a - b; }).forEach(function (k) { f[k] = x.f[k]; hasF = true; });
      }
      var o = { u: x.u, id: x.id, on: x.on !== false, s: s };
      if (hasF) o.f = f;
      out.push(o);
    });
    return out;
  }
  function normProject(x) {
    if (!x || typeof x !== "object" || !okId(x.id, "p") || !okM(x.m)) return null;
    var lp = x.loop && typeof x.loop === "object" ? x.loop : {};
    var a = num(lp.a, 0, MAX_SEC, 0, 4), b = num(lp.b, 0, MAX_SEC, 0, 4);
    if (b < a) { var tmp = a; a = b; b = tmp; }
    return {
      id: x.id, m: x.m,
      name: clipLine(x.name, MAX_NAME),
      bpm: num(x.bpm, MIN_BPM, MAX_BPM, DEFAULT.bpm, 2),
      sig: SIGS.indexOf(x.sig) >= 0 ? x.sig : DEFAULT.sig,
      vol: num(x.vol, VOL_MIN, VOL_MAX, 0, 1),
      loop: { on: !!(x.loop && x.loop.on === true && b - a >= MIN_LEN), a: a, b: b },
      fx: normFx(x.fx)
    };
  }
  function normTrack(x) {
    if (!x || typeof x !== "object" || !okId(x.id, "t") || !okM(x.m) || !okId(x.p, "p")) return null;
    return {
      id: x.id, m: x.m, p: x.p,
      name: clipLine(x.name, MAX_NAME),
      color: COLORS.indexOf(x.color) >= 0 ? x.color : COLORS[0],
      vol: num(x.vol, VOL_MIN, VOL_MAX, 0, 1),
      pan: isNum(x.pan) ? Math.round(clamp(x.pan, -100, 100)) : 0,
      mute: x.mute === true,
      solo: x.solo === true,
      ord: isNum(x.ord) ? round(clamp(x.ord, -1e6, 1e6), 4) : 0,
      fx: normFx(x.fx)
    };
  }
  function normSource(x) {
    if (!x || typeof x !== "object" || !okId(x.id, "s") || !okM(x.m) || !okId(x.p, "p")) return null;
    if (typeof x.path !== "string" || !PATH_RE.test(x.path) || x.path.indexOf("/..") >= 0) return null;
    return {
      id: x.id, m: x.m, p: x.p,
      name: clipLine(x.name, 80),
      path: x.path,
      dur: num(x.dur, 0, MAX_SEC, 0, 6),
      ch: x.ch === 1 ? 1 : 2
    };
  }
  function normClip(x) {
    if (!x || typeof x !== "object" || !okId(x.id, "c") || !okM(x.m) ||
        !okId(x.p, "p") || !okId(x.t, "t") || !okId(x.s, "s")) return null;
    if (!isNum(x.len) || x.len <= 0) return null;
    var len = num(x.len, MIN_LEN, MAX_SEC, 0, 6);
    var fi = num(x.fi, 0, len, 0, 4), fo = num(x.fo, 0, len, 0, 4);
    if (fi + fo > len) { var k = len / (fi + fo); fi = round(fi * k, 4); fo = round(fo * k, 4); }
    return {
      id: x.id, m: x.m, p: x.p, t: x.t, s: x.s,
      at: num(x.at, 0, MAX_SEC, 0, 6),
      off: num(x.off, 0, MAX_SEC, 0, 6),
      len: len,
      gain: num(x.gain, GAIN_MIN, GAIN_MAX, 0, 1),
      fi: fi, fo: fo
    };
  }
  var NORM = { projects: normProject, tracks: normTrack, sources: normSource, clips: normClip };
  var LISTS = ["projects", "tracks", "sources", "clips"];

  function emptyData() { return { ver: DATA_VER, projects: [], tracks: [], sources: [], clips: [], tombs: {} }; }

  // ---------- Merge: symmetric, idempotent, canonical ----------
  function mergeStudio(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object" || Array.isArray(tm)) return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !okM(tm[id])) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    var out = emptyData();
    LISTS.forEach(function (key) {
      var best = {};
      [a[key], b[key]].forEach(function (list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (raw) {
          var x = NORM[key](raw);
          if (!x) return;
          var cur = best[x.id];
          if (!cur || x.m > cur.m || (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
        });
      });
      Object.keys(best).sort(cmpStr).forEach(function (id) {
        if (id in tombs && tombs[id] >= best[id].m) return;
        out[key].push(best[id]);
      });
    });
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { out.tombs[id] = tombs[id]; });
    return out;
  }

  // ---------- Lookups ----------
  function find(dat, key, id) {
    var list = dat[key];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function ofProject(dat, key, pid) { return dat[key].filter(function (x) { return x.p === pid; }); }
  function tracksOf(dat, pid) {
    return ofProject(dat, "tracks", pid).sort(function (x, y) { return x.ord - y.ord || cmpStr(x.id, y.id); });
  }
  function clipsOfTrack(dat, tid) {
    return dat.clips.filter(function (c) { return c.t === tid; }).sort(function (x, y) { return x.at - y.at || cmpStr(x.id, y.id); });
  }
  function newestFirst(list) {
    return list.slice().sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); });
  }
  function newId(kind, r) {
    var s = kind;
    for (var i = 0; i < 12; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(r() * 36));
    return s;
  }
  // The next free colour for a new track (the first one not in use).
  function nextColor(tracks) {
    for (var i = 0; i < COLORS.length; i++) {
      if (!tracks.some(function (t) { return t.color === COLORS[i]; })) return COLORS[i];
    }
    return COLORS[tracks.length % COLORS.length];
  }

  // ---------- Time: bars and beats ----------
  function beatSec(bpm) { return 60 / clamp(bpm, MIN_BPM, MAX_BPM); }
  function barSec(bpm, sig) { return beatSec(bpm) * sig; }
  // 1-based bar and beat, and the fraction into the beat.
  function barBeat(sec, bpm, sig) {
    var b = Math.max(0, sec) / beatSec(bpm) + 1e-9, whole = Math.floor(b);
    return { bar: Math.floor(whole / sig) + 1, beat: (whole % sig) + 1, frac: b - whole };
  }
  // Snap to the nearest grid line; grid is "bar", "beat" or "off".
  function snap(sec, bpm, sig, grid) {
    if (grid !== "bar" && grid !== "beat") return Math.max(0, sec);
    var step = grid === "bar" ? barSec(bpm, sig) : beatSec(bpm);
    return Math.max(0, Math.round(sec / step) * step);
  }
  // "m:ss.mmm"
  function fmtTime(sec) {
    sec = Math.max(0, sec || 0);
    var ms = Math.floor(sec * 1000 + 1e-6), m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60;
    return m + ":" + (s < 10 ? "0" : "") + s + "." + ("00" + (ms % 1000)).slice(-3);
  }

  // ---------- Mixing ----------
  function dbToGain(db) { return db <= VOL_MIN ? 0 : Math.pow(10, db / 20); }
  function gainToDb(g) { return g <= 0 ? -Infinity : 20 * Math.log10(g); }
  // What a track sends to the master: muted tracks and, when any track
  // is soloed, the tracks that are not, are silent.
  function trackGain(track, anySolo) {
    if (track.mute || (anySolo && !track.solo)) return 0;
    return dbToGain(track.vol);
  }
  function anySolo(tracks) { return tracks.some(function (t) { return t.solo && !t.mute; }); }

  // ---------- Clips ----------
  function clipEnd(c) { return c.at + c.len; }
  function projectEnd(clips) {
    var e = 0;
    clips.forEach(function (c) { e = Math.max(e, clipEnd(c)); });
    return e;
  }
  // Move: the start stays at 0 or later.
  function moveClip(c, at) { return Object.assign({}, c, { at: round(clamp(at, 0, MAX_SEC), 6) }); }
  // Trim the left edge to `at` (same audio stays where it was in time).
  function trimStart(c, at, srcDur) {
    var end = clipEnd(c);
    var minAt = Math.max(0, c.at - c.off);                       // cannot reach before the file's start
    at = clamp(at, minAt, end - MIN_LEN);
    var d = at - c.at, n = Object.assign({}, c);
    n.at = round(at, 6); n.off = round(Math.max(0, c.off + d), 6); n.len = round(end - at, 6);
    if (srcDur > 0 && n.off + n.len > srcDur) n.len = round(Math.max(MIN_LEN, srcDur - n.off), 6);
    return fitFades(n);
  }
  // Trim the right edge to `end`.
  function trimEnd(c, end, srcDur) {
    var maxEnd = srcDur > 0 ? c.at + (srcDur - c.off) : c.at + MAX_SEC;
    end = clamp(end, c.at + MIN_LEN, maxEnd);
    var n = Object.assign({}, c);
    n.len = round(end - c.at, 6);
    return fitFades(n);
  }
  function fitFades(c) {
    if (c.fi + c.fo > c.len) {
      var k = c.len / (c.fi + c.fo);
      c.fi = round(c.fi * k, 4); c.fo = round(c.fo * k, 4);
    }
    return c;
  }
  // Split at `at` (project time): two clips, or null when `at` is not
  // inside the clip with room on both sides. The right one gets `newId`.
  function splitClip(c, at, newId) {
    if (!(at > c.at + MIN_LEN && at < clipEnd(c) - MIN_LEN)) return null;
    var d = at - c.at;
    var left = Object.assign({}, c, { len: round(d, 6), fo: 0 });
    var right = Object.assign({}, c, { id: newId, at: round(at, 6), off: round(c.off + d, 6), len: round(c.len - d, 6), fi: 0 });
    left.fi = Math.min(left.fi, left.len);
    right.fo = Math.min(right.fo, right.len);
    return [left, right];
  }
  // Gain of a clip at time `x` seconds into it (fades are linear in gain).
  function fadeGainAt(c, x) {
    var g = 1;
    if (c.fi > 0 && x < c.fi) g = Math.max(0, x / c.fi);
    if (c.fo > 0 && x > c.len - c.fo) g = Math.min(g, Math.max(0, (c.len - x) / c.fo));
    return g;
  }
  // The range to export: the loop when it is on, else from 0 to the end
  // of the last clip.
  function exportRange(project, clips) {
    if (project.loop && project.loop.on && project.loop.b - project.loop.a >= MIN_LEN) return { a: project.loop.a, b: project.loop.b };
    return { a: 0, b: projectEnd(clips) };
  }

  // ---------- Peaks (waveform drawing) ----------
  // channels: arrays of samples. Returns `buckets` [min, max] pairs as
  // one Float32Array (min0, max0, min1, max1, …), both channels folded.
  function peaks(channels, buckets) {
    var n = channels.length ? channels[0].length : 0, out = new Float32Array(buckets * 2);
    if (!n || buckets < 1) return out;
    var step = n / buckets;
    for (var b = 0; b < buckets; b++) {
      var s = Math.floor(b * step), e = Math.max(s + 1, Math.floor((b + 1) * step)), lo = 0, hi = 0;
      for (var c = 0; c < channels.length; c++) {
        var d = channels[c];
        for (var i = s; i < e && i < n; i++) { var v = d[i]; if (v < lo) lo = v; else if (v > hi) hi = v; }
      }
      out[b * 2] = lo; out[b * 2 + 1] = hi;
    }
    return out;
  }

  // ---------- WAV (PCM 16 or 24 bit, 1 or 2 channels) ----------
  function wavBytes(channels, rate, bits) {
    bits = bits === 24 ? 24 : 16;
    var ch = channels.length, n = ch ? channels[0].length : 0, bps = bits / 8;
    var size = n * ch * bps, buf = new Uint8Array(44 + size), dv = new DataView(buf.buffer);
    function str(off, s) { for (var i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i); }
    str(0, "RIFF"); dv.setUint32(4, 36 + size, true); str(8, "WAVE");
    str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * ch * bps, true); dv.setUint16(32, ch * bps, true); dv.setUint16(34, bits, true);
    str(36, "data"); dv.setUint32(40, size, true);
    var o = 44, max = bits === 24 ? 8388607 : 32767;
    for (var i = 0; i < n; i++) {
      for (var c = 0; c < ch; c++) {
        var v = Math.round(clamp(channels[c][i] || 0, -1, 1) * max);
        if (bits === 16) { dv.setInt16(o, v, true); o += 2; }
        else { buf[o] = v & 255; buf[o + 1] = (v >> 8) & 255; buf[o + 2] = (v >> 16) & 255; o += 3; }
      }
    }
    return buf;
  }

  // ---------- Effects: slider controls ----------
  // A JSFX slider { min, max, inc, shape, shapeArg, enums } shown as a
  // range input of POS_STEPS steps: position 0..1 <-> value.
  var POS_STEPS = 1000;
  function sliderLog(sl) { return sl.shape === "log" && sl.min > 0 && sl.max > sl.min; }
  function sliderStep(sl, v) {
    var inc = sl.inc > 0 ? sl.inc : 0;
    if (inc) v = sl.min + Math.round((v - sl.min) / inc) * inc;
    v = clamp(v, Math.min(sl.min, sl.max), Math.max(sl.min, sl.max));
    return round(v, 6);
  }
  function sliderFromPos(sl, x) {
    x = clamp(x, 0, 1);
    var v = sliderLog(sl) ? sl.min * Math.pow(sl.max / sl.min, x) : sl.min + (sl.max - sl.min) * x;
    return sliderStep(sl, v);
  }
  function sliderToPos(sl, v) {
    if (sl.max === sl.min) return 0;
    var x = sliderLog(sl) ? Math.log(Math.max(v, sl.min) / sl.min) / Math.log(sl.max / sl.min) : (v - sl.min) / (sl.max - sl.min);
    return clamp(x, 0, 1);
  }
  // The value of slider i in a chain item (the effect's default otherwise).
  function fxValue(item, sl) {
    var v = item && item.s ? item.s[String(sl.i)] : undefined;
    return isNum(v) ? v : sl.def;
  }
  // Where an IR (or other file for an effect) goes on the orOS disk.
  function fxFilePath(u, name, ext) {
    return sourcePath(u, name, ext).replace("/internal/Studio/audio/", "/internal/Studio/fx/");
  }

  // ---------- Names ----------
  function fileName(name, ext) {
    var base = clipLine(name, MAX_NAME).replace(/[\\/:*?"<>|.]+/g, "").replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
    return (base || "studio") + "." + ext;
  }
  // Where a new audio file goes on the orOS disk.
  function sourcePath(id, name, ext) {
    var base = clipLine(name, 40).replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^A-Za-z0-9 _-]+/g, "").replace(/\s+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
    ext = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "wav";
    return "/internal/Studio/audio/" + (base ? base + "-" : "") + id + "." + ext;
  }
  function extOf(name, type) {
    var m = /\.([a-z0-9]{1,5})$/i.exec(String(name || ""));
    if (m) return m[1].toLowerCase();
    var t = String(type || "");
    if (/wav/.test(t)) return "wav";
    if (/mpeg|mp3/.test(t)) return "mp3";
    if (/ogg/.test(t)) return "ogg";
    if (/flac/.test(t)) return "flac";
    if (/mp4|m4a|aac/.test(t)) return "m4a";
    if (/webm/.test(t)) return "webm";
    return "audio";
  }

  var api = {
    DATA_VER: DATA_VER, MAX_PROJECTS: MAX_PROJECTS, MAX_TRACKS: MAX_TRACKS, MAX_CLIPS: MAX_CLIPS,
    MAX_NAME: MAX_NAME, MIN_BPM: MIN_BPM, MAX_BPM: MAX_BPM, SIGS: SIGS, MAX_SEC: MAX_SEC, MIN_LEN: MIN_LEN,
    VOL_MIN: VOL_MIN, VOL_MAX: VOL_MAX, GAIN_MIN: GAIN_MIN, GAIN_MAX: GAIN_MAX, COLORS: COLORS,
    ID_RE: ID_RE, DEFAULT: DEFAULT, LISTS: LISTS,
    normProject: normProject, normTrack: normTrack, normSource: normSource, normClip: normClip,
    emptyData: emptyData, mergeStudio: mergeStudio,
    find: find, ofProject: ofProject, tracksOf: tracksOf, clipsOfTrack: clipsOfTrack,
    newestFirst: newestFirst, newId: newId, nextColor: nextColor,
    beatSec: beatSec, barSec: barSec, barBeat: barBeat, snap: snap, fmtTime: fmtTime,
    dbToGain: dbToGain, gainToDb: gainToDb, trackGain: trackGain, anySolo: anySolo,
    clipEnd: clipEnd, projectEnd: projectEnd, moveClip: moveClip, trimStart: trimStart, trimEnd: trimEnd,
    splitClip: splitClip, fadeGainAt: fadeGainAt, exportRange: exportRange,
    peaks: peaks, wavBytes: wavBytes, fileName: fileName, sourcePath: sourcePath, extOf: extOf,
    clipLine: clipLine,
    MAX_FX: MAX_FX, FX_ID_RE: FX_ID_RE, normFx: normFx, POS_STEPS: POS_STEPS,
    sliderFromPos: sliderFromPos, sliderToPos: sliderToPos, sliderStep: sliderStep, fxValue: fxValue, fxFilePath: fxFilePath
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioCore = api;
})(typeof window !== "undefined" ? window : this);
