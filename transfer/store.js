/* ============================================================
   orOS Transfer — store.js (browser), v1.0.0
   Where received bytes go while they arrive, and where they end up.

   Every received file is first written, piece by piece, into a
   scratch folder of the browser's private storage (OPFS, outside the
   orOS disk mount, so nothing syncs while it arrives). Nothing big is
   held in memory. Then:
   - "disk": each whole file is copied into the orOS disk under
     /internal/Transfers/<date time>/… through orosFS (so Vault Drive
     syncs it like any other file) and its scratch copy is removed.
     Only for transfers whose files are all ≤ DISK_MAX (200 MB: the
     disk syncs every file whole, in memory). A name that is taken
     gets "name (2).ext": nothing is ever overwritten.
   - "device": one file stays as it is; several files are written as
     one ZIP (core.js ZipWriter, streamed, ZIP64 when needed). The
     person saves it with the Save button (orosDialog.saveFile: a
     picker needs a click).
   A file that did not arrive whole is removed (disk) or named in the
   result (a ZIP cannot drop an entry it has already streamed).
   Browsers without a writable OPFS keep the bytes in memory, up to
   MEM_MAX.

   window.OrosTransferStore = { canScratch, sink(opts) → Sink, sweep(),
     freeBytes() → Promise<number|null>, diskTarget(fs, date), temp() }
   Sink: { open, write, close } (engine.js contract) + finish() →
     Promise<{ kind: "disk", folder, saved: [paths] } | { kind: "file", file, name }>,
     drop() → Promise
   ============================================================ */
