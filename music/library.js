// ============================================================
// orOS Music — library.js (the device's music, v1.1.0)
// Runs in the app window. The music files live on the orOS disk
// under /internal/Music (window.orosFS: Files shows them, Vault
// Drive syncs them like any other file). This file:
//   - scans that folder (sub-folders too) and reads the tags of new
//     or changed files into the device index (store.js), small
//     slices only: the first 512 KB (more when an ID3 tag is
//     bigger), the last 128 KB, and an MP4's moov box wherever it is;
//   - makes one 300 px JPEG cover per album from the picture inside
//     the files (re-drawn on a canvas: only real JPEG/PNG/WebP/GIF
//     bytes are ever shown);
//   - copies picked or dropped files (or a whole folder) into the
//     music folder (with their .lrc lyrics files), and deletes songs
//     from the device;
//   - finds a song's lyrics: the .lrc file next to it, or the lyrics
//     inside its tags.
// ============================================================
(function (w) {
  "use strict";
  var C = w.OrosMusicCore, ST = w.OrosMusicStore;
  var ROOT = "/internal/Music";
  // Index records made before TV are read again once (ReplayGain and
  // the lyrics flag came with TV 2).
  var TV = 2;
  var HEAD = 512 * 1024, TAIL = 128 * 1024, MAX_TAG = 16 * 1024 * 1024, ART_PX = 300;

  function fs() {
    try { return (w.parent && w.parent !== w && w.parent.orosFS) || w.orosFS || null; } catch (e) { return w.orosFS || null; }
  }
  function bytes(blob, a, b) {
    return blob.slice(a, b).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  // Every audio file under the music folder: [{ p, name }].
  function walk(F, dir, out, depth) {
    if (depth > 12) return Promise.resolve(out);
    return F.ls(dir).then(function (list) {
      var subs = [];
      (list || []).forEach(function (e) {
        if (!e || !e.name || e.name.charAt(0) === ".") return;
        var p = dir + "/" + e.name;
        if (e.dir) subs.push(p);
        else if (C.isAudioName(e.name)) out.push({ p: p, name: e.name });
      });
      return subs.reduce(function (pr, s) { return pr.then(function () { return walk(F, s, out, depth + 1); }); }, Promise.resolve(out));
    }, function () { return out; });
  }
  // MP4 keeps its tags in moov, often after the media: walk the boxes.
  function findMoov(blob) {
    var o = 0, n = 0;
    function step() {
      if (o + 8 > blob.size || ++n > 64) return Promise.resolve(null);
      return bytes(blob, o, o + 16).then(function (b) {
        var bx = C.mp4Box(b);
        if (!bx || bx.size < 8) return null;
        if (bx.type === "moov") return bx.size <= 4 * MAX_TAG ? bytes(blob, o, o + bx.size) : null;
        o += bx.size;
        return step();
      });
    }
    return step();
  }
  function readFileTags(blob, name, legacy) {
    var size = blob.size;
    return bytes(blob, 0, Math.min(size, HEAD)).then(function (head) {
      var need = C.id3Size(head);
      var more = need > head.length && need <= MAX_TAG ? bytes(blob, 0, Math.min(size, need + 65536)) : Promise.resolve(head);
      return more.then(function (h) {
        var tail = size > h.length ? bytes(blob, Math.max(0, size - TAIL), size) : Promise.resolve(h);
        return tail.then(function (t) {
          var isMp4 = h.length >= 8 && String.fromCharCode(h[4], h[5], h[6], h[7]) === "ftyp";
          return (isMp4 ? findMoov(blob) : Promise.resolve(null)).then(function (moov) {
            return C.readTags({ head: h, tail: t, moov: moov, size: size, name: name }, { legacy: legacy });
          });
        });
      });
    });
  }
  // A cover picture → a small JPEG (null when it is not a picture).
  function makeArt(pic) {
    if (!pic || !pic.data || !C.sniffImage(pic.data) || typeof w.createImageBitmap !== "function") return Promise.resolve(null);
    var src = new Blob([pic.data], { type: C.sniffImage(pic.data) });
    return w.createImageBitmap(src).then(function (bmp) {
      var s = Math.min(1, ART_PX / Math.max(bmp.width, bmp.height));
      var cw = Math.max(1, Math.round(bmp.width * s)), ch = Math.max(1, Math.round(bmp.height * s));
      var cv = document.createElement("canvas");
      cv.width = cw; cv.height = ch;
      cv.getContext("2d").drawImage(bmp, 0, 0, cw, ch);
      try { bmp.close(); } catch (e) {}
      return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, "image/jpeg", 0.85); });
    }).catch(function () { return null; });
  }
  function artIdFor(tags, key) {
    var ak = C.albumKey(tags);
    return "a" + C.hash(ak || key);
  }

  var scanning = null;
  // → Promise<{ tracks, added, removed, changed }>. onProgress(done, total).
  function scan(opts) {
    if (scanning) return scanning;
    opts = opts || {};
    var F = fs();
    if (!F || !ST) return Promise.reject(new Error("nofs"));
    var legacy = opts.legacy || "auto";
    scanning = Promise.all([walk(F, ROOT, [], 0), ST.all()]).then(function (r) {
      var files = r[0], old = {}, seen = {}, todo = [], keepRecs = [];
      r[1].forEach(function (t) { old[t.p] = t; });
      return files.reduce(function (pr, f) {
        return pr.then(function () {
          seen[f.p] = 1;
          return F.stat(f.p).then(function (st) {
            var o = old[f.p];
            if (o && o.sz === st.size && o.mt === (st.mtime || 0) && o.tv >= TV && !opts.force) { keepRecs.push(o); return; }
            todo.push({ f: f, st: st, o: o });
          }, function () {});
        });
      }, Promise.resolve()).then(function () {
        var done = 0, total = todo.length, changed = [], made = {};
        if (opts.onProgress) opts.onProgress(0, total);
        return todo.reduce(function (pr, x) {
          return pr.then(function () {
            return F.read(x.f.p).then(function (blob) {
              return readFileTags(blob, x.f.p, legacy).then(function (tg) {
                var k = C.trackKey(tg, x.f.p), art = tg.pic ? artIdFor(tg, k) : (x.o && x.o.art) || "";
                var rec = { p: x.f.p, sz: x.st.size, mt: x.st.mtime || 0, k: k, t: tg.t || C.stem(x.f.name), a: tg.a, aa: tg.aa, al: tg.al,
                  n: tg.n, dn: tg.dn, g: tg.g, y: tg.y, d: tg.dur || (x.o && x.o.d) || 0, art: art, add: (x.o && x.o.add) || Date.now(), fmt: tg.fmt, tv: TV };
                if (tg.rg) rec.rg = tg.rg;
                if (tg.ly) rec.ly = 1;
                var artJob = !tg.pic || made[art] ? Promise.resolve() : ST.hasArt(art).then(function (has) {
                  if (has && !opts.force) { made[art] = 1; return; }
                  return makeArt(tg.pic).then(function (jpg) { if (jpg) { made[art] = 1; return ST.putArt(art, jpg); } rec.art = ""; });
                });
                return artJob.then(function () { changed.push(rec); });
              });
            }).catch(function () {}).then(function () {
              done++;
              if (opts.onProgress) opts.onProgress(done, total);
              if (changed.length >= 25) { var part = changed.splice(0); keepRecs = keepRecs.concat(part); return ST.putTracks(part); }
            });
          });
        }, Promise.resolve()).then(function () {
          keepRecs = keepRecs.concat(changed);
          var gone = Object.keys(old).filter(function (p) { return !seen[p]; });
          return ST.putTracks(changed).then(function () { return ST.delTracks(gone); }).then(function () {
            // Covers no song points to any more.
            var used = {};
            keepRecs.forEach(function (t) { if (t.art) used[t.art] = 1; });
            return ST.artIds().then(function (ids) { return ST.delArt(ids.filter(function (id) { return !used[id]; })); }).catch(function () {});
          }).then(function () { return { tracks: keepRecs, added: total, removed: gone.length }; });
        });
      });
    });
    var clear = function () { scanning = null; };
    scanning.then(clear, clear);
    return scanning;
  }

  // Safe file and folder names on the disk.
  function safeName(n) {
    n = String(n || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
    if (!n || n === "." || n === "..") n = "song";
    return n.slice(0, 120);
  }
  function exists(F, p) { return F.stat(p).then(function () { return true; }, function () { return false; }); }
  function uniquePath(F, dir, name) {
    var dot = name.lastIndexOf("."), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    var n = 1;
    function next() {
      var p = dir + "/" + (n === 1 ? name : base + " (" + n + ")" + ext);
      return exists(F, p).then(function (yes) { if (!yes) return p; n++; return n > 500 ? null : next(); });
    }
    return next();
  }
  function isLrc(f) { return /\.lrc$/i.test(f.name || "") && f.size < 512 * 1024; }
  // The lyrics file next to a song: same name, .lrc. → text or "".
  function lrcFor(p) {
    var F = fs();
    if (!F || typeof p !== "string" || p.indexOf(ROOT + "/") !== 0) return Promise.resolve("");
    var base = p.replace(/\.[^./]+$/, "");
    var tryOne = function (ext) {
      return F.read(base + ext).then(function (b) { return b && b.size < 512 * 1024 ? b.text() : ""; }, function () { return ""; });
    };
    return tryOne(".lrc").then(function (t) { return t || tryOne(".LRC"); });
  }
  // Lyrics inside a song's own tags (ID3 USLT, Vorbis LYRICS, MP4 ©lyr).
  function tagLyrics(p) {
    var F = fs();
    if (!F) return Promise.resolve("");
    return F.read(p).then(function (blob) { return readFileTags(blob, p, "auto"); }).then(function (tg) { return (tg && tg.ly) || ""; }, function () { return ""; });
  }
  // files: [File] (webkitRelativePath kept as sub-folders). → { saved, skipped }
  function addFiles(files, onProgress) {
    var F = fs();
    if (!F) return Promise.reject(new Error("nofs"));
    // Lyrics files (.lrc) go next to their songs, under their own name.
    var list = [].slice.call(files || []).filter(function (f) { return f && (C.isAudioName(f.name) || isLrc(f)); });
    var skipped = (files ? files.length : 0) - list.length, saved = 0, done = 0;
    return list.reduce(function (pr, f) {
      return pr.then(function () {
        var rel = String(f.webkitRelativePath || f.relPath || "").split("/").filter(Boolean).slice(0, -1).map(safeName);
        var dir = ROOT + (rel.length ? "/" + rel.join("/") : "");
        return (rel.length ? F.mkdir(dir) : F.mkdir(ROOT)).then(function () {
          return isLrc(f) ? dir + "/" + safeName(f.name) : uniquePath(F, dir, safeName(f.name));
        }).then(function (p) {
          if (!p) { skipped++; return; }
          return F.write(p, f).then(function () { if (!isLrc(f)) saved++; });
        }).catch(function () { skipped++; }).then(function () { done++; if (onProgress) onProgress(done, list.length); });
      });
    }, Promise.resolve()).then(function () { return { saved: saved, skipped: skipped }; });
  }
  function removeFile(p) {
    var F = fs();
    if (!F || p.indexOf(ROOT + "/") !== 0) return Promise.reject(new Error("path"));
    return F.rm(p).then(function () { return ST.delTracks([p]); });
  }

  w.OrosMusicLibrary = { ROOT: ROOT, scan: scan, addFiles: addFiles, removeFile: removeFile, readFileTags: readFileTags, lrcFor: lrcFor, tagLyrics: tagLyrics, fs: fs };
})(window);
