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
//   putById(id, blob) stores a file that arrives with its id (an
//   .orosmontage bundle), skipping ids this device has already.
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

  // A file that arrives with its id already (an .orosmontage bundle,
  // whose media/ keys are these ids): stored in the device store unless
  // this device has it already (device store or orOS disk).
  // → Promise<"have" | "added">; rejects with code "full" like import.
  function has(id) {
    return deviceGet(id).then(function (b) {
      if (b) return true;
      var F = osFS();
      return F ? F.stat(ASSETS + "/" + id).then(function () { return true; }, function () { return false; }) : false;
    });
  }
  function putById(id, blob) {
    askPersist();
    return has(id).then(function (y) {
      if (y) return "have";
      return devicePut(id, blob).then(function () { delete cache[id]; return "added"; });
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
  // Device-only videos are the only copy orOS has: ask the browser once
  // not to evict this site's storage when the disk runs low.
  var persistAsked = false;
  function askPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      var S = navigator.storage;
      if (S && S.persisted && S.persist) S.persisted().then(function (y) { if (!y) return S.persist(); }).then(null, function () {});
    } catch (e) {}
  }
  function importFile(file, progress) {
    progress = progress || function () {};
    askPersist();
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

  // frameAt(id, sec) → Promise<Blob|null>: one frame of a video file at
  // its own size (long side at most 3840), as PNG (freeze frame).
  function frameAt(id, sec) {
    if (!C().isVideo(id) || !root.Mediabunny) return Promise.resolve(null);
    return get(id).then(function (blob) {
      if (!blob) return null;
      var M = root.Mediabunny, input = new M.Input({ source: new M.BlobSource(blob), formats: M.ALL_FORMATS });
      var done = function (r) { if (input.dispose) input.dispose(); return r; };
      return input.getPrimaryVideoTrack().then(function (vt) {
        if (!vt) return null;
        return vt.getFirstTimestamp().then(function (off) {
          var w = vt.displayWidth, h = vt.displayHeight, k = Math.min(1, 3840 / Math.max(w, h));
          var sink = new M.CanvasSink(vt, { width: Math.max(2, Math.round(w * k)), height: Math.max(2, Math.round(h * k)), fit: "fill" });
          return sink.getCanvas(off + Math.max(0, sec));
        }).then(function (wc) {
          if (!wc) return null;
          var cv = wc.canvas;
          if (cv.convertToBlob) return cv.convertToBlob({ type: "image/png" });
          return new Promise(function (resolve) { cv.toBlob(resolve, "image/png"); });
        });
      }).then(done, function () { return done(null); });
    });
  }

  // ---------- light copies (proxies) for a smooth preview ----------
  // proxy-<id>.<mp4|webm>: the video at most PROXY_SIDE px on its short
  // side, no sound, in the device store next to the original. Only the
  // preview plays it; export, freeze frame and grab read the original.
  // Never synced: each device makes its own.
  var PROXY_SIDE = 540, PROXY_RE = /^proxy-([0-9a-f]{64}\.(?:mp4|webm))\.(?:mp4|webm)$/, proxies = {};
  function proxy(id) {
    if (!C().isVideo(id)) return Promise.resolve(null);
    if (proxies[id] !== undefined) return proxies[id];
    proxies[id] = deviceGet("proxy-" + id + ".webm").then(function (b) { return b || deviceGet("proxy-" + id + ".mp4"); })
      .then(function (b) { if (!b) delete proxies[id]; return b || null; }, function () { delete proxies[id]; return null; });
    return proxies[id];
  }
  // makeProxy(id, progress, signal) → "made" | "small" (no copy needed) | "missing"
  function makeProxy(id, progress, signal) {
    var M = root.Mediabunny;
    if (!M || !C().isVideo(id)) return Promise.resolve("missing");
    return Promise.all([get(id), proxy(id)]).then(function (r) {
      if (!r[0]) return "missing";
      if (r[1]) return "made";
      var input = new M.Input({ source: new M.BlobSource(r[0]), formats: M.ALL_FORMATS });
      var done = function (x) { if (input.dispose) input.dispose(); return x; };
      return input.getPrimaryVideoTrack().then(function (vt) {
        if (!vt) return "missing";
        var w = vt.displayWidth, h = vt.displayHeight, k = PROXY_SIDE / Math.min(w, h);
        if (k >= 1) return "small";
        var pw = Math.max(2, Math.round(w * k / 2) * 2), ph = Math.max(2, Math.round(h * k / 2) * 2);
        return M.getFirstEncodableVideoCodec(["vp9", "vp8", "avc"], { width: pw, height: ph }).then(function (vc) {
          if (!vc) throw fail("decode");
          var ext = vc === "avc" ? "mp4" : "webm", target = new M.BufferTarget();
          var output = new M.Output({ format: ext === "mp4" ? new M.Mp4OutputFormat({ fastStart: "in-memory" }) : new M.WebMOutputFormat(), target: target });
          return M.Conversion.init({
            input: input, output: output,
            video: { width: pw, height: ph, fit: "fill", codec: vc, bitrate: M.QUALITY_LOW, keyFrameInterval: 1 },
            audio: { discard: true }
          }).then(function (conv) {
            if (!conv.isValid) throw fail("decode");
            conv.onProgress = function (f) { progress && progress(f); };
            if (signal) signal.cancel = function () { conv.cancel(); };
            return conv.execute();
          }).then(function () {
            var blob = new Blob([target.buffer], { type: ext === "mp4" ? "video/mp4" : "video/webm" });
            return devicePut("proxy-" + id + "." + ext, blob).then(function () { delete proxies[id]; return "made"; });
          });
        });
      }).then(done, function (e) { done(); throw e; });
    });
  }
  function dropProxies() {
    return deviceList().then(function (ids) {
      var list = ids.filter(function (i) { return PROXY_RE.test(i); });
      proxies = {};
      return Promise.all(list.map(deviceDel)).then(function () { return list.length; });
    });
  }

  // ---------- sound waveforms ----------
  // peaks(id) → Promise<Uint8Array|null>: the loudest sample of every
  // 1/PEAK_RATE s (0–255), cached next to the thumbnails. Read with
  // Mediabunny's AudioBufferSink so a long video never decodes at once.
  var PEAK_RATE = 20, peakJobs = {};
  function peaks(id) {
    if (peakJobs[id]) return peakJobs[id];
    var key = id + "#peaks";
    var p = peakJobs[id] = idbDo(TDB, "readonly", function (st) { return st.get(key); }).then(null, function () { return null; }).then(function (have) {
      if (have) return have;
      return get(id).then(function (b) {
        if (!b || C().isPicture(id)) return null;
        return makePeaks(b).then(function (arr) {
          if (arr) idbDo(TDB, "readwrite", function (st) { return st.put(arr, key); }).then(null, function () {});
          return arr;
        });
      });
    }).then(null, function () { delete peakJobs[id]; return null; });
    return p;
  }
  function makePeaks(blob) {
    var M = root.Mediabunny;
    if (!M || !M.AudioBufferSink) return Promise.resolve(null);
    var input = new M.Input({ source: new M.BlobSource(blob), formats: M.ALL_FORMATS });
    var done = function (r) { if (input.dispose) input.dispose(); return r; };
    return input.getPrimaryAudioTrack().then(function (at2) {
      if (!at2) return null;
      return Promise.all([at2.getFirstTimestamp(), input.computeDuration()]).then(function (r) {
        var off = r[0] || 0, len = Math.max(0, r[1] - off);
        var out = new Uint8Array(Math.max(1, Math.ceil(len * PEAK_RATE)));
        var it = new M.AudioBufferSink(at2).buffers()[Symbol.asyncIterator]();
        function next() {
          return it.next().then(function (step) {
            if (step.done) return out;
            var ab = step.value.buffer, t0 = step.value.timestamp - off, sr = ab.sampleRate;
            for (var c = 0; c < ab.numberOfChannels; c++) {
              var d = ab.getChannelData(c);
              for (var i = 0; i < d.length; i += 4) {
                var k = Math.floor((t0 + i / sr) * PEAK_RATE);
                if (k < 0 || k >= out.length) continue;
                var v = Math.min(255, Math.round(Math.abs(d[i]) * 255));
                if (v > out[k]) out[k] = v;
              }
            }
            return next();
          });
        }
        return next();
      });
    }).then(done, function () { return done(null); });
  }

  // ---------- housekeeping ----------
  // Remove device copies that no project on this device names any more.
  function cleanUnused(usedIds) {
    var used = {};
    (usedIds || []).forEach(function (i) { used[i] = 1; });
    return deviceList().then(function (ids) {
      // a light copy goes with its original
      var gone = ids.filter(function (i) { return !used[i] && !(PROXY_RE.test(i) && used[i.replace(PROXY_RE, "$1")]); });
      return Promise.all(gone.map(function (i) { delete cache[i]; return deviceDel(i); })).then(function () { return gone.length; });
    });
  }
  function usage() {
    return navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve({ usage: 0, quota: 0 });
  }

  root.MontageMedia = {
    sniff: sniff, get: get, share: share, has: has, putById: putById, importFile: importFile, relink: relink,
    thumb: thumb, frameAt: frameAt, proxy: proxy, makeProxy: makeProxy, dropProxies: dropProxies, peaks: peaks, PEAK_RATE: PEAK_RATE, cleanUnused: cleanUnused, usage: usage, mimeOf: mimeOf, MAX_FILE: MAX_FILE
  };
})(typeof window !== "undefined" ? window : this);
