// ============================================================
// orOS Writer — catstore.js: book translation projects on the orOS
// disk (WR-CAT, T1)
// A project is a folder /internal/Writer/Translations/<id>/:
//   src.json                 the source cut into segments (catcore
//                            extract), written once, never changed
//   original.<ext>           the file the project was made from (kept
//                            for the Word round trip of wave T4)
//   project.json             id, name, languages; written LAST, so a
//                            folder without it is a project still
//                            being made (or broken) and is not listed
//   rows-<dev>-<chunk>.json  the translations THIS device changed, 200
//                            segments a file
//   meta-<dev>.json          this device's name / translated document
// Each device writes only its own rows and meta files, so two devices
// never write the same file and Vault Drive never makes a conflict
// copy; reading merges every device's files (catcore.mergeRows, the
// newer stamp wins per segment). A save writes only the chunks that
// changed (a few KB), so typing never uploads the whole book again.
// Deleting moves the folder to the Files Trash (FILES-T record first),
// so it can be put back from Files for 30 days.
// fs = window.parent.orosFS (or a fake with the same calls in tests).
// Exposes window.WriterCatStore (browser) or module.exports.
//   (T2) /internal/Writer/Memories/<id>/: translation memories, the
//   same rules: tm.json written last, units-<dev>-<bucket>.json (32
//   buckets by key, cattm.js), meta-<dev>.json for a rename.
//   (T3) /internal/Writer/Glossaries/<id>/: the same with gl.json and
//   entries-<dev>-<bucket>.json (catqa.js).
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var C = node ? require("./catcore.js") : root.WriterCatCore;
  var TM = node ? require("./cattm.js") : root.WriterCatTM;
  var QA = node ? require("./catqa.js") : root.WriterCatQA;

  var ROOT = "/internal/Writer/Translations";
  var TMROOT = "/internal/Writer/Memories";     // T2: translation memories
  var GLROOT = "/internal/Writer/Glossaries";   // T3: glossaries
  var TRASH = "/internal/.trash";
  var MAX_FILE = 64 * 1024 * 1024;

  function dirOf(id) { return ROOT + "/" + id; }
  function json(text) { try { return JSON.parse(text); } catch (e) { return null; } }
  function ls(fs, path) { return fs.ls(path).catch(function () { return []; }); }
  function readJson(fs, path) {
    return fs.readText(path).then(function (t) { return t && t.length <= MAX_FILE ? json(t) : null; }, function () { return null; });
  }

  function Store(fs, dev, now) {
    if (!C.DEV_RX.test(String(dev || ""))) throw new Error("device id");
    now = now || function () { return Date.now(); };
    var self = this;
    // own rows per project: { id: { chunk: { "<i>": row } } }
    var own = {};

    // ---- list ----
    self.list = function () {
      return ls(fs, ROOT).then(function (ents) {
        return Promise.all(ents.filter(function (e) { return e.dir && C.ID_RX.test(e.name); }).map(function (e) {
          var d = dirOf(e.name);
          return Promise.all([readJson(fs, d + "/project.json"), ls(fs, d)]).then(function (r) {
            var p = C.readProject(r[0]);
            if (!p || p.id !== e.name) return null;
            var metas = r[1].filter(function (x) { return !x.dir && C.metaName(x.name); });
            return Promise.all(metas.map(function (x) { return readJson(fs, d + "/" + x.name); })).then(function (ms) {
              var m = C.mergeMeta(ms);
              if (m.name) p.name = m.name;
              p.out = m.out;
              return p;
            });
          });
        }));
      }).then(function (list) {
        return list.filter(Boolean).sort(function (a, b) { return (b.at - a.at) || (a.id < b.id ? -1 : 1); });
      });
    };

    // ---- create ----
    // o = { name, from, to, src (Writer doc id), data (catcore extract + page), orig: Blob|null, origName }
    self.create = function (o) {
      var id = C.newId(now(), Math.random()), d = dirOf(id);
      var ext = /\.([a-z0-9]{1,8})$/i.exec(String(o.origName || ""));
      var p = { v: 1, id: id, name: String(o.name || "").slice(0, 200), from: C.cleanLang(o.from), to: C.cleanLang(o.to), at: now(),
        src: String(o.src || "").slice(0, 80), file: String(o.origName || "").slice(0, 200) };
      return fs.writeText(d + "/src.json", JSON.stringify(o.data))
        .then(function () { return o.orig && ext ? fs.write(d + "/original." + ext[1].toLowerCase(), o.orig) : null; })
        .then(function () { return fs.writeText(d + "/project.json", JSON.stringify(p)); })
        .then(function () { own[id] = {}; return C.readProject(p); });
    };

    // ---- open ----
    // → { p, src, rows, meta, sig } (rows merged over every device)
    self.open = function (id) {
      if (!C.ID_RX.test(id)) return Promise.reject(new Error("id"));
      var d = dirOf(id);
      return Promise.all([readJson(fs, d + "/project.json"), readJson(fs, d + "/src.json")]).then(function (r) {
        var p = C.readProject(r[0]), src = C.readSrc(r[1]);
        if (!p || !src) { var e = new Error(p ? "nosrc" : "gone"); e.code = p ? "nosrc" : "gone"; throw e; }
        return self.reload(id).then(function (x) { return { p: p, src: src, rows: x.rows, meta: x.meta, sig: x.sig }; });
      });
    };

    // every device's rows + meta again → { rows, meta, sig }
    self.reload = function (id) {
      var d = dirOf(id);
      return ls(fs, d).then(function (ents) {
        var files = ents.filter(function (e) { return !e.dir && (C.rowsName(e.name) || C.metaName(e.name)); });
        return Promise.all(files.map(function (e) {
          return Promise.all([readJson(fs, d + "/" + e.name), fs.stat(d + "/" + e.name).catch(function () { return null; })])
            .then(function (r) { return { name: e.name, obj: r[0], st: r[1] }; });
        }));
      }).then(function (files) {
        var lists = [], metas = [], mine = {};
        files.forEach(function (f) {
          var rn = C.rowsName(f.name);
          if (rn) {
            var rows = C.readRowsFile(f.obj, rn.dev, rn.chunk);
            lists.push(rows);
            if (rn.dev === dev) mine[rn.chunk] = rows;
          } else metas.push(f.obj);
        });
        // what this device wrote before (another tab of it may have written more)
        var prev = own[id] || {};
        Object.keys(mine).forEach(function (k) { prev[k] = C.mergeRows([prev[k], mine[k]]); });
        own[id] = prev;
        Object.keys(prev).forEach(function (k) { lists.push(prev[k]); });
        return { rows: C.mergeRows(lists), meta: C.mergeMeta(metas), sig: sigOf(files) };
      });
    };
    function sigOf(files) {
      return files.map(function (f) { return f.name + ":" + (f.st ? f.st.size + "/" + f.st.mtime : "?"); }).sort().join("|");
    }
    // the folder's rows / meta files now (cheap: names, sizes, times)
    self.sig = function (id) {
      var d = dirOf(id);
      return ls(fs, d).then(function (ents) {
        var files = ents.filter(function (e) { return !e.dir && (C.rowsName(e.name) || C.metaName(e.name)); });
        return Promise.all(files.map(function (e) {
          return fs.stat(d + "/" + e.name).then(function (st) { return { name: e.name, st: st }; }, function () { return { name: e.name, st: null }; });
        }));
      }).then(sigOf);
    };

    // ---- save ----
    // changed = { "<i>": row } (rows this device just wrote). Writes the
    // chunks they fall in, each with every row this device wrote there.
    self.saveRows = function (id, changed) {
      var d = dirOf(id), mine = own[id] = own[id] || {}, chunks = {};
      Object.keys(changed || {}).forEach(function (k) {
        var r = C.cleanRow(changed[k]);
        if (!r || !/^\d{1,6}$/.test(k)) return;
        var c = C.chunkOf(+k);
        mine[c] = mine[c] || {};
        mine[c][k] = r;
        chunks[c] = 1;
      });
      // read the file first: another window of this device may have
      // written rows there since (the newer row wins, as everywhere)
      return Promise.all(Object.keys(chunks).map(function (c) {
        var path = d + "/rows-" + dev + "-" + c + ".json";
        return readJson(fs, path).then(function (cur) {
          mine[c] = C.mergeRows([C.readRowsFile(cur, dev, +c), mine[c]]);
          return fs.writeText(path, JSON.stringify(C.rowsFile(dev, mine[c])));
        });
      })).then(function () { return Object.keys(chunks).length; });
    };
    // meta = { name?, out?, tm?, gl? } → this device's meta file (merged with what it had)
    self.saveMeta = function (id, meta) {
      var path = dirOf(id) + "/meta-" + dev + ".json";
      return readJson(fs, path).then(function (cur) {
        var m = C.mergeMeta([cur]), t = now(), o = {};
        if (m.nm) { o.name = m.name; o.nm = m.nm; }
        if (m.om) { o.out = m.out; o.om = m.om; }
        if (m.tmm) { o.tm = m.tm; o.tmm = m.tmm; }
        if (m.glm) { o.gl = m.gl; o.glm = m.glm; }
        if (typeof meta.name === "string") { o.name = meta.name.slice(0, 200); o.nm = Math.max(t, (m.nm || 0) + 1); }
        if (typeof meta.out === "string") { o.out = meta.out.slice(0, 80); o.om = Math.max(t, (m.om || 0) + 1); }
        if (typeof meta.tm === "string") { o.tm = meta.tm.slice(0, 40); o.tmm = Math.max(t, (m.tmm || 0) + 1); }
        if (typeof meta.gl === "string") { o.gl = meta.gl.slice(0, 40); o.glm = Math.max(t, (m.glm || 0) + 1); }
        o.v = 1;
        return fs.writeText(path, JSON.stringify(o));
      });
    };

    // ---- delete: into the Files Trash (FILES-T) ----
    function trashDir(path, name) {
      var t = now(), tid = t.toString(36).padStart(9, "0") + "-" + Math.random().toString(36).slice(2, 8);
      var rec = TRASH + "/" + tid + ".json";
      return fs.writeText(rec, JSON.stringify({ v: 1, path: path, name: name, dir: true, at: t }))
        .then(function () { return fs.mv(path, TRASH + "/" + tid + "/" + name); })
        .catch(function (e) { return fs.rm(rec).catch(function () {}).then(function () { throw e; }); });
    }
    self.trash = function (id) {
      if (!C.ID_RX.test(id)) return Promise.reject(new Error("id"));
      return trashDir(dirOf(id), id).then(function () { delete own[id]; });
    };

    // ---- translation memories (T2) and glossaries (T3) ----
    // <root>/<id>/: <head>.json (written last), meta-<dev>.json (rename),
    // <prefix>-<dev>-<bucket>.json (only this device's items)
    function Coll(o) {
      var mine = {};      // { id: { bucket: { key: item } } }
      function dir(id) { return o.root + "/" + id; }
      function files(id) {
        return ls(fs, dir(id)).then(function (ents) { return ents.filter(function (e) { return !e.dir && o.name(e.name); }); });
      }
      var c = {};
      c.list = function () {
        return ls(fs, o.root).then(function (ents) {
          return Promise.all(ents.filter(function (e) { return e.dir && o.rx.test(e.name); }).map(function (e) {
            var d = dir(e.name);
            return Promise.all([readJson(fs, d + "/" + o.head), ls(fs, d)]).then(function (r) {
              var m = o.readHead(r[0]);
              if (!m || m.id !== e.name) return null;
              var metas = r[1].filter(function (x) { return !x.dir && C.metaName(x.name); });
              return Promise.all(metas.map(function (x) { return readJson(fs, d + "/" + x.name); })).then(function (ms) {
                var mm = C.mergeMeta(ms);
                if (mm.name) m.name = mm.name;
                return m;
              });
            });
          }));
        }).then(function (list) {
          return list.filter(Boolean).sort(function (x, y) { return (x.at - y.at) || (x.id < y.id ? -1 : 1); });
        });
      };
      c.create = function (name) {
        var id = o.newId(now(), Math.random());
        var m = { v: 1, id: id, name: String(name || "").slice(0, 200), at: now() };
        return fs.writeText(dir(id) + "/" + o.head, JSON.stringify(m)).then(function () { mine[id] = {}; return o.readHead(m); });
      };
      c.rename = function (id, name) {
        if (!o.rx.test(id)) return Promise.reject(new Error("id"));
        var path = dir(id) + "/meta-" + dev + ".json";
        return readJson(fs, path).then(function (cur) {
          var m = C.mergeMeta([cur]);
          return fs.writeText(path, JSON.stringify({ v: 1, name: String(name).slice(0, 200), nm: Math.max(now(), (m.nm || 0) + 1) }));
        });
      };
      // → { items: { key: item } over every device, sig }
      c.load = function (id) {
        if (!o.rx.test(id)) return Promise.reject(new Error("id"));
        var d = dir(id);
        return files(id).then(function (ents) {
          return Promise.all(ents.map(function (e) {
            return Promise.all([readJson(fs, d + "/" + e.name), fs.stat(d + "/" + e.name).catch(function () { return null; })])
              .then(function (r) { return { name: e.name, obj: r[0], st: r[1] }; });
          }));
        }).then(function (fl) {
          var maps = [], my = mine[id] = mine[id] || {};
          fl.forEach(function (f) {
            var un = o.name(f.name), u = o.readFile(f.obj, un.dev, un.bucket);
            maps.push(u);
            if (un.dev === dev) my[un.bucket] = o.merge([my[un.bucket], u]);
          });
          Object.keys(my).forEach(function (bk) { maps.push(my[bk]); });
          return { items: o.merge(maps), sig: sigOf(fl) };
        });
      };
      c.sig = function (id) {
        var d = dir(id);
        return files(id).then(function (ents) {
          return Promise.all(ents.map(function (e) {
            return fs.stat(d + "/" + e.name).then(function (st) { return { name: e.name, st: st }; }, function () { return { name: e.name, st: null }; });
          }));
        }).then(sigOf);
      };
      // changed = { key: item } → the buckets they fall in, each file read
      // first (another window of this device), merged, written
      c.save = function (id, changed) {
        if (!o.rx.test(id)) return Promise.reject(new Error("id"));
        var d = dir(id), my = mine[id] = mine[id] || {}, buckets = {};
        Object.keys(changed || {}).forEach(function (k) {
          var u = o.clean(changed[k]);
          if (!u || !TM.KEY_RX.test(k)) return;
          var bk = TM.bucketOf(k);
          my[bk] = my[bk] || {};
          my[bk][k] = u;
          buckets[bk] = 1;
        });
        return Promise.all(Object.keys(buckets).map(function (bk) {
          var path = d + "/" + o.prefix + "-" + dev + "-" + bk + ".json";
          return readJson(fs, path).then(function (cur) {
            my[bk] = o.merge([o.readFile(cur, dev, +bk), my[bk]]);
            return fs.writeText(path, JSON.stringify(o.file(dev, my[bk])));
          });
        })).then(function () { return Object.keys(buckets).length; });
      };
      c.trash = function (id) {
        if (!o.rx.test(id)) return Promise.reject(new Error("id"));
        return trashDir(dir(id), id).then(function () { delete mine[id]; });
      };
      return c;
    }
    var tms = Coll({ root: TMROOT, rx: TM.TM_RX, head: "tm.json", prefix: "units", readHead: TM.readTm, newId: TM.newTmId,
      name: TM.unitsName, readFile: TM.readUnitsFile, file: TM.unitsFile, merge: TM.mergeUnits, clean: TM.cleanUnit });
    self.listTms = tms.list;
    self.createTm = tms.create;
    self.renameTm = tms.rename;
    self.loadTm = function (id) { return tms.load(id).then(function (r) { return { units: r.items, sig: r.sig }; }); };
    self.tmSig = tms.sig;
    self.saveUnits = tms.save;
    self.trashTm = tms.trash;
    if (QA) {
      var gls = Coll({ root: GLROOT, rx: QA.GL_RX, head: "gl.json", prefix: "entries", readHead: QA.readGl, newId: QA.newGlId,
        name: QA.entriesName, readFile: QA.readEntriesFile, file: QA.entriesFile, merge: QA.mergeEntries, clean: QA.cleanEntry });
      self.listGls = gls.list;
      self.createGl = gls.create;
      self.renameGl = gls.rename;
      self.loadGl = function (id) { return gls.load(id).then(function (r) { return { entries: r.items, sig: r.sig }; }); };
      self.glSig = gls.sig;
      self.saveEntries = gls.save;
      self.trashGl = gls.trash;
    }
  }

  var api = { Store: Store, ROOT: ROOT, TMROOT: TMROOT, GLROOT: GLROOT, dirOf: dirOf };
  if (node) module.exports = api;
  else root.WriterCatStore = api;
})(this);
