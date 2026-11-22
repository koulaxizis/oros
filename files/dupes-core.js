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
      return { k: items[0].k, s: items[0].s, items: items, waste: items[0].s * (items.length - 1) };
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

  // The copies pre-ticked for the Trash: all but the first of each group.
  function defaultPicks(gs) {
    var out = {};
    (gs || []).forEach(function (g) { g.items.forEach(function (x, i) { if (i) out[x.p] = true; }); });
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
    (gs || []).forEach(function (g) {
      var keep = null;
      g.items.forEach(function (x) { if (!keep && !picked[x.p]) keep = x; });
      if (!keep) return;
      g.items.forEach(function (x) { if (picked[x.p]) out.push({ p: x.p, keep: keep.p, s: x.s, k: g.k }); });
    });
    return out;
  }
  // Groups after copies left (removed paths): a group needs two to stay.
  function without(gs, gone) {
    var out = [];
    (gs || []).forEach(function (g) {
      var items = g.items.filter(function (x) { return !gone[x.p]; });
      if (items.length > 1) out.push({ k: g.k, s: g.s, items: items, waste: g.s * (items.length - 1) });
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

  var api = {
    sameFiles: sameFiles, find: find,
    VERSION: VERSION, ROOT: ROOT, TRASH: TRASH, HEAD: HEAD, HASH_MAX: HASH_MAX, CHUNK: CHUNK,
    MAX_FILES: MAX_FILES, MAX_DIRS: MAX_DIRS,
    skipDir: skipDir, wanted: wanted, splitBy: splitBy, bySize: bySize, keepOrder: keepOrder,
    groups: groups, sameBytes: sameBytes, defaultPicks: defaultPicks, canPick: canPick, plan: plan,
    without: without, totals: totals, hex: hex, isHash: isHash, cacheOk: cacheOk
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosDupesCore = api;
})(typeof window !== "undefined" ? window : this);
