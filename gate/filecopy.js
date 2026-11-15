// gate/filecopy.js — GATE-FILES F2: the sealed copy of Claude's folders
// that the relay reads while every orOS is closed (Chris 2026-11-13:
// Dropbox, quota 250 MB by default and changeable, 7 days).
//
// What goes where:
// - the INDEX (every file of Claude's folders: path, size, time,
//   version, kind, and the links of its sealed pieces) is sealed with
//   the gate key K and sent to the gate box like the copy;
// - the CONTENT and a TEXT sidecar (PDF / document text made on the
//   device) are cut into 1 MiB pieces, each AES-GCM-256 under a file
//   key FK = HMAC-K("orOS-gate-fk|" + sha256), a fresh IV, and the
//   file's hash, the part ("c" content / "t" text) and the piece number
//   as additional data, so a swapped, reordered or foreign piece fails.
//   Piece names are HMAC-K of the same, so equal content is stored once
//   and an unchanged file is never sent again. Pieces sit in Dropbox
//   (/gate/<gate id>/) behind shared links: ciphertext only.
// The relay (relay/gate.js filePiece/openPiece) opens them with the
// same rules; tests/gate-filecopy.test.js keeps both sides equal.
//
// Pure planning + WebCrypto; window.OrosGateFileCopy or module.exports.
(function (root) {
  "use strict";
  var PIECE = 1048576;                       // 1 MiB of plain bytes per piece
  var TEXT_MAX = 2000000;                    // characters of a text sidecar
  var LIMITS = { text: 25 << 20, document: 25 << 20, pdf: 50 << 20, image: 25 << 20, other: 25 << 20, media: 0 };
  var QUOTA_DEF = 250 << 20, QUOTA_MIN = 50 << 20;
  var FILES_MAX = 3000;                      // files in the index (the rest: none)
  var enc = new TextEncoder();

  function C() { return root.crypto || (typeof crypto !== "undefined" ? crypto : null); }
  function hex(buf) {
    var u = new Uint8Array(buf), s = "";
    for (var i = 0; i < u.length; i++) s += (u[i] < 16 ? "0" : "") + u[i].toString(16);
    return s;
  }
  function hmacKey(kRaw) {
    return C().subtle.importKey("raw", kRaw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  function hmac(kRaw, text) {
    return hmacKey(kRaw).then(function (k) { return C().subtle.sign("HMAC", k, enc.encode(text)); }).then(function (b) { return new Uint8Array(b); });
  }
  function sha256(bytes) { return C().subtle.digest("SHA-256", bytes).then(hex); }
  function fileKey(kRaw, h) {
    return hmac(kRaw, "orOS-gate-fk|" + h).then(function (raw) {
      return C().subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    });
  }
  function aad(h, part, i) { return enc.encode("orOS-gate-file|" + h + "|" + part + "|" + i); }
  // → 32 hex: the piece's name in Dropbox
  function pieceName(kRaw, h, part, i) { return hmac(kRaw, "orOS-gate-pc|" + h + "|" + part + "|" + i).then(function (b) { return hex(b).slice(0, 32); }); }
  function count(size) { return Math.max(1, Math.ceil(size / PIECE)); }
  // bytes (one piece's plain bytes) → iv(12) ‖ ciphertext
  function seal(kRaw, h, part, i, bytes) {
    var iv = C().getRandomValues(new Uint8Array(12));
    return fileKey(kRaw, h).then(function (key) {
      return C().subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: aad(h, part, i) }, key, bytes);
    }).then(function (ct) {
      var out = new Uint8Array(12 + ct.byteLength);
      out.set(iv, 0); out.set(new Uint8Array(ct), 12);
      return out;
    });
  }
  function open(kRaw, h, part, i, sealed) {
    var u = new Uint8Array(sealed);
    return fileKey(kRaw, h).then(function (key) {
      return C().subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12), additionalData: aad(h, part, i) }, key, u.slice(12));
    }).then(function (b) { return new Uint8Array(b); });
  }
  function textBytes(text) { return enc.encode(String(text || "").slice(0, TEXT_MAX)); }

  // What of a file goes into the copy. row = { p, s, kind }.
  // → { c: bool (content), t: bool (text sidecar), x: "" | "media" | "big" }
  function wants(row) {
    var lim = Object.prototype.hasOwnProperty.call(LIMITS, row.kind) ? LIMITS[row.kind] : LIMITS.other;
    var side = row.kind === "pdf" || row.kind === "document";
    if (row.kind === "media") return { c: false, t: false, x: "media" };
    if (row.s > lim) return { c: false, t: false, x: "big" };
    return { c: true, t: side, x: "" };
  }
  // The plan: which files keep content within the quota. Text and
  // sidecars first (small, the reason the copy exists), then the rest
  // smallest first, so a big file leaves the copy before many small ones.
  // rows = [{ p, s, kind }] → { take: { path: { c, t } }, used, out: { path: reason } }
  function plan(rows, quota) {
    quota = Math.max(QUOTA_MIN, +quota || QUOTA_DEF);
    var take = {}, out = {}, used = 0;
    var list = rows.slice(0, FILES_MAX).map(function (r) { return { r: r, w: wants(r) }; });
    rows.slice(FILES_MAX).forEach(function (r) { out[r.p] = "many"; });
    function rank(x) { return x.r.kind === "text" ? 0 : x.w.t ? 1 : 2; }
    list.sort(function (a, b) { return rank(a) - rank(b) || a.r.s - b.r.s || (a.r.p < b.r.p ? -1 : 1); });
    list.forEach(function (x) {
      if (x.w.x) { out[x.r.p] = x.w.x; return; }
      var cost = x.r.s + (x.w.t ? Math.min(x.r.s, 4 << 20) : 0);
      if (used + cost > quota) { out[x.r.p] = "quota"; return; }
      used += cost;
      take[x.r.p] = { c: true, t: x.w.t };
    });
    return { take: take, used: used, out: out };
  }
  // Pieces of the last index by name, to skip what is already there.
  // → { "<h>|<part>": [links] }
  function known(idx) {
    var m = {};
    (idx && Array.isArray(idx.files) ? idx.files : []).forEach(function (f) {
      if (!f || typeof f.h !== "string") return;
      if (Array.isArray(f.c) && f.c.length) m[f.h + "|c"] = f.c;
      if (Array.isArray(f.t) && f.t.length) m[f.h + "|t"] = f.t;
    });
    return m;
  }
  function quotaOf(v) {
    var n = Math.floor(+v || 0);
    return n >= QUOTA_MIN ? n : QUOTA_DEF;
  }

  var api = { PIECE: PIECE, TEXT_MAX: TEXT_MAX, LIMITS: LIMITS, QUOTA_DEF: QUOTA_DEF, QUOTA_MIN: QUOTA_MIN, FILES_MAX: FILES_MAX,
              sha256: sha256, pieceName: pieceName, count: count, seal: seal, open: open, textBytes: textBytes,
              wants: wants, plan: plan, known: known, quotaOf: quotaOf, hex: hex };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosGateFileCopy = api;
})(typeof window !== "undefined" ? window : globalThis);
