// ============================================================
// orOS designkit — docstore.js (v1.0.0)
// Documents as files on the orOS disk, one file per document, for
// the designkit apps (Layout first, Atelier next). The app keeps its
// documents in memory as before; this module only reads and writes
// the files, so the document model and its merge stay in model.js.
//   - A file: "<dir>/<name> · <doc id><ext>", its text the app's JSON
//     package { kind, ver, doc } (the same that "Open file" reads), so
//     the file opens anywhere a package opens. The id in the name lets
//     the app find its document again after a rename in Files.
//   - Vault Drive syncs the files (FILES-V); a version changed on two
//     devices comes back as "<name> · <id> (conflict …)<ext>", which
//     the app merges into its document (model.mergeDoc) and then
//     moves to the Trash (parse() tells such a copy apart).
//   - Deleting moves the file to the orOS Trash (the record Files
//     reads, files-core.js), never removes it.
// Pure apart from the disk calls it is handed: no DOM, no storage.
// Exposes window.orosDocStore (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var BAD = /[\\\/:*?"<>|\u0000-\u001f]+/g;
  var SEP = " · ";

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // o: { dir, ext, kind, ver, fs (orosFS), M (model), core (OrosFilesCore) }
  function create(o) {
    var dir = o.dir, ext = o.ext, fs = o.fs, M = o.M, core = o.core;
    var NAME_RE = new RegExp("^(.*)" + esc(SEP) + "([a-z]{1,4}-[a-z0-9]{1,24})( \\(conflict [^)\\/]{1,40}\\))?" + esc(ext) + "$");

    // the file name for a document: its name (cleaned, ≤ 80) and id
    function nameFor(doc) {
      var n = String(doc.name || "").replace(BAD, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/^\.+/, "").trim();
      return (n || "Untitled") + SEP + doc.id + ext;
    }
    function pathFor(doc) { return dir + "/" + nameFor(doc); }
    // → { id, conflict } for a document file name, else null
    function parse(name) {
      var m = NAME_RE.exec(String(name || ""));
      return m && M.isId(m[2]) ? { id: m[2], conflict: !!m[3] } : null;
    }
    function text(doc) { return JSON.stringify({ kind: o.kind, ver: o.ver, doc: doc }); }
    // a package's text → the document (normalized), or null
    function fromText(txt) {
      var pkg = null;
      try { pkg = JSON.parse(txt); } catch (e) { return null; }
      if (!pkg || pkg.kind !== o.kind || pkg.ver !== o.ver || !pkg.doc || !M.isId(pkg.doc.id)) return null;
      return M.normDoc(pkg.doc);
    }
    function blobText(b) {
      if (b == null) return Promise.resolve(null);
      if (typeof b === "string") return Promise.resolve(b);
      return typeof b.text === "function" ? b.text() : Promise.resolve(null);
    }

    function ensureDir() {
      return Promise.resolve(typeof fs.ready === "function" ? fs.ready() : null)
        .then(function () { return fs.mkdir(dir); }).then(null, function () {});
    }
    // every document file in the folder → [{ id, path, conflict }]
    // sorted by path (an absent folder is an empty one)
    function list() {
      return ensureDir().then(function () { return fs.ls(dir); }).then(function (en) {
        var out = [];
        (en || []).forEach(function (e) {
          if (!e || e.dir || typeof e.name !== "string") return;
          var p = parse(e.name);
          if (p) out.push({ id: p.id, path: dir + "/" + e.name, conflict: p.conflict });
        });
        out.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
        return out;
      }, function (e) { if (e && e.code === "ENOENT") return []; throw e; });
    }
    // → Promise of { doc, text } (doc null when the file is not a
    // package of this app); rejects when the disk cannot read it
    function read(path) {
      return fs.read(path).then(blobText).then(function (txt) {
        return { doc: typeof txt === "string" ? fromText(txt) : null, text: txt };
      });
    }
    // Writes doc at its own path; a file of it elsewhere (oldPath,
    // the name changed) is moved there first, so a sync never sees the
    // document gone. verify: read it back and compare. → Promise of
    // the path; rejects when it did not land.
    function write(doc, oldPath, verify) {
      var path = pathFor(doc), txt = text(doc);
      return ensureDir().then(function () {
        if (!oldPath || oldPath === path) return null;
        return fs.stat(path).then(function (st) { return !!st; }, function () { return false; }).then(function (taken) {
          // another file holds the name (a copy put there by hand):
          // keep it, write ours beside it
          if (taken) return null;
          return fs.mv(oldPath, path).then(null, function () { return null; });
        });
      }).then(function () { return fs.write(path, txt); }).then(function () {
        if (!verify) return path;
        return fs.read(path).then(blobText).then(function (back) {
          if (back !== txt) throw new Error("verify");
          return path;
        });
      }).then(function (p) {
        // the old file, when the move above did not take it
        if (!oldPath || oldPath === p) return p;
        return fs.stat(oldPath).then(function (st) { return st ? trash(oldPath) : null; }, function () { return null; }).then(function () { return p; });
      });
    }
    // to the orOS Trash, as Files does it (record first; taken back
    // when the move fails)
    function trash(path) {
      if (!core) return Promise.reject(new Error("notrash"));
      var now = Date.now(), id = core.trashId(now, Math.random().toString(36).slice(2, 10));
      var base = path.slice(path.lastIndexOf("/") + 1);
      return fs.writeText(core.trashMetaPath(id), JSON.stringify(core.makeMeta(path, false, now))).then(function () {
        return fs.mv(path, core.trashItemDir(id) + "/" + base);
      }).then(null, function (e) {
        return fs.rm(core.trashMetaPath(id)).then(null, function () {}).then(function () { throw e; });
      });
    }
    // ids of this app's documents in the orOS Trash (deleted on purpose,
    // here or on another device)
    function trashedIds() {
      if (!core) return Promise.resolve({});
      return fs.ls(core.TRASH).then(function (en) {
        var out = {}, chain = Promise.resolve();
        (en || []).forEach(function (e) {
          if (!e || !e.dir) return;
          chain = chain.then(function () {
            return fs.ls(core.TRASH + "/" + e.name).then(function (items) {
              (items || []).forEach(function (it) { var p = it && !it.dir && parse(it.name); if (p) out[p.id] = 1; });
            }, function () {});
          });
        });
        return chain.then(function () { return out; });
      }, function () { return {}; });
    }

    return {
      dir: dir, nameFor: nameFor, pathFor: pathFor, parse: parse, text: text, fromText: fromText,
      list: list, read: read, write: write, trash: trash, trashedIds: trashedIds
    };
  }

  // ---------- The app's side: its data ↔ the files ----------
  // The app keeps { ver, docs, dt } in memory as before; open() loads
  // it from the files, writes back what changed, and keeps the old
  // synced slice working for devices that still run an older orOS.
  // o: { store, M, ls (localStorage), keys { legacy, index, open },
  //      rescue (file name prefix), fs, entry(doc) → index fields }
  //   - legacy: the old slice's key. Its documents are merged into the
  //     files at every load and every pull (older devices still send
  //     theirs there); this copy never adds documents to it, only the
  //     deletions (dt), so it never grows. Before the first merge its
  //     text goes to /internal/Rescue once (30 days, then the Trash).
  //   - index: a small list for Home-less readers (universal search,
  //     the Assistant): id, m, name, path, setup, pages and the app's
  //     own fields (entry). Device-local, rebuilt at every save.
  //   - open: the open document, written at every save, so the last
  //     edits before the window closes are never only in a pending
  //     disk write; merged back at the next load.
  // A document's file is written when its newest stamp (maxM) moved
  // or a merge brought something in; a document gone from data (dt)
  // moves its file to the Trash.
  var RESCUE_DIR = "/internal/Rescue", RESCUE_DAYS = 30, DAY = 86400000;

  function open(o) {
    var store = o.store, M = o.M, ls = o.ls, K = o.keys, fs = o.fs;
    var known = {};        // id → { path, sig, mm }: what the disk holds
    var force = {};        // id → 1: write even when maxM did not move
    var extra = {};        // id → [paths]: duplicates / conflict copies to trash once written
    var legacy = { ver: 1, docs: [], dt: {} };
    var queue = Promise.resolve(), running = false, again = null, lastFail = 0;
    var entries = {};      // id + ":" + mm → index entry (cache)

    function readJson(k) {
      if (!ls || !k) return null;
      try { var v = ls.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    }
    function writeKey(k, v) {
      if (!ls || !k) return false;
      try { ls.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); return true; } catch (e) { return false; }
    }
    function dtOf(a, b) { return M.mergeData({ docs: [], dt: a || {} }, { docs: [], dt: b || {} }).dt; }
    function sigOf(path) {
      return fs.stat(path).then(function (st) { return st ? (st.size || 0) + ":" + (st.mtime || 0) : ""; }, function () { return ""; });
    }
    function byId(data) { var m = {}; data.docs.forEach(function (d) { m[d.id] = d; }); return m; }

    // the files → { data, failed } (failed: files that could not be read)
    function load() {
      var raw = null;
      try { raw = ls ? ls.getItem(K.legacy) : null; } catch (e) { raw = null; }
      var lg = null;
      try { lg = raw ? JSON.parse(raw) : null; } catch (e) { lg = null; }
      legacy = lg && Array.isArray(lg.docs) ? M.normData(lg) : { ver: 1, docs: [], dt: {} };
      var idx = readJson(K.index), journal = readJson(K.open);
      var docs = {}, failed = 0, conflicts = [];
      return store.list().then(function (list) {
        var chain = Promise.resolve();
        list.forEach(function (e) {
          chain = chain.then(function () {
            return Promise.all([store.read(e.path), sigOf(e.path)]).then(function (r) {
              var doc = r[0].doc;
              if (!doc || doc.id !== e.id) { if (!e.conflict) failed++; return; }
              if (e.conflict) { conflicts.push({ id: e.id, path: e.path, doc: doc }); return; }
              if (docs[e.id]) {
                // two files of one document (a sync brought a renamed
                // copy): one merged document, the other file goes
                docs[e.id] = M.mergeDoc(docs[e.id], doc);
                var keep = store.pathFor(doc) === e.path ? e.path : known[e.id].path;
                (extra[e.id] = extra[e.id] || []).push(keep === e.path ? known[e.id].path : e.path);
                known[e.id].path = keep;
                force[e.id] = 1;
                return;
              }
              docs[e.id] = doc;
              known[e.id] = { path: e.path, sig: r[1], mm: M.maxM(doc), text: r[0].text };
            }, function () { if (!e.conflict) failed++; });
          });
        });
        return chain;
      }).then(function () {
        conflicts.forEach(function (c) {
          docs[c.id] = docs[c.id] ? M.mergeDoc(docs[c.id], c.doc) : c.doc;
          (extra[c.id] = extra[c.id] || []).push(c.path);
          force[c.id] = 1;
        });
        var data = { ver: 1, docs: Object.keys(docs).map(function (id) { return docs[id]; }), dt: dtOf(legacy.dt, idx && idx.dt) };
        data = M.mergeData(data, legacy);
        if (journal && journal.doc && M.isId(journal.doc.id)) data = M.mergeData(data, { docs: [journal.doc], dt: {} });
        // what the files do not hold yet is written
        data.docs.forEach(function (d) {
          var k = known[d.id];
          if (!k || k.text !== store.text(d)) force[d.id] = 1;
        });
        Object.keys(known).forEach(function (id) { delete known[id].text; });
        var rescued = idx && idx.rescued;
        var first = legacy.docs.length && !rescued ? rescue(raw) : Promise.resolve(!!rescued);
        return first.then(function (ok) {
          return persist(data, true).then(function (res) {
            writeIndex(data, ok || rescued);
            return { data: data, failed: failed, wrote: res.wrote, writeFailed: res.failed };
          });
        });
      });
    }

    // the old slice's text, once, before its documents are merged into
    // the files; rescue files older than RESCUE_DAYS go to the Trash
    function rescue(raw) {
      var path = RESCUE_DIR + "/" + o.rescue + "-" + Date.now() + ".json";
      return Promise.resolve(fs.mkdir(RESCUE_DIR)).then(null, function () {})
        .then(function () { return fs.write(path, raw); })
        .then(function () { return true; }, function () { return false; });
    }
    function sweepRescue() {
      var re = new RegExp("^" + o.rescue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d{13})\\.json$"), now = Date.now();
      return fs.ls(RESCUE_DIR).then(function (en) {
        var chain = Promise.resolve();
        (en || []).forEach(function (e) {
          var m = e && !e.dir && re.exec(e.name);
          if (!m || now - Number(m[1]) < RESCUE_DAYS * DAY) return;
          chain = chain.then(function () { return store.trash(RESCUE_DIR + "/" + e.name).then(null, function () {}); });
        });
        return chain;
      }, function () {});
    }

    // Writes what changed (maxM moved, or marked by a merge) and moves
    // the files of documents gone from data to the Trash. One run at a
    // time; a call while one runs is taken by the next run. verify:
    // read each file back (first load). → Promise of { wrote, failed }
    function persist(data, verify) {
      if (running) {
        again = { data: data, verify: verify || (again && again.verify) };
        return queue;
      }
      running = true;
      var res = { wrote: 0, failed: 0 }, have = byId(data);
      var todo = data.docs.filter(function (d) { var k = known[d.id]; return force[d.id] || !k || k.mm !== M.maxM(d); });
      var gone = Object.keys(known).filter(function (id) { return !have[id]; });
      var chain = Promise.resolve();
      todo.forEach(function (d) {
        chain = chain.then(function () {
          var k = known[d.id], mm = M.maxM(d);
          delete force[d.id];
          return store.write(d, k && k.path, verify).then(function (path) {
            return sigOf(path).then(function (sig) {
              known[d.id] = { path: path, sig: sig, mm: mm };
              res.wrote++;
              var ex = extra[d.id];
              delete extra[d.id];
              if (!ex) return;
              return ex.filter(function (p) { return p !== path; }).reduce(function (p2, x) {
                return p2.then(function () { return store.trash(x).then(null, function () {}); });
              }, Promise.resolve());
            });
          }, function () { force[d.id] = 1; res.failed++; lastFail = Date.now(); });
        });
      });
      gone.forEach(function (id) {
        chain = chain.then(function () {
          var k = known[id];
          return store.trash(k.path).then(function () { delete known[id]; }, function (e) {
            if (e && e.code === "ENOENT") delete known[id];
            else res.failed++;
          });
        });
      });
      function done() {
        running = false;
        if (again) { var a = again; again = null; return persist(a.data, a.verify).then(function (r2) { res.wrote += r2.wrote; res.failed += r2.failed; return res; }); }
        return res;
      }
      // whatever happened, the next save can run
      queue = chain.then(done, function () { res.failed++; lastFail = Date.now(); return done(); });
      return queue;
    }

    // The index for search and the Assistant (best effort: a full
    // storage keeps the last one) and the open document.
    function writeIndex(data, rescued) {
      var list = data.docs.map(function (d) {
        var mm = M.maxM(d), key = d.id + ":" + mm, e = entries[key];
        if (!e) {
          e = { id: d.id, m: mm, name: d.name || "", pages: (d.pages || []).length,
                setup: { w: d.setup.w, h: d.setup.h, unit: d.setup.unit } };
          if (d.setup.ext && typeof d.setup.ext.mv === "number") e.setup.ext = { mv: d.setup.ext.mv };
          var more = o.entry ? o.entry(d) : null;
          if (more) Object.keys(more).forEach(function (f) { e[f] = more[f]; });
          entries[key] = e;
        }
        var k = known[d.id];
        return k ? Object.assign({}, e, { path: k.path }) : e;
      });
      var prev = readJson(K.index);
      writeKey(K.index, { ver: 1, rescued: !!(rescued || (prev && prev.rescued)), dt: data.dt, docs: list });
    }
    function journal(doc) {
      if (!ls || !K.open) return;
      if (!doc) { try { ls.removeItem(K.open); } catch (e) {} return; }
      if (!writeKey(K.open, { doc: doc })) { try { ls.removeItem(K.open); } catch (e) {} }
    }
    // an app save: the open document to the journal now, the files and
    // the index after.
    // openDoc: the open document (journaled now); null: none is open
    // (the journal goes once the files hold everything); undefined:
    // the journal stays as it is (a pull)
    function save(data, openDoc) {
      if (openDoc) journal(openDoc);
      return persist(data, false).then(function (res) {
        writeIndex(data);
        if (openDoc === null && !res.failed && !running) journal(null);
        return res;
      });
    }

    // A pull of the old slice (or a backup restored): keep it as the
    // legacy copy and merge its documents in. → { data, changed[ids] }
    function absorb(data, incoming) {
      if (!incoming || !Array.isArray(incoming.docs)) return { data: data, changed: [] };
      legacy = M.normData(incoming);
      writeKey(K.legacy, legacy);
      // only the documents it carries can change (and those a deletion drops)
      var before = byId(data), next = M.mergeData(data, legacy), changed = [];
      var after = byId(next);
      legacy.docs.forEach(function (d) {
        var id = d.id;
        if (!after[id]) return;
        if (!before[id] || JSON.stringify(before[id]) !== JSON.stringify(after[id])) { changed.push(id); force[id] = 1; }
      });
      Object.keys(before).forEach(function (id) { if (!after[id]) changed.push(id); });
      return { data: next, changed: changed };
    }
    // What the old slice carries from here: its documents as they came,
    // and every deletion (so an older device deletes them too).
    function sliceGet(data) { return M.mergeData(legacy, { docs: [], dt: data.dt }); }

    // After Vault changed the disk: files that changed are read and
    // merged, conflict copies merged, a file that vanished is either a
    // deletion made elsewhere (its file is in the Trash: the document
    // goes) or written again (never lost). → Promise of { data, changed[ids] }
    function rescan(data) {
      var mem = byId(data), changed = {}, files = {};
      return store.list().then(function (list) {
        list.forEach(function (e) { (files[e.id] = files[e.id] || []).push(e); });
        var chain = Promise.resolve();
        Object.keys(files).forEach(function (id) {
          var k = known[id], mains = files[id].filter(function (e) { return !e.conflict; });
          // renamed in Files: the file where it is now is the document's
          if (k && mains.length && !mains.some(function (e) { return e.path === k.path; })) k.path = mains[0].path;
          files[id].forEach(function (e) {
            chain = chain.then(function () {
              return sigOf(e.path).then(function (sig) {
                var main = !e.conflict && (!known[id] || known[id].path === e.path);
                if (main && known[id] && known[id].sig === sig) return;
                return store.read(e.path).then(function (r) {
                  var doc = r.doc;
                  if (!doc || doc.id !== id) return;
                  var cur = mem[id], merged = cur ? M.mergeDoc(cur, doc) : doc;
                  if (!cur || JSON.stringify(cur) !== JSON.stringify(merged)) { mem[id] = merged; changed[id] = 1; }
                  if (main) {
                    known[id] = { path: e.path, sig: sig, mm: M.maxM(doc) };
                    if (r.text !== store.text(merged)) force[id] = 1;
                  } else {
                    // a conflict copy or a second file: merged, then trashed
                    // once the document is written
                    (extra[id] = extra[id] || []).push(e.path);
                    force[id] = 1;
                  }
                }, function () {});
              });
            });
          });
        });
        return chain;
      }).then(function () {
        var lost = Object.keys(known).filter(function (id) { return !files[id] && mem[id]; });
        return lost.length ? store.trashedIds() : {};
      }).then(function (trashed) {
        var dt = {}, nw = Date.now();
        Object.keys(known).forEach(function (id) {
          if (files[id] || !mem[id]) return;
          // deleted on purpose elsewhere, and nothing here is newer than the file
          if (trashed[id] && !force[id] && known[id].mm === M.maxM(mem[id])) { dt[id] = Math.max(nw, M.maxM(mem[id])); delete known[id]; changed[id] = 1; }
          else force[id] = 1;     // vanished without a trace, or changed here since: written again
        });
        var docs = Object.keys(mem).map(function (id) { return mem[id]; });
        var next = M.mergeData({ docs: docs, dt: data.dt }, { docs: [], dt: dt });
        return { data: next, changed: Object.keys(changed) };
      });
    }

    return {
      load: load, save: save, persist: persist, absorb: absorb, sliceGet: sliceGet, rescan: rescan,
      sweepRescue: sweepRescue, writeIndex: writeIndex, journal: journal,
      idle: function () { return queue; }, failedAt: function () { return lastFail; },
      pathOf: function (id) { return known[id] ? known[id].path : null; }
    };
  }

  var api = { create: create, open: open, SEP: SEP };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.orosDocStore = api;
})(this);
