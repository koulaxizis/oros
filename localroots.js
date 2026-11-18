// Local folders for Claude (LOCAL-1, temporary bridge; Chris 2026-11-18,
// until the books' material is on the orOS disk). The owner picks
// folders of this device with the browser's folder picker (File System
// Access): read roots (pictures, PDFs, texts Layout may copy in) and
// write roots (where Layout may save proofs and print PDFs). Claude
// names them as `local:<root>/<path>` (or the full path the owner
// typed for the root, e.g. `local:C:\Users\…\Final Images`).
//
// Safety (spec items 1, 2, 4, 6, 7):
//   - a read root is opened with read permission only; nothing in it is
//     ever written, renamed or deleted;
//   - a write root only takes new files: a taken name gets -2, -3 …;
//   - the browser keeps every handle inside its folder; on top, a path
//     with "..", ".", an empty or odd segment, or outside every root is
//     refused (notAllowedRoot);
//   - roots expire (default 30 days), the bridge can be paused at once,
//     each read and write goes to the gate's log, the owner is told once
//     per session;
//   - handles live in this device's IndexedDB only, never synced.
//
// window.orosLocal (browser) and module.exports (the pure parts, Node).
(function (root) {
  "use strict";

  var DB = "oros-local-roots", STORE = "roots", PAUSE_KEY = "oros-local-paused";
  var DAY = 86400000, DEF_DAYS = 30, WARN_DAYS = 3, MAX_ROOTS = 8;
  var NAME_RE = /^[^\/\\:*?"<>|\u0000-\u001f]{1,80}$/;

  // ---------- pure parts ----------
  function norm(s) { return String(s || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "").normalize("NFC"); }
  function isLocal(p) { return typeof p === "string" && /^local:/i.test(p.trim()); }
  // One segment of a path inside a root: a plain name, never "." or "..".
  function segOk(s) { return !!s && s !== "." && s !== ".." && NAME_RE.test(s) && !/^\s|\s$/.test(s); }
  // "local:<root or label>/<rest>" → { root, rel: [segments] } or
  // { err: "notLocal" | "notAllowedRoot" | "badPath" }. roots: [{ id,
  // name, label, mode }]; the longest name or label that is a whole-
  // segment prefix wins (labels compare without case: Windows paths).
  function parse(path, roots, mode) {
    if (!isLocal(path)) return { err: "notLocal" };
    var p = norm(String(path).trim().slice(6)), best = null, bestLen = -1;
    (roots || []).forEach(function (r) {
      if (mode && r.mode !== mode) return;
      [r.name, r.label].forEach(function (k, i) {
        k = norm(k);
        if (!k) return;
        var a = i ? p.toLowerCase() : p, b = i ? k.toLowerCase() : k;
        if ((a === b || a.indexOf(b + "/") === 0) && b.length > bestLen) { best = { r: r, cut: k.length }; bestLen = b.length; }
      });
    });
    if (!best) return { err: "notAllowedRoot" };
    var rest = p.slice(best.cut).replace(/^\//, ""), rel = rest ? rest.split("/") : [];
    for (var i = 0; i < rel.length; i++) if (!segOk(rel[i])) return { err: rel[i] === ".." ? "notAllowedRoot" : "badPath" };
    return { root: best.r, rel: rel };
  }
  // A name that is not taken: "x.pdf", then "x-2.pdf", "x-3.pdf" …
  function freeName(name, taken) {
    var has = {};
    (taken || []).forEach(function (n) { has[String(n).toLowerCase()] = 1; });
    if (!has[name.toLowerCase()]) return name;
    var dot = name.lastIndexOf("."), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    for (var k = 2; k < 1000; k++) { var n = base + "-" + k + ext; if (!has[n.toLowerCase()]) return n; }
    return null;
  }
  // A root as the owner and Claude see it (no handle).
  function shown(r, now) {
    var left = r.exp ? r.exp - now : Infinity;
    return { id: r.id, name: r.name, label: r.label || "", mode: r.mode, exp: r.exp || 0, expired: left <= 0, soon: left > 0 && left < WARN_DAYS * DAY };
  }
  // A root name from a folder name, unique among the others.
  function rootName(want, others) {
    var n = String(want || "").replace(/[\/\\:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Folder";
    return freeName(n, (others || []).map(function (r) { return r.name; })) || n + " " + Date.now();
  }
  // A picture's pixel size and resolution from its first bytes (JPEG:
  // SOF + JFIF density or EXIF X resolution; PNG: IHDR + pHYs).
  // bytes: Uint8Array → { w, h, ppi } or null
  function imageInfo(b) {
    if (!b || b.length < 24) return null;
    var u16 = function (i, le) { return le ? b[i] | b[i + 1] << 8 : b[i] << 8 | b[i + 1]; };
    var u32 = function (i, le) { return le ? (b[i] | b[i + 1] << 8 | b[i + 2] << 16) + b[i + 3] * 16777216 : b[i] * 16777216 + (b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]); };
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      var o = { w: u32(16), h: u32(20), ppi: 0 }, i = 8;
      while (i + 12 <= b.length) {
        var len = u32(i), typ = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
        if (typ === "pHYs" && i + 17 <= b.length && b[i + 16] === 1) { o.ppi = Math.round(u32(i + 8) * 0.0254); break; }
        if (typ === "IDAT" || typ === "IEND") break;
        i += 12 + len;
      }
      return o;
    }
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    var r = { w: 0, h: 0, ppi: 0 }, k = 2;
    while (k + 4 <= b.length) {
      if (b[k] !== 0xff) { k++; continue; }
      var m = b[k + 1], L = u16(k + 2);
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { k += 2; continue; }
      if (m === 0xe0 && b[k + 4] === 0x4a && b[k + 5] === 0x46 && b[k + 6] === 0x49 && b[k + 7] === 0x46 && !r.ppi) {
        var unit = b[k + 11], dx = u16(k + 12);
        if (unit === 1) r.ppi = dx; else if (unit === 2) r.ppi = Math.round(dx * 2.54);
      }
      if (m === 0xe1 && b[k + 4] === 0x45 && b[k + 5] === 0x78 && b[k + 6] === 0x69 && b[k + 7] === 0x66) {
        var t0 = k + 10, le = b[t0] === 0x49, ifd = t0 + u32(t0 + 4, le), n = ifd + 2 <= b.length ? u16(ifd, le) : 0, xres = 0, runit = 2;
        for (var e = 0; e < n && ifd + 2 + e * 12 + 12 <= b.length; e++) {
          var q = ifd + 2 + e * 12, tag = u16(q, le);
          if (tag === 0x011a) { var off = t0 + u32(q + 8, le); if (off + 8 <= b.length) { var den = u32(off + 4, le); xres = den ? u32(off, le) / den : 0; } }
          if (tag === 0x0128) runit = u16(q + 8, le);
        }
        if (xres) r.ppi = Math.round(runit === 3 ? xres * 2.54 : xres);
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { r.h = u16(k + 5); r.w = u16(k + 7); return r; }
      k += 2 + L;
    }
    return r.w ? r : null;
  }
  var PURE = { imageInfo: imageInfo, parse: parse, isLocal: isLocal, segOk: segOk, freeName: freeName, shown: shown, rootName: rootName, norm: norm, DEF_DAYS: DEF_DAYS, MAX_ROOTS: MAX_ROOTS };
  if (typeof module !== "undefined" && module.exports) { module.exports = PURE; return; }

  // ---------- this device ----------
  var roots = [], loaded = null, listeners = [], told = false;
  function idb() {
    return new Promise(function (ok, no) {
      if (!root.indexedDB) return no(new Error("noIdb"));
      var rq = root.indexedDB.open(DB, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE, { keyPath: "id" }); };
      rq.onsuccess = function () { ok(rq.result); };
      rq.onerror = function () { no(rq.error); };
    });
  }
  function tx(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (ok, no) {
        var t = db.transaction(STORE, mode), st = t.objectStore(STORE), out = fn(st);
        t.oncomplete = function () { db.close(); ok(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { db.close(); no(t.error); };
      });
    });
  }
  function load() {
    loaded = tx("readonly", function (st) { return st.getAll(); }).then(function (l) {
      roots = (Array.isArray(l) ? l : []).filter(function (r) { return r && r.id && r.handle && (r.mode === "r" || r.mode === "w"); });
      return roots;
    }, function () { roots = []; return roots; });
    return loaded;
  }
  function ready() { return loaded || load(); }
  function changed() { listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { void e; } }); banner(); }
  function paused() { try { return localStorage.getItem(PAUSE_KEY) === "1"; } catch (e) { return false; } }
  function supported() { return typeof root.showDirectoryPicker === "function"; }
  function tr(k, v) { var s = typeof root.t === "function" ? root.t(k) : k; Object.keys(v || {}).forEach(function (x) { s = s.split("{" + x + "}").join(v[x]); }); return s; }
  function perm(r, ask) {
    var o = { mode: r.mode === "w" ? "readwrite" : "read" };
    var q = ask ? r.handle.requestPermission(o) : r.handle.queryPermission(o);
    return Promise.resolve(q).then(function (s) { return s === "granted"; }, function () { return false; });
  }
  function live(now) { return roots.filter(function (r) { return !r.exp || r.exp > now; }); }
  function log(kind, path, size, cmd) {
    try { var G = root.orosGate; if (G && typeof G.localLog === "function") G.localLog({ kind: kind, path: String(path).slice(0, 300), size: size || 0, cmd: String(cmd || "").slice(0, 40) }); } catch (e) { void e; }
    if (told) return;
    told = true;
    try { if (root.orosNotifs && root.orosNotifs.transient) root.orosNotifs.transient({ ns: "system", title: tr("loc.used") }); } catch (e) { void e; }
  }
  function fail(why, path) { var e = new Error(why); e.why = why; e.path = path; return e; }
  // path → { r, dir (FileSystemDirectoryHandle of the parent or the folder), leaf, rel }
  function open(path, mode) {
    return ready().then(function () {
      if (paused()) throw fail("bridgePaused", path);
      var x = parse(path, live(Date.now()), mode);
      if (x.err) throw fail(x.err === "notLocal" ? "notAllowedRoot" : x.err, path);
      return perm(x.root, false).then(function (ok) {
        if (!ok) throw fail("needsReconnect", path);
        return x;
      });
    });
  }
  function walk(dir, segs) {
    return segs.reduce(function (p, s) { return p.then(function (d) { return d.getDirectoryHandle(s); }); }, Promise.resolve(dir));
  }
  // The entry at a path: { kind: "dir" | "file", handle }
  function entry(x) {
    if (!x.rel.length) return Promise.resolve({ kind: "dir", handle: x.root.handle });
    var parent = x.rel.slice(0, -1), leaf = x.rel[x.rel.length - 1];
    return walk(x.root.handle, parent).then(function (d) {
      return d.getFileHandle(leaf).then(function (h) { return { kind: "file", handle: h }; }, function () {
        return d.getDirectoryHandle(leaf).then(function (h) { return { kind: "dir", handle: h }; });
      });
    });
  }
  function shownPath(x, rel) { return "local:" + x.root.name + (rel.length ? "/" + rel.join("/") : ""); }
  // ls(path, depth) → [{ path, name, dir, size, mtime, type }] (sorted:
  // folders first; at most 2000)
  function ls(path, depth, cmd) {
    return open(path).then(function (x) {
      return entry(x).then(function (e) {
        if (e.kind !== "dir") throw fail("notFolder", path);
        var out = [], max = Math.max(1, Math.min(3, depth || 1));
        function go(h, rel, lv) {
          if (out.length >= 2000) return Promise.resolve();
          var kids = [];
          var it = h.values();
          function next() {
            return it.next().then(function (r) {
              if (r.done) return;
              var k = r.value;
              if (segOk(k.name)) kids.push(k);
              return next();
            });
          }
          return next().then(function () {
            kids.sort(function (a, b) { return (a.kind === b.kind ? 0 : a.kind === "directory" ? -1 : 1) || a.name.localeCompare(b.name); });
            return kids.reduce(function (p, k) {
              return p.then(function () {
                if (out.length >= 2000) return;
                var r2 = rel.concat([k.name]);
                if (k.kind === "directory") {
                  out.push({ path: shownPath(x, x.rel.concat(r2)), name: r2.join("/"), dir: true });
                  return lv < max ? go(k, r2, lv + 1) : null;
                }
                if (k.kind !== "file") return;
                return k.getFile().then(function (f) {
                  var row = { path: shownPath(x, x.rel.concat(r2)), name: r2.join("/"), dir: false, size: f.size, mtime: f.lastModified, type: f.type || "" };
                  out.push(row);
                  if (!/\.(jpe?g|png)$/i.test(k.name)) return;
                  return f.slice(0, 262144).arrayBuffer().then(function (ab) {
                    var im = imageInfo(new Uint8Array(ab));
                    if (im && im.w) { row.px = { w: im.w, h: im.h }; if (im.ppi) row.ppi = im.ppi; }
                  }, function () {});
                }, function () {});
              });
            }, Promise.resolve());
          });
        }
        return go(e.handle, [], 1).then(function () { log("list", path, out.length, cmd); return out; });
      });
    });
  }
  // read(path) → File (read and write roots both read; only files)
  function read(path, cmd) {
    return open(path).then(function (x) {
      return entry(x).then(function (e) {
        if (e.kind !== "file") throw fail("notFile", path);
        return e.handle.getFile().then(function (f) { log("read", path, f.size, cmd); return f; });
      }, function () { throw fail("notThere", path); });
    });
  }
  // write(dirPath, name, blob) → the path written (write roots only;
  // never replaces a file: a taken name gets -2, -3 …)
  function write(dirPath, name, blob, cmd) {
    if (!segOk(name)) return Promise.reject(fail("badPath", name));
    return open(dirPath, "w").then(function (x) {
      return x.rel.reduce(function (p, s) { return p.then(function (d) { return d.getDirectoryHandle(s, { create: true }); }); }, Promise.resolve(x.root.handle)).then(function (d) {
        var taken = [], it = d.keys();
        function next() { return it.next().then(function (r) { if (r.done) return; taken.push(r.value); return next(); }); }
        return next().then(function () {
          var n = freeName(name, taken);
          if (!n) throw fail("nameTaken", name);
          return d.getFileHandle(n, { create: true }).then(function (fh) {
            return fh.createWritable().then(function (w) {
              return w.write(blob).then(function () { return w.close(); });
            }).then(function () {
              var p = shownPath(x, x.rel.concat([n]));
              log("write", p, blob.size, cmd);
              return p;
            });
          });
        });
      });
    });
  }
  // add a root from a handle the owner just picked (Settings frame)
  function add(handle, o) {
    o = o || {};
    return ready().then(function () {
      if (roots.length >= MAX_ROOTS) throw fail("tooMany");
      if (!handle || handle.kind !== "directory") throw fail("notFolder");
      var mode = o.mode === "w" ? "w" : "r", days = Math.max(1, Math.min(90, Math.floor(o.days || DEF_DAYS)));
      var r = { id: "lr" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: rootName(o.name || handle.name, roots), label: norm(o.label).slice(0, 400),
                mode: mode, exp: Date.now() + days * DAY, added: Date.now(), handle: handle };
      return tx("readwrite", function (st) { st.put(r); }).then(function () { roots.push(r); changed(); return shown(r, Date.now()); });
    });
  }
  function remove(id) {
    return tx("readwrite", function (st) { st["delete"](id); }).then(function () { roots = roots.filter(function (r) { return r.id !== id; }); changed(); });
  }
  function extend(id, days) {
    var r = roots.filter(function (x) { return x.id === id; })[0];
    if (!r) return Promise.resolve(false);
    r.exp = Date.now() + Math.max(1, Math.min(90, days || DEF_DAYS)) * DAY;
    return tx("readwrite", function (st) { st.put(r); }).then(function () { changed(); return true; });
  }
  function setPaused(on) { try { localStorage.setItem(PAUSE_KEY, on ? "1" : "0"); } catch (e) { void e; } changed(); }
  // ask the browser again (needs a click): → number granted
  function reconnect() {
    return ready().then(function () {
      return live(Date.now()).reduce(function (p, r) { return p.then(function (n) { return perm(r, true).then(function (ok) { return n + (ok ? 1 : 0); }); }); }, Promise.resolve(0));
    }).then(function (n) { changed(); return n; });
  }
  function list() {
    return ready().then(function () {
      var now = Date.now();
      return Promise.all(roots.map(function (r) { return perm(r, false).then(function (ok) { var s = shown(r, now); s.granted = ok; return s; }); }));
    });
  }
  // "Move this local root into Claude's folders" (spec item 8): every
  // file of the root (3 folder levels) is copied to dest on the orOS
  // disk (F = orosFS); the local folder is never changed and nothing in
  // the documents is rewritten (they hold their own copies).
  // → { files, skipped }
  function copyIn(id, F, dest) {
    var r = roots.filter(function (x) { return x.id === id; })[0];
    if (!r || !F || typeof F.writeBlob !== "function") return Promise.reject(fail("notThere"));
    var top = "local:" + r.name, n = 0, skip = 0;
    return ls(top, 3, "copy-in").then(function (rows) {
      return rows.filter(function (e) { return !e.dir; }).reduce(function (p, e) {
        return p.then(function () {
          if (e.size > 200 * 1024 * 1024) { skip++; return; }
          return read(e.path, "copy-in").then(function (f) {
            return Promise.resolve(F.writeBlob(dest + "/" + e.name, f)).then(function () { n++; });
          }).then(null, function () { skip++; });
        });
      }, Promise.resolve());
    }).then(function () { return { files: n, skipped: skip }; });
  }
  function onChange(fn) { if (typeof fn === "function") listeners.push(fn); }

  // ---------- the banner (spec item 1) ----------
  var bar = null;
  function banner() {
    if (!root.document || !root.document.body) return;
    list().then(function (l) {
      var on = l.filter(function (r) { return !r.expired; });
      if (!on.length) { if (bar) { bar.remove(); bar = null; } return; }
      if (!bar) {
        bar = root.document.createElement("div");
        bar.id = "oros-local-bar";
        bar.setAttribute("role", "status");
        root.document.body.appendChild(bar);
      }
      bar.textContent = "";
      var need = on.some(function (r) { return !r.granted; }), p = paused(), soon = on.some(function (r) { return r.soon; });
      var txt = root.document.createElement("span");
      txt.textContent = p ? tr("loc.barPaused") : need ? tr("loc.barNeed", { n: on.length }) : tr("loc.barOn", { n: on.length }) + (soon ? " " + tr("loc.barSoon") : "");
      bar.appendChild(txt);
      function b(label, fn) {
        var x = root.document.createElement("button");
        x.type = "button"; x.textContent = label;
        x.addEventListener("click", fn);
        bar.appendChild(x);
      }
      if (need && !p) b(tr("loc.reconnect"), function () { reconnect(); });
      b(p ? tr("loc.resume") : tr("loc.pause"), function () { setPaused(!p); });
    }, function () {});
  }
  function boot() { ready().then(banner); }
  if (root.document && root.document.readyState !== "loading") setTimeout(boot, 0);
  else if (root.document) root.document.addEventListener("DOMContentLoaded", boot);

  root.orosLocal = Object.assign({ supported: supported, ready: ready, list: list, add: add, remove: remove, extend: extend, paused: paused, setPaused: setPaused,
    reconnect: reconnect, ls: ls, read: read, write: write, copyIn: copyIn, onChange: onChange, reload: function () { return load().then(changed); } }, PURE);
})(typeof window !== "undefined" ? window : this);
