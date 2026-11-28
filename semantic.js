// ============================================================
// orOS — semantic.js (search by meaning, runtime, v1.0.0)
// ------------------------------------------------------------
// "Search by meaning" (MEANING-1): the shell's search also finds
// notes, mail, documents and articles that say the same thing in
// other words, in Greek, English, German and ~100 other languages.
// The model is multilingual-e5-small (MIT; int8 ONNX export by
// Xenova, Apache-2.0) on the device:
//   - off until the person turns it on in Settings › Language &
//     search; then the runtime (vendor/ort on this site, ~11 MB) and
//     the model (~130 MB, our copy koulaxizis/oros-models-vision on
//     GitHub Pages, the model in two parts) are fetched ONCE through
//     modelfetch.js, checked against the SHA-256 written below and
//     kept in IndexedDB "oros-meaning" (store "files")
//   - the index: for every item of the apps in APPS, 1–3 vectors of
//     384 numbers (384 bytes each) and a hash of its text, in the
//     same database (store "vecs"), keyed "<app>\n<item id>". Built
//     a few items at a time while the page is visible and idle; an
//     item is embedded again only when its text changes. Never
//     synced, never in the service worker's precache, in the factory
//     reset list (shell.js). Texts never leave the device.
//   - the switch is device-local: localStorage "oros-meaning-prefs"
//     { on: true } (not an oros-*-data key, so never synced)
// API (window.orosMeaning, Promises):
//   APPS, MB                     which apps, download size in MB
//   on() → bool                  the switch
//   ready() → bool               every file on this device
//   install(progress(f), cancelled()) → true  (turns it on; errors
//                                 .code download | hash | quota | cancelled)
//   remove() → true              files, index and the switch
//   count() → number             items in the index
//   sync(lists) → { added, removed, left }   lists = [{ id: app, hits }]
//                                 (the providers' every-item answers);
//                                 one call does at most BATCH_MAX items
//   search(q, appIds) → [{ app, k, s }]   best first (semantic-core rank)
//   busy() → bool                a sync is running
// Needs semantic-core.js (OrosSemanticCore) and modelfetch.js
// (OrosModelFetch) loaded first; semantic-worker.js runs the model.
// ============================================================
(function (root) {
  "use strict";

  var CORE = root.OrosSemanticCore, FETCH = root.OrosModelFetch;
  if (!CORE || !FETCH) return;
  var SELF_V = (function () {
    var s = root.document && root.document.currentScript, m = s && /\?v=[^#]*/.exec(s.src || "");
    return m ? m[0] : "";
  })();

  var APPS = ["notes", "mail", "files", "feeds"];
  var PREFS_KEY = "oros-meaning-prefs";
  var MIRROR = "https://koulaxizis.github.io/oros-models-vision/multilingual-e5-small/";
  var VER = "e5s-q8-1";              // a new value fetches the model again
  var RT_VER = "ort1.22.0";
  // size = bytes, sha = SHA-256 (from oros-models-vision index.json, pinned 761b726d)
  var FILES = {
    model: { url: MIRROR + "onnx/model_quantized.onnx", v: VER, size: 118308185,
             sha: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
             parts: [
               { size: 95000000, sha: "5c0910dc67c8e11fd0b05f871a0b5050bf0520a038d48152ae489bbf8a1a02ba" },
               { size: 23308185, sha: "2c4265ec38dbf2236e01747e2ececd67fad7e257e6474dc6b6b25cc63c1748c6" }
             ] },
    tok:   { url: MIRROR + "tokenizer.json", v: VER, size: 17082730,
             sha: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39" },
    js:    { url: "vendor/ort/ort.wasm.min.js", v: RT_VER },
    mjs:   { url: "vendor/ort/ort-wasm-simd-threaded.mjs", v: RT_VER },
    wasm:  { url: "vendor/ort/ort-wasm-simd-threaded.wasm", v: RT_VER }
  };
  var IDX = "1|";                    // index format: a new value makes every entry again
  var RUNTIME_BYTES = 11300000;
  var BATCH = 4;                     // passages per model run
  var BATCH_MAX = 60;                // items per sync() call
  var MODEL_BYTES = FETCH.bytes(FILES.model) + FILES.tok.size;
  var MB = Math.round((MODEL_BYTES + RUNTIME_BYTES) / 1048576);

  function err(code) { var e = new Error(code); e.code = code; return e; }

  // ---------- the switch ----------
  function on() {
    try { var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); return !!(p && p.on === true); }
    catch (e) { return false; }
  }
  function setOn(v) {
    try {
      if (v) localStorage.setItem(PREFS_KEY, JSON.stringify({ on: true }));
      else localStorage.removeItem(PREFS_KEY);
    } catch (e) { /* private mode: stays off */ }
  }

  // ---------- IndexedDB ----------
  var DB_NAME = "oros-meaning", dbP = null;
  function db() {
    if (!dbP) {
      dbP = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames.contains("files")) d.createObjectStore("files");
          if (!d.objectStoreNames.contains("vecs")) d.createObjectStore("vecs");
        };
        req.onsuccess = function () { var d = req.result; d.onversionchange = function () { d.close(); dbP = null; }; resolve(d); };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () { reject(new Error("blocked")); };
      });
      dbP.catch(function () { dbP = null; });
    }
    return dbP;
  }
  function tx(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(store, mode), res, r = fn(t.objectStore(store));
        if (r) r.onsuccess = function () { res = r.result; };
        t.oncomplete = function () { resolve(res); };
        t.onerror = t.onabort = function () {
          var e = t.error || new Error("idb");
          reject(e && e.name === "QuotaExceededError" ? err("quota") : e);
        };
      });
    });
  }
  function stored(k) {
    return tx("files", "readonly", function (s) { return s.get(k); }).then(function (rec) {
      return rec && rec.v === FILES[k].v && rec.blob instanceof Blob ? rec.blob : null;
    }, function () { return null; });
  }
  function ready() {
    return Promise.all(Object.keys(FILES).map(stored)).then(function (l) { return l.every(Boolean); }, function () { return false; });
  }

  // ---------- install / remove ----------
  function install(progress, cancelled) {
    var total = MODEL_BYTES + RUNTIME_BYTES, done = 0;
    function onBytes(n) { done += n; if (progress) progress(Math.min(0.99, done / total)); }
    return Object.keys(FILES).reduce(function (p, k) {
      return p.then(function () {
        if (cancelled && cancelled()) throw err("cancelled");
        return stored(k).then(function (b) {
          if (b) { onBytes(b.size); return null; }
          return FETCH.get(FILES[k], { onBytes: onBytes, cancelled: cancelled }).then(function (blob) {
            return tx("files", "readwrite", function (s) { s.put({ v: FILES[k].v, blob: blob }, k); });
          });
        });
      });
    }, Promise.resolve()).then(function () {
      setOn(true);
      if (progress) progress(1);
      return true;
    });
  }
  function remove() {
    setOn(false);
    stopWorker();
    mem = null;
    var close = dbP ? dbP.then(function (d) { d.close(); }, function () {}) : Promise.resolve();
    dbP = null;
    return close.then(function () {
      return new Promise(function (resolve) {
        try {
          var req = indexedDB.deleteDatabase(DB_NAME);
          req.onsuccess = req.onerror = req.onblocked = function () { resolve(true); };
        } catch (e) { resolve(true); }
      });
    });
  }

  // ---------- worker ----------
  var worker = null, wid = 0, waiting = {}, loaded = null;
  function stopWorker() {
    if (worker) { try { worker.terminate(); } catch (e) { /* gone */ } }
    worker = null; loaded = null;
    Object.keys(waiting).forEach(function (id) { waiting[id].reject(err("stopped")); });
    waiting = {};
  }
  function call(msg) {
    return new Promise(function (resolve, reject) {
      msg.id = ++wid;
      waiting[msg.id] = { resolve: resolve, reject: reject };
      worker.postMessage(msg);
    });
  }
  function boot() {
    if (loaded) return loaded;
    loaded = Promise.all(Object.keys(FILES).map(function (k) {
      return stored(k).then(function (b) { if (!b) throw err("not-installed"); return [k, b]; });
    })).then(function (pairs) {
      var f = {};
      pairs.forEach(function (p) { f[p[0]] = p[1]; });
      worker = new Worker("semantic-worker.js" + SELF_V);
      worker.onmessage = function (e) {
        var m = e.data || {}, w = waiting[m.id];
        if (!w) return;
        delete waiting[m.id];
        if (m.ok) w.resolve(m); else w.reject(new Error(m.error || "worker"));
      };
      worker.onerror = function () { stopWorker(); };
      return fetch("semantic-core.js" + SELF_V, { credentials: "same-origin" }).then(function (r) {
        if (!r.ok) throw err("download");
        return r.blob();
      }).then(function (core) {
        return call({ op: "load", js: f.js, mjs: f.mjs, wasm: f.wasm, core: core, tok: f.tok, model: f.model });
      });
    });
    loaded.catch(function () { stopWorker(); });
    return loaded;
  }
  function embed(texts) {
    return boot().then(function () { return call({ op: "embed", texts: texts }); }).then(function (m) { return m.vecs; });
  }

  // ---------- the index ----------
  // mem: Map "<app>\n<id>" → { h, v: [Int8Array] }, read once per session.
  var mem = null, memP = null;
  function all() {
    if (mem) return Promise.resolve(mem);
    if (!memP) {
      memP = db().then(function (d) {
        return new Promise(function (resolve, reject) {
          var out = new Map(), t = d.transaction("vecs", "readonly"), req = t.objectStore("vecs").openCursor();
          req.onsuccess = function () {
            var c = req.result;
            if (!c) return;
            var r = c.value;
            if (r && typeof r.h === "string" && Array.isArray(r.v)) out.set(String(c.key), r);
            c.continue();
          };
          t.oncomplete = function () { resolve(out); };
          t.onerror = t.onabort = function () { reject(t.error || new Error("idb")); };
        });
      }).then(function (m) { mem = m; memP = null; return m; }, function (e) { memP = null; throw e; });
    }
    return memP;
  }
  function count() { return on() ? all().then(function (m) { return m.size; }, function () { return 0; }) : Promise.resolve(0); }
  function key(app, id) { return app + "\n" + id; }

  var syncing = false;
  function idle() {
    return new Promise(function (resolve) {
      var go = function () {
        if (root.document && root.document.hidden) { setTimeout(go, 2000); return; }
        if (typeof root.requestIdleCallback === "function") root.requestIdleCallback(function () { resolve(); }, { timeout: 1500 });
        else setTimeout(resolve, 50);
      };
      go();
    });
  }
  function sync(lists) {
    if (!on() || syncing) return Promise.resolve({ added: 0, removed: 0, left: 0 });
    syncing = true;
    var added = 0, removed = 0;
    return all().then(function (m) {
      var want = new Map(), todo = [];
      (lists || []).forEach(function (g) {
        if (!g || APPS.indexOf(g.id) < 0 || !Array.isArray(g.hits)) return;
        g.hits.forEach(function (h) {
          if (!h || h.id == null) return;
          var ps = CORE.passages(h);
          if (!ps.length) return;
          var k = key(g.id, String(h.id)), hs = CORE.hash(IDX + ps.join("\n"));
          want.set(k, true);
          var have = m.get(k);
          if (!have || have.h !== hs) todo.push({ k: k, h: hs, ps: ps });
        });
      });
      // Apps that did not answer this time keep their entries.
      var asked = {};
      (lists || []).forEach(function (g) { if (g && Array.isArray(g.hits)) asked[g.id] = true; });
      var gone = [];
      m.forEach(function (_, k) {
        var app = k.slice(0, k.indexOf("\n"));
        if ((asked[app] && !want.has(k)) || APPS.indexOf(app) < 0) gone.push(k);
      });
      var del = gone.length ? tx("vecs", "readwrite", function (s) { gone.forEach(function (k) { s.delete(k); }); })
        .then(function () { gone.forEach(function (k) { m.delete(k); }); removed = gone.length; }) : Promise.resolve();
      var left = Math.max(0, todo.length - BATCH_MAX);
      todo = todo.slice(0, BATCH_MAX);
      function step(i) {
        if (i >= todo.length || !on()) return Promise.resolve();
        var items = [], texts = [];
        while (i < todo.length && texts.length < BATCH) { items.push(todo[i]); texts = texts.concat(todo[i].ps); i++; }
        return idle().then(function () { return embed(texts); }).then(function (vecs) {
          var at = 0, recs = items.map(function (it) {
            var v = vecs.slice(at, at + it.ps.length).map(CORE.pack);
            at += it.ps.length;
            return { k: it.k, r: { h: it.h, v: v } };
          });
          return tx("vecs", "readwrite", function (s) { recs.forEach(function (x) { s.put(x.r, x.k); }); }).then(function () {
            recs.forEach(function (x) { m.set(x.k, x.r); });
            added += recs.length;
          });
        }).then(function () { return step(i); });
      }
      return del.then(function () { return step(0); }).then(function () {
        return { added: added, removed: removed, left: left };
      });
    }).then(function (r) { syncing = false; return r; }, function (e) { syncing = false; throw e; });
  }

  function search(q, appIds) {
    if (!on()) return Promise.resolve([]);
    var allow = {};
    (Array.isArray(appIds) ? appIds : APPS).forEach(function (id) { allow[id] = true; });
    return all().then(function (m) {
      var entries = [];
      m.forEach(function (r, k) {
        var app = k.slice(0, k.indexOf("\n"));
        if (allow[app]) entries.push({ k: k, v: r.v });
      });
      if (!entries.length) return [];
      return embed([CORE.query(q)]).then(function (vecs) {
        return CORE.rank(vecs[0], entries).map(function (x) {
          var at = x.k.indexOf("\n");
          return { app: x.k.slice(0, at), k: x.k.slice(at + 1), s: x.s };
        });
      });
    });
  }

  root.orosMeaning = {
    APPS: APPS.slice(), MB: MB,
    on: on, ready: ready, install: install, remove: remove, count: count,
    sync: sync, search: search, busy: function () { return syncing; }
  };
})(typeof window !== "undefined" ? window : globalThis);
