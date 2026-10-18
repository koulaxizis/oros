// ============================================================
// orOS Screen Capture — pure helpers (no DOM)
// Loaded by index.html before app.js, and by Node in the tests.
// The app keeps no synced data: screenshots are files in
// /internal/Pictures and recordings in /internal/Videos (synced by
// the disk like any other file), and the options below stay on this
// device in localStorage "oros-capture-prefs":
//   { mode: "shot"|"rec", delay: 0|3|5|10, cursor: bool, edit: bool,
//     sys: bool, mic: bool, montage: bool }
// ============================================================
(function (root) {
  "use strict";

  var DELAYS = [0, 3, 5, 10];
  var MIN_CROP = 8;          // a smaller drag is a click: keep the whole picture
  var FOLDER = "/internal/Pictures/";
  var VIDEOS = "/internal/Videos/";
  // A recording is held in memory until it is saved: stop before the
  // tab runs out of it (and before the browser's storage quota).
  var MAX_BYTES = 1024 * 1024 * 1024;
  // MP4 first (opens everywhere, Montage edits it without converting),
  // then WebM. The first one the browser can write wins.
  var REC_TYPES = [
    "video/mp4;codecs=avc1,mp4a", "video/mp4",
    "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"
  ];

  function prefs(raw) {
    var p = raw && typeof raw === "object" ? raw : {};
    return {
      mode: p.mode === "rec" ? "rec" : "shot",
      delay: DELAYS.indexOf(p.delay) >= 0 ? p.delay : 0,
      cursor: p.cursor !== false,
      edit: p.edit === true,
      sys: p.sys !== false,
      mic: p.mic === true,
      montage: p.montage === true
    };
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // "Screenshot 2026-10-18 10-30-05.png": sorts by time in Files, and
  // has no ":" (not allowed in file names on Windows).
  function fileName(label, d, ext) {
    var base = String(label || "Screenshot").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Screenshot";
    return base + " " + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + "-" + pad(d.getMinutes()) + "-" + pad(d.getSeconds()) + "." + (ext || "png");
  }

  // The n-th free path for a name: 1 → "a.png", 2 → "a (2).png".
  function pathFor(name, n, folder) {
    var dir = folder || FOLDER;
    if (!(n > 1)) return dir + name;
    var dot = name.lastIndexOf(".");
    return dir + (dot > 0 ? name.slice(0, dot) + " (" + n + ")" + name.slice(dot) : name + " (" + n + ")");
  }

  // The recorder format: the first of REC_TYPES the browser supports
  // ("" lets the browser pick), null with no MediaRecorder at all.
  function recType(supported) {
    if (typeof supported !== "function") return null;
    for (var i = 0; i < REC_TYPES.length; i++) if (supported(REC_TYPES[i])) return REC_TYPES[i];
    return "";
  }
  function recExt(type) { return /mp4/.test(type || "") ? "mp4" : "webm"; }

  // 75000 → "1:15", 3725000 → "1:02:05".
  function clock(ms) {
    var s = Math.max(0, Math.floor((ms || 0) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    s = s % 60;
    return (h ? h + ":" + pad(m) : String(m)) + ":" + pad(s);
  }
  // Bytes → "0.4 MB", "12 MB", "1.2 GB".
  function size(b) {
    var mb = (b || 0) / 1048576;
    if (mb >= 1024) return (mb / 1024).toFixed(1) + " GB";
    return (mb < 10 ? mb.toFixed(1) : String(Math.round(mb))) + " MB";
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Two points of a drag on the preview (in screen pixels, preview
  // size bw × bh) → a rectangle in picture pixels (iw × ih), inside
  // the picture. Null when the drag is too small to mean a crop.
  function cropRect(x0, y0, x1, y1, bw, bh, iw, ih) {
    if (!(bw > 0 && bh > 0 && iw > 0 && ih > 0)) return null;
    var sx = iw / bw, sy = ih / bh;
    var l = clamp(Math.min(x0, x1), 0, bw) * sx, r = clamp(Math.max(x0, x1), 0, bw) * sx;
    var t = clamp(Math.min(y0, y1), 0, bh) * sy, b = clamp(Math.max(y0, y1), 0, bh) * sy;
    var x = Math.round(l), y = Math.round(t);
    var w = Math.round(r) - x, h = Math.round(b) - y;
    if (w < MIN_CROP || h < MIN_CROP) return null;
    return { x: x, y: y, w: w, h: h };
  }

  // The same rectangle as percentages of the picture, for the
  // overlay drawn on top of the preview.
  function rectStyle(r, iw, ih) {
    if (!r || !(iw > 0 && ih > 0)) return null;
    return { left: r.x / iw * 100, top: r.y / ih * 100, width: r.w / iw * 100, height: r.h / ih * 100 };
  }

  var API = {
    DELAYS: DELAYS, MIN_CROP: MIN_CROP, FOLDER: FOLDER, VIDEOS: VIDEOS, MAX_BYTES: MAX_BYTES, REC_TYPES: REC_TYPES,
    prefs: prefs, fileName: fileName, pathFor: pathFor, cropRect: cropRect, rectStyle: rectStyle,
    recType: recType, recExt: recExt, clock: clock, size: size
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.CaptureCore = API;
})(typeof window !== "undefined" ? window : globalThis);
