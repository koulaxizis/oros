// ============================================================
// orOS — modelfetch.js (on-device model download, v1.0.0)
// ------------------------------------------------------------
// One way to fetch a model file from our own mirrors on GitHub Pages
// (koulaxizis/oros-models-vision, oros-models-large) and keep it only
// when it is exactly the file the mirror's index.json records.
//
//   file = { url, size, sha }                  one file
//        | { url, size, sha, parts: [{ size, sha }, ...] }
//          a file over 95 MB that tools/mirror.py cut into
//          "<url>.part00", "<url>.part01", ... (GitHub's 100 MB limit)
//   size = bytes, sha = SHA-256 (hex), both copied from index.json.
//
// get(file, opts) → Promise<Blob>
//   opts.onBytes(n)  called with every chunk's length (progress)
//   opts.cancelled() true stops the download (error "cancelled")
//   Each part is checked (size + SHA-256) as soon as it arrives, then
//   the joined file is checked against the whole file's size and
//   SHA-256. Errors carry .code: "download" | "hash" | "cancelled".
//   A file without sha is fetched as it is (our own vendor/ files).
// bytes(file)  → the download size in bytes (whole file or parts)
// partUrl(url, i) → "<url>.partNN"
//
// Pure fetch + Web Crypto, no DOM: the same file runs in a page, a
// worker and Node (tests/modelfetch.test.js). Nothing is stored here;
// the caller keeps the Blob (IndexedDB) under its own version key.
// UMD: window.OrosModelFetch / self.OrosModelFetch, or module.exports.
// ============================================================
(function (root) {
  "use strict";

  function err(code) { var e = new Error(code); e.code = code; return e; }

  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function sha256(buf) {
    return root.crypto.subtle.digest("SHA-256", buf).then(hex);
  }
  function partUrl(url, i) {
    return url + ".part" + (i < 10 ? "0" : "") + i;
  }
  function bytes(file) {
    if (!file) return 0;
    if (Array.isArray(file.parts) && file.parts.length) {
      return file.parts.reduce(function (s, p) { return s + (p && p.size > 0 ? p.size : 0); }, 0);
    }
    return file.size > 0 ? file.size : 0;
  }

  // One URL → Blob, streamed so the progress moves and Cancel works.
  function fetchBlob(url, opts) {
    var f = opts.fetch || root.fetch;
    return Promise.resolve().then(function () {
      return f(url, { cache: "no-cache", credentials: "omit" });
    }).then(function (res) {
      if (!res || !res.ok) throw err("download");
      if (!res.body || !res.body.getReader) {
        return res.blob().then(function (b) { if (opts.onBytes) opts.onBytes(b.size); return b; });
      }
      var reader = res.body.getReader(), chunks = [];
      function pump() {
        if (opts.cancelled && opts.cancelled()) {
          try { reader.cancel(); } catch (e) { /* gone */ }
          throw err("cancelled");
        }
        return reader.read().then(function (r) {
          if (r.done) return new Blob(chunks);
          chunks.push(r.value);
          if (opts.onBytes) opts.onBytes(r.value.byteLength);
          return pump();
        });
      }
      return pump();
    }, function (e) { throw e && e.code ? e : err("download"); })
      .catch(function (e) { throw e && e.code ? e : err("download"); });
  }

  // Blob → checked against { size, sha }; resolves with the Blob.
  function check(blob, want) {
    if (!want || !want.sha) return Promise.resolve(blob);
    if (want.size > 0 && blob.size !== want.size) return Promise.reject(err("hash"));
    return blob.arrayBuffer().then(sha256).then(function (h) {
      if (h !== String(want.sha).toLowerCase()) throw err("hash");
      return blob;
    });
  }

  function get(file, opts) {
    opts = opts || {};
    if (!file || typeof file.url !== "string" || !file.url) return Promise.reject(err("download"));
    var parts = Array.isArray(file.parts) && file.parts.length ? file.parts : null;
    if (!parts) {
      return fetchBlob(file.url, opts).then(function (b) { return check(b, file); });
    }
    var got = [];
    return parts.reduce(function (p, want, i) {
      return p.then(function () {
        if (opts.cancelled && opts.cancelled()) throw err("cancelled");
        return fetchBlob(partUrl(file.url, i), opts).then(function (b) { return check(b, want); })
          .then(function (b) { got.push(b); });
      });
    }, Promise.resolve()).then(function () {
      return check(new Blob(got), file);
    });
  }

  var api = { get: get, bytes: bytes, partUrl: partUrl, hex: hex, sha256: sha256 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosModelFetch = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
