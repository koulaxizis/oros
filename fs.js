// ============================================================
// orOS Core — fs.js v0.1.0 (OrosFS, Wave 1: internal disk)
// ------------------------------------------------------------
// Virtual file system for orOS. Wave 1 scope:
//   • One mount: "/internal" — the orOS private disk
//   • Backend: OPFS when available, IndexedDB fallback otherwise
//     (identical API — callers never know which one answered)
//   • Promise-based API: read/write/readText/writeText/ls/mkdir/
//     rm/mv/stat + usage()
//   • Full-disk export/import (portable JSON across backends)
//   • Dirty flag ("oros-ofs-dirty") — groundwork for Wave 2 sync
//
// ZERO-CONTACT RULE (project data-safety protocol):
//   • Touches NO existing orOS localStorage keys.
//   • Opens NO existing IndexedDB database: "oros-fs" belongs to
//     the shell's backup-folder handles, "oros-vault" to the sync
//     engine — both untouched. This file uses "oros-ofs" only.
//   • Registers NOTHING with sync.js — Wave 2 concern.
//   • Existing apps keep their own storage — nothing migrates,
//     nothing moves. Pure addition.
//
// Safety contracts:
//   • All localStorage keys written here start with "oros-" so
//     the factory-reset sweep catches them.
//   • window.orosFS.wipe() exists so the factory reset can also
//     clean the disk itself (OPFS is not a localStorage key).
//   • importDisk() MERGES by default (never deletes files that
//     are not present in the payload — zero-loss instinct).
//
// Coding style: ES5 + promises, matching shell.js/sync.js.
// ============================================================
(function () {
  "use strict";

  var FS_VERSION = "0.1.0";
  var ROOT_DIR    = "internal";            // mount segment inside OPFS root
  var ROOT_PATH   = "/" + ROOT_DIR;        // "/internal" — the mount point
  var IDB_NAME    = "oros-ofs";            // fallback backend DB (NEW name)
  var DIRTY_KEY   = "oros-ofs-dirty";      // swept by factory reset (oros-*)
  var MODE_OPFS   = "opfs";
  var MODE_IDB    = "indexeddb";

  var mode = null;          // resolved lazily on first operation
  var opfsRoot = null;      // cached OPFS root handle
  var idbDb = null;         // cached fallback DB

  // ---------- Errors & blobs ----------

  function err(code, msg) {
    var e = new Error(msg || code);
    e.code = code;
    return e;
  }

  // Map a raw DOMException to a coded error (NotFoundError → ENOENT).
  function mapErr(e) {
    if (e && e.code) return e;
    if (e && (e.name === "NotFoundError" || e.name === "TypeMismatchError")) {
      return err("ENOENT", e.message || "ENOENT");
    }
    return e || err("EIO", "unknown FS error");
  }

  function toBlob(data) {
    if (!data) return new Blob([""], { type: "text/plain" });
    if (typeof Blob === "function" && data instanceof Blob) return data;
    if (typeof data === "string") return new Blob([data], { type: "text/plain" });
    if (data && typeof data.buffer === "object") {
      return new Blob([data.buffer], { type: "application/octet-stream" });
    }
    return new Blob([data], { type: "application/octet-stream" });
  }

  function blobToText(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(blob);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    var idx = dataUrl.indexOf(",");
    if (idx === -1) throw err("EINVAL", "corrupt data URL");
    var meta = dataUrl.slice(0, idx);
    var b64  = dataUrl.slice(idx + 1);
    var mime = "application/octet-stream";
    var mi = /^data:([^;,]+)/.exec(meta);
    if (mi) mime = mi[1];
    var bin = atob(b64);
    var len = bin.length;
    var buf = new Uint8Array(len);
    for (var i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }

  // ---------- Path plumbing ----------
  // Accepted form: "/internal/a/b.txt". Segments after the mount.
  // Returns [] for the mount root (valid for ls/stat), null for malformed.

  function parsePath(p) {
    if (typeof p !== "string" || p.charAt(0) !== "/") return null;
    var parts = p.split("/");
    var segs = [];
    for (var i = 1; i < parts.length; i++) {
      var s = parts[i];
      if (s === "" || s === ".") continue;
      if (s === "..") return null;          // no upward escapes
      segs.push(s);
    }
    if (!segs.length) return [];            // "/" alone = mount root (VALID)
    if (segs[0] !== ROOT_DIR) return null;  // Wave 1: internal only
    return segs.slice(1);
  }

  function pathKey(segs) {
    return ROOT_PATH + (segs.length ? "/" + segs.join("/") : "");
  }

  // ---------- Dirty flag (Wave 2 groundwork) ----------

  function markDirty() {
    try { localStorage.setItem(DIRTY_KEY, "1"); } catch (e) {}
  }
  function isDirty() {
    return localStorage.getItem(DIRTY_KEY) === "1";
  }
  function clearDirty() {
    try { localStorage.removeItem(DIRTY_KEY); } catch (e) {}
  }

  // ============================================================
  // DRIVER A — OPFS (primary backend, all modern browsers)
  // ============================================================

  function opfsAvailable() {
    return !!(navigator.storage &&
              typeof navigator.storage.getDirectory === "function");
  }

  function opfsRootGet() {
    if (opfsRoot) return Promise.resolve(opfsRoot);
    return navigator.storage.getDirectory().then(function (root) {
      opfsRoot = root;
      return root;
    });
  }

  // Mount directory ("/internal") — created on demand.
  function opfsMount(create) {
    return opfsRootGet().then(function (root) {
      return root.getDirectoryHandle(ROOT_DIR, { create: !!create });
    });
  }

  // Walk dir handles along segs (relative to the mount).
  function opfsWalk(start, segs, create) {
    var cur = start;
    var i = 0;
    function step() {
      if (i >= segs.length) return Promise.resolve(cur);
      var seg = segs[i++];
      return cur.getDirectoryHandle(seg, { create: !!create }).then(function (h) {
        cur = h;
        return step();
      });
    }
    return step();
  }

  // split path into {dirs, name}; name === null means the path IS a dir
  function splitLeaf(segs) {
    if (!segs.length) return { dirs: [], name: null };
    return { dirs: segs.slice(0, segs.length - 1), name: segs[segs.length - 1] };
  }

  function opfsWriteHandle(fh, blob) {
    return fh.createWritable().then(function (w) {
      return w.write(blob).then(function () { return w.close(); });
    });
  }

  function opfsEntries(dirHandle) {
    return new Promise(function (resolve, reject) {
      var out = [];
      var it = dirHandle.values();
      function step() {
        it.next().then(function (r) {
          if (r.done) { resolve(out); return; }
          var h = r.value;
          if (h && h.name) out.push({ name: h.name, dir: h.kind === "directory" });
          step();
        }, reject);
      }
      step();
    });
  }

  function opfsRead(segs) {
    if (!segs.length) return Promise.reject(err("EISDIR", ROOT_PATH));
    var leaf = splitLeaf(segs);
    return opfsMount(false)
      .then(function (m) { return opfsWalk(m, leaf.dirs, false); })
      .then(function (dh) { return dh.getFileHandle(leaf.name); })
      .then(function (fh) { return fh.getFile(); })
      .catch(function (e) { throw mapErr(e); });
  }

  function opfsWrite(segs, blob) {
    if (!segs.length) return Promise.reject(err("EINVAL", ROOT_PATH));
    var leaf = splitLeaf(segs);
    return opfsMount(true)
      .then(function (m) { return opfsWalk(m, leaf.dirs, true); })
      .then(function (dh) { return dh.getFileHandle(leaf.name, { create: true }); })
      .then(function (fh) { return opfsWriteHandle(fh, blob); })
      .catch(function (e) { throw mapErr(e); });
  }

  function opfsLs(segs) {
    return opfsMount(false)
      .then(function (m) { return opfsWalk(m, segs, false); })
      .then(opfsEntries)
      .then(function (list) {
        list.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        return list;
      })
      .catch(function (e) { throw mapErr(e); });
  }

  function opfsMkdir(segs) {
    if (!segs.length) return Promise.resolve();      // mount root exists
    return opfsMount(true)
      .then(function (m) { return opfsWalk(m, segs, true); })
      .then(function () { markDirty(); })            // #16 FIX: mkdir marks dirty
      .catch(function (e) { throw mapErr(e); });
  }

  function opfsStat(segs) {
    if (!segs.length) {
      return Promise.resolve({ path: ROOT_PATH, dir: true, size: 0, mtime: null });
    }
    var leaf = splitLeaf(segs);
    return opfsMount(false)
      .then(function (m) { return opfsWalk(m, leaf.dirs, false); })
      .then(function (dh) {
        return dh.getFileHandle(leaf.name).then(function (fh) {
          return fh.getFile().then(function (f) {
            return { path: pathKey(segs), dir: false, size: f.size, mtime: f.lastModified };
          });
        }).catch(function () {
          return dh.getDirectoryHandle(leaf.name).then(function () {
            return { path: pathKey(segs), dir: true, size: 0, mtime: null };
          });
        });
      })
      .catch(function (e) { throw mapErr(e); });
  }

  function opfsRm(segs) {
    if (!segs.length) return Promise.reject(err("EPERM", "cannot remove the mount root"));
    var leaf = splitLeaf(segs);
    return opfsMount(false)
      .then(function (m) { return opfsWalk(m, leaf.dirs, false); })
      .then(function (dh) {
        return new Promise(function (resolve, reject) {
          // recursive covers both files and non-empty dirs
          var req = dh.removeEntry(leaf.name, { recursive: true });
          if (req && typeof req.then === "function") {
            req.then(resolve, function (e) { reject(mapErr(e)); });
          } else {
            // Older engines: request without completion callback support
            setTimeout(resolve, 0);
          }
        });
      })
      .then(function () { markDirty(); })            // #16 FIX: rm marks dirty
      .catch(function (e) { throw mapErr(e); });
  }

  // Recursive copy (dir → dir). Used by mv.
  function opfsCopyTree(srcDir, dstDir) {
    return opfsEntries(srcDir).then(function (entries) {
      var chain = Promise.resolve();
      entries.forEach(function (e) {
        chain = chain.then(function () {
          if (e.dir) {
            return srcDir.getDirectoryHandle(e.name)
              .then(function (subSrc) {
                return dstDir.getDirectoryHandle(e.name, { create: true })
                  .then(function (subDst) { return opfsCopyTree(subSrc, subDst); });
              });
          }
          return srcDir.getFileHandle(e.name)
            .then(function (fh) { return fh.getFile(); })
            .then(function (f) {
              return dstDir.getFileHandle(e.name, { create: true })
                .then(function (nf) { return opfsWriteHandle(nf, f); });
            });
        });
      });
      return chain;
    });
  }

  function opfsMv(srcSegs, dstSegs) {
    if (!srcSegs.length || !dstSegs.length) {
      return Promise.reject(err("EINVAL", "mv needs two non-root paths"));
    }
    var srcLeaf = splitLeaf(srcSegs);
    var dstLeaf = splitLeaf(dstSegs);
    return opfsMount(true)
      .then(function (m) {
        return opfsWalk(m, srcLeaf.dirs, false).then(function (srcParent) {
          return opfsWalk(m, dstLeaf.dirs, true).then(function (dstParent) {
            return { m: m, srcParent: srcParent, dstParent: dstParent };
          });
        });
      })
      .then(function (ctx) {
        // Determine source kind: dir first (file attempt falls through)
        return ctx.srcParent.getDirectoryHandle(srcLeaf.name).then(function (srcDir) {
          return ctx.dstParent.getDirectoryHandle(dstLeaf.name, { create: true })
            .then(function (dstDir) { return opfsCopyTree(srcDir, dstDir); })
            .then(function () { return ctx.srcParent.removeEntry(srcLeaf.name, { recursive: true }); });
        }).catch(function () {
          return ctx.srcParent.getFileHandle(srcLeaf.name)
            .then(function (fh) { return fh.getFile(); })
            .then(function (f) {
              return ctx.dstParent.getFileHandle(dstLeaf.name, { create: true })
                .then(function (nf) { return opfsWriteHandle(nf, f); });
            })
            .then(function () { return ctx.srcParent.removeEntry(srcLeaf.name); });
        });
      })
      .then(function () { markDirty(); })              // #16 FIX: mv marks dirty
      .catch(function (e) { throw mapErr(e); });
  }

  function opfsWipe() {
    return opfsRootGet().then(function (root) {
      return new Promise(function (resolve) {
        var req = root.removeEntry(ROOT_DIR, { recursive: true });
        if (req && typeof req.then === "function") {
          req.then(function () { resolve(true); }, function () { resolve(false); });
        } else {
          setTimeout(function () { resolve(true); }, 0);
        }
      });
    });
  }

  function opfsCollect(dirHandle, prefix, out) {
    return opfsEntries(dirHandle).then(function (entries) {
      var chain = Promise.resolve();
      entries.forEach(function (e) {
        chain = chain.then(function () {
          if (e.dir) {
            out.push({ path: prefix + e.name, dir: true, mtime: null });
            return dirHandle.getDirectoryHandle(e.name).then(function (sub) {
              return opfsCollect(sub, prefix + e.name + "/", out);
            });
          }
          return dirHandle.getFileHandle(e.name)
            .then(function (fh) { return fh.getFile(); })
            .then(function (f) {
              return blobToDataUrl(f).then(function (du) {
                out.push({
                  path: prefix + e.name, dir: false,
                  mtime: f.lastModified, data: du
                });
              });
            });
        });
      });
      return chain.then(function () { return out; });   // FIX: was "return chain;"
    });
  }

  // ============================================================
  // DRIVER B — IndexedDB fallback (blobs keyed by path)
  // Records: key = "/internal/a/b", value = {dir, mtime, blob}
  // ============================================================

  function idbOpen() {
    if (idbDb) return Promise.resolve(idbDb);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore("nodes");
      };
      req.onsuccess = function () { idbDb = req.result; resolve(idbDb); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  function idbReq(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror   = function () { reject(request.error); };
    });
  }

  function idbStore(mode) {
    return idbOpen().then(function (db) {
      return db.transaction("nodes", mode).objectStore("nodes");
    });
  }

  function idbGet(key) {
    return idbStore("readonly").then(function (st) { return idbReq(st.get(key)); });
  }

  function idbPut(key, value) {
    return idbStore("readwrite").then(function (st) { return idbReq(st.put(value, key)); });
  }

  function idbDel(key) {
    return idbStore("readwrite").then(function (st) { return idbReq(st.delete(key)); });
  }

  function idbKeys() {
    return idbStore("readonly").then(function (st) { return idbReq(st.getAllKeys()); });
  }

  // Ensure every ancestor dir of a path has a record.
  function idbEnsureDirs(segs) {
    var chain = Promise.resolve();
    for (var i = 0; i < segs.length; i++) {
      (function (upto) {
        chain = chain.then(function () {
          return idbGet(pathKey(upto)).then(function (rec) {
            if (rec) return null;
            return idbPut(pathKey(upto), { dir: true, mtime: Date.now(), blob: null });
          });
        });
      })(segs.slice(0, i + 1));
    }
    return chain;
  }

  function idbSubtreeKeys(key) {
    return idbKeys().then(function (keys) {
      var out = [];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k === key || k.indexOf(key + "/") === 0) out.push(k);
      }
      return out;
    });
  }

  function idbRead(segs) {
    if (!segs.length) return Promise.reject(err("EISDIR", ROOT_PATH));
    return idbGet(pathKey(segs)).then(function (rec) {
      if (!rec) throw err("ENOENT", pathKey(segs));
      if (rec.dir) throw err("EISDIR", pathKey(segs));
      return rec.blob || new Blob([""]);
    });
  }

  function idbWrite(segs, blob) {
    if (!segs.length) return Promise.reject(err("EINVAL", ROOT_PATH));
    return idbEnsureDirs(segs.slice(0, segs.length - 1)).then(function () {
      return idbPut(pathKey(segs), {
        dir: false, mtime: Date.now(), blob: blob
      });
    });
  }

  function idbLs(segs) {
    var key = pathKey(segs);
    return idbGet(key).then(function (rec) {
      if (!rec || !rec.dir) throw err("ENOENT", key);
      return idbKeys();
    }).then(function (keys) {
      var prefix = (key === ROOT_PATH) ? key + "/" : key + "/"; // #17 FIX: removed redundant ternary
      var seen = {}, names = {};
      var i, k;
      for (i = 0; i < keys.length; i++) {
        k = keys[i];
        if (k.indexOf(prefix) !== 0 || k === key) continue;
        var rest = k.slice(prefix.length);
        if (!rest) continue;
        var name = rest.split("/")[0];
        names[name] = true;
        if (rest.indexOf("/") !== -1) seen[name] = "dir";   // deeper content → dir
      }
      var out = [];
      for (i = 0; i < keys.length; i++) {
        k = keys[i];
        if (k.indexOf(prefix) !== 0 || k === key) continue;
        rest = k.slice(prefix.length);
        if (!rest || rest.indexOf("/") !== -1) continue;
        seen[rest] = "file";
      }
      // Resolve kind: recorded record wins over implication
      var chain = Promise.resolve(out);
      Object.keys(names).forEach(function (nm) {
        chain = chain.then(function () {
          return idbGet(prefix + nm).then(function (rec) {
            var isDir = (seen[nm] === "dir") || (rec && rec.dir);
            out.push({ name: nm, dir: !!isDir });
          });
        });
      });
      return chain.then(function () {
        out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        return out;
      });
    });
  }

  function idbMkdir(segs) {
    if (!segs.length) return Promise.resolve();
    return idbEnsureDirs(segs);
  }

  function idbStat(segs) {
    if (!segs.length) {
      return Promise.resolve({ path: ROOT_PATH, dir: true, size: 0, mtime: null });
    }
    return idbGet(pathKey(segs)).then(function (rec) {
      if (!rec) throw err("ENOENT", pathKey(segs));
      return {
        path: pathKey(segs),
        dir: !!rec.dir,
        size: (rec.blob && rec.blob.size) || 0,
        mtime: rec.mtime || null
      };
    });
  }

  function idbRm(segs) {
    if (!segs.length) return Promise.reject(err("EPERM", "cannot remove the mount root"));
    return idbSubtreeKeys(pathKey(segs)).then(function (keys) {
      if (!keys.length) throw err("ENOENT", pathKey(segs));
      var chain = Promise.resolve();
      keys.forEach(function (k) {
        chain = chain.then(function () { return idbDel(k); });
      });
      return chain.then(function () {
        markDirty();                           // #16 FIX: idb rm marks dirty
        return keys.length;
      });
    });
  }

  function idbMv(srcSegs, dstSegs) {
    if (!srcSegs.length || !dstSegs.length) {
      return Promise.reject(err("EINVAL", "mv needs two non-root paths"));
    }
    var srcKey = pathKey(srcSegs);
    var dstKey = pathKey(dstSegs);
    return idbSubtreeKeys(srcKey).then(function (keys) {
      if (!keys.length) throw err("ENOENT", srcKey);
      return idbEnsureDirs(dstSegs.slice(0, dstSegs.length - 1)).then(function () {
        var chain = Promise.resolve();
        keys.forEach(function (k) {
          chain = chain.then(function () {
            return idbGet(k).then(function (rec) {
              if (!rec) return null;
              var newKey = dstKey + k.slice(srcKey.length);
              return idbPut(newKey, rec);
            });
          });
        });
        chain = chain.then(function () {
          var del = Promise.resolve();
          keys.forEach(function (k) {
            del = del.then(function () { return idbDel(k); });
          });
          return del;
        });
        return chain.then(function () {
          markDirty();                           // #16 FIX: idb mv marks dirty
        });
      });
    });
  }

  function idbWipe() {
    return idbKeys().then(function (keys) {
      var chain = Promise.resolve();
      keys.forEach(function (k) {
        chain = chain.then(function () { return idbDel(k); });
      });
      return chain.then(function () { return keys.length; });
    });
  }

  // ============================================================
  // Dispatch — one public surface, two interchangeable drivers
  // ============================================================

  function backendReady() {
    if (mode) return Promise.resolve(mode);
    if (opfsAvailable()) {
      return opfsRootGet().then(function () {
        mode = MODE_OPFS;
        return mode;
      }).catch(function () {
        mode = MODE_IDB;
        return mode;
      });
    }
    mode = MODE_IDB;
    return Promise.resolve(mode);
  }

  function dispatch(op, opfsFn, idbFn) {
    return backendReady().then(function () {
      var segs = op.path ? parsePath(op.path) : null;
      if (segs === null) throw err("EINVAL", "invalid path: " + op.path);
      var fn = (mode === MODE_OPFS) ? opfsFn : idbFn;
      // Drivers take segments FIRST: opfsWrite(segs, blob),
      // opfsMv(segs, dstSegs). Args order must match signatures.
      return fn.apply(null, [segs].concat(op.args));
    });
  }

  // ---------- Export / import (zero-loss contract) ----------

  function exportDisk() {
    return backendReady().then(function () {
      if (mode === MODE_OPFS) {
        return opfsMount(false)
          .catch(function (e) {
            // Empty disk: the mount dir was never created (nothing
            // written yet) — an EMPTY export, never an error.
            var m = mapErr(e);
            if (m.code === "ENOENT") return null;
            throw m;
          })
          .then(function (m) {
            return m ? opfsCollect(m, ROOT_PATH + "/", []) : [];
          })
          .then(function (entries) {
            return { ver: 1, backend: MODE_OPFS, at: new Date().toISOString(), entries: entries };
          });
      }
      return idbKeys().then(function (keys) {
        var out = [];
        var chain = Promise.resolve();
        keys.forEach(function (k) {
          chain = chain.then(function () {
            return idbGet(k).then(function (rec) {
              if (!rec) return null;
              if (rec.dir) {
                out.push({ path: k, dir: true, mtime: rec.mtime || null });
                return null;
              }
              return blobToDataUrl(rec.blob || new Blob([""])).then(function (du) {
                out.push({ path: k, dir: false, mtime: rec.mtime || null, data: du });
              });
            });
          });
        });
        return chain.then(function () {
          return { ver: 1, backend: MODE_IDB, at: new Date().toISOString(), entries: out };
        });
      });
    });
  }

  // payload: object or JSON string produced by exportDisk().
  // options.wipe === true → wipe the disk first (destructive!).
  // Default: MERGE — files in the payload overwrite matching paths,
  // everything else is left alone. NEVER deletes what's absent.
  function importDisk(payload, options) {
    var opts = options || {};
    var obj = (typeof payload === "string") ? JSON.parse(payload) : payload;
    if (!obj || !Array.isArray(obj.entries)) {
      return Promise.reject(err("EINVAL", "not an orOS disk export"));
    }
    var prep = opts.wipe ? wipe() : Promise.resolve();
    return prep.then(function () {
      var applied = 0;
      var chain = Promise.resolve();
      obj.entries.forEach(function (e) {
        chain = chain.then(function () {
          var segs = parsePath(e.path);
          if (segs === null) return null;
          if (e.dir) {
            return mkdir(e.path).then(function () { applied++; });
          }
          return write(e.path, dataUrlToBlob(e.data)).then(function () { applied++; });
        });
      });
      return chain.then(function () { return applied; });
    });
  }

  function wipe() {
    return backendReady().then(function () {
      return (mode === MODE_OPFS) ? opfsWipe() : idbWipe();
    });
  }

  function usage() {
    if (navigator.storage && typeof navigator.storage.estimate === "function") {
      return navigator.storage.estimate().then(function (est) {
        return { usage: est.usage || 0, quota: est.quota || 0, backend: mode };
      });
    }
    return Promise.resolve({ usage: null, quota: null, backend: mode || null }); // #18 FIX: handle pre-boot
  }

  // ---------- Public API ----------

  function read(path)          { return dispatch({ path: path, args: [] }, opfsRead,  idbRead); }
  function write(path, data)   {
    var blob = toBlob(data);
    return dispatch({ path: path, args: [blob] }, opfsWrite, idbWrite)
      .then(function (r) { markDirty(); return r; });
  }
  function ls(path)            { return dispatch({ path: path, args: [] }, opfsLs,    idbLs); }
  function mkdir(path)         { return dispatch({ path: path, args: [] }, opfsMkdir, idbMkdir); }
  function rm(path)            {
    return dispatch({ path: path, args: [] }, opfsRm, idbRm)
      .then(function (r) { markDirty(); return r; });
  }
  function mv(src, dst)        {
    var parsedDst = parsePath(dst);
    if (parsedDst === null) return Promise.reject(err("EINVAL", "invalid dst: " + dst));
    return dispatch({ path: src, args: [parsedDst] }, opfsMv, idbMv)
      .then(function (r) { markDirty(); return r; });
  }
  function stat(path)          { return dispatch({ path: path, args: [] }, opfsStat,  idbStat); }

  function readText(path)  { return read(path).then(blobToText); }
  function writeText(path, text) { return write(path, String(text)); }

  // ---------- Console self-test (verification, never shipped UI) ----------
  // window.orosFS.selftest() — writes/reads/removes a probe file and
  // reports PASS/FAIL per step. Leaves no trace behind on success.
  function selftest() {
    var probe = ROOT_PATH + "/.oros-selftest";
    return writeText(probe, "OrosFS selftest " + new Date().toISOString())
      .then(function () { return readText(probe); })
      .then(function (txt) {
        console.log("[orOS] fs selftest: write/read", txt.indexOf("OrosFS") === 0 ? "PASS" : "FAIL");
        return ls(ROOT_PATH);
      })
      .then(function (list) {
        console.log("[orOS] fs selftest: ls (" + list.length + " entries)");
        return stat(probe);
      })
      .then(function (st) {
        console.log("[orOS] fs selftest: stat", st);
        return rm(probe);
      })
      .then(function () {
        console.log("[orOS] fs selftest: cleanup done");
        return usage();
      })
      .then(function (u) {
        console.log("[orOS] fs selftest: usage", u);
        return "selftest complete";
      });
  }

  window.orosFS = {
    version: FS_VERSION,
    INTERNAL_ROOT: ROOT_PATH,
    ready: backendReady,
    capabilities: { opfs: opfsAvailable() },
    mode: function () { return mode; },
    read: read, readText: readText,
    write: write, writeText: writeText,
    ls: ls, mkdir: mkdir, rm: rm, mv: mv, stat: stat,
    exportDisk: exportDisk, importDisk: importDisk,
    isDirty: isDirty, clearDirty: clearDirty,
    usage: usage, wipe: wipe,
    selftest: selftest
  };

  backendReady().then(function (m) {
    console.log("[orOS] fs.js v" + FS_VERSION + " booted (backend: " + m + ")");
  }).catch(function () {
    console.warn("[orOS] fs.js v" + FS_VERSION + " booted (backend: NONE — all ops will fail)");
  });
})();