// ============================================================
// orOS Files — tags-core.js (TAGS v1): which file has which tag, and
// the smart folders. Pure, no DOM, no disk. Exposes
// window.OrosTagsCore (browser) or module.exports (tests).
//
// One tag list for the whole of Files: the tags themselves (name,
// colour) are the Documents tags, slice "files-docs" `tags`
// [{ id "tg-…", m, n, c? }] (docs-core.js), so a tag made here shows
// in Documents and the other way round. This file only says which
// files carry them, in a slice of its own so that an older Files,
// which does not know these fields, can never drop them by writing
// "files-docs" again (Chris 2026-11-17, big-OS idea 8).
//
// State (slice "files-tags", key "oros-files-tags"):
//   { v: 1,
//     files: [{ k, p, m, t: { "tg-…": ±ms } }],         sorted by k
//     smart: [{ id "sf-…", m, n, c?, q }],               sorted by id
//     tombs: { "sf-…": ms } }
// k is "h:<sha256>" (the vault manifest knows the file, so the tags
// follow it through moves on every device) or "p:<path>" (a folder,
// or a file sync does not hold); p is the last known path and m the
// time it was set. t holds one stamp per tag: positive = on since,
// negative = taken off at. A smart folder (wave T2) is a saved search
// q, never copies of files.
//
// Merge (R5, R17, R26): per file the path goes with the larger m
// (equal: the larger path); per tag the larger stamp wins (equal: off
// wins), so two devices tagging one file with different tags both
// keep theirs. Smart folders: the larger m wins (equal: the larger
// canonical JSON); a tomb at or after m hides one. Every writer stamps
// max(now, the stamp it replaces + 1) and an unchanged edit returns
// the same state object (R27). The result is canonical:
// norm(merge(a, b)) equals merge(a, b).
// Caps: 20,000 tagged files and 2,000 untagged rows kept (newest
// first), 20 tags on a file and 40 removals per file, 200 smart
// folders, 500 tombs.
// ============================================================
(function (root) {
  "use strict";

  var KEY = "oros-files-tags";
  var SLICE = "files-tags";
  var ROOT = "/internal/";
  var MAX_FILES = 20000, MAX_DEAD = 2000, MAX_ON = 20, MAX_OFF = 40;
  var MAX_SMART = 200, MAX_TOMBS = 500, MAX_NAME = 80, MAX_PATH = 1024;
  var HKEY = /^h:[0-9a-f]{64}$/;
  var HASH = /^[0-9a-f]{64}$/;
  var TAG_ID = /^tg-[0-9a-z][0-9a-z_-]{0,40}$/;
  var SMART_ID = /^sf-[0-9a-z][0-9a-z_-]{0,40}$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  // The kinds a smart folder can ask for (files.js KIND_EXT says
  // which extensions each one means).
  var KINDS = ["image", "video", "audio", "doc", "pdf", "sheet", "text", "archive", "code", "folder"];

  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function stamp(n) { return typeof n === "number" && isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  function okPath(p) {
    if (typeof p !== "string" || p.indexOf(ROOT) !== 0 || p.length > MAX_PATH || p.indexOf("\u0000") >= 0) return false;
    var rest = p.slice(ROOT.length);
    if (!rest || /(^|\/)\.\.?(\/|$)/.test(rest) || /\/$/.test(rest) || rest.indexOf("//") >= 0) return false;
    return rest !== ".docs" && rest.indexOf(".docs/") !== 0;      // Documents' texts are never tagged
  }
  function okKey(k) {
    if (typeof k !== "string") return false;
    if (HKEY.test(k)) return true;
    return k.indexOf("p:") === 0 && okPath(k.slice(2));
  }
  function cleanName(n) {
    if (typeof n !== "string") return "";
    n = n.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (n.normalize) n = n.normalize("NFC");
    return n.slice(0, MAX_NAME);
  }
  function canon(o) { return JSON.stringify(o); }
  function byK(a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : 0; }
  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
  function under(p, dir) { return p === dir || p.indexOf(dir + "/") === 0; }

  // ---------- tags on one file ----------
  // The winner of two stamps for one tag: the larger |v|, off on a tie.
  function tagWins(a, b) {
    var x = Math.abs(a), y = Math.abs(b);
    if (x !== y) return x > y ? a : b;
    return a < 0 ? a : b;
  }
  function normT(t) {
    var out = {};
    if (!isObj(t)) return out;
    var on = [], off = [];
    Object.keys(t).forEach(function (id) {
      var v = t[id];
      if (!TAG_ID.test(id) || typeof v !== "number" || !isFinite(v) || v === 0) return;
      v = v > 0 ? Math.floor(v) : -Math.floor(-v);
      if (v === 0) return;
      (v > 0 ? on : off).push([id, v]);
    });
    function newest(a, b) { return Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1); }
    if (on.length > MAX_ON) on = on.sort(newest).slice(0, MAX_ON);
    if (off.length > MAX_OFF) off = off.sort(newest).slice(0, MAX_OFF);
    on.concat(off).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }).forEach(function (x) { out[x[0]] = x[1]; });
    return out;
  }
  function joinT(a, b) {
    var t = {};
    Object.keys(a).forEach(function (id) { t[id] = a[id]; });
    Object.keys(b).forEach(function (id) { t[id] = t[id] == null ? b[id] : tagWins(t[id], b[id]); });
    return normT(t);
  }
  function onIds(row) {
    if (!row) return [];
    return Object.keys(row.t).filter(function (id) { return row.t[id] > 0; });
  }
  function touched(row) {
    var m = row.m;
    Object.keys(row.t).forEach(function (id) { var v = Math.abs(row.t[id]); if (v > m) m = v; });
    return m;
  }

  function normRow(o) {
    if (!isObj(o) || !okKey(o.k)) return null;
    var m = stamp(o.m);
    if (!m) return null;
    var p = okPath(o.p) ? o.p : (o.k.indexOf("p:") === 0 ? o.k.slice(2) : "");
    if (!p) return null;
    if (o.k.indexOf("p:") === 0) p = o.k.slice(2);           // a path key is its own path
    return { k: o.k, p: p, m: m, t: normT(o.t) };
  }
  function joinRows(a, b) {
    var keepA = a.m !== b.m ? a.m > b.m : a.p >= b.p;
    var w = keepA ? a : b;
    return { k: a.k, p: w.p, m: w.m, t: joinT(a.t, b.t) };
  }

  // ---------- smart folders (the saved search; wave T2 shows them) ----------
  function normQuery(q) {
    var o = isObj(q) ? q : {};
    var out = {};
    if (Array.isArray(o.tg)) {
      var tg = [];
      o.tg.forEach(function (id) { if (typeof id === "string" && TAG_ID.test(id) && tg.indexOf(id) === -1 && tg.length < MAX_ON) tg.push(id); });
      if (tg.length) { out.tg = tg.sort(); if (o.all === true && tg.length > 1) out.all = true; }
    }
    if (Array.isArray(o.kind)) {
      var kd = KINDS.filter(function (k) { return o.kind.indexOf(k) !== -1; });
      if (kd.length) out.kind = kd;
    }
    var days = Math.floor(Number(o.days));
    if (o.days != null && isFinite(days) && days >= 1 && days <= 36500) out.days = days;
    else {
      if (typeof o.from === "string" && DATE_RE.test(o.from)) out.from = o.from;
      if (typeof o.to === "string" && DATE_RE.test(o.to)) out.to = o.to;
    }
    var name = typeof o.name === "string" ? o.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100) : "";
    if (name) out.name = name;
    if (typeof o.dir === "string" && (o.dir === "/internal" || okPath(o.dir))) out.dir = o.dir;
    ["min", "max"].forEach(function (f) {
      var n = Math.floor(Number(o[f]));
      if (o[f] != null && isFinite(n) && n >= 0 && n <= 1e13) out[f] = n;
    });
    // Fields of a later Files, kept as they are (≤ 2 KB).
    if (isObj(o.x)) { var xs = canon(o.x); if (xs.length <= 2048) out.x = JSON.parse(xs); }
    return out;
  }
  function normSmart(o) {
    if (!isObj(o) || typeof o.id !== "string" || !SMART_ID.test(o.id)) return null;
    var m = stamp(o.m), n = cleanName(o.n);
    if (!m || !n) return null;
    var r = { id: o.id, m: m, n: n };
    var c = Math.floor(Number(o.c));
    if (o.c != null && isFinite(c) && c >= 0 && c <= 11) r.c = c;
    r.q = normQuery(o.q);
    return r;
  }
  function smartWins(a, b) {
    if (a.m !== b.m) return a.m > b.m;
    return canon(a) >= canon(b);
  }

  // ---------- the whole state ----------
  function norm(raw) {
    var o = isObj(raw) ? raw : {};
    var tombs = {};
    if (isObj(o.tombs)) {
      var tk = Object.keys(o.tombs).filter(function (k) { return SMART_ID.test(k) && stamp(o.tombs[k]); });
      if (tk.length > MAX_TOMBS) tk = tk.sort(function (x, y) { return o.tombs[y] - o.tombs[x] || (x < y ? -1 : 1); }).slice(0, MAX_TOMBS);
      tk.sort().forEach(function (k) { tombs[k] = stamp(o.tombs[k]); });
    }
    var map = {};
    (Array.isArray(o.files) ? o.files : []).forEach(function (x) {
      var r = normRow(x);
      if (r) map[r.k] = map[r.k] ? joinRows(map[r.k], r) : r;
    });
    var live = [], dead = [];
    Object.keys(map).forEach(function (k) { (onIds(map[k]).length ? live : dead).push(map[k]); });
    function newest(a, b) { return touched(b) - touched(a) || byK(a, b); }
    if (live.length > MAX_FILES) live = live.sort(newest).slice(0, MAX_FILES);
    if (dead.length > MAX_DEAD) dead = dead.sort(newest).slice(0, MAX_DEAD);
    var sm = {};
    (Array.isArray(o.smart) ? o.smart : []).forEach(function (x) {
      var r = normSmart(x);
      if (r && (!sm[r.id] || smartWins(r, sm[r.id]))) sm[r.id] = r;
    });
    var smart = Object.keys(sm).map(function (k) { return sm[k]; })
      .filter(function (r) { return !(tombs[r.id] >= r.m); });
    if (smart.length > MAX_SMART) smart = smart.sort(function (a, b) { return b.m - a.m || byId(a, b); }).slice(0, MAX_SMART);
    return { v: 1, files: live.concat(dead).sort(byK), smart: smart.sort(byId), tombs: tombs };
  }

  function merge(a, b) {
    a = norm(a); b = norm(b);
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (t) {
      Object.keys(t).forEach(function (k) { if (!tombs[k] || t[k] > tombs[k]) tombs[k] = t[k]; });
    });
    return norm({ v: 1, files: a.files.concat(b.files), smart: a.smart.concat(b.smart), tombs: tombs });
  }

  // ---------- reading ----------
  function keyOf(path, h) {
    if (typeof h === "string" && HASH.test(h)) return "h:" + h;
    return okPath(path) ? "p:" + path : "";
  }
  function rowAt(s, k) {
    for (var i = 0; i < s.files.length; i++) if (s.files[i].k === k) return s.files[i];
    return null;
  }
  // A lookup for many paths at once. here(p) says whether a path is on
  // this device (the vault's local paths; null = not known): a hash row
  // whose last path is still here belongs to that file only, so a
  // copy with the same content does not take its tags; once that path
  // is gone the row goes with whichever file now has the content.
  function index(s) {
    var byP = {}, byH = {};
    s.files.forEach(function (r) {
      if (!onIds(r).length) return;
      if (r.k.indexOf("h:") === 0) byH[r.k.slice(2)] = r;
      (byP[r.p] = byP[r.p] || []).push(r);
    });
    return { byP: byP, byH: byH };
  }
  // The tag ids on one file (sorted), from every row that applies.
  function tagsAt(ix, path, h, here) {
    var rows = [];
    (ix.byP[path] || []).forEach(function (r) {
      if (r.k.indexOf("p:") === 0 || !h || r.k === "h:" + h) rows.push(r);
    });
    if (h && ix.byH[h] && rows.indexOf(ix.byH[h]) === -1) {
      var r = ix.byH[h];
      if (!here || !here(r.p)) rows.push(r);
    }
    var ids = {};
    rows.forEach(function (x) { onIds(x).forEach(function (id) { ids[id] = true; }); });
    return Object.keys(ids).sort();
  }
  // The rows carrying a tag: [{ k, p, h? }] (the caller finds the file).
  function withTag(s, id) {
    var out = [];
    s.files.forEach(function (r) {
      if (r.t[id] > 0) {
        var x = { k: r.k, p: r.p };
        if (r.k.indexOf("h:") === 0) x.h = r.k.slice(2);
        out.push(x);
      }
    });
    return out;
  }
  // How many files carry each tag: { id: n }.
  function counts(s) {
    var out = {};
    s.files.forEach(function (r) { onIds(r).forEach(function (id) { out[id] = (out[id] || 0) + 1; }); });
    return out;
  }
  function hasAny(s) {
    for (var i = 0; i < s.files.length; i++) if (onIds(s.files[i]).length) return true;
    return s.smart.length > 0;
  }

  // ---------- writing (each returns a new state, or s unchanged) ----------
  function cloneRow(r) {
    var t = {};
    Object.keys(r.t).forEach(function (id) { t[id] = r.t[id]; });
    return { k: r.k, p: r.p, m: r.m, t: t };
  }
  function withRows(s, rows) {
    var map = {};
    s.files.forEach(function (r) { map[r.k] = r; });
    rows.forEach(function (r) { map[r.k] = r; });
    var files = Object.keys(map).map(function (k) { return map[k]; });
    return norm({ v: 1, files: files, smart: s.smart, tombs: s.tombs });
  }
  function same(a, b) { return canon(a) === canon(b); }
  function setOne(t, id, on, now) {
    var cur = t[id];
    if (on && cur > 0) return false;
    if (!on && !(cur > 0)) return false;
    var at = Math.max(stamp(now) || 1, cur ? Math.abs(cur) + 1 : 1);
    t[id] = on ? at : -at;
    return true;
  }
  // Puts tags on and takes tags off one file. A path row of the same
  // file is folded into its hash row once the hash is known.
  function setTags(s, path, h, add, remove, now) {
    var k = keyOf(path, h);
    if (!k || !okPath(path)) return s;
    var cur = rowAt(s, k);
    var row = cur ? cloneRow(cur) : { k: k, p: path, m: Math.max(stamp(now), 1), t: {} };
    var out = [], changed = false;
    if (row.p !== path) { row.p = path; row.m = Math.max(stamp(now), row.m + 1); changed = true; }
    if (k.indexOf("h:") === 0) {
      var old = rowAt(s, "p:" + path);
      if (old && onIds(old).length) {
        var o2 = cloneRow(old);
        onIds(old).forEach(function (id) {
          if ((remove || []).indexOf(id) === -1 && setOne(row.t, id, true, now)) changed = true;
          setOne(o2.t, id, false, now);
        });
        out.push(o2);
        changed = true;
      }
    }
    (add || []).forEach(function (id) { if (TAG_ID.test(id) && setOne(row.t, id, true, now)) changed = true; });
    (remove || []).forEach(function (id) { if (TAG_ID.test(id) && setOne(row.t, id, false, now)) changed = true; });
    if (!changed) return s;
    if (onIds(row).length > MAX_ON) return s;
    out.push(row);
    var next = withRows(s, out);
    return same(next, s) ? s : next;
  }
  // A file or folder this device moved inside Files: path rows move to
  // their new key, hash rows only get the new path. from/to may be
  // folders (everything under one moves).
  function carry(s, from, to, now) {
    if (!okPath(from) || !okPath(to) || from === to) return s;
    var out = [];
    s.files.forEach(function (r) {
      if (!under(r.p, from)) return;
      var np = to + r.p.slice(from.length);
      if (!okPath(np)) return;
      if (r.k.indexOf("h:") === 0) {
        out.push({ k: r.k, p: np, m: Math.max(stamp(now), r.m + 1), t: r.t });
        return;
      }
      var ids = onIds(r);
      if (!ids.length) return;
      var gone = cloneRow(r), dst = rowAt(s, "p:" + np);
      var moved = dst ? cloneRow(dst) : { k: "p:" + np, p: np, m: Math.max(stamp(now), 1), t: {} };
      ids.forEach(function (id) { setOne(gone.t, id, false, now); setOne(moved.t, id, true, now); });
      out.push(gone, moved);
    });
    if (!out.length) return s;
    var next = withRows(s, out);
    return same(next, s) ? s : next;
  }
  // Deleted for good (not the Trash): the file's tags go.
  function dropPath(s, path, now) {
    if (!okPath(path)) return s;
    var out = [];
    s.files.forEach(function (r) {
      if (!under(r.p, path) || !onIds(r).length) return;
      var x = cloneRow(r);
      onIds(r).forEach(function (id) { setOne(x.t, id, false, now); });
      out.push(x);
    });
    if (!out.length) return s;
    return withRows(s, out);
  }
  // A tag removed from the list (Documents' dropTag) leaves every file.
  function stripTag(s, id, now) {
    var out = [];
    s.files.forEach(function (r) {
      if (!(r.t[id] > 0)) return;
      var x = cloneRow(r);
      setOne(x.t, id, false, now);
      out.push(x);
    });
    if (!out.length) return s;
    return withRows(s, out);
  }
  // Hash rows whose file was moved elsewhere (another device, another
  // app): entries [{ p, h }] of this device; a row whose last path is
  // not among them and whose content is at one path gets that path.
  function relocate(s, entries, now) {
    var paths = {}, byH = {};
    (entries || []).forEach(function (e) {
      if (!e || !okPath(e.p)) return;
      paths[e.p] = true;
      if (typeof e.h === "string" && HASH.test(e.h)) (byH[e.h] = byH[e.h] || []).push(e.p);
    });
    var out = [];
    s.files.forEach(function (r) {
      if (r.k.indexOf("h:") !== 0 || paths[r.p] || !onIds(r).length) return;
      var at = byH[r.k.slice(2)];
      if (!at || !at.length) return;
      var np = at.slice().sort()[0];
      out.push({ k: r.k, p: np, m: Math.max(stamp(now), r.m + 1), t: r.t });
    });
    if (!out.length) return { state: s, moved: 0 };
    return { state: withRows(s, out), moved: out.length };
  }

  // Smart folders (T2 writes them; kept and merged here from T1 on).
  function newSmartId(now, rnd) {
    var r = typeof rnd === "function" ? rnd : Math.random;
    var tail = "";
    for (var i = 0; i < 6; i++) tail += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(r() * 36));
    return "sf-" + Math.floor(now).toString(36) + tail;
  }
  function findSmart(s, id) {
    for (var i = 0; i < s.smart.length; i++) if (s.smart[i].id === id) return s.smart[i];
    return null;
  }
  // row { id?, n, c?, q }: a new one gets an id; returns { state, id }.
  function putSmart(s, row, now, rnd) {
    if (!isObj(row)) return { state: s, id: "" };
    var id = row.id;
    var old = id ? findSmart(s, id) : null;
    if (!old) {
      if (s.smart.length >= MAX_SMART) return { state: s, id: "" };
      id = newSmartId(now, rnd);
      while (findSmart(s, id) || s.tombs[id]) id = newSmartId(now, rnd);
    }
    var m = Math.max(stamp(now) || 1, old ? old.m + 1 : 1, (s.tombs[id] || 0) + 1);
    var cand = normSmart({ id: id, m: m, n: row.n, c: row.c, q: row.q });
    if (!cand) return { state: s, id: "" };
    if (old && canon(Object.assign({}, old, { m: 0 })) === canon(Object.assign({}, cand, { m: 0 }))) return { state: s, id: id };
    var smart = s.smart.filter(function (x) { return x.id !== id; }).concat([cand]);
    return { state: norm({ v: 1, files: s.files, smart: smart, tombs: s.tombs }), id: id };
  }
  function dropSmart(s, id, now) {
    var old = findSmart(s, id);
    if (!old) return s;
    var tombs = {};
    Object.keys(s.tombs).forEach(function (k) { tombs[k] = s.tombs[k]; });
    tombs[id] = Math.max(stamp(now), old.m);
    return norm({ v: 1, files: s.files, smart: s.smart.filter(function (x) { return x.id !== id; }), tombs: tombs });
  }

  var api = {
    VERSION: "1.0.0", KEY: KEY, SLICE: SLICE, KINDS: KINDS,
    MAX_FILES: MAX_FILES, MAX_ON: MAX_ON, MAX_SMART: MAX_SMART, MAX_NAME: MAX_NAME,
    norm: norm, merge: merge, okPath: okPath, okKey: okKey, keyOf: keyOf, rowAt: rowAt,
    onIds: onIds, index: index, tagsAt: tagsAt, withTag: withTag, counts: counts, hasAny: hasAny,
    setTags: setTags, carry: carry, dropPath: dropPath, stripTag: stripTag, relocate: relocate,
    normQuery: normQuery, findSmart: findSmart, putSmart: putSmart, dropSmart: dropSmart
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosTagsCore = api;
})(this);
