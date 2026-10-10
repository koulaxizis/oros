// ============================================================
// orOS Atelier — clips.js: video and sound files (v1.0.0)
// A clip is a file the user added, stored ONCE on the orOS disk next
// to the pictures: /internal/Assets/<sha256>.<ext> (the hash IS the
// id, so a package or another device can verify it). Vault Drive
// syncs it per file, like the pictures; designs keep only the id.
//   video: webm | mp4 (also .mov in an MP4 box) → id "….webm" / "….mp4"
//   sound: mp3 | m4a | ogg | wav | weba (sound-only WebM)
// The type comes from the file's first bytes, never from its name.
// A clip is played by the browser's own <video>/<audio> elements
// from a blob: URL: nothing in it is ever run as code.
//
// Where a clip is in a design (atelier/ax.js):
//   video element = a photo (its poster frame is the picture, so
//     still exports, thumbnails, PDF and PowerPoint show that frame)
//     with ax.vid (clip id), vs / ve (trim, seconds), mu (muted),
//     vol (0..100, default 100), nl (no loop: stops at its end)
//   page sound = on the page background: au (clip id), av (volume),
//     ao (seconds into the sound where the page starts). Consecutive
//     pages with the same sound play it on without a restart.
// Pure: no DOM. Exposes window.AtelierClips (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var VIDEO_RE = /^[0-9a-f]{64}\.(webm|mp4)$/;
  var SOUND_RE = /^[0-9a-f]{64}\.(mp3|m4a|ogg|wav|weba)$/;
  var MAX_VIDEO = 100 * 1024 * 1024, MAX_SOUND = 30 * 1024 * 1024;
  var MAX_LEN = 30 * 60;                        // seconds
  var MIME = { webm: "video/webm", mp4: "video/mp4", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav", weba: "audio/webm" };

  function isVideo(id) { return typeof id === "string" && VIDEO_RE.test(id); }
  function isSound(id) { return typeof id === "string" && SOUND_RE.test(id); }
  function extOf(id) { return String(id).split(".").pop(); }
  function mimeOf(id) { return MIME[extOf(id)] || "application/octet-stream"; }

  function at(b, i, s) {
    for (var j = 0; j < s.length; j++) if (b[i + j] !== s.charCodeAt(j)) return false;
    return true;
  }
  // First bytes (≥ 12) → "webm" | "mp4" | "mp3" | "ogg" | "wav" | "" .
  // WebM and MP4 may hold only sound; the caller decides after the
  // browser has read the file (a video has a picture size).
  function sniff(b) {
    if (!b || b.length < 12) return "";
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
    if (at(b, 4, "ftyp")) return "mp4";
    if (at(b, 0, "OggS")) return "ogg";
    if (at(b, 0, "RIFF") && at(b, 8, "WAVE")) return "wav";
    if (at(b, 0, "ID3")) return "mp3";
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return "mp3";   // MPEG audio frame, layer set
    return "";
  }
  // sniffed container + whether it has a picture → id extension
  function extFor(kind, hasPicture) {
    if (kind === "webm") return hasPicture ? "webm" : "weba";
    if (kind === "mp4") return hasPicture ? "mp4" : "m4a";
    if (kind === "ogg" || kind === "wav" || kind === "mp3") return hasPicture ? "" : kind;
    return "";
  }

  function nOr(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }

  // Where in the clip a video element is, `local` seconds after its
  // page appeared. len = the clip's length (seconds, may be unknown).
  function videoTime(ax, local, len) {
    var s = Math.max(0, nOr(ax.vs, 0));
    var e = nOr(ax.ve, 0) > s ? ax.ve : nOr(len, 0);
    if (len > 0) { e = Math.min(e || len, len); s = Math.min(s, Math.max(0, len - 0.05)); }
    var span = e - s;
    local = Math.max(0, nOr(local, 0));
    if (!(span > 0.05)) return s + (e ? 0 : local);       // length unknown: just run
    if (ax.nl) return Math.min(s + local, e - 0.02);
    return s + (local % span);
  }

  // The sound of every page in film order: [{ id, vol, from (seconds
  // into the sound at the page's start) }] or null per page. A run of
  // pages with the same sound continues it. pages: [{ dur, au, av, ao }]
  function soundPlan(pages) {
    var out = [];
    pages.forEach(function (p, i) {
      if (!isSound(p.au)) { out.push(null); return; }
      var prev = i ? out[i - 1] : null;
      var from = prev && prev.id === p.au ? prev.from + prev.dur : Math.max(0, nOr(p.ao, 0));
      out.push({ id: p.au, vol: p.av === undefined ? 100 : p.av, from: from, dur: p.dur });
    });
    return out;
  }
  // position in a sound of length len (loops when the page outlasts it)
  function soundTime(from, local, len) {
    var t = Math.max(0, nOr(from, 0) + Math.max(0, nOr(local, 0)));
    return len > 0.05 ? t % len : t;
  }

  var api = {
    VIDEO_RE: VIDEO_RE, SOUND_RE: SOUND_RE, MAX_VIDEO: MAX_VIDEO, MAX_SOUND: MAX_SOUND, MAX_LEN: MAX_LEN,
    isVideo: isVideo, isSound: isSound, extOf: extOf, mimeOf: mimeOf, sniff: sniff, extFor: extFor,
    videoTime: videoTime, soundPlan: soundPlan, soundTime: soundTime
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtelierClips = api;
})(typeof window !== "undefined" ? window : this);
