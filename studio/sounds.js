// ============================================================
// orOS Studio — sample instruments from koulaxizis/oros-sounds
//   Free instrument packs (VSCO 2 CE, CC0 1.0, and others; each pack
//   names its licence) are downloaded when a track first uses one,
//   never precached. Every file goes into the Cache Storage "oros-sounds"
//   (kept by sw.js across releases), so a pack downloads once and then
//   plays offline. A pack is an .sfz (studio/sfz.js) plus its samples.
//   - catalog(): the list (packs/index.json), from the network or the
//     last copy kept; list() / find(id): what is known now.
//   - ensure(ctx, ids, onStep): downloads and decodes the packs;
//     get(id) is the StudioSfz.Instrument once it is ready.
//   - kept(id) / forget(id): whether a pack is on the device; removes it.
//   - Instruments the person imported (an SFZ folder) live on the orOS
//     disk in /internal/Studio/instruments/<id>/ (instrument.sfz, the
//     samples, info.json { name }), so Vault Drive takes them to the
//     other devices; ids start with "u-". useDisk(fn) gives the disk,
//     scan() lists them, save() writes a new one.
// Loaded before studio.js (window.StudioSounds).
// ============================================================
(function (root) {
  "use strict";

  var BASE = "https://koulaxizis.github.io/oros-sounds/packs/";
  var CACHE = "oros-sounds";
  var ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
  var MAX_BYTES = 40e6;               // a pack larger than this is not offered
  var DISK_DIR = "/internal/Studio/instruments/";
  var USER_RE = /^u-[a-z0-9]{8}$/;
  var list = [], byId = {}, insts = {}, states = {}, jobs = {}, users = [], getFs = function () { return null; };

  function cacheOpen() {
    try { return root.caches ? root.caches.open(CACHE) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); }
  }
  // a file of a pack: the kept copy, else the network (then kept)
  function file(url, fresh) {
    return cacheOpen().catch(function () { return null; }).then(function (c) {
      var net = function () {
        return fetch(url, { cache: "no-cache", credentials: "omit" }).then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
          if (c) c.put(url, r.clone()).catch(function () { /* full: plays, not kept */ });
          return r;
        });
      };
      if (!c) return net();
      return c.match(url).then(function (hit) {
        if (hit && !fresh) return hit;
        return fresh && hit ? net().catch(function () { return hit; }) : net();
      });
    });
  }

  // the pack's name in other languages: { el: "…", de: "…" }
  function names(n) {
    var o = {};
    if (n && typeof n === "object") Object.keys(n).forEach(function (k) { if (/^[a-z]{2}$/.test(k) && typeof n[k] === "string" && n[k]) o[k] = n[k].slice(0, 60); });
    return o;
  }
  function clean(x) {
    if (!x || !ID_RE.test(x.id) || typeof x.name !== "string" || typeof x.sfz !== "string") return null;
    if (!(x.bytes > 0 && x.bytes <= MAX_BYTES)) return null;
    return {
      id: x.id, name: x.name.slice(0, 60), names: names(x.names), category: String(x.category || "").slice(0, 30),
      kind: /^(piano|epiano|organ|strings|lead|bass|drums)$/.test(x.kind) ? x.kind : "piano",
      lic: String(x.lic || ""), by: String(x.by || "").slice(0, 120),
      url: /^https:\/\/[^\s<>"]{1,300}$/.test(x.url || "") ? x.url : "",
      sfz: x.sfz, bytes: x.bytes, files: x.files | 0
    };
  }
  var cat = null;
  function catalog() {
    if (cat) return cat;
    cat = file(BASE + "index.json", true).then(function (r) { return r.json(); }).then(function (j) {
      list = (j && Array.isArray(j.packs) ? j.packs : []).map(clean).filter(Boolean);
      byId = {};
      list.forEach(function (p) { byId[p.id] = p; });
      return list;
    }, function () { cat = null; return list; });
    return cat;
  }

  // a pack's file as a Response-like { text(), arrayBuffer() }
  function source(id, name) {
    if (USER_RE.test(id)) {
      var fs = getFs();
      if (!fs) return Promise.reject(new Error("nodisk"));
      return Promise.resolve(fs.readBlob(DISK_DIR + id + "/" + name)).then(function (b) { if (!b) throw new Error("missing"); return b; });
    }
    return file(BASE + id + "/" + name.split("/").map(encodeURIComponent).join("/"));
  }
  function load(ctx, id, onStep) {
    var p = byId[id];
    if (!p) return Promise.reject(new Error("unknown"));
    var S = root.StudioSfz;
    states[id] = "loading";
    return source(id, p.sfz).then(function (r) { return r.text(); }).then(function (text) {
      var parsed = S.parse(text), names = S.samples(parsed.regions), bufs = {}, done = 0;
      if (!names.length) throw new Error("empty");
      // a few at a time: phones decode slowly and run out of memory
      var queue = names.slice(), fail = null;
      function next() {
        if (fail || !queue.length) return Promise.resolve();
        var n = queue.shift();
        return source(id, n).then(function (r) { return r.arrayBuffer(); })
          .then(function (ab) {
            return new Promise(function (res, rej) {
              var pr = ctx.decodeAudioData(ab, res, rej);
              if (pr && typeof pr.then === "function") pr.then(res, rej);
            });
          })
          .then(function (b) { bufs[n] = b; done++; if (onStep) onStep(id, done, names.length); }, function (e) { fail = e; })
          .then(next);
      }
      return Promise.all([next(), next(), next(), next()]).then(function () {
        if (fail) throw fail;
        insts[id] = new S.Instrument(parsed.regions, bufs);
        states[id] = "ok";
        return insts[id];
      });
    }).then(null, function (e) { states[id] = "bad"; delete jobs[id]; throw e; });
  }
  function ensure(ctx, ids, onStep) {
    ids = (ids || []).filter(function (id, i, a) { return a.indexOf(id) === i; });
    if (!ids.length) return Promise.resolve();
    return Promise.all([catalog(), ids.some(function (id) { return USER_RE.test(id) && !byId[id]; }) ? scan() : null]).then(function () {
      return Promise.all(ids.map(function (id) {
        if (insts[id]) return insts[id];
        if (!jobs[id]) jobs[id] = load(ctx, id, onStep);
        return jobs[id];
      }));
    });
  }
  function isReady(ids) { return (ids || []).every(function (id) { return !!insts[id]; }); }
  function kept(id) {
    var p = byId[id];
    if (!p) return Promise.resolve(false);
    return cacheOpen().then(function (c) { return c ? c.match(BASE + id + "/" + p.sfz).then(function (r) { return !!r; }) : false; }, function () { return false; });
  }
  function forget(id) {
    delete insts[id]; delete jobs[id]; delete states[id];
    return cacheOpen().then(function (c) {
      if (!c) return;
      return c.keys().then(function (ks) {
        return Promise.all(ks.filter(function (k) { return k.url.indexOf(BASE + id + "/") === 0; }).map(function (k) { return c.delete(k); }));
      });
    }, function () {});
  }

  // ---------- Single sounds (samples/), added as audio clips ----------
  var SBASE = BASE.replace(/packs\/$/, "samples/"), sgroups = null, SID_RE = /^[a-z0-9-]{1,40}$/;
  function sampleList() {
    if (sgroups) return sgroups;
    sgroups = file(SBASE + "index.json", true).then(function (r) { return r.json(); }).then(function (j) {
      return (j && Array.isArray(j.groups) ? j.groups : []).map(function (g) {
        if (!g || !SID_RE.test(g.id) || !Array.isArray(g.items)) return null;
        var items = g.items.map(function (x) {
          if (!x || !SID_RE.test(x.id) || x.file !== g.id + "/" + x.id + ".mp3" || !(x.bytes > 0 && x.bytes <= 20e6)) return null;
          return { id: x.id, group: g.id, name: String(x.name || x.id).slice(0, 60), names: names(x.names), file: x.file, bytes: x.bytes,
                   dur: +x.dur || 0, lic: String(x.lic || ""), by: String(x.by || "").slice(0, 80),
                   url: /^https:\/\/[^\s<>"]{1,300}$/.test(x.url || "") ? x.url : "" };
        }).filter(Boolean);
        return items.length ? { id: g.id, name: String(g.name || g.id).slice(0, 60), names: names(g.names), items: items } : null;
      }).filter(Boolean);
    }, function () { sgroups = null; return []; });
    return sgroups;
  }
  // a single sound's file (kept like the packs' files)
  function sampleBlob(x) { return file(SBASE + x.file).then(function (r) { return r.blob(); }); }

  // the imported instruments on the disk
  function scan() {
    var fs = getFs();
    if (!fs || typeof fs.ls !== "function") return Promise.resolve(users);
    return Promise.resolve(fs.ls(DISK_DIR)).then(function (ents) {
      var ids = (ents || []).filter(function (e) { return e && e.dir && USER_RE.test(e.name); }).map(function (e) { return e.name; });
      return Promise.all(ids.map(function (id) {
        return Promise.resolve(fs.readText(DISK_DIR + id + "/info.json")).then(function (t) {
          var j = JSON.parse(t);
          return { id: id, name: String(j.name || id).slice(0, 60), names: {}, category: "", kind: /^(piano|epiano|organ|strings|lead|bass|drums)$/.test(j.kind) ? j.kind : "piano",
                   lic: "", by: "", url: "", sfz: "instrument.sfz", bytes: +j.bytes || 0, files: j.files | 0, user: true };
        }).then(null, function () { return null; });
      }));
    }, function () { return []; }).then(function (l) {
      users.forEach(function (u) { if (byId[u.id] === u) delete byId[u.id]; });
      users = l.filter(Boolean).sort(function (a, b) { return a.name.localeCompare(b.name); });
      users.forEach(function (u) { byId[u.id] = u; });
      return users;
    });
  }
  // a new imported instrument: files [{ name, blob }] next to instrument.sfz
  function save(name, kind, sfzText, files) {
    var fs = getFs();
    if (!fs) return Promise.reject(new Error("nodisk"));
    var id = "u-" + Math.random().toString(36).slice(2, 10).padEnd(8, "0"), dir = DISK_DIR + id + "/";
    var bytes = files.reduce(function (n, f) { return n + (f.blob.size || 0); }, 0);
    var chain = files.reduce(function (p, f) { return p.then(function () { return fs.writeBlob(dir + f.name, f.blob); }); }, Promise.resolve());
    return chain.then(function () { return fs.writeText(dir + "instrument.sfz", sfzText); })
      .then(function () { return fs.writeText(dir + "info.json", JSON.stringify({ name: String(name).slice(0, 60), kind: kind, bytes: bytes, files: files.length })); })
      .then(scan).then(function () { return byId[id]; });
  }

  root.StudioSounds = {
    BASE: BASE, CACHE: CACHE, ID_RE: ID_RE, MAX_BYTES: MAX_BYTES,
    catalog: catalog, list: function () { return list; }, find: function (id) { return byId[id] || null; },
    get: function (id) { return insts[id] || null; }, state: function (id) { return states[id] || ""; },
    ensure: ensure, isReady: isReady, kept: kept, forget: forget,
    DISK_DIR: DISK_DIR, USER_RE: USER_RE, useDisk: function (fn) { getFs = fn; }, scan: scan, save: save,
    users: function () { return users; }, samples: sampleList, sampleBlob: sampleBlob
  };
})(typeof window !== "undefined" ? window : this);
