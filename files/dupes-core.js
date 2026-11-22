// ============================================================
// orOS Files — dupes-core.js: exact duplicate finder (DUPES-1, wave K1).
// Pure: no DOM, no disk. Exposes window.OrosDupesCore (browser) or
// module.exports (Node tests, tests/files-dupes.test.js).
//
// Two files are duplicates only when every byte is the same. Names,
// dates and folders never count. files/dupes.js gets there in steps,
// each one only over what the step before left together:
//   1. same size (files of 0 bytes are never duplicates);
//   2. same SHA-256 of the first HEAD bytes (only for files bigger
//      than HEAD, and only in a size group with no cloud-only file);
//   3. same SHA-256 of the whole file (the vault manifest's hash for
//      a cloud-only orOS Drive file, worked out on the device for
//      every file that is here); a file bigger than HASH_MAX is not
//      hashed but compared with the others chunk by chunk (sameBytes);
//   4. right before a copy goes to the Trash, the copy kept and the
//      copy removed are read again and compared byte by byte.
// In every group one copy always stays: the first one by keepOrder.
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var ROOT = "/internal";
  var TRASH = ROOT + "/.trash";
  var HEAD = 64 * 1024;                 // step 2
  var HASH_MAX = 256 * 1048576;         // above: compared in chunks, not hashed
  var CHUNK = 8 * 1048576;              // chunk size for byte comparisons
  var MAX_FILES = 100000, MAX_DIRS = 20000;

  function isStr(x) { return typeof x === "string"; }
  function isHash(h) { return isStr(h) && /^[0-9a-f]{64}$/.test(h); }

  // A folder the finder never walks into: the Trash and every folder
  // whose name starts with a dot (app data such as /internal/.docs).
  function skipDir(p) {
    if (!isStr(p)) return true;
    if (p === TRASH || p.indexOf(TRASH + "/") === 0) return true;
    var parts = p.split("/");
    for (var i = 0; i < parts.length; i++) if (parts[i].charAt(0) === "." ) return true;
    return false;
  }
  // A file the finder looks at: inside the place, not skipped, not empty.
  function wanted(p, size, base) {
    base = base || ROOT;
    if (!isStr(p) || (p !== base && p.indexOf(base + "/") !== 0)) return false;
    if (!(size > 0)) return false;
    var dir = p.slice(0, p.lastIndexOf("/"));
    var name = p.slice(p.lastIndexOf("/") + 1);
    return !!name && name.charAt(0) !== "." && !skipDir(dir);
  }

  // Splits list into groups of at least two by key(x); falsy keys and
  // lone items drop out. Groups keep the input order.
  function splitBy(list, key) {
    var map = {}, order = [];
    (list || []).forEach(function (x) {
      var k = key(x);
      if (k === "" || k === null || k === undefined || k === false) return;
      k = String(k);
      if (!map[k]) { map[k] = []; order.push(k); }
      map[k].push(x);
    });
    var out = [];
    order.forEach(function (k) { if (map[k].length > 1) out.push(map[k]); });
    return out;
  }
  // Step 1: files [{ p, s, … }] → groups that share a size.
  function bySize(files) {
    return splitBy((files || []).filter(function (f) { return f && isStr(f.p) && f.s > 0; }), function (f) { return f.s; });
  }

  // Which copy stays: one the person marked (a favourite, a document,
  // tags, an album item kept by path), then one that is on this
  // device, then the oldest, then the shortest path, then the first
  // path. Same input, same order.
  function keepOrder(a, b) {
    var ia = a.imp ? 1 : 0, ib = b.imp ? 1 : 0;
    if (ia !== ib) return ib - ia;
    var ca = a.cloud ? 1 : 0, cb = b.cloud ? 1 : 0;
    if (ca !== cb) return ca - cb;
    var ma = a.m > 0 ? a.m : Infinity, mb = b.m > 0 ? b.m : Infinity;
    if (ma !== mb) return ma < mb ? -1 : 1;
    if (a.p.length !== b.p.length) return a.p.length - b.p.length;
    return a.p < b.p ? -1 : a.p > b.p ? 1 : 0;
  }

  // Step 3 result: files that carry a key `k` (the full SHA-256, or
  // "b:<path>" of the first file a big file matched byte by byte) →
  // [{ k, s, items (keeper first), waste }], most space to win first.
  function groups(files) {
    var out = splitBy(files, function (f) { return f.k; }).map(function (g) {
      var items = g.slice().sort(keepOrder);
      return { kind: "same", k: items[0].k, s: items[0].s, items: items, waste: items[0].s * (items.length - 1) };
    });
    out.sort(function (a, b) {
      if (a.waste !== b.waste) return b.waste - a.waste;
      return a.items[0].p < b.items[0].p ? -1 : a.items[0].p > b.items[0].p ? 1 : 0;
    });
    return out;
  }

  // Byte by byte, two Uint8Arrays.
  function sameBytes(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // The copies pre-ticked for the Trash: all but the first of each
  // group, never in a "meta" group (its copies differ in details).
  function defaultPicks(gs) {
    var out = {};
    (gs || []).forEach(function (g) { if (g.kind !== "meta") g.items.forEach(function (x, i) { if (i) out[x.p] = true; }); });
    return out;
  }
  // May `p` be ticked? Only while another copy of its group stays.
  function canPick(g, picked, p) {
    if (!g) return false;
    var left = 0;
    g.items.forEach(function (x) { if (x.p !== p && !picked[x.p]) left++; });
    return left > 0;
  }
  // The removal plan: [{ p, keep }] for every ticked copy, each paired
  // with the first copy of its group that stays. A group where every
  // copy is ticked removes nothing (the picks there are a mistake).
  function plan(gs, picked) {
    var out = [];
    var done = {};
    (gs || []).forEach(function (g, gi) {
      var keep = null;
      g.items.forEach(function (x) { if (!keep && !picked[x.p]) keep = x; });
      if (!keep) return;
      g.items.forEach(function (x) {
        if (!picked[x.p] || done[x.p]) return;
        done[x.p] = true;
        out.push({ p: x.p, keep: keep.p, s: x.s, k: g.k, gi: gi });
      });
    });
    return out;
  }
  // Space a group frees: all but one copy (meta: all but the biggest).
  function wasteOf(kind, items, s) {
    if (kind !== "meta") return s * (items.length - 1);
    var sum = 0, big = 0;
    items.forEach(function (x) { sum += x.s; if (x.s > big) big = x.s; });
    return sum - big;
  }
  // Groups after copies left (removed paths): a group needs two to
  // stay. A removed folder takes every group copy inside it along.
  function without(gs, gone) {
    var dirs = Object.keys(gone || {}).map(function (p) { return p + "/"; });
    function off(p) {
      if (gone[p]) return true;
      for (var i = 0; i < dirs.length; i++) if (p.indexOf(dirs[i]) === 0) return true;
      return false;
    }
    var out = [];
    (gs || []).forEach(function (g) {
      var items = g.items.filter(function (x) { return !off(x.p); });
      if (items.length > 1) out.push({ kind: g.kind, k: g.k, s: g.s, items: items, waste: wasteOf(g.kind, items, g.s) });
    });
    return out;
  }
  function totals(gs, picked) {
    var t = { groups: 0, copies: 0, waste: 0, picked: 0, bytes: 0 };
    (gs || []).forEach(function (g) {
      t.groups++;
      t.copies += g.items.length;
      t.waste += g.waste;
      g.items.forEach(function (x) { if (picked && picked[x.p]) { t.picked++; t.bytes += x.s; } });
    });
    return t;
  }

  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  // Device-local cache key: a hash is reused only while path, size and
  // time are what they were when it was worked out.
  function cacheOk(rec, f) {
    return !!(rec && f && rec.p === f.p && rec.s === f.s && rec.m === f.m && f.m > 0);
  }

  // Byte by byte, two files of the same size, CHUNK at a time:
  // read(f, offset, length) → Promise<Uint8Array>. Resolves true only
  // when every chunk matched; a read that fails is "not the same".
  function sameFiles(a, b, read, live) {
    if (!a || !b || a.s !== b.s || !(a.s > 0)) return Promise.resolve(false);
    var size = a.s;
    function step(off) {
      if (off >= size) return Promise.resolve(true);
      if (live && !live()) return Promise.resolve(false);
      var n = Math.min(CHUNK, size - off);
      return Promise.all([read(a, off, n), read(b, off, n)]).then(function (r) {
        if (!r[0] || !r[1] || r[0].length !== n || !sameBytes(r[0], r[1])) return false;
        return step(off + n);
      });
    }
    return step(0).catch(function () { return false; });
  }

  // The whole search over files [{ p, s, m, h?, cloud?, imp? }].
  // io: head(f) and hash(f) → Promise<hex>, read(f, off, len) →
  // Promise<Uint8Array>, tick() after each file of a size group,
  // live() false stops (resolves null). A file whose read fails drops
  // out. A cloud-only file takes part only with its manifest hash and
  // only up to HASH_MAX (bigger ones cannot be compared unread).
  function find(files, io, opts) {
    opts = opts || {};
    var live = io.live || function () { return true; };
    var head = opts.head > 0 ? opts.head : HEAD, max = opts.hashMax > 0 ? opts.hashMax : HASH_MAX;
    var sg = bySize((files || []).filter(function (f) { return !f.cloud || isHash(f.h); }));
    var keyed = [];
    function tick() { if (io.tick) io.tick(); }
    function seq(list, fn) {
      return list.reduce(function (p, x) { return p.then(function () { return live() ? fn(x) : null; }); }, Promise.resolve());
    }
    function full(sub) {
      if (sub[0].s > max) {
        // Big files: here only, chunk by chunk against one copy per bucket.
        var reps = [];
        return seq(sub.filter(function (f) { return !f.cloud; }), function (f) {
          var i = 0;
          function next() {
            if (i >= reps.length) { reps.push(f); f.k = "b:" + f.p; tick(); return null; }
            var r = reps[i++];
            return sameFiles(r, f, io.read, live).then(function (same) {
              if (same) { f.k = r.k; tick(); return null; }
              return next();
            });
          }
          return next();
        }).then(function () { sub.forEach(function (f) { if (f.k) keyed.push(f); }); });
      }
      return seq(sub, function (f) {
        if (f.cloud) { f.k = f.h; keyed.push(f); tick(); return null; }
        return io.hash(f).then(function (h) {
          if (isHash(h)) { f.k = h; keyed.push(f); }
        }, function () {}).then(tick);
      });
    }
    return seq(sg, function (g) {
      g.forEach(function (f) { delete f.k; });
      var anyCloud = g.some(function (f) { return f.cloud; });
      if (g[0].s <= head || anyCloud) return full(g);
      var heads = {};
      return seq(g, function (f) {
        return io.head(f).then(function (h) { heads[f.p] = isHash(h) ? h : ""; }, function () { heads[f.p] = ""; });
      }).then(function () {
        var subs = splitBy(g, function (f) { return heads[f.p]; });
        g.forEach(function (f) { if (!subs.some(function (s) { return s.indexOf(f) !== -1; })) tick(); });
        return seq(subs, full);
      });
    }).then(function () { return live() ? groups(keyed) : null; });
  }

  // ---------- K2: same content, other hidden details ----------
  // Pictures and sounds whose content is the same byte for byte once
  // the hidden details are left out (clean-core's JPEG / PNG / WebP
  // cleaners, ID3 tags of MP3). Never pre-ticked: the details differ.
  var META_MAX = 64 * 1048576;           // bigger files are not read for this
  var JPEG_HEAD = 256 * 1024;            // JPEG headers are read from here
  function metaKind(p) {
    var m = /\.([a-z0-9]+)$/i.exec(String(p || ""));
    var e = m ? m[1].toLowerCase() : "";
    if (e === "jpg" || e === "jpeg" || e === "jfif") return "jpeg";
    if (e === "png") return "png";
    if (e === "webp") return "webp";
    if (e === "mp3") return "mp3";
    return "";
  }
  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
  // JPEG: the bytes from the start-of-scan marker to the end never
  // change with the details; their count is a cheap first filter.
  // head = the first bytes of the file → the scan length, or -1.
  function jpegScanLen(head, size) {
    if (!head || head.length < 4 || head[0] !== 0xff || head[1] !== 0xd8) return -1;
    var p = 2;
    while (p + 4 <= head.length) {
      if (head[p] !== 0xff) return -1;
      var m = head[p + 1];
      if (m === 0xff) { p++; continue; }
      if (m === 0xda) return size - p;
      if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
      var len = u16(head, p + 2);
      if (len < 2) return -1;
      p += 2 + len;
    }
    return -1;
  }
  // MP3: ID3v2 at the start (size in the header, a footer adds 10),
  // ID3v1 ("TAG", 128 bytes) at the end. → [start, end) of the sound.
  function mp3Range(head, tail, size) {
    var a = 0, z = size;
    if (head && head.length >= 10 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      var n = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
      a = 10 + n + ((head[5] & 0x10) ? 10 : 0);
    }
    if (tail && tail.length === 128 && tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47) z = size - 128;
    if (a >= z) return null;
    return [a, z];
  }
  // The content without its hidden details, or null when it cannot be
  // read as that kind. clean = window.orosClean (clean-core.js).
  function stripped(kind, b, clean) {
    try {
      if (kind === "jpeg") return clean.cleanJpeg(b).bytes;
      if (kind === "png") return clean.cleanPng(b).bytes;
      if (kind === "webp") return clean.cleanWebp(b).bytes;
      if (kind === "mp3") {
        var r = mp3Range(b.subarray(0, 10), b.length >= 128 ? b.subarray(b.length - 128) : null, b.length);
        return r ? b.subarray(r[0], r[1]) : null;
      }
    } catch (e) {}
    return null;
  }
  // files [{ p, s, kind, pre (cheap first key: scan length, sound
  // length, or the size for PNG / WebP), c? (hash of the stripped
  // content), k? (exact key) }] → groups of kind "meta": the same
  // stripped content, more than one exact copy among them (an exact
  // group is already shown). Items carry their own size.
  function metaGroups(files) {
    var out = splitBy((files || []).filter(function (f) { return f && isHash(f.c); }), function (f) { return f.kind + ":" + f.c; })
      .filter(function (g) {
        var ks = {};
        g.forEach(function (f) { ks[f.k || "p:" + f.p] = true; });
        return Object.keys(ks).length > 1;
      })
      .map(function (g) {
        // One row per exact copy set: exact twins are in their own group.
        var seen = {}, items = [];
        g.slice().sort(keepOrder).forEach(function (f) {
          var key = f.k || "p:" + f.p;
          if (seen[key]) return;
          seen[key] = true;
          items.push(f);
        });
        return { kind: "meta", k: "c:" + items[0].c, s: items[0].s, items: items, waste: wasteOf("meta", items) };
      })
      .filter(function (g) { return g.items.length > 1; });
    out.sort(function (a, b) { return b.waste - a.waste || (a.items[0].p < b.items[0].p ? -1 : 1); });
    return out;
  }

  // ---------- K2: identical folders ----------
  function parentOf(p) { return p.slice(0, p.lastIndexOf("/")); }
  // files: every file of the search [{ p, s, m, k?, cloud?, imp? }]
  // (k = exact key, set only for files that have a twin by size).
  // Folders below base whose whole content (relative paths and exact
  // keys, every file keyed) is the same, with at least one file. Only
  // the outermost twins are listed: when the parents are twins, their
  // children go with them. → groups of kind "dir" with items
  // { p (folder), s (bytes), m (oldest file), n (files), cloud, imp }.
  function folderTwins(files, base) {
    base = base || ROOT;
    var sig = {}, bad = {}, info = {};
    (files || []).forEach(function (f) {
      if (!f || !isStr(f.p)) return;
      var d = parentOf(f.p);
      while (d.length > base.length && d.indexOf(base + "/") === 0) {
        if (!f.k) bad[d] = true;
        else if (!bad[d]) {
          (sig[d] = sig[d] || []).push(f.p.slice(d.length + 1) + "\u0000" + f.k);
          var i = info[d] || (info[d] = { p: d, s: 0, m: 0, n: 0, cloud: false, imp: false });
          i.s += f.s || 0; i.n++;
          if (f.m > 0 && (!i.m || f.m < i.m)) i.m = f.m;
          if (f.cloud) i.cloud = true;
          if (f.imp) i.imp = true;
        }
        d = parentOf(d);
      }
    });
    var dirs = Object.keys(sig).filter(function (d) { return !bad[d]; });
    var groupsOf = splitBy(dirs, function (d) { return sig[d].sort().join("\u0001"); });
    var member = {};
    groupsOf.forEach(function (g) { g.forEach(function (d) { member[d] = true; }); });
    var out = groupsOf.filter(function (g) {
      return !g.every(function (d) { return member[parentOf(d)]; });
    }).map(function (g) {
      var items = g.map(function (d) { return info[d]; }).sort(keepOrder);
      return { kind: "dir", k: "d:" + items[0].p, s: items[0].s, items: items, waste: items[0].s * (items.length - 1) };
    });
    out.sort(function (a, b) { return b.waste - a.waste || (a.items[0].p < b.items[0].p ? -1 : 1); });
    return out;
  }
  // File groups without the copies inside folders that go as a whole
  // (every folder of a "dir" group but its first).
  function outsideFolders(fileGroups, dirGroups) {
    var gone = [];
    (dirGroups || []).forEach(function (g) { g.items.forEach(function (x, i) { if (i) gone.push(x.p + "/"); }); });
    if (!gone.length) return fileGroups;
    function inside(p) { for (var i = 0; i < gone.length; i++) if (p.indexOf(gone[i]) === 0) return true; return false; }
    var out = [];
    (fileGroups || []).forEach(function (g) {
      var items = g.items.filter(function (x) { return !inside(x.p); });
      if (items.length > 1) out.push({ kind: g.kind, k: g.k, s: g.s, items: items, waste: wasteOf(g.kind, items, g.s) });
    });
    return out;
  }

  var api = {
    META_MAX: META_MAX, JPEG_HEAD: JPEG_HEAD, metaKind: metaKind, jpegScanLen: jpegScanLen, mp3Range: mp3Range,
    stripped: stripped, metaGroups: metaGroups, folderTwins: folderTwins, outsideFolders: outsideFolders, parentOf: parentOf,
    sameFiles: sameFiles, find: find,
    VERSION: VERSION, ROOT: ROOT, TRASH: TRASH, HEAD: HEAD, HASH_MAX: HASH_MAX, CHUNK: CHUNK,
    MAX_FILES: MAX_FILES, MAX_DIRS: MAX_DIRS,
    skipDir: skipDir, wanted: wanted, splitBy: splitBy, bySize: bySize, keepOrder: keepOrder,
    groups: groups, sameBytes: sameBytes, defaultPicks: defaultPicks, canPick: canPick, plan: plan,
    without: without, totals: totals, wasteOf: wasteOf, hex: hex, isHash: isHash, cacheOk: cacheOk
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosDupesCore = api;
})(typeof window !== "undefined" ? window : this);