(function (root) {
  "use strict";

  var CORE = root.OrosTransferCore;
  var SCRATCH = "oros-transfer-tmp";
  var FLUSH = 1048576;                       // bytes gathered before one write to the scratch file
  var STALE_MS = 24 * 3600000;

  function canScratch() {
    return !!(root.navigator && navigator.storage && typeof navigator.storage.getDirectory === "function" &&
      root.FileSystemFileHandle && typeof FileSystemFileHandle.prototype.createWritable === "function");
  }
  function scratchRoot() {
    return navigator.storage.getDirectory().then(function (r) { return r.getDirectoryHandle(SCRATCH, { create: true }); });
  }
  // Scratch folders left by a tab that closed mid-transfer, older than a day.
  function sweep() {
    if (!canScratch()) return Promise.resolve();
    return scratchRoot().then(function (dir) {
      var it = dir.entries(), old = [];
      function step() {
        return it.next().then(function (r) {
          if (r.done) return null;
          var t = parseInt(String(r.value[0]).split("-")[0], 36);
          if (!(t > 0) || Date.now() - t > STALE_MS) old.push(r.value[0]);
          return step();
        });
      }
      return step().then(function () {
        return Promise.all(old.map(function (n) { return dir.removeEntry(n, { recursive: true }).catch(function () {}); }));
      });
    }).catch(function () {});
  }
  function freeBytes() {
    try {
      return navigator.storage.estimate().then(function (e) {
        return (e && e.quota > 0) ? Math.max(0, e.quota - (e.usage || 0)) : null;
      }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // "/internal/Transfers/2026-11-12 18.05" (a free name).
  function diskTarget(fs, d) {
    d = d || new Date();
    var base = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + "." + pad(d.getMinutes());
    return fs.ls("/internal/Transfers").then(function (list) {
      var names = {};
      (list || []).forEach(function (e) { names[e.name.toLowerCase()] = true; });
      return "/internal/Transfers/" + CORE.freeName(base, function (n) { return !!names[n.toLowerCase()]; });
    }, function () { return "/internal/Transfers/" + base; });
  }

  // One scratch file, written in ~1 MB steps.
  function ScratchFile(dir, name) {
    var self = this, handle = null, w = null, buf = [], bufLen = 0;
    this.open = function () {
      return dir.getFileHandle(name, { create: true }).then(function (h) { handle = h; return h.createWritable(); })
        .then(function (x) { w = x; });
    };
    function flush() {
      if (!bufLen) return Promise.resolve();
      var all = new Uint8Array(bufLen), o = 0;
      buf.forEach(function (b) { all.set(b, o); o += b.length; });
      buf = []; bufLen = 0;
      return w.write(all);
    }
    this.write = function (bytes) {
      buf.push(bytes); bufLen += bytes.length;
      return bufLen >= FLUSH ? flush() : Promise.resolve();
    };
    this.close = function () { return flush().then(function () { return w.close(); }).then(function () { w = null; }); };
    this.abort = function () { var x = w; w = null; buf = []; bufLen = 0; return x ? Promise.resolve(x.abort()).catch(function () {}) : Promise.resolve(); };
    this.file = function () { return handle.getFile(); };
    this.remove = function () { return dir.removeEntry(name).catch(function () {}); };
    self.name = name;
  }
  // The same in memory (no writable OPFS).
  function MemFile(name) {
    var parts = [], file = null;
    this.open = function () { return Promise.resolve(); };
    this.write = function (b) { parts.push(b); return Promise.resolve(); };
    this.close = function () { file = new Blob(parts); parts = []; return Promise.resolve(); };
    this.abort = function () { parts = []; return Promise.resolve(); };
    this.file = function () { return Promise.resolve(file); };
    this.remove = function () { file = null; return Promise.resolve(); };
    this.name = name;
  }

  // opts: { dest: "disk"|"device", files (checked manifest), fs (orosFS, disk only), zipName }
  function sink(opts) {
    var files = opts.files, dest = opts.dest, fs = opts.fs;
    var id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    var dirP = canScratch() ? scratchRoot().then(function (r) { return r.getDirectoryHandle(id, { create: true }); }) : Promise.resolve(null);
    var one = files.length === 1, zip = null, zf = null, cur = null, single = null, folder = "", saved = [], bad = [];
    var targetP = dest === "disk" ? diskTarget(fs) : Promise.resolve("");
    function mk(name) {
      return dirP.then(function (dir) {
        var f = dir ? new ScratchFile(dir, name) : new MemFile(name);
        return f.open().then(function () { return f; });
      });
    }
    function takenOnDisk(dir) {
      return function (name) { return fs.stat(dir + "/" + name).then(function () { return true; }, function () { return false; }); };
    }
    function freeOnDisk(path) {
      var slash = path.lastIndexOf("/"), dir = path.slice(0, slash), name = path.slice(slash + 1);
      var dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
      var taken = takenOnDisk(dir);
      function attempt(i) {
        var n = i < 2 ? name : stem + " (" + i + ")" + ext;
        return taken(n).then(function (t) { return t && i < 1000 ? attempt(i < 2 ? 2 : i + 1) : dir + "/" + n; });
      }
      return attempt(1);
    }
    var api = {
      open: function (i, f) {
        if (dest === "device" && !one) {
          var start = zf ? Promise.resolve() : mk("transfer.zip").then(function (x) { zf = x; zip = new CORE.ZipWriter(); });
          return start.then(function () { return zf.write(zip.begin(f.p, f.s, f.m)); });
        }
        return mk("f" + i).then(function (x) { cur = x; });
      },
      write: function (i, bytes) {
        if (zip) return zf.write(zip.data(bytes));
        return cur.write(bytes);
      },
      close: function (i, ok) {
        if (!ok) bad.push(i);
        if (zip) return zf.write(zip.end());
        var c = cur;
        cur = null;
        if (!ok) return c.abort().then(function () { return c.remove(); });
        if (dest === "device") { single = c; return c.close(); }   // the one file; saved with the Save button
        return c.close().then(function () { return targetP; }).then(function (t) {
          folder = t;
          return Promise.all([c.file(), freeOnDisk(t + "/" + files[i].p)]);
        }).then(function (r) {
          return fs.write(r[1], r[0]).then(function () { saved.push(r[1]); });
        }).then(function () { return c.remove(); });
      },
      finish: function () {
        if (dest === "disk") return targetP.then(function (t) { return { kind: "disk", folder: folder || t, saved: saved, bad: bad }; });
        if (zip) {
          return zf.write(zip.finish()).then(function () { return zf.close(); }).then(function () { return zf.file(); }).then(function (file) {
            return { kind: "file", file: file, name: opts.zipName || "orOS Transfer.zip", bad: bad, scratch: zf };
          });
        }
        return (single ? single.file() : Promise.resolve(null)).then(function (file) {
          return { kind: "file", file: file, name: files[0].p.split("/").pop(), bad: bad };
        });
      },
      // Everything of this transfer in scratch (after a save, a cancel or an error).
      drop: function () {
        var c = cur, z = zf;
        cur = null; zf = null;
        return Promise.all([c && c.abort(), z && z.abort()]).then(function () { return dirP; }).then(function (dir) {
          if (!dir) return null;
          return navigator.storage.getDirectory().then(function (r) { return r.getDirectoryHandle(SCRATCH); })
            .then(function (s) { return s.removeEntry(id, { recursive: true }); });
        }).catch(function () {});
      }
    };
    return api;
  }

  // One scratch file for a sealed pack on its way to Dropbox (cloud.js):
  // { write, close, file, remove } — remove() drops its scratch folder.
  function temp() {
    var id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    var dirP = canScratch() ? scratchRoot().then(function (r) { return r.getDirectoryHandle(id, { create: true }); }) : Promise.resolve(null);
    return dirP.then(function (dir) {
      var f = dir ? new ScratchFile(dir, "pack") : new MemFile("pack");
      return f.open().then(function () {
        return {
          write: f.write, close: f.close, file: f.file,
          remove: function () {
            return Promise.resolve(f.abort()).then(function () {
              if (!dir) return f.remove();
              return scratchRoot().then(function (r) { return r.removeEntry(id, { recursive: true }); });
            }).catch(function () {});
          }
        };
      });
    });
  }

  root.OrosTransferStore = { canScratch: canScratch, sink: sink, sweep: sweep, freeBytes: freeBytes, diskTarget: diskTarget, temp: temp, SCRATCH: SCRATCH };
})(window);
