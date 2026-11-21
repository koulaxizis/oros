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
// orOS Setup / Portable route: where the orOS launcher serves this
// computer's files (/__oros/fs/, oros-portable computerfs.go) and its
// roots answer says `under: true`, a root can also be a real folder of
// the computer typed by its path (C:\Users\…\Vythos). No browser
// permission prompt; every call sends under=<root>, so the launcher
// refuses anything outside the folder and any symbolic link or junction
// below it, and a write never replaces a file there either.
//
// TRAY-2 (Chris 2026-11-21 «πρόσβαση στους φακέλους ακόμη και με
// έγκριση από κινητό»): computer folders (by path, above) are no longer
// this browser's alone. They live in one list every device of the owner's
// orOS Gate shares (localStorage "oros-local-pc", sealed with the gate's
// key and passed on by its relay, gate.js lf), so a folder opened, renewed
// or closed on the phone, or one Claude asked for and the owner allowed
// there (local_folders_request), reaches the computer as soon as orOS
// runs there, also in the tray. A device without the orOS launcher only
// keeps and shows the list; the files are read where the launcher is.
// No handle and no file ever leaves the computer; only the paths do.
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
    // A full path the owner did not type as the label (C:\…\<root>\…):
    // the root's own folder name as one whole part of it, the last one
    // that matches (the handle still keeps every read inside the root).
    if (!best && /^([A-Za-z]:\/|\/|~\/)/.test(p)) {
      // read roots first for a read, so another root named like a
      // folder inside this one is not taken
      var segs = p.split("/");
      (mode ? [mode] : ["r", "w"]).some(function (md) {
        var at = -1;
        (roots || []).forEach(function (r) {
          if (r.mode !== md) return;
          var n = norm(r.name).toLowerCase();
          for (var j = segs.length - 1; j > at; j--) if (segs[j].toLowerCase() === n) { at = j; best = { r: r, cut: segs.slice(0, j + 1).join("/").length }; break; }
        });
        return !!best;
      });
    }
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
  // A typed computer folder → the launcher's path ("/disks/C/…" or
  // "/home/…"), or "" when it is not one. Windows "C:\a\b", "~/a", and
  // the API's own "/home/…" and "/disks/<name>/…".
  function pcPath(typed) {
    var s = String(typed || "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "").normalize("NFC");
    var m = /^([A-Za-z]):(\/.*)?$/.exec(s);
    if (m) s = "/disks/" + m[1].toUpperCase() + (m[2] || "");
    else if (/^~(\/|$)/.test(s)) s = "/home" + s.slice(1);
    if (!/^\/(home|disks\/[^\/]+)(\/|$)/.test(s) || s.length > 1000) return "";
    var segs = s.split("/").slice(1);
    for (var i = 0; i < segs.length; i++) if (!segOk(segs[i])) return "";
    return s;
  }
  // A root as the owner and Claude see it (no handle).
  function shown(r, now) {
    var left = r.exp ? r.exp - now : Infinity;
    return { id: r.id, name: r.name, label: r.label || "", mode: r.mode, exp: r.exp || 0, expired: left <= 0, soon: left > 0 && left < WARN_DAYS * DAY, pc: !!r.pc };
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
  // ---------- TRAY-2: the shared list of computer folders (pure) ----------
  var PC_KEY = "oros-local-pc", PC_TOMB_DAYS = 90, ID_RE = /^lr[a-z0-9]{4,24}$/;
  // One entry as kept and shared, or null: { id, pc, label, name, mode,
  // exp, added, m, gone?, by? } (m: its last change, the newest wins).
  function pcClean(e) {
    if (!e || typeof e !== "object" || !ID_RE.test(String(e.id || ""))) return null;
    var m = Math.floor(+e.m || 0);
    if (!(m > 0)) return null;
    if (e.gone) return { id: e.id, m: m, gone: 1 };
    var pc = typeof e.pc === "string" ? e.pc : "";
    if (!pc || pcPath(pc) !== pc || pcRisky(pc)) return null;
    var name = String(e.name || ""), exp = Math.floor(+e.exp || 0);
    if (!NAME_RE.test(name) || /^\s|\s$/.test(name) || !(exp > 0)) return null;
    var o = { id: e.id, pc: pc, label: norm(String(e.label || "")).slice(0, 400), name: name, mode: e.mode === "w" ? "w" : "r", exp: exp, added: Math.floor(+e.added || m), m: m };
    if (typeof e.by === "string" && /^(owner|claude)$/.test(e.by)) o.by = e.by;
    return o;
  }
  function pcList(raw) {
    var out = [], seen = {};
    (Array.isArray(raw) ? raw : []).slice(0, 200).forEach(function (e) { var c = pcClean(e); if (c && !seen[c.id]) { seen[c.id] = 1; out.push(c); } });
    return out;
  }
  // Two lists → one: per id the newest m wins (a tie: the removal, then
  // the later expiry); removals older than 90 days are forgotten.
  function pcMerge(a, b, now) {
    var by = {};
    pcList(a).concat(pcList(b)).forEach(function (e) {
      var o = by[e.id];
      if (!o || e.m > o.m || (e.m === o.m && (e.gone && !o.gone || (!e.gone && !o.gone && e.exp > o.exp)))) by[e.id] = e;
    });
    var cut = (now || Date.now()) - PC_TOMB_DAYS * DAY;
    return Object.keys(by).sort().map(function (k) { return by[k]; }).filter(function (e) { return !e.gone || e.m >= cut; });
  }
  // A computer folder Claude may never be given: a drive or the home
  // folder itself, the system, programs, app data, keys.
  var PC_NO = ["appdata", "windows", "program files", "program files (x86)", "programdata", "$recycle.bin", "system volume information", ".ssh", ".gnupg", ".aws", ".config", ".local", "library", "etc", "proc", "sys", "root"];
  function pcRisky(pc) {
    var segs = String(pc || "").split("/").slice(1), low = segs.map(function (x) { return x.toLowerCase(); });
    if (!segs.length) return true;
    var base = low[0] === "home" ? 2 : low[0] === "disks" ? (low[2] === "users" ? 4 : 2) : 99;   // /home/<u>, /disks/C/Users/<u>, /disks/D
    if (segs.length <= base) return true;
    return low.some(function (x) { return PC_NO.indexOf(x) >= 0; });
  }
  var PURE = { pcClean: pcClean, pcList: pcList, pcMerge: pcMerge, pcRisky: pcRisky, PC_KEY: PC_KEY, pcPath: pcPath, imageInfo: imageInfo, parse: parse, isLocal: isLocal, segOk: segOk, freeName: freeName, shown: shown, rootName: rootName, norm: norm, DEF_DAYS: DEF_DAYS, MAX_ROOTS: MAX_ROOTS };
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
      rq.onblocked = function () { no(new Error("blocked")); };
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
  // TRAY-2: the shared list (localStorage, every gate device)
  function pcRead() { try { return pcList(JSON.parse(localStorage.getItem(PC_KEY) || "[]")); } catch (e) { return []; } }
  function pcSave(list, quiet) {
    try { localStorage.setItem(PC_KEY, JSON.stringify(list)); } catch (e) { return false; }
    if (!quiet) { try { if (typeof root.orosLocalShare === "function") root.orosLocalShare(); } catch (e) { void e; } }
    return true;
  }
  function pcLive(list) { return list.filter(function (e) { return !e.gone; }); }
  function load() {
    loaded = limit(tx("readonly", function (st) { return st.getAll(); }), "", 10000).then(null, function () { return []; }).then(function (l) {
      var rows = Array.isArray(l) ? l : [];
      // computer folders kept here before TRAY-2 join the shared list (once)
      var old = rows.filter(function (r) { return r && r.id && typeof r.pc === "string" && pcPath(r.pc) === r.pc; });
      if (old.length) {
        var now = Date.now();
        pcSave(pcMerge(pcRead(), old.map(function (r) { return { id: ID_RE.test(r.id) ? r.id : "lr" + now.toString(36) + Math.random().toString(36).slice(2, 6), pc: r.pc, label: r.label, name: r.name, mode: r.mode, exp: r.exp || now + DEF_DAYS * DAY, added: r.added || now, m: now, by: "owner" }; }), now));
        tx("readwrite", function (st) { old.forEach(function (r) { st["delete"](r.id); }); }).then(null, function () {});
      }
      roots = rows.filter(function (r) { return r && r.id && r.handle && (r.mode === "r" || r.mode === "w"); }).concat(pcLive(pcRead()));
      return roots;
    });
    return loaded;
  }
  function ready() { return loaded || load(); }
  function changed() { listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { void e; } }); banner(); }
  function paused() { try { return localStorage.getItem(PAUSE_KEY) === "1"; } catch (e) { return false; } }
  function supported() { return typeof root.showDirectoryPicker === "function"; }
  // ---------- the launcher's computer files (orOS Setup / Portable) ----------
  var API = "/__oros/fs/", pcP = null;
  function pcCall(call, path, under, init) {
    var q = API + call + "?path=" + encodeURIComponent(path) + (under ? "&under=" + encodeURIComponent(under) : "");
    var o = Object.assign({ credentials: "same-origin" }, init || {});
    o.headers = Object.assign({ "X-Oros-FS": "1" }, o.headers || {});
    return root.fetch(q, o).then(function (res) {
      if (res.ok) return res;
      return res.json().then(function (j) { return j; }, function () { return {}; }).then(function (j) {
        var code = j && j.error, why = code === "notAllowedRoot" ? "notAllowedRoot" : code === "link" ? "notAllowedRoot" : res.status === 404 ? "notThere" : res.status === 409 ? "nameTaken" : code === "off" ? "needsReconnect" : "badPath";
        throw fail(why, path);
      });
    });
  }
  // → true when this launcher serves the computer's files with the
  // under= checks (asked once per page)
  function pcOn() {
    if (!pcP) pcP = typeof root.fetch !== "function" ? Promise.resolve(false) : root.fetch(API + "roots", { credentials: "same-origin", headers: { "X-Oros-FS": "1" } }).then(function (r) {
      return r.ok ? r.json().then(function (j) { return !!(j && j.under === true); }) : false;
    }).then(null, function () { return false; });
    return pcP;
  }
  function pcJoin(x, rel) { return x.root.pc + (rel.length ? "/" + rel.join("/") : ""); }
  function tr(k, v) { var s = typeof root.t === "function" ? root.t(k) : k; Object.keys(v || {}).forEach(function (x) { s = s.split("{" + x + "}").join(v[x]); }); return s; }
  function perm(r, ask) {
    if (r.pc) return pcOn();
    var o = { mode: r.mode === "w" ? "readwrite" : "read" };
    var q = ask ? r.handle.requestPermission(o) : limit(r.handle.queryPermission(o), "", 10000);
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
  // Every call ends: a browser or disk that does not answer (a cloud
  // placeholder, a lost permission prompt, a stuck launcher) gives
  // "timeout" instead of a promise that never settles (bug 2026-11-18).
  var LIMIT = 30000, READ_MS = 15000;   // a read answers inside the gate's ~21 s wait
  function limit(pr, path, ms) {
    return new Promise(function (ok, no) {
      var t = setTimeout(function () { no(fail("timeout", path)); }, ms || LIMIT);
      Promise.resolve(pr).then(function (v) { clearTimeout(t); ok(v); }, function (e) { clearTimeout(t); no(e); });
    });
  }
  // path → { r, dir (FileSystemDirectoryHandle of the parent or the folder), leaf, rel }
  function open(path, mode) {
    return ready().then(function () {
      if (paused()) throw fail("bridgePaused", path);
      var x = parse(path, live(Date.now()), mode);
      if (x.err) throw fail(x.err === "notLocal" ? "notAllowedRoot" : x.err, path);
      return perm(x.root, false).then(function (ok) {
        if (!ok) throw fail(x.root.pc ? "notHere" : "needsReconnect", path);
        return x;
      });
    });
  }
  function walk(dir, segs) {
    return segs.reduce(function (p, s) { return p.then(function (d) { return d.getDirectoryHandle(s); }); }, Promise.resolve(dir));
  }
  // The entry at a path: { kind: "dir" | "file", handle }
  function entry(x) {
    if (x.root.pc) {
      return pcCall("stat", pcJoin(x, x.rel), x.root.pc).then(function (r) { return r.json(); }).then(function (e) {
        return { kind: e.dir ? "dir" : "file", pc: pcJoin(x, x.rel), size: e.size || 0, mtime: e.mtime || 0 };
      });
    }
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
  function ls(path, depth, cmd) { return limit(lsRaw(path, depth, cmd), path, 120000); }
  function lsRaw(path, depth, cmd) {
    return open(path).then(function (x) {
      return entry(x).then(function (e) {
        if (e.kind !== "dir") throw fail("notFolder", path);
        var out = [], max = Math.max(1, Math.min(3, depth || 1));
        function goPc(dir, rel, lv) {
          if (out.length >= 2000) return Promise.resolve();
          return pcCall("list", dir, x.root.pc).then(function (r) { return r.json(); }).then(function (l) {
            var kids = (Array.isArray(l) ? l : []).filter(function (k) { return k && segOk(k.name); });
            kids.sort(function (a, b) { return (a.dir === b.dir ? 0 : a.dir ? -1 : 1) || a.name.localeCompare(b.name); });
            return kids.reduce(function (p, k) {
              return p.then(function () {
                if (out.length >= 2000) return;
                var r2 = rel.concat([k.name]), kp = dir + "/" + k.name;
                if (k.dir) {
                  out.push({ path: shownPath(x, x.rel.concat(r2)), name: r2.join("/"), dir: true });
                  return lv < max ? goPc(kp, r2, lv + 1) : null;
                }
                var row = { path: shownPath(x, x.rel.concat(r2)), name: r2.join("/"), dir: false, size: k.size || 0, mtime: k.mtime || 0, type: "" };
                out.push(row);
                if (!/\.(jpe?g|png)$/i.test(k.name)) return;
                return pcCall("raw", kp, x.root.pc, { headers: { Range: "bytes=0-262143" } }).then(function (res) { return res.arrayBuffer(); }).then(function (ab) {
                  var im = imageInfo(new Uint8Array(ab));
                  if (im && im.w) { row.px = { w: im.w, h: im.h }; if (im.ppi) row.ppi = im.ppi; }
                }, function () {});
              });
            }, Promise.resolve());
          });
        }
        if (e.pc) return goPc(e.pc, [], 1).then(function () { log("list", path, out.length, cmd); return out; });
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
  function read(path, cmd) { return limit(readRaw(path, cmd), path, READ_MS); }
  function readRaw(path, cmd) {
    return open(path).then(function (x) {
      return entry(x).then(function (e) {
        if (e.kind !== "file") throw fail("notFile", path);
        if (e.pc) {
          return pcCall("raw", e.pc, x.root.pc).then(function (res) { return res.blob(); }).then(function (b) {
            var f = new File([b], x.rel[x.rel.length - 1], { type: b.type || "", lastModified: e.mtime || Date.now() });
            log("read", path, f.size, cmd);
            return f;
          });
        }
        return e.handle.getFile().then(function (f) { log("read", path, f.size, cmd); return f; });
      }, function (er) { throw er && er.why ? er : fail("notThere", path); });
    });
  }
  // write(dirPath, name, blob) → the path written (write roots only;
  // never replaces a file: a taken name gets -2, -3 …)
  function write(dirPath, name, blob, cmd) { return limit(writeRaw(dirPath, name, blob, cmd), dirPath, 60000); }
  function writeRaw(dirPath, name, blob, cmd) {
    if (!segOk(name)) return Promise.reject(fail("badPath", name));
    return open(dirPath, "w").then(function (x) {
      if (x.root.pc) return pcWrite(x, name, blob, cmd);
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
  // A write into a computer folder: missing folders are made one by one
  // (each parent checked with under= first), the name is free in the
  // folder's listing, and the launcher refuses to replace a file anyway.
  function pcWrite(x, name, blob, cmd) {
    var base = x.root.pc;
    return x.rel.reduce(function (p, s) {
      return p.then(function (dir) {
        var next = dir + "/" + s;
        return pcCall("stat", next, base).then(function (r) { return r.json(); }).then(function (e) {
          if (!e.dir) throw fail("notFolder", next);
          return next;
        }, function (err) {
          if (!err || err.why !== "notThere") throw err;
          return pcCall("stat", dir, base).then(function () {
            return root.fetch(API + "op", { method: "POST", credentials: "same-origin", headers: { "X-Oros-FS": "1", "Content-Type": "application/json" }, body: JSON.stringify({ op: "mkdir", path: next }) });
          }).then(function (res) { if (!res.ok) throw fail("badPath", next); return next; });
        });
      });
    }, Promise.resolve(base)).then(function (dir) {
      return pcCall("list", dir, base).then(function (r) { return r.json(); }).then(function (l) {
        var taken = (Array.isArray(l) ? l : []).map(function (e) { return e.name; });
        function put(tries) {
          var n = freeName(name, taken);
          if (!n) throw fail("nameTaken", name);
          return pcCall("raw", dir + "/" + n, base, { method: "PUT", body: blob }).then(function () {
            var p = shownPath(x, x.rel.concat([n]));
            log("write", p, blob.size, cmd);
            return p;
          }, function (e) {
            if (e && e.why === "nameTaken" && tries < 5) { taken.push(n); return put(tries + 1); }
            throw e;
          });
        }
        return put(0);
      });
    });
  }
  // add a computer folder by its path (orOS Setup / Portable)
  // TRAY-2: kept in the shared list; o.anywhere (a phone, Claude's
  // request the owner allowed): no launcher here, so it is checked on the
  // computer when used. The same folder and access again only renews it.
  function addPc(typed, o) {
    o = o || {};
    var pc = pcPath(typed);
    if (!pc) return Promise.reject(fail("badPath"));
    if (pcRisky(pc)) return Promise.reject(fail("riskyPath"));
    var mode = o.mode === "w" ? "w" : "r", days = Math.max(1, Math.min(90, Math.floor(o.days || DEF_DAYS)));
    return ready().then(function () { return pcOn(); }).then(function (on) {
      if (!on) { if (o.anywhere) return { dir: true }; throw fail("needsReconnect"); }
      return pcCall("stat", pc, pc).then(function (r) { return r.json(); });
    }).then(function (e) {
      if (!e || !e.dir) throw fail("notFolder");
      var now = Date.now(), list = pcRead();
      var same = pcLive(list).filter(function (x) { return x.pc.toLowerCase() === pc.toLowerCase() && x.mode === mode; })[0];
      var r;
      if (same) r = Object.assign({}, same, { exp: Math.max(same.exp, now + days * DAY), m: now });
      else {
        if (roots.length >= MAX_ROOTS) throw fail("tooMany");
        var leaf = pc.slice(pc.lastIndexOf("/") + 1);
        r = { id: "lr" + now.toString(36) + Math.random().toString(36).slice(2, 6), name: rootName(o.name || leaf, roots), label: norm(String(typed).trim()).slice(0, 400),
              mode: mode, exp: now + days * DAY, added: now, m: now, pc: pc, by: o.by === "claude" ? "claude" : "owner" };
      }
      if (!pcSave(pcMerge(list, [r], now))) throw fail("storage");
      return load().then(function () { changed(); return shown(r, now); });
    });
  }
  // TRAY-2: a list from another device of the gate (already opened) → merged here
  function mergeShared(raw) {
    var now = Date.now(), cur = pcRead(), next = pcMerge(cur, raw, now);
    if (JSON.stringify(next) === JSON.stringify(cur)) return Promise.resolve(false);
    pcSave(next, true);
    return load().then(function () { changed(); return true; });
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
    var r = roots.filter(function (x) { return x.id === id; })[0];
    if (r && r.pc) {                                  // TRAY-2: closed on every device
      pcSave(pcMerge(pcRead(), [{ id: id, m: Date.now(), gone: 1 }], Date.now()));
      return load().then(changed);
    }
    return tx("readwrite", function (st) { st["delete"](id); }).then(function () { roots = roots.filter(function (r) { return r.id !== id; }); changed(); });
  }
  function extend(id, days) {
    var r = roots.filter(function (x) { return x.id === id; })[0];
    if (!r) return Promise.resolve(false);
    r.exp = Date.now() + Math.max(1, Math.min(90, days || DEF_DAYS)) * DAY;
    if (r.pc) {
      r.m = Date.now();
      pcSave(pcMerge(pcRead(), [r], r.m));
      return load().then(function () { changed(); return true; });
    }
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
      return Promise.all(roots.map(function (r) { return perm(r, false).then(function (ok) { var s = shown(r, now); s.granted = ok; if (r.pc && !ok) s.elsewhere = true; if (r.by) s.by = r.by; return s; }); }));
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
      var on = l.filter(function (r) { return !r.expired && !r.elsewhere; });
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
    reconnect: reconnect, addPc: addPc, pcOn: pcOn, ls: ls, mergeShared: mergeShared, shared: function () { return pcRead(); },
    // the open roots as Claude names them (sync; [] until loaded)
    names: function () { var now = Date.now(); return live(now).map(function (r) { return { name: r.name, label: r.label || "", mode: r.mode }; }); }, read: read, write: write, copyIn: copyIn, onChange: onChange, reload: function () { return load().then(changed); } }, PURE);
})(typeof window !== "undefined" ? window : this);
