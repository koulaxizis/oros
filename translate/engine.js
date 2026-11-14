// ============================================================
// orOS translation engine (translate/engine.js, v1.0.0)
// Translation on the device with Mozilla's Firefox Translations
// models and the Bergamot translator (both MPL-2.0). Any app frame
// loads this file (<script src="../translate/engine.js">) and gets
// window.OrosTranslate; Text Tools has the screen for it, Writer uses
// it for machine suggestions (shared engine, Bible "TRANSLATE").
//   - nothing is downloaded until the person asks: then the runtime
//     (vendor/bergamot on this site, ~5 MB, once) and the pair's model
//     (~15 MB per direction, from our own copy on GitHub Pages,
//     koulaxizis/oros-models) are fetched, unpacked, checked against
//     the SHA-256 written below and kept in IndexedDB "oros-translate"
//     (never synced, never in the service worker's precache)
//   - the text never leaves the device
//   - languages without a direct model go through English (two models)
// API (every call returns a Promise; errors carry .code):
//   pairs()            → [{ from, to }] the directions this build knows
//   languages()        → ["el", "en"]
//   route(from, to)    → ["el-en"] | ["el-en", "en-de"] | [] (same) | null
//   status(from, to)   → { ok, legs, need: [legs], mb }  (mb = still to download)
//   installed()        → [{ pair, mb }]
//   install(from, to, { progress(f), cancelled() }) → true
//   remove(pair)       → true (the runtime goes with the last pair)
//   detect(text)       → "el" | "en"
//   translate(text, { from, to, progress, cancelled }) → { text, engine }
//   translateMany(segments, { from, to, progress(done, total), cancelled })
//                      → [{ text, engine, tagsOk }] in order
// Inline tags: ⟦1⟧…⟦/1⟧ and ⟦2/⟧ (Writer) are kept: they go to
// Bergamot as HTML and come back; tagsOk says whether every tag came
// back exactly once. Error codes: unsupported, pair, not-installed,
// download, hash, quota, cancelled, engine.
// The pure helpers are exported for the tests (Node).
// ============================================================
(function (root) {
  "use strict";

  var MIRROR = "https://koulaxizis.github.io/oros-models/translate/";
  var RUNTIME_VER = "bergamot-0.4.9";
  var RUNTIME = {
    glue: { n: "bergamot-translator-worker.js", size: 80474 },
    wasm: { n: "bergamot-translator-worker.wasm", size: 5174294 }
  };
  // Mozilla's released models (Remote Settings "translations-models";
  // registry models.json), copied unchanged to MIRROR/<pair>/<v>/.
  // size = unpacked bytes, gz = download bytes, sha = SHA-256 unpacked.
  var MODELS = {
    "el-en": { v: "spring-2024_RJucgx7LRMKB9E4oSSzdtA", files: {
      model: { n: "model.elen.intgemm.alphas.bin", size: 17141051, gz: 12696541, sha: "0a43c3716156061494d995d0c88113e789f8d919e0c88a15bc1ad360e0482a8c" },
      lex:   { n: "lex.50.50.elen.s2t.bin", size: 4295860, gz: 1851246, sha: "2c969b069b3d230feddd17db2d74eb658a9b33b960d2d40adbca5496c9784e85" },
      vocab: { n: "vocab.elen.spm", size: 894960, gz: 419174, sha: "e1a1298cc2cf3968f3d7cc3b36bc463a4e1bf154272e8fb2f15142b54edc4349" } } },
    "en-el": { v: "spring-2024_Y3ThG3XkTxG4ROUQK2LpVg", files: {
      model: { n: "model.enel.intgemm.alphas.bin", size: 17141051, gz: 12808027, sha: "724b358d399c6b23444de36d76e9e2630c7024c29d9e617323b820a11631535a" },
      lex:   { n: "lex.50.50.enel.s2t.bin", size: 2856724, gz: 1352643, sha: "c2acd9241eb8a1e5b13a43efa5723628839d6e3b3dc7b93e2f20990a6ab81e24" },
      vocab: { n: "vocab.enel.spm", size: 896168, gz: 419275, sha: "0ffc5569d7f400f03539c5fc3e28ff35f1d0381eba0ec866c44aef0c26f3ce5e" } } }
  };
  var PIVOT = "en";
  var CHUNK = 16;                  // segments per worker call (progress, cancel)
  var IDLE_MS = 120000;            // the worker (and its memory) goes after this
  var MB = 1024 * 1024;

  // ---------- Pure helpers ----------
  function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }

  function languages() {
    var seen = {}, out = [];
    Object.keys(MODELS).forEach(function (p) {
      p.split("-").forEach(function (l) { if (!seen[l]) { seen[l] = 1; out.push(l); } });
    });
    return out.sort();
  }
  function pairs() {
    var langs = languages(), out = [];
    langs.forEach(function (a) {
      langs.forEach(function (b) { if (a !== b && route(a, b)) out.push({ from: a, to: b }); });
    });
    return out;
  }
  // The models a direction needs, in order; [] for the same language.
  function route(from, to) {
    if (from === to) return [];
    if (MODELS[from + "-" + to]) return [from + "-" + to];
    if (from !== PIVOT && to !== PIVOT && MODELS[from + "-" + PIVOT] && MODELS[PIVOT + "-" + to]) {
      return [from + "-" + PIVOT, PIVOT + "-" + to];
    }
    return null;
  }
  function pairBytes(pair, key) {
    var f = MODELS[pair].files;
    return Object.keys(f).reduce(function (s, k) { return s + f[k][key || "gz"]; }, 0);
  }
  function runtimeBytes() { return RUNTIME.glue.size + RUNTIME.wasm.size; }

  // Greek or English, by the share of Greek letters among all letters.
  var GREEK_RE = /[Ͱ-Ͽἀ-῿]/g, LETTER_RE = /[A-Za-zÀ-ɏͰ-Ͽἀ-῿Ѐ-ӿ]/g;
  function detect(text) {
    var s = String(text || "").slice(0, 5000);
    var g = (s.match(GREEK_RE) || []).length, all = (s.match(LETTER_RE) || []).length;
    return all && g / all >= 0.3 ? "el" : "en";
  }

  // Lines with their breaks: [{ text, br }]; joining them gives the input back.
  function splitLines(text) {
    var out = [], re = /\r\n|\n|\r/g, last = 0, m;
    text = String(text || "");
    while ((m = re.exec(text))) { out.push({ text: text.slice(last, m.index), br: m[0] }); last = re.lastIndex; }
    out.push({ text: text.slice(last), br: "" });
    return out;
  }
  // Leading and trailing white space stays where it was; only the core
  // of a line is translated.
  function trimParts(s) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    return { pre: m[1], core: m[2], post: m[3] };
  }

  function escHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  function unescHtml(s) {
    return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, function (all, e) {
      if (e[0] === "#") {
        var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
      }
      var k = e.toLowerCase();
      return ENT.hasOwnProperty(k) ? ENT[k] : all;
    });
  }
  // ⟦n⟧ ⟦/n⟧ ⟦n/⟧ ↔ <tn> </tn> <vn></vn>
  var TAG_RE = /⟦(\/?)(\d{1,4})(\/?)⟧/g;
  function hasTags(s) { TAG_RE.lastIndex = 0; return TAG_RE.test(s); }
  function tagSig(s) {
    var out = [];
    String(s).replace(TAG_RE, function (all, c, n, v) { out.push((c ? "/" : "") + n + (v ? "/" : "")); return all; });
    return out.sort().join(",");
  }
  function toHtml(s) {
    return escHtml(s).replace(TAG_RE, function (all, c, n, v) {
      if (v) return "<v" + n + "></v" + n + ">";
      return c ? "</t" + n + ">" : "<t" + n + ">";
    });
  }
  function fromHtml(s) {
    s = s.replace(/<v(\d{1,4})\s*\/?>(\s*<\/v\1>)?/g, function (all, n) { return "⟦" + n + "/⟧"; })
         .replace(/<(\/?)t(\d{1,4})>/g, function (all, c, n) { return "⟦" + c + n + "⟧"; })
         .replace(/<\/?[a-z][^>]*>/gi, "");
    return unescHtml(s);
  }
  // What goes to Bergamot for one segment: null = nothing to translate.
  function prepare(seg) {
    var p = trimParts(String(seg == null ? "" : seg));
    if (!/[0-9A-Za-z\u00aa\u00b5\u00ba\u00c0-\u1fff\u3040-\uffef]/.test(p.core)) return { pre: p.pre, core: p.core, post: p.post, skip: true };
    var html = hasTags(p.core);
    return { pre: p.pre, core: p.core, post: p.post, html: html, send: html ? toHtml(p.core) : p.core };
  }
  function finish(prep, out) {
    if (prep.skip) return { text: prep.pre + prep.core + prep.post, tagsOk: true };
    var core = prep.html ? fromHtml(out) : out;
    return { text: prep.pre + core + prep.post, tagsOk: tagSig(core) === tagSig(prep.core) };
  }

  var pure = {
    MODELS: MODELS, RUNTIME: RUNTIME, MIRROR: MIRROR, languages: languages, pairs: pairs, route: route,
    pairBytes: pairBytes, runtimeBytes: runtimeBytes, detect: detect, splitLines: splitLines,
    trimParts: trimParts, toHtml: toHtml, fromHtml: fromHtml, tagSig: tagSig, prepare: prepare,
    finish: finish, unescHtml: unescHtml
  };
  if (typeof module === "object" && module.exports) { module.exports = pure; return; }

  // ---------- Browser: files (IndexedDB) ----------
  var BASE = (function () {
    var src = (document.currentScript && document.currentScript.src) || location.href;
    return new URL("../", src).href;               // the orOS root
  })();
  var DB_NAME = "oros-translate", dbP = null;
  function db() {
    if (!dbP) {
      dbP = new Promise(function (resolve, reject) {
        if (!root.indexedDB) { reject(err("unsupported", "indexedDB")); return; }
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files"); };
        req.onsuccess = function () { var d = req.result; d.onversionchange = function () { d.close(); dbP = null; }; resolve(d); };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () { reject(new Error("blocked")); };
      });
      dbP.catch(function () { dbP = null; });
    }
    return dbP;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("files", mode), res, r = fn(t.objectStore("files"));
        if (r) r.onsuccess = function () { res = r.result; };
        t.oncomplete = function () { resolve(res); };
        t.onerror = t.onabort = function () {
          var e = t.error || new Error("idb");
          reject(e && e.name === "QuotaExceededError" ? err("quota") : e);
        };
      });
    });
  }
  function keyOf(pair, k) { return pair + ":" + k; }
  function verOf(pair) { return pair === "runtime" ? RUNTIME_VER : MODELS[pair].v; }
  function partsOf(pair) { return Object.keys(pair === "runtime" ? RUNTIME : MODELS[pair].files); }
  function stored(pair, k) {
    return tx("readonly", function (s) { return s.get(keyOf(pair, k)); }).then(function (rec) {
      return rec && rec.v === verOf(pair) && rec.blob instanceof Blob ? rec.blob : null;
    }, function () { return null; });
  }
  function have(pair) {
    return Promise.all(partsOf(pair).map(function (k) { return stored(pair, k); }))
      .then(function (l) { return l.every(Boolean); });
  }
  function supported() {
    return !!(root.WebAssembly && root.Worker && root.indexedDB && root.DecompressionStream &&
              root.crypto && root.crypto.subtle && root.TextDecoder);
  }

  function fetchBlob(url, onBytes, cancelled) {
    var ctl = root.AbortController ? new AbortController() : null;
    var timer = setInterval(function () { if (cancelled && cancelled() && ctl) ctl.abort(); }, 300);
    return fetch(url, { cache: "no-cache", credentials: "omit", signal: ctl ? ctl.signal : undefined }).then(function (res) {
      if (!res.ok) throw err("download", "http " + res.status);
      if (!res.body || !res.body.getReader) return res.blob().then(function (b) { onBytes(b.size); return b; });
      var reader = res.body.getReader(), parts = [];
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return new Blob(parts);
          parts.push(r.value); onBytes(r.value.byteLength);
          return pump();
        });
      }
      return pump();
    }).then(function (b) { clearInterval(timer); return b; }, function (e) {
      clearInterval(timer);
      if (cancelled && cancelled()) throw err("cancelled");
      throw e && e.code ? e : err("download", String(e && e.message || e));
    });
  }
  // A host that already undid the gzip (Content-Encoding) hands the
  // plain file over: only bytes that start like gzip are unpacked.
  function gunzip(blob) {
    return blob.slice(0, 2).arrayBuffer().then(function (h) {
      var b = new Uint8Array(h);
      if (b[0] !== 0x1f || b[1] !== 0x8b) return blob.arrayBuffer();
      return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    });
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function getPart(pair, k, onBytes, cancelled) {
    if (pair === "runtime") {
      return fetchBlob(BASE + "vendor/bergamot/" + RUNTIME[k].n, onBytes, cancelled);
    }
    var M = MODELS[pair], f = M.files[k];
    return fetchBlob(MIRROR + pair + "/" + M.v + "/" + f.n + ".gz", onBytes, cancelled).then(function (gz) {
      return gunzip(gz).then(function (buf) {
        if (buf.byteLength !== f.size) throw err("hash", f.n);
        return crypto.subtle.digest("SHA-256", buf).then(function (h) {
          if (hex(h) !== f.sha) throw err("hash", f.n);
          return new Blob([buf]);
        });
      }, function (e) { throw e && e.code ? e : err("hash", f.n); });
    });
  }

  // ---------- Status, install, remove ----------
  function status(from, to) {
    var legs = route(from, to);
    if (!legs) return Promise.resolve({ ok: false, legs: null, need: [], mb: 0 });
    var all = legs.length ? legs.concat(["runtime"]) : [];
    return Promise.all(all.map(have)).then(function (h) {
      var need = all.filter(function (p, i) { return !h[i]; }), bytes = 0;
      need.forEach(function (p) { bytes += p === "runtime" ? runtimeBytes() : pairBytes(p); });
      return { ok: !need.length, legs: legs, need: need, mb: Math.ceil(bytes / MB) };
    });
  }
  function installed() {
    var list = Object.keys(MODELS);
    return Promise.all(list.map(have)).then(function (h) {
      return list.filter(function (p, i) { return h[i]; }).map(function (p) {
        return { pair: p, mb: Math.ceil(pairBytes(p, "size") / MB) };
      });
    });
  }
  var installing = null;
  function install(from, to, opts) {
    opts = opts || {};
    if (!supported()) return Promise.reject(err("unsupported"));
    if (installing) return Promise.reject(err("engine", "busy"));
    var progress = opts.progress || function () {}, cancelled = opts.cancelled || function () { return false; };
    installing = status(from, to).then(function (st) {
      if (!st.legs) throw err("pair");
      var total = 0, done = 0;
      st.need.forEach(function (p) { total += p === "runtime" ? runtimeBytes() : pairBytes(p); });
      return st.need.reduce(function (chain, pair) {
        return chain.then(function () {
          return partsOf(pair).reduce(function (c, k) {
            return c.then(function () {
              return stored(pair, k).then(function (b) {
                var size = pair === "runtime" ? RUNTIME[k].size : MODELS[pair].files[k].gz;
                if (b) { done += size; progress(total ? done / total : 1); return; }
                var base = done;
                return getPart(pair, k, function (n) {
                  done += n; progress(Math.min(0.99, done / total));
                }, cancelled).then(function (blob) {
                  done = base + size;
                  if (cancelled()) throw err("cancelled");
                  return tx("readwrite", function (s) { s.put({ v: verOf(pair), blob: blob }, keyOf(pair, k)); });
                });
              });
            });
          }, Promise.resolve());
        });
      }, Promise.resolve()).then(function () { progress(1); return true; });
    });
    var p = installing;
    installing.then(function () { installing = null; }, function () { installing = null; });
    return p;
  }
  function remove(pair) {
    if (!MODELS[pair]) return Promise.reject(err("pair"));
    stopWorker();
    return tx("readwrite", function (s) {
      partsOf(pair).forEach(function (k) { s.delete(keyOf(pair, k)); });
    }).then(installed).then(function (left) {
      if (left.length) return true;
      return tx("readwrite", function (s) { partsOf("runtime").forEach(function (k) { s.delete(keyOf("runtime", k)); }); })
        .then(function () { return true; });
    });
  }

  // ---------- The worker ----------
  var worker = null, wseq = 0, wpend = {}, loaded = {}, idleTimer = null, workerReady = null;
  function stopWorker() {
    clearTimeout(idleTimer);
    if (worker) { try { worker.terminate(); } catch (e) {} }
    worker = null; workerReady = null; loaded = {};
    Object.keys(wpend).forEach(function (id) { wpend[id].reject(err("engine", "stopped")); });
    wpend = {};
  }
  function call(op, msg, transfer) {
    return new Promise(function (resolve, reject) {
      var id = ++wseq;
      msg.id = id; msg.op = op;
      wpend[id] = { resolve: resolve, reject: reject };
      try { worker.postMessage(msg, transfer || []); }
      catch (e) { delete wpend[id]; reject(err("engine", String(e && e.message || e))); }
    });
  }
  function startWorker() {
    if (workerReady) return workerReady;
    try { worker = new Worker(BASE + "translate/worker.js"); }
    catch (e) { return Promise.reject(err("unsupported", "worker")); }
    worker.onmessage = function (e) {
      var m = e.data || {}, p = wpend[m.id];
      if (!p) return;
      delete wpend[m.id];
      if (m.ok) p.resolve(m.result); else p.reject(err("engine", m.error));
    };
    worker.onerror = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      stopWorker();
    };
    workerReady = Promise.all([stored("runtime", "glue"), stored("runtime", "wasm")]).then(function (r) {
      if (!r[0] || !r[1]) throw err("not-installed");
      return r[1].arrayBuffer().then(function (wasm) {
        return call("init", { glue: r[0], wasm: wasm }, [wasm]);
      });
    });
    workerReady.catch(function () { stopWorker(); });
    return workerReady;
  }
  function loadLeg(pair) {
    if (loaded[pair]) return loaded[pair];
    loaded[pair] = Promise.all(partsOf(pair).map(function (k) { return stored(pair, k); })).then(function (b) {
      if (!b.every(Boolean)) throw err("not-installed");
      return Promise.all(b.map(function (x) { return x.arrayBuffer(); }));
    }).then(function (buf) {
      var names = partsOf(pair), msg = { pair: pair };
      names.forEach(function (k, i) { msg[k] = buf[i]; });
      return call("load", msg, buf);
    });
    loaded[pair].catch(function () { delete loaded[pair]; });
    return loaded[pair];
  }
  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stopWorker, IDLE_MS);
  }

  // One job at a time: a chapter and a line from another place wait in turn.
  var queue = Promise.resolve();
  function serial(fn) {
    var p = queue.then(fn, fn);
    queue = p.then(function () {}, function () {});
    return p;
  }

  function translateMany(segments, opts) {
    opts = opts || {};
    var list = Array.isArray(segments) ? segments : [];
    var from = opts.from, to = opts.to;
    var progress = opts.progress || function () {}, cancelled = opts.cancelled || function () { return false; };
    var legs = route(from, to);
    if (!legs) return Promise.reject(err("pair"));
    var prep = list.map(prepare);
    if (!legs.length) {
      return Promise.resolve(list.map(function (s) { return { text: String(s == null ? "" : s), engine: "bergamot", tagsOk: true }; }));
    }
    if (!supported()) return Promise.reject(err("unsupported"));
    return serial(function () {
      var out = new Array(list.length), work = [];
      prep.forEach(function (p, i) { if (p.skip) out[i] = finish(p, ""); else work.push(i); });
      return startWorker().then(function () {
        return legs.reduce(function (c, leg) { return c.then(function () { return loadLeg(leg); }); }, Promise.resolve());
      }).then(function () {
        var done = 0;
        function next() {
          touch();
          if (cancelled()) throw err("cancelled");
          if (done >= work.length) return;
          var ids = work.slice(done, done + CHUNK);
          return call("translate", { legs: legs, texts: ids.map(function (i) { return { text: prep[i].send, html: prep[i].html }; }) }).then(function (r) {
            ids.forEach(function (i, j) { out[i] = finish(prep[i], r[j] || ""); });
            done += ids.length;
            progress(done, work.length);
            return next();
          });
        }
        return next();
      }).then(function () {
        touch();
        return out.map(function (r) { return { text: r.text, engine: "bergamot", tagsOk: r.tagsOk }; });
      });
    });
  }
  function translate(text, opts) {
    opts = opts || {};
    var lines = splitLines(text);
    return translateMany(lines.map(function (l) { return l.text; }), {
      from: opts.from, to: opts.to, cancelled: opts.cancelled,
      progress: opts.progress ? function (d, n) { opts.progress(n ? d / n : 1); } : null
    }).then(function (r) {
      return { text: lines.map(function (l, i) { return r[i].text + l.br; }).join(""), engine: "bergamot" };
    });
  }

  root.OrosTranslate = {
    pairs: pairs, languages: languages, route: route, status: status, installed: installed,
    install: install, remove: remove, detect: detect, translate: translate,
    translateMany: translateMany, supported: supported
  };
})(typeof window !== "undefined" ? window : this);
