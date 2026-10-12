// ============================================================
// orOS Montage — media files: import, where they live, thumbnails.
//
// A media file is stored once under its id "<sha256>.<ext>" (the forms
// MontageCore accepts: jpg|png, mp4|webm, mp3|m4a|ogg|wav|weba).
//   - Device store (default): this browser only, never synced. An OPFS
//     folder "montage-media" next to the orOS disk, or IndexedDB
//     "oros-montage-media" where OPFS cannot be written. Vault Drive
//     does not see it, so a 2 GB phone video never starts an upload.
//   - Shared: the project's "Sync media" switch (project.vs) copies its
//     files to the orOS disk, /internal/Assets/<id> (the Atelier
//     folder), and Vault Drive syncs them from there (encrypted).
//   get(id) looks in the device store, then on the orOS disk.
// Thumbnails (small JPEGs) are a device-local cache in IndexedDB
// "oros-montage-thumbs"; they can always be made again.
// Media are only decoded by the browser (Mediabunny / <video>), never
// run; the type comes from the file's first bytes, not its name.
// ============================================================
(function (root) {
  "use strict";

  var DIR = "montage-media", DB = "oros-montage-media", TDB = "oros-montage-thumbs";
  var ASSETS = "/internal/Assets";
  var MAX_FILE = 4 * 1024 * 1024 * 1024;             // 4 GB
  var MIME = { jpg: "image/jpeg", png: "image/png", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav", weba: "audio/webm" };

  function C() { return root.MontageCore; }
  function fail(code) { var e = new Error(code); e.code = code; return e; }
  function osFS() {
    try { return (root.parent && root.parent.orosFS) || root.orosFS || null; }
    catch (e) { return root.orosFS || null; }
  }
  function mimeOf(id) { return MIME[String(id).split(".").pop()] || "application/octet-stream"; }

  // ---------- first bytes → container ----------
  function at(b, i, s) { for (var j = 0; j < s.length; j++) if (b[i + j] !== s.charCodeAt(j)) return false; return true; }
  function sniff(b) {
    if (!b || b.length < 12) return "";
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
    if (b[0] === 0x89 && at(b, 1, "PNG")) return "png";
    if (at(b, 0, "RIFF") && at(b, 8, "WEBP")) return "webp";
    if (at(b, 0, "GIF8")) return "gif";
    if (at(b, 4, "ftyp") && (at(b, 8, "avif") || at(b, 8, "heic") || at(b, 8, "heix") || at(b, 8, "mif1"))) return "still";
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
    if (at(b, 4, "ftyp") || at(b, 4, "moov") || at(b, 4, "mdat") || at(b, 4, "wide")) return "mp4";
    if (at(b, 0, "OggS")) return "ogg";
    if (at(b, 0, "RIFF") && at(b, 8, "WAVE")) return "wav";
    if (at(b, 0, "ID3")) return "mp3";
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return "mp3";
    return "";
  }

  // ---------- device store ----------
  var opfsDir = null;
  function opfs() {
    if (opfsDir) return opfsDir;
    var ok = navigator.storage && typeof navigator.storage.getDirectory === "function" &&
             root.FileSystemFileHandle && typeof FileSystemFileHandle.prototype.createWritable === "function";
    opfsDir = ok ? navigator.storage.getDirectory().then(function (r) { return r.getDirectoryHandle(DIR, { create: true }); })
      .catch(function () { return null; }) : Promise.resolve(null);
    return opfsDir;
  }
  function idb(name) {
    return new Promise(function (resolve, reject) {
      var rq = indexedDB.open(name, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore("files"); };
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
  }
  function idbDo(name, mode, fn) {
    return idb(name).then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("files", mode), st = tx.objectStore("files"), out;
        var rq = fn(st);
        if (rq) rq.onsuccess = function () { out = rq.result; };
        tx.oncomplete = function () { db.close(); resolve(out); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error || fail("idb")); };
      });
    });
  }

  function deviceGet(id) {
    return opfs().then(function (dir) {
      if (dir) return dir.getFileHandle(id).then(function (fh) { return fh.getFile(); }, function () { return null; });
      return idbDo(DB, "readonly", function (st) { return st.get(id); }).then(function (b) { return b || null; }, function () { return null; });
    });
  }
  function devicePut(id, blob) {
    return opfs().then(function (dir) {
      if (dir) {
        return dir.getFileHandle(id, { create: true }).then(function (fh) {
          return fh.createWritable().then(function (w) {
            return w.write(blob).then(function () { return w.close(); }, function (e) { try { w.abort(); } catch (e2) {} throw e; });
          });
        });
      }
      return idbDo(DB, "readwrite", function (st) { return st.put(blob, id); });
    }).then(null, function (e) {
      if (e && (e.name === "QuotaExceededError" || /quota/i.test(e.message || ""))) throw fail("full");
      throw e;
    });
  }
  function deviceList() {
    return opfs().then(function (dir) {
      if (dir) {
        var out = [], it = dir.keys();
        function step() { return it.next().then(function (r) { if (r.done) return out; out.push(r.value); return step(); }); }
        return step();
      }
      return idbDo(DB, "readonly", function (st) { return st.getAllKeys(); }).then(function (k) { return k || []; });
    });
  }
  function deviceDel(id) {
    return opfs().then(function (dir) {
      if (dir) return dir.removeEntry(id).then(null, function () {});
      return idbDo(DB, "readwrite", function (st) { return st["delete"](id); });
    });
  }

  // ---------- lookup ----------
  var cache = {};                                   // id → Promise<Blob|null> (cleared on misses)
  function get(id) {
    if (cache[id]) return cache[id];
    var p = cache[id] = deviceGet(id).then(function (b) {
      if (b) return b;
      var F = osFS();
      if (!F) return null;
      return F.read(ASSETS + "/" + id).then(function (x) { return x || null; }, function () { return null; });
    }).then(function (b) {
      if (!b) { delete cache[id]; return null; }
      return b.type ? b : new Blob([b], { type: mimeOf(id) });
    });
    return p;
  }
  // Copy a file to the orOS disk (Vault Drive syncs it from there).
  function share(id) {
    var F = osFS();
    if (!F) return Promise.resolve(false);
    var path = ASSETS + "/" + id;
    return F.stat(path).then(function () { return true; }, function () {
      return deviceGet(id).then(function (b) {
        if (!b) return false;
        return F.write(path, b).then(function () { return true; });
      });
    });
  }

  // ---------- import ----------
  function head(b) { return b.slice(0, 16).arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); }

  // A picture that is not JPEG or PNG (WebP, GIF, AVIF, HEIC where the
  // browser reads it) becomes a JPEG.
  function toJpeg(file) {
    return createImageBitmap(file).then(function (bmp) {
      var c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      bmp.close && bmp.close();
      return new Promise(function (resolve, reject) {
        c.toBlob(function (b) { if (b) resolve(b); else reject(fail("decode")); }, "image/jpeg", 0.92);
      });
    }, function () { throw fail("decode"); });
  }

  // File → { id, kind: "video"|"image"|"audio", len, w, h, audio, name }
  // Rejects with code: type | decode | big | full
  function importFile(file, progress) {
    progress = progress || function () {};
    var M = root.Mediabunny;
    if (!file || !file.size) return Promise.reject(fail("type"));
    if (file.size > MAX_FILE) return Promise.reject(fail("big"));
    return head(file).then(function (b) {
      var k = sniff(b);
      if (!k) throw fail("type");
      if (k === "jpg" || k === "png" || k === "webp" || k === "gif" || k === "still") {
        var pic = (k === "jpg" || k === "png") ? Promise.resolve(file) : toJpeg(file);
        return pic.then(function (blob) {
          return createImageBitmap(blob).then(function (bmp) {
            var w = bmp.width, h = bmp.height;
            bmp.close && bmp.close();
            return store(blob, k === "png" ? "png" : "jpg", { kind: "image", len: 0, w: w, h: h, audio: false });
          }, function () { throw fail("decode"); });
        });
      }
      if (!M) throw fail("decode");
      var input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
      var meta = {};
      return input.getPrimaryVideoTrack().then(function (vt) {
        meta.vt = vt;
        return input.getPrimaryAudioTrack();
      }).then(function (at2) {
        meta.at = at2;
        return Promise.all([
          meta.vt ? meta.vt.canDecode() : false,
          meta.at ? meta.at.canDecode() : false,
          input.computeDuration()
        ]);
      }).then(function (r) {
        var hasPic = !!meta.vt && r[0], hasSnd = !!meta.at && r[1], len = r[2];
        if (input.dispose) input.dispose();
        if (!hasPic && !hasSnd) throw fail("decode");
        var ext;
        if (k === "webm") ext = hasPic ? "webm" : "weba";
        else if (k === "mp4") ext = hasPic ? "mp4" : "m4a";
        else if (!hasPic) ext = k;                     // mp3 | ogg | wav
        else throw fail("type");                       // a picture inside ogg: not supported
        return store(file, ext, {
          kind: hasPic ? "video" : "audio", len: Math.round(len * 1000) / 1000,
          w: hasPic ? meta.vt.displayWidth : 0, h: hasPic ? meta.vt.displayHeight : 0, audio: hasSnd
        });
      }, function (e) { if (input.dispose) input.dispose(); throw e && e.code ? e : fail("decode"); });
    });

    function store(blob, ext, info) {
      return root.MontageHash.file(blob, function (f) { progress(f * 0.8); }).then(function (h) {
        var id = h + "." + ext;
        info.id = id;
        info.name = String(file.name || "").slice(0, 120);
        return deviceGet(id).then(function (have) {
          if (have) return null;
          return osFS() ? osFS().stat(ASSETS + "/" + id).then(function () { return null; }, function () { return devicePut(id, blob); }) : devicePut(id, blob);
        }).then(function () { delete cache[id]; progress(1); return info; });
      });
    }
  }

  // Relink: the user points at a file for a missing id. Same content →
  // stored under the same id; different content → a new id the caller
  // puts in the project's clips instead.
  function relink(id, file, progress) { return importFile(file, progress).then(function (info) { info.same = info.id === id; return info; }); }

  // ---------- thumbnails ----------
  var thumbs = {};
  function thumb(id, at2) {
    var key = id + "@" + (Math.round((at2 || 0) * 10) / 10);
    if (thumbs[key]) return thumbs[key];
    var p = thumbs[key] = idbDo(TDB, "readonly", function (st) { return st.get(key); }).then(null, function () { return null; }).then(function (have) {
      if (have) return have;
      return get(id).then(function (b) {
        if (!b) return null;
        return makeThumb(id, b, at2 || 0).then(function (j) {
          if (j) idbDo(TDB, "readwrite", function (st) { return st.put(j, key); }).then(null, function () {});
          return j;
        });
      });
    }).then(function (j) { return j ? URL.createObjectURL(j) : null; }, function () { delete thumbs[key]; return null; });
    return p;
  }
  function makeThumb(id, blob, at2) {
    var H = 96;
    var c = document.createElement("canvas"), g = c.getContext("2d");
    function out(src, w, h) {
      c.height = H; c.width = Math.max(8, Math.round(H * w / h));
      g.drawImage(src, 0, 0, c.width, c.height);
      return new Promise(function (resolve) { c.toBlob(resolve, "image/jpeg", 0.8); });
    }
    if (C().isPicture(id)) return createImageBitmap(blob).then(function (bmp) { var r = out(bmp, bmp.width, bmp.height); bmp.close && bmp.close(); return r; });
    if (!C().isVideo(id) || !root.Mediabunny) return Promise.resolve(null);
    var M = root.Mediabunny, input = new M.Input({ source: new M.BlobSource(blob), formats: M.ALL_FORMATS });
    return input.getPrimaryVideoTrack().then(function (vt) {
      if (!vt) return null;
      return vt.getFirstTimestamp().then(function (off) {
        var sink = new M.CanvasSink(vt, { height: H, fit: "contain", width: Math.max(8, Math.round(H * vt.displayWidth / vt.displayHeight)) });
        return sink.getCanvas(off + at2);
      }).then(function (wc) { return wc ? out(wc.canvas, wc.canvas.width, wc.canvas.height) : null; });
    }).then(function (r) { if (input.dispose) input.dispose(); return r; }, function () { if (input.dispose) input.dispose(); return null; });
  }

  // ---------- housekeeping ----------
  // Remove device copies that no project on this device names any more.
  function cleanUnused(usedIds) {
    var used = {};
    (usedIds || []).forEach(function (i) { used[i] = 1; });
    return deviceList().then(function (ids) {
      var gone = ids.filter(function (i) { return !used[i]; });
      return Promise.all(gone.map(function (i) { delete cache[i]; return deviceDel(i); })).then(function () { return gone.length; });
    });
  }
  function usage() {
    return navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve({ usage: 0, quota: 0 });
  }

  root.MontageMedia = {
    sniff: sniff, get: get, share: share, importFile: importFile, relink: relink,
    thumb: thumb, cleanUnused: cleanUnused, usage: usage, mimeOf: mimeOf, MAX_FILE: MAX_FILE
  };
})(typeof window !== "undefined" ? window : this);
