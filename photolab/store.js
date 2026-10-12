// ============================================================
// orOS Photo Lab — projects on the orOS disk (no DOM)
// Every project is a folder on orosFS, synced per file by Vault
// Drive (encrypted, like any other file):
//
//   /internal/Photo Lab/<id>/doc.json          the document (core.js)
//   /internal/Photo Lab/<id>/t-<name>.plt      one tile (tiles.js)
//   /internal/Photo Lab/<id>/thumb.jpg         preview for the list
//
// Tile files are named by content and never rewritten, so a save
// writes only tiles that are new, and Vault Drive uploads only those.
//
// Two devices editing the same project offline: Vault Drive keeps
// the local doc.json and writes the other one beside it as
// "doc (conflict <stamp>).json" (FILES-V). conflicts() lists those;
// splitConflict() turns one into its own project "<name> (other
// device)", so nothing is lost and nothing is merged pixel by pixel.
//
// Tiles are removed (gc) only when no doc in the folder names them
// AND the file is older than GRACE: a tile another device still
// needs reaches this device in the same Vault sync as the doc that
// names it, and save() rewrites any named tile that went missing.
//
// fs = window.parent.orosFS (or a test double with read, write, ls,
// rm, stat). UMD: module.exports in Node, window.PhotoLab.store.
// ============================================================
(function (root) {
  "use strict";

  var FOLDER = "/internal/Photo Lab";
  var GRACE = 3 * 24 * 3600 * 1000;
  var TILE_FILE_RE = /^t-([0-9a-f]{28})\.plt$/;
  var CONFLICT_RE = /^doc \(conflict [^)\/]{1,40}\)\.json$/;
  var MAX_DOC_BYTES = 2 * 1024 * 1024;

  function dirOf(id) { return FOLDER + "/" + id; }
  function tilePath(id, name) { return dirOf(id) + "/t-" + name + ".plt"; }

  function blobBytes(b) {
    if (b && typeof b.arrayBuffer === "function") return b.arrayBuffer().then(function (x) { return new Uint8Array(x); });
    return Promise.resolve(b instanceof Uint8Array ? b : new Uint8Array(0));
  }
  function blobText(b) {
    if (b && typeof b.text === "function") return b.text();
    return Promise.resolve(typeof b === "string" ? b : "");
  }
  function isMissing(e) { return e && (e.code === "ENOENT" || e.name === "NotFoundError"); }

  function readDoc(fs, C, path) {
    return fs.read(path).then(function (b) {
      if (b && typeof b.size === "number" && b.size > MAX_DOC_BYTES) throw new Error("doc");
      return blobText(b);
    }).then(function (txt) {
      var doc;
      try { doc = C.normDoc(JSON.parse(txt)); } catch (e) { doc = null; }
      if (!doc) throw new Error("doc");
      return doc;
    });
  }

  // known: optional { name: 1 } of tiles already confirmed on disk this
  // session (saves a stat per tile per save).
  //
  // save(fs, C, T, doc, surfaces, known) → Promise<{ doc, written }>.
  // doc.layers[].t is updated from the surfaces' dirty tiles; the caller
  // stamps doc.m (R27) and puts the index entry in the slice.
  function save(fs, C, T, doc, surfaces, known) {
    known = known || {};
    var written = 0, jobs = [];
    // Raster layers and layer masks (C.tileOwners) own tiles.
    C.tileOwners(doc).forEach(function (o) {
      var L = o.rec, s = surfaces[o.id];
      if (!s) return;
      Object.keys(s.dirty).forEach(function (k) {
        var t = s.tiles.get(k);
        if (!t) { delete L.t[k]; return; }
        var name = T.tileName(t);
        L.t[k] = name;
        jobs.push({ name: name, t: t });
      });
      s.dirty = {};
      // Re-sort tile keys (R26-style canonical doc).
      var sorted = {};
      Object.keys(L.t).sort().forEach(function (k) { sorted[k] = L.t[k]; });
      L.t = sorted;
      // Every named tile must exist on disk (another device's gc).
      Object.keys(L.t).forEach(function (k) {
        if (!known[L.t[k]]) jobs.push({ name: L.t[k], t: s.tiles.get(k) || null, check: true });
      });
    });
    var seen = {};
    var chain = Promise.resolve();
    jobs.forEach(function (j) {
      if (seen[j.name]) return;
      seen[j.name] = 1;
      chain = chain.then(function () {
        if (known[j.name]) return;
        var p = tilePath(doc.id, j.name);
        return fs.stat(p).then(function () { known[j.name] = 1; }, function (e) {
          if (!isMissing(e)) throw e;
          if (!j.t) return;                     // nothing in memory to write
          return T.encodeTile(j.t).then(function (bytes) {
            return fs.write(p, bytes);
          }).then(function () { known[j.name] = 1; written++; });
        });
      });
    });
    return chain.then(function () {
      var clean = C.normDoc(doc);
      return fs.write(dirOf(doc.id) + "/doc.json", JSON.stringify(clean)).then(function () {
        return { doc: clean, written: written };
      });
    });
  }

  // load → Promise<{ doc, surfaces, missing }>. missing = tiles named
  // by the doc that are not on this device yet (Vault still syncing):
  // those areas show transparent and the caller says so.
  function load(fs, C, T, id, known) {
    known = known || {};
    return readDoc(fs, C, dirOf(id) + "/doc.json").then(function (doc) {
      var surfaces = {}, missing = 0, cache = {}, chain = Promise.resolve();
      C.tileOwners(doc).forEach(function (o) {
        var L = o.rec, s = surfaces[o.id] = T.create();
        Object.keys(L.t).forEach(function (k) {
          var name = L.t[k];
          chain = chain.then(function () {
            if (cache[name]) { s.tiles.set(k, new Uint8ClampedArray(cache[name])); return; }
            return fs.read(tilePath(id, name)).then(blobBytes).then(T.decodeTile).then(function (t) {
              if (T.tileName(t) !== name) throw new Error("tile");
              cache[name] = t; known[name] = 1;
              s.tiles.set(k, new Uint8ClampedArray(t));
            }).catch(function () { missing++; });
          });
        });
      });
      return chain.then(function () { return { doc: doc, surfaces: surfaces, missing: missing }; });
    });
  }

  function conflicts(fs, id) {
    return fs.ls(dirOf(id)).then(function (list) {
      return list.filter(function (e) { return !e.dir && CONFLICT_RE.test(e.name); })
                 .map(function (e) { return e.name; }).sort();
    }, function (e) { if (isMissing(e)) return []; throw e; });
  }

  // Makes the conflict copy `file` its own project (new id, its tiles
  // copied) and removes the copy. → Promise<doc> (the caller adds it
  // to the index).
  function splitConflict(fs, C, id, file, newId, suffix, now) {
    if (!CONFLICT_RE.test(file)) return Promise.reject(new Error("doc"));
    return readDoc(fs, C, dirOf(id) + "/" + file).then(function (doc) {
      doc.id = newId;
      doc.m = now;
      doc.name = C.cleanName(doc.name + " " + suffix);
      var chain = Promise.resolve();
      C.tilesOf(doc).forEach(function (name) {
        chain = chain.then(function () {
          return fs.read(tilePath(id, name)).then(function (b) {
            return fs.write(tilePath(newId, name), b);
          }, function (e) { if (!isMissing(e)) throw e; });
        });
      });
      return chain.then(function () {
        return fs.write(dirOf(newId) + "/doc.json", JSON.stringify(doc));
      }).then(function () {
        return fs.rm(dirOf(id) + "/" + file);
      }).then(function () { return doc; });
    });
  }

  // Removes tile files no doc in the folder names, once older than
  // GRACE. → Promise<number removed>
  function gc(fs, C, id, now, grace) {
    grace = grace == null ? GRACE : grace;
    var dir = dirOf(id);
    return fs.ls(dir).then(function (list) {
      var docs = list.filter(function (e) { return !e.dir && (e.name === "doc.json" || CONFLICT_RE.test(e.name)); });
      var used = {}, ok = true;
      var chain = Promise.resolve();
      docs.forEach(function (e) {
        chain = chain.then(function () {
          return readDoc(fs, C, dir + "/" + e.name).then(function (doc) {
            C.tilesOf(doc).forEach(function (n) { used[n] = 1; });
          }, function () { ok = false; });
        });
      });
      return chain.then(function () {
        if (!ok || !docs.length) return 0;      // never guess: an unreadable doc stops gc
        var removed = 0, c2 = Promise.resolve();
        list.forEach(function (e) {
          var m = !e.dir && TILE_FILE_RE.exec(e.name);
          if (!m || used[m[1]]) return;
          c2 = c2.then(function () {
            return fs.stat(dir + "/" + e.name).then(function (st) {
              if (st && typeof st.mtime === "number" && st.mtime < now - grace) {
                return fs.rm(dir + "/" + e.name).then(function () { removed++; });
              }
            }, function () {});
          });
        });
        return c2.then(function () { return removed; });
      });
    }, function (e) { if (isMissing(e)) return 0; throw e; });
  }

  function saveThumb(fs, id, blob) { return fs.write(dirOf(id) + "/thumb.jpg", blob); }
  function readThumb(fs, id) { return fs.read(dirOf(id) + "/thumb.jpg"); }
  function remove(fs, id) {
    return fs.rm(dirOf(id)).catch(function (e) { if (!isMissing(e)) throw e; });
  }

  var API = {
    FOLDER: FOLDER, GRACE: GRACE, CONFLICT_RE: CONFLICT_RE, dirOf: dirOf, tilePath: tilePath,
    save: save, load: load, conflicts: conflicts, splitConflict: splitConflict, gc: gc,
    saveThumb: saveThumb, readThumb: readThumb, remove: remove
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.PhotoLab = root.PhotoLab || {}; root.PhotoLab.store = API; }
})(typeof window !== "undefined" ? window : this);
