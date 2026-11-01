// ============================================================
// orOS — vault.js (Vault Drive, Wave 2: encrypted sync)
// ------------------------------------------------------------
// Encrypted virtual disk on top of the unified storage adapter
// (orOS Bible rule: apps never talk to providers — this module
// talks to orosSync.storage ONLY, so the vault works unchanged
// on Dropbox today and any compliant provider tomorrow).
//
// Architecture:
//   • Manifest: one small encrypted JSON (orOS-sync.storage key
//     "manifest.json") — the single source of truth. Contains
//     per-file entries: { h: sha256-plaintext, s: size,
//     m: mtime, mime }. Paths live ONLY inside the encrypted
//     manifest — the provider never learns names or structure.
//   • Objects: file content stored content-addressed as
//     "objects/<sha256-of-plaintext>", encrypted with the SAME
//     passphrase-derived key model as the main orOS blob.
//     Copies and renames never re-upload (same content hash).
//   • Local state: files live in OPFS via window.orosFS (Files
//     app continues to work fully offline). Local manifest cache
//     + rev let pull detect cloud changes cheaply.
//   • Dirty queue: localStorage list of paths with unpushed local
//     work (survives offline; flushed on next online sync).
//   • Conflict model: last-writer-wins PER FILE (mtime), with the
//     dirty queue acting as the "local work in flight" override —
//     a queued path is never overwritten by a remote pull.
//     Conditional manifest write (knownRev) makes concurrent
//     pushes from two devices fail loudly (storage-conflict) and
//     converge on retry instead of blind-overwriting.
//
// Limits (documented, Wave 2): encryption is whole-file in RAM
// (SubtleCrypto has no streaming) — files of many hundreds of MB
// are heavy on memory. Deleted and replaced files leave their
// encrypted objects behind (provider space only, nothing leaks);
// VD-GC removes them only when the person asks (Settings › Sync).
// ============================================================
(function () {
  "use strict";

  // ---------- Configuration / constants ----------
  var MANIFEST_KEY   = "manifest.json";
  var KEY_FILE       = "key.json";                // VD-KEY: the wrapped vault key
  var SEED_KEY       = "oros-vault-seeded";       // FILES-V: this device's disk was queued once
  var CONFLICT_KEY   = "oros-vault-conflicts";    // FILES-V: { path: remoteHash } copies already made
  var ROOT_PATH      = "/internal";
  var OBJECTS_PREFIX = "objects/";
  var QUEUE_KEY      = "oros-vault-queue";        // dirty paths pending push
  var LM_KEY         = "oros-vault-manifest";     // local manifest cache
  var REV_KEY        = "oros-vault-rev";          // last-synced manifest rev
  var ABSENT_KEY     = "oros-vault-absent-at";    // ts of last "no manifest" probe
  var ABSENT_TTL_MS  = 60000;                     // absent-quiet window
  var DEBOUNCE_MS    = 3000;                      // auto-sync quiet period
  var MAX_SYNC_TRIES = 2;                         // conflict retry budget
  // VD-OD: files under DRIVE_ROOT (folders mirrored from computers and
  // phones by the orOS Drive app) stay in the cloud until opened, so a
  // phone's browser does not fill up with a desktop's folders.
  var DRIVE_ROOT     = "/internal/Drive";
  var OD_KEY         = "oros-vault-ondemand";     // { path: entry } in the cloud, not on this device
  var OFFLINE_KEY    = "oros-vault-offline";      // [folder] kept on this device (device-local)

  // ---------- Internal state ----------
  var syncInFlight   = false;
  var debounceTimer  = null;
  var listeners      = [];                        // status subscribers

  // ---------- Accessors (late-bound: vault boots before FS?) ----------
  function S()  { return window.orosSync; }
  function ST() { return window.orosSync && window.orosSync.storage; }
  function VC() { return window.orosSync && window.orosSync.vaultCrypto; }
  function FS() { return window.orosFS; }

  function usable() {
    return !!(ST() && VC() && FS() &&
              S().isConnected() && S().hasPassphrase());
  }

  // ---------- Small helpers ----------
  function readJson(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeJson(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }
  function nowIso() { return new Date().toISOString(); }

  function emit(kind, detail) {
    listeners.forEach(function (fn) {
      try { fn(kind, detail); } catch (e) {}
    });
    console.log("[orOS] vault:", kind, detail || "");
  }

  // ---------- Dirty queue (local work in flight) ----------
  // VD-5: the queue is a MAP path → generation. A plain list had no
  // way to tell "the edit this sync uploaded" from "an edit made
  // WHILE the sync ran": the old clearQueue() dropped both, so a
  // file saved during a sync was never uploaded — and, unqueued, it
  // was fair game for the next remote version to overwrite. A path
  // now leaves the queue only if its generation is still the one
  // the sync picked up. (An older stored LIST is read as a map.)
  var queueSeq = 0;
  function getQueueMap() {
    var q = readJson(QUEUE_KEY);
    var out = {};
    if (Array.isArray(q)) {
      q.forEach(function (p) { if (typeof p === "string") out[p] = 1; });
    } else if (q && typeof q === "object") {
      Object.keys(q).forEach(function (p) { out[p] = q[p]; });
    }
    return out;
  }
  function setQueueMap(m) {
    if (Object.keys(m).length) writeJson(QUEUE_KEY, m);
    else localStorage.removeItem(QUEUE_KEY);
  }
  function getQueue() { return Object.keys(getQueueMap()); }
  function queueHas(path) {
    return Object.prototype.hasOwnProperty.call(getQueueMap(), path);
  }
  function queueTouch(path) {
    var m = getQueueMap();
    queueSeq = Math.max(queueSeq + 1, Date.now());
    m[path] = queueSeq;
    setQueueMap(m);
  }
  // Listeners only, no console line (a pill wants to know that
  // something is waiting; the log does not need one line per file).
  function tellQueue() {
    listeners.forEach(function (fn) {
      try { fn("queue", getQueue().length); } catch (e) {}
    });
  }
  function queueAdd(path) {
    queueTouch(path);
    armDebounce();
    tellQueue();
  }
  // Settle what a sync really pushed: only generations it picked up.
  function queueSettle(done) {
    var m = getQueueMap();
    Object.keys(done).forEach(function (p) {
      if (m[p] === done[p]) delete m[p];
    });
    setQueueMap(m);
  }

  function queueTouchMany(paths) {
    if (!paths.length) return;
    var m = getQueueMap();
    for (var i = 0; i < paths.length; i++) {
      queueSeq = Math.max(queueSeq + 1, Date.now());
      m[paths[i]] = queueSeq;
    }
    setQueueMap(m);
  }
  function queueDrop(path) {
    var m = getQueueMap();
    if (Object.prototype.hasOwnProperty.call(m, path)) { delete m[path]; setQueueMap(m); }
  }

  // ---------- FILES-V: who changed the disk? ----------
  // fs.js reports EVERY mutation of the disk to this module (write →
  // fileChanged, delete / move → touchTree), whoever caused it. That
  // includes the writes this module makes itself while applying a
  // remote change — those must not come back as "local work".
  // Path-specific and counted: a user edit of ANOTHER file during
  // the same moment is still seen.
  var ownWrites = {};
  function ownBegin(path) { ownWrites[path] = (ownWrites[path] || 0) + 1; }
  function ownEnd(path) {
    if (ownWrites[path] > 1) ownWrites[path]--; else delete ownWrites[path];
  }
  function ownWrite(path, blob) {
    ownBegin(path);
    return FS().write(path, blob).then(function (r) { ownEnd(path); return r; },
                                       function (e) { ownEnd(path); throw e; });
  }
  function ownRemove(path) {
    ownBegin(path);
    return FS().rm(path).then(function (r) { ownEnd(path); return r; },
                              function (e) { ownEnd(path); throw e; });
  }

  // Every FILE at or under a path (a missing path = none).
  function walkFiles(path) {
    return FS().stat(path).then(function (st) {
      if (!st.dir) return [path];
      return FS().ls(path).then(function (list) {
        var out = [], chain = Promise.resolve();
        (list || []).forEach(function (e) {
          var child = path + "/" + e.name;
          chain = chain.then(function () {
            if (!e.dir) { out.push(child); return null; }
            return walkFiles(child).then(function (more) { out = out.concat(more); });
          });
        });
        return chain.then(function () { return out; });
      });
    }, function () { return []; });
  }

  // "Something changed at or under this path": queue every file this
  // device has synced there (covers deletions and moves away) and
  // every file that is there now (covers creations and moves in).
  // The push sorts them out: gone = deletion, same bytes = nothing.
  function touchTree(path) {
    if (typeof path !== "string" || !path || ownWrites[path]) return Promise.resolve(0);
    var known = [], pre = path + "/", lm = getLocalManifest();
    Object.keys(lm.files).forEach(function (p) {
      if (p === path || p.indexOf(pre) === 0) known.push(p);
    });
    return walkFiles(path).then(function (found) {
      var all = known.concat(found);
      queueTouchMany(all);
      if (all.length) { armDebounce(); tellQueue(); }
      return all.length;
    });
  }

  // ---------- Local manifest cache + rev ----------
  function emptyManifest() { return { ver: 1, files: {} }; }
  function getLocalManifest() {
    var m = readJson(LM_KEY);
    return (m && m.files && typeof m.files === "object") ? m : emptyManifest();
  }
  function setLocalManifest(m) { writeJson(LM_KEY, m); }
  function setRev(r) {
    if (r) localStorage.setItem(REV_KEY, r);
    else localStorage.removeItem(REV_KEY);
  }
  function getRev() { return localStorage.getItem(REV_KEY) || null; }

  // ---------- VD-OD: on-demand paths ----------
  function under(path, root) { return path === root || path.indexOf(root + "/") === 0; }
  function getOnDemand() {
    var m = readJson(OD_KEY);
    return (m && typeof m === "object" && !Array.isArray(m)) ? m : {};
  }
  function setOnDemand(m) {
    if (Object.keys(m).length) writeJson(OD_KEY, m);
    else { try { localStorage.removeItem(OD_KEY); } catch (e) {} }
  }
  function offlineFolders() {
    var l = readJson(OFFLINE_KEY);
    return Array.isArray(l) ? l.filter(function (p) { return typeof p === "string" && under(p, DRIVE_ROOT); }) : [];
  }
  function keptOffline(path) {
    return offlineFolders().some(function (f) { return under(path, f); });
  }
  function isOnDemand(path) {
    return under(path, DRIVE_ROOT) && path !== DRIVE_ROOT && !keptOffline(path);
  }

  // ---------- FS error kinds ----------
  // fs.js answers string codes; the DOMException name/number is
  // accepted too (a cached older fs.js on OPFS let them through).
  function isMissing(e) {
    return !!e && (e.code === "ENOENT" || e.name === "NotFoundError" || e.code === 8);
  }
  function isDirErr(e) {
    return !!e && (e.code === "EISDIR" || e.name === "TypeMismatchError" || e.code === 17);
  }
  function fsReady() {
    return (typeof FS().ready === "function") ? FS().ready() : Promise.resolve();
  }

  // ---------- VD-KEY: the vault key ----------
  // The Vault used to be encrypted directly with the passphrase, and
  // its objects were named by the SHA-256 of their PLAINTEXT. Two
  // consequences: changing the passphrase re-encrypted only the main
  // blob and left the whole Vault unreadable on every device; and the
  // provider could test whether a KNOWN file was stored.
  // Now: one random 32-byte vault key, stored in the cloud as
  // key.json = { ver:1, wraps:[…] }, each wrap being that key sealed
  // with a passphrase (sync.js re-wraps it on a passphrase change —
  // one small file, the content is never touched). From it:
  //   · an AES-GCM key   → manifest + objects (envelope 0x02|iv|data)
  //   · an HMAC key      → object names: HMAC(plaintext hash) — the
  //                        provider sees neither names nor contents
  //                        nor content fingerprints.
  // LEGACY (before VD-KEY): a manifest that is passphrase-sealed JSON
  // text, entries whose objects are "objects/<plaintext hash>" in the
  // passphrase envelope. They are read as entries marked v:1 and are
  // converted the next time this device pushes them (it holds the
  // file); the old object is removed only after the new manifest has
  // landed.
  var vaultKeys = null;                           // { enc, mac } — memory only

  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += ("0" + b[i].toString(16)).slice(-2);
    return s;
  }
  function b64FromBytes(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function bytesFromB64(str) {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function subKey(raw, label) {
    var tag = new TextEncoder().encode(label);
    var buf = new Uint8Array(tag.length + raw.length);
    buf.set(tag, 0);
    buf.set(raw, tag.length);
    return crypto.subtle.digest("SHA-256", buf);
  }
  function deriveVaultKeys(raw) {
    return Promise.all([subKey(raw, "orOS-vault-enc:"), subKey(raw, "orOS-vault-name:")])
      .then(function (d) {
        return Promise.all([
          crypto.subtle.importKey("raw", d[0], { name: "AES-GCM" }, false, ["encrypt", "decrypt"]),
          crypto.subtle.importKey("raw", d[1], { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
        ]);
      })
      .then(function (k) { return { enc: k[0], mac: k[1] }; });
  }

  // Open the wraps with the passphrase currently in memory.
  function openWraps(doc) {
    var wraps = (doc && Array.isArray(doc.wraps)) ? doc.wraps : [];
    function tryAt(i) {
      if (i >= wraps.length) return Promise.reject(new Error("vault-key-locked"));
      return VC().decryptJson(wraps[i]).then(function (o) {
        if (!o || typeof o.k !== "string") throw new Error("bad wrap");
        return bytesFromB64(o.k);
      }).catch(function () { return tryAt(i + 1); });
    }
    return tryAt(0);
  }

  // create = true only on the push path: a vault with nothing in it
  // needs no key yet.
  function loadVaultKeys(create) {
    if (vaultKeys) return Promise.resolve(vaultKeys);
    return ST().getObject(KEY_FILE).then(function (buf) {
      if (buf) {
        var doc;
        try { doc = JSON.parse(new TextDecoder().decode(buf)); }
        catch (e) { throw new Error("bad vault key file"); }
        return openWraps(doc).then(deriveVaultKeys);
      }
      if (!create) return null;
      var raw = new Uint8Array(32);
      crypto.getRandomValues(raw);
      return VC().encryptJson({ k: b64FromBytes(raw) }).then(function (sealed) {
        // "null" = create only: if another device made the key first,
        // ours is discarded and theirs is used.
        return ST().putObject(KEY_FILE, JSON.stringify({ ver: 1, wraps: [sealed] }), null);
      }).then(function () {
        return deriveVaultKeys(raw);
      }, function (e) {
        if (e && e.message === "storage-conflict") return loadVaultKeys(false);
        throw e;
      });
    }).then(function (k) {
      if (k) vaultKeys = k;
      return k;
    });
  }

  function sealV2(buf) {
    var iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, vaultKeys.enc, buf)
      .then(function (ct) {
        var out = new Uint8Array(1 + 12 + ct.byteLength);
        out[0] = 2;
        out.set(iv, 1);
        out.set(new Uint8Array(ct), 13);
        return out.buffer;
      });
  }
  function openV2(buf) {
    var env = new Uint8Array(buf);
    if (env.length < 14 || env[0] !== 2) return Promise.reject(new Error("bad vault envelope"));
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: env.slice(1, 13) }, vaultKeys.enc, env.slice(13));
  }
  function objectKey(hash) {
    return crypto.subtle.sign("HMAC", vaultKeys.mac, new TextEncoder().encode(hash))
      .then(function (sig) { return OBJECTS_PREFIX + hex(sig); });
  }

  // ---------- Cloud manifest fetch ----------
  // ABSENT-QUIET: probing an EMPTY vault costs one 409 per sweep
  // (boot + every tab-visible + every "online"). The browser paints
  // that 409 red in the console — alarming noise for a state the
  // code already handles. While this device has NOTHING to do with
  // the vault (nothing queued, nothing ever synced), the "absent"
  // verdict is cached for ABSENT_TTL_MS; the first sweep after the
  // TTL re-probes, so a manifest created by another device is picked
  // up within ~ABSENT_TTL_MS.
  // VD-2: the cache is used ONLY in that empty state. It used to be
  // trusted with files already synced: right after this device's own
  // first push, the next sweep read the minute-old "absent" verdict
  // as "the cloud has no files" and deleted the local copy of what
  // had just been uploaded.
  // The manifest as stored → { ver:1, files } as used in memory.
  // First byte "{" = LEGACY (passphrase-sealed JSON text); 0x02 = v2.
  function openManifest(buf) {
    var first = new Uint8Array(buf)[0];
    if (first === 0x7B) {
      return VC().decryptJson(new TextDecoder().decode(buf)).then(function (m) {
        if (!m || m.ver !== 1 || !m.files) throw new Error("bad manifest");
        var files = {};
        Object.keys(m.files).forEach(function (p) {
          var e = m.files[p];
          if (e && typeof e.h === "string") {
            files[p] = { h: e.h, s: e.s, m: e.m, mime: e.mime, v: 1 };
          }
        });
        return { ver: 1, files: files };
      });
    }
    function attempt(retried) {
      return loadVaultKeys(false).then(function (k) {
        if (!k) throw new Error("vault key missing");
        return openV2(buf);
      }).then(function (plain) {
        var m = JSON.parse(new TextDecoder().decode(plain));
        if (!m || m.ver !== 2 || !m.files) throw new Error("bad manifest");
        return { ver: 1, files: m.files };
      }, function (e) {
        // A key cached from BEFORE the cloud vault was wiped and
        // rebuilt elsewhere cannot open the new manifest: forget it,
        // fetch the current key once, try again.
        if (!retried && vaultKeys) { vaultKeys = null; return attempt(true); }
        throw e;
      });
    }
    return attempt(false);
  }

  function fetchCloudManifest(lm) {
    var idle = getQueue().length === 0 && Object.keys(lm.files).length === 0;
    var absentAt = parseInt(localStorage.getItem(ABSENT_KEY) || "0", 10) || 0;
    if (idle && Date.now() - absentAt < ABSENT_TTL_MS) {
      return Promise.resolve({ rev: null, manifest: emptyManifest() });
    }
    return ST().getRevision(MANIFEST_KEY).then(function (rev) {
      // FILES-V: the vault is now asked after every engine cycle. The
      // manifest is downloaded only when its revision moved since the
      // last sync that completed WITHOUT a failed file (setRev below);
      // an idle check costs one metadata call.
      if (rev !== null && rev === getRev() && getQueue().length === 0) {
        return { rev: rev, manifest: { ver: 1, files: lm.files }, same: true };
      }
      if (rev === null) {
        // No manifest in the cloud — empty vault (first run / after wipe)
        try { localStorage.setItem(ABSENT_KEY, String(Date.now())); } catch (e) {}
        return { rev: null, manifest: emptyManifest() };
      }
      return ST().getObject(MANIFEST_KEY).then(function (buf) {
        if (!buf) return { rev: null, manifest: emptyManifest() };
        return openManifest(buf).then(function (m) {
          try { localStorage.removeItem(ABSENT_KEY); } catch (e) {}
          return { rev: rev, manifest: m };
        });
      });
    });
  }

  // ---------- Object download / decrypt ----------
  // VD-H (2026-10-07): the decrypted content must hash to the
  // manifest's `h`. AES-GCM proves an object was sealed with the
  // vault key, not WHICH file it is: anyone with write access to the
  // app folder could swap two objects (or put back an old one) and
  // one file's content would be written at another file's path.
  function checkedPlain(entry) {
    return function (plain) {
      return VC().sha256Hex(plain).then(function (h) {
        if (h !== entry.h) throw new Error("vault object does not match its manifest entry");
        return plain;
      });
    };
  }
  function downloadObject(entry) {
    if (entry.v === 1) {                           // LEGACY object
      return ST().getObject(OBJECTS_PREFIX + entry.h).then(function (buf) {
        if (!buf) throw new Error("missing vault object");
        return VC().decryptBytes(buf);
      }).then(checkedPlain(entry));
    }
    return loadVaultKeys(false).then(function (k) {
      if (!k) throw new Error("vault key missing");
      return objectKey(entry.h);
    }).then(function (key) {
      return ST().getObject(key);
    }).then(function (buf) {
      if (!buf) throw new Error("missing vault object");
      return openV2(buf);
    }).then(checkedPlain(entry));
  }

  // VD-4: what is REALLY at a local path, compared with what this
  // device last synced there (cached) and with what the cloud now
  // says (remote, may be undefined). The pull used to trust the
  // queue alone; any write that never reached the queue (another
  // orosFS consumer, a disk import, an edit racing a sync) was
  // overwritten or deleted without a look.
  //   "absent"  — no file here
  //   "remote"  — already identical to the cloud's version
  //   "clean"   — exactly what was last synced: safe to replace/remove
  //   "changed" — something else: local work, hands off
  function localState(path, cached, remote) {
    return FS().stat(path).then(function (st) {
      if (st.dir) return "changed";
      var couldBeCached = !!cached && (typeof cached.s !== "number" || cached.s === st.size);
      var couldBeRemote = !!remote && (typeof remote.s !== "number" || remote.s === st.size);
      if (!couldBeCached && !couldBeRemote) return "changed";   // size alone settles it
      return FS().read(path)
        .then(function (blob) { return blob.arrayBuffer(); })
        .then(function (buf) { return VC().sha256Hex(buf); })
        .then(function (hash) {
          if (remote && hash === remote.h) return "remote";
          if (cached && hash === cached.h) return "clean";
          return "changed";
        });
    }, function (e) {
      if (isMissing(e)) return "absent";
      throw e;
    });
  }

  // FILES-V — the same file was changed on two devices. Write the
  // cloud's version beside the local one as
  // "name (conflict YYYYMMDD-HHMMSS).ext" and track it like any
  // synced file. One copy per (path, remote version): a push that
  // fails afterwards must not produce a second copy on the next try.
  function conflictName(path, n) {
    var slash = path.lastIndexOf("/");
    var dir = path.slice(0, slash), name = path.slice(slash + 1);
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : "";
    var d = new Date();
    function p2(x) { return (x < 10 ? "0" : "") + x; }
    var stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "-" +
                p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
    return dir + "/" + base + " (conflict " + stamp + (n ? "-" + n : "") + ")" + ext;
  }
  function saveConflictCopy(path, entry, lm, stats) {
    var done = readJson(CONFLICT_KEY) || {};
    if (done[path] === entry.h) return Promise.resolve();      // already kept
    function freeName(n) {
      var cand = conflictName(path, n);
      return FS().stat(cand).then(function () { return freeName(n + 1); },
                                  function () { return cand; });
    }
    return downloadObject(entry).then(function (plain) {
      return freeName(0).then(function (copyPath) {
        return ownWrite(copyPath, new Blob([plain], {
          type: entry.mime || "application/octet-stream"
        })).then(function () {
          lm.files[copyPath] = { h: entry.h, s: entry.s, m: entry.m, mime: entry.mime };
          setLocalManifest(lm);
          queueTouch(copyPath);                 // its entry goes up with the next push
          done[path] = entry.h;
          writeJson(CONFLICT_KEY, done);
          stats.conflicts++;
        });
      });
    });
  }

  function fileFail(stats, path, e) {
    stats.failed++;
    emit("file-fail", path + " — " + ((e && (e.code || e.message)) || "error"));
  }

  // ---------- Pull: apply remote changes onto local FS ----------
  // Rules (per path, remote manifest = cloud truth):
  //   · path queued locally            → SKIP (local work wins; the
  //                                      queue is the in-flight override)
  //   · remote entry ≠ local cache     → download + decrypt + FS write,
  //                                      unless the local file holds
  //                                      unsynced content (VD-4: kept
  //                                      and queued — same "local
  //                                      wins" rule as the queue)
  //   · path in cache, gone from cloud → delete the local file, only
  //                                      if it still is what was
  //                                      synced (VD-4), and ONLY when
  //                                      a cloud manifest EXISTS.
  // VD-1: an ABSENT manifest says nothing about deletions. It is what
  // a factory reset on another device, a different Dropbox account or
  // a manifest that was never written look like — the old code read
  // it as "every file was deleted remotely" and removed the whole
  // local vault. The caller re-queues what this device holds instead.
  // VD-6: one file at a time, the local manifest saved after each
  // one, and one bad file is one failure — not the end of the sync.
  function applyRemote(cloud, lm, stats) {
    var cf = cloud.manifest.files;
    var chain = Promise.resolve();
    // VD-OD: rebuilt from a downloaded manifest; an idle check (the
    // cloud did not move, `same`) lists only this device's files, so the
    // cloud-only list stays as it was.
    var od = cloud.same ? getOnDemand() : {};

    Object.keys(cf).forEach(function (path) {
      chain = chain.then(function () {
        var entry = cf[path];
        if (!entry || typeof entry.h !== "string") return null;
        var cached = lm.files[path];
        var queued = queueHas(path);
        if (cached && cached.h === entry.h) {
          if (!queued) lm.files[path] = entry;         // meta refresh only
          return null;                                 // the cloud did not move: plain local work, or nothing
        }
        // The cloud has a version this device has not seen.
        return localState(path, cached, entry).then(function (state) {
          // VD-OD: a Drive file this device never held stays in the
          // cloud (listed, fetched when opened). One it holds is kept
          // up to date like any other file.
          if (state === "absent" && !cached && !queued && isOnDemand(path)) {
            od[path] = entry;
            return null;
          }
          if (state === "remote") {                    // already identical
            lm.files[path] = entry;
            setLocalManifest(lm);
            if (queued) queueDrop(path);
            return null;
          }
          if (state === "changed") {
            // BOTH sides changed this file. Local stays at its path
            // and goes up (the queue rule); the cloud's version is
            // kept NEXT to it as a copy — neither is lost.
            return saveConflictCopy(path, entry, lm, stats).then(function () {
              if (!queued) queueTouch(path);
              stats.kept++;
            });
          }
          // "clean" (safe to replace) or "absent". Absent AND queued =
          // deleted here while it was edited elsewhere: the edit wins.
          return downloadObject(entry).then(function (plain) {
            if (queueHas(path) && state !== "absent") return null;   // edited while downloading
            return ownWrite(path, new Blob([plain], {
              type: entry.mime || "application/octet-stream"
            })).then(function () {
              lm.files[path] = entry;
              setLocalManifest(lm);
              if (state === "absent") queueDrop(path);
              stats.downloaded++;
            });
          });
        }).catch(function (e) { fileFail(stats, path, e); });
      });
    });

    if (cloud.rev !== null) {
      Object.keys(lm.files).forEach(function (path) {
        if (cf[path]) return;                          // still exists remotely
        chain = chain.then(function () {
          if (queueHas(path)) return null;             // local edit in flight
          return localState(path, lm.files[path], null).then(function (state) {
            if (state === "changed") {                 // edited here since the last sync
              queueTouch(path);
              stats.kept++;
              return null;
            }
            var gone = (state === "absent")
              ? Promise.resolve()
              : ownRemove(path).then(function () { stats.deleted++; });
            return gone.then(function () {
              delete lm.files[path];
              setLocalManifest(lm);
            });
          }).catch(function (e) { fileFail(stats, path, e); });
        });
      });
    }

    return chain.then(function () {
      // An entry the device now holds is no longer "in the cloud only".
      Object.keys(od).forEach(function (p) { if (lm.files[p]) delete od[p]; });
      setOnDemand(od);
      return lm;
    });
  }

  // ---------- Object upload (encrypt + content-address) ----------
  function uploadObject(plainBuf, hash) {
    return Promise.all([sealV2(plainBuf), objectKey(hash)]).then(function (r) {
      return ST().putObject(r[1], new Blob([r[0]]));
    });
  }

  // Is this content already stored? The manifest we pulled says so —
  // and one cheap existence probe confirms it (an object upload that
  // failed without anyone noticing must not leave a manifest pointing
  // at nothing forever).
  function objectStored(hash, cloudHashes) {
    if (!cloudHashes[hash]) return Promise.resolve(false);
    return objectKey(hash).then(function (key) {
      return ST().getRevision(key);
    }).then(function (rev) { return rev !== null; }, function () { return false; });
  }

  // ---------- Push: upload queued local work, then manifest ----------
  // Uploads every queued path's current content (content-addressed,
  // immutable objects — no conditional write needed), then writes the
  // merged manifest CONDITIONALLY on the cloud rev we pulled (null =
  // "there must be no manifest yet"). On storage-conflict (another
  // device won the race) the whole sync is retried (MAX_SYNC_TRIES)
  // so both sides' work converges.
  // VD-3: a queued path whose file is GONE is a deletion. FS().read()
  // rejects for a missing file (it never resolved null as the old
  // code expected), so the first deleted file made every later sync
  // fail — deletions never reached the cloud and nothing else did.
  function pushCloud(lm, cloud, stats) {
    var snap = getQueueMap();
    var done = {};
    var cloudHashes = {};                          // content already stored as v2
    Object.keys(cloud.manifest.files).forEach(function (p) {
      var e = cloud.manifest.files[p];
      if (e && typeof e.h === "string" && e.v !== 1) cloudHashes[e.h] = true;
    });
    var legacyDone = [];                           // legacy hashes converted in this push
    var gone = {};                                 // paths this push deletes
    var sent = [];                                 // VD-GC: [path, hash] uploaded in this push

    // VD-KEY: nothing goes up before the vault key exists IN THE
    // CLOUD. No manifest there = the vault is being created or was
    // wiped: a key still cached in memory may have no key file any
    // more (everything would go up sealed with a key nobody else can
    // obtain) — so look again, and create the file if it is gone.
    if (cloud.rev === null) vaultKeys = null;
    var chain = loadVaultKeys(true).then(function () {});
    Object.keys(snap).forEach(function (path) {
      chain = chain.then(function () {
        return FS().read(path).then(function (blob) {
          return blob.arrayBuffer().then(function (buf) {
            return VC().sha256Hex(buf).then(function (hash) {
              var entry = {
                h: hash,
                s: blob.size,
                m: nowIso(),
                mime: blob.type || "application/octet-stream"
              };
              // Upload only if this content is NOT already stored —
              // copies / renames / re-pushes of identical content
              // cost one existence probe, not a transfer.
              return objectStored(hash, cloudHashes).then(function (stored) {
                if (stored) return null;
                sent.push([path, hash]);
                return uploadObject(buf, hash);
              }).then(function () {
                cloudHashes[hash] = true;
                var was = lm.files[path];
                if (was && was.v === 1 && typeof was.h === "string") legacyDone.push(was.h);
                lm.files[path] = entry;
                stats.uploaded++;
                done[path] = snap[path];
              });
            });
          });
        }, function (e) {
          if (isMissing(e)) {                          // deleted locally
            if (lm.files[path]) { delete lm.files[path]; stats.deleted++; }
            gone[path] = true;
            done[path] = snap[path];
            return null;
          }
          if (isDirErr(e)) {                           // a folder was queued: nothing to store
            done[path] = snap[path];
            return null;
          }
          throw e;
        }).catch(function (e) { fileFail(stats, path, e); });   // stays queued
      });
    });

    return chain.then(function () {
      // Conditional manifest write — the convergence point. The queue
      // is settled only AFTER it lands (SQ1), and only for what this
      // sync picked up (VD-5); a conflict re-runs attempt() with the
      // queue intact.
      var plain = new TextEncoder().encode(JSON.stringify({ ver: 2, files: manifestToWrite(lm, cloud, gone) }));
      return sealV2(plain.buffer).then(function (sealed) {
        return ST().putObject(MANIFEST_KEY, new Blob([sealed]), cloud.rev)
          .then(function (res) {
            queueSettle(done);
            try { localStorage.removeItem(ABSENT_KEY); } catch (e) {}
            // The new manifest has landed: legacy objects that no
            // entry points to any more can go. Best-effort — a
            // leftover is only wasted space.
            var still = {};
            Object.keys(lm.files).forEach(function (p) {
              if (lm.files[p].v === 1) still[lm.files[p].h] = true;
            });
            legacyDone.forEach(function (h) {
              if (!still[h]) ST().deleteObject(OBJECTS_PREFIX + h).catch(function () {});
            });
            noteSent(sent);
            return res;
          });
      });
    });
  }

  // VD-OD: the manifest written is what this device holds PLUS every
  // cloud entry it did not apply: on-demand files it never downloaded,
  // and files whose download failed in this sync. Writing only the
  // local cache dropped those entries from the cloud, which every other
  // device then read as a deletion.
  // (An idle check hands over this device's own list as the "cloud"
  // manifest, so the cloud-only list is added too.)
  function manifestToWrite(lm, cloud, gone) {
    var out = {}, cf = cloud.manifest.files, od = getOnDemand();
    [od, cf].forEach(function (src) {
      Object.keys(src).forEach(function (p) {
        if (!lm.files[p] && !gone[p] && src[p] && typeof src[p].h === "string") out[p] = src[p];
      });
    });
    Object.keys(lm.files).forEach(function (p) { out[p] = lm.files[p]; });
    return out;
  }

  // FILES-V: the first sync of a device queues its whole disk once.
  // Until now the disk travelled as one blob in the main sync file;
  // from here on the vault is the only channel, so every file this
  // device holds must be offered to it (identical files cost one
  // existence probe each, not a transfer).
  function seedOnce() {
    if (localStorage.getItem(SEED_KEY) === "1") return Promise.resolve();
    return walkFiles(ROOT_PATH).then(function (files) {
      queueTouchMany(files);
      try { localStorage.setItem(SEED_KEY, "1"); } catch (e) {}
    });
  }

  var lastError = null, lastOkAt = 0;
  var idle = Promise.resolve();                    // settles when no sync runs

  // VD-OD: fetch / evict run between syncs, never inside one (both
  // change the local manifest that a running sync holds in memory).
  var odChain = Promise.resolve();
  function betweenSyncs(fn) {
    var run = odChain.then(function wait() {
      return syncInFlight ? idle.then(wait) : fn();
    });
    odChain = run.catch(function () {});
    return run;
  }

  // Download one on-demand file onto the disk; from then on it is an
  // ordinary synced file of this device.
  function fetchOnDemand(path) {
    return betweenSyncs(function () {
      var od = getOnDemand(), entry = od[path];
      if (!entry) {
        return FS().stat(path).then(function () { return path; }, function () {
          throw new Error("not in the vault");
        });
      }
      return downloadObject(entry).then(function (plain) {
        return ownWrite(path, new Blob([plain], { type: entry.mime || "application/octet-stream" }));
      }).then(function () {
        var lm = getLocalManifest();
        lm.files[path] = entry;
        setLocalManifest(lm);
        var od2 = getOnDemand();
        delete od2[path];
        setOnDemand(od2);
        emit("fetched", path);
        return path;
      });
    });
  }

  // Free space: Drive files under `folder` that are exactly what was
  // synced (VD-4 "clean") leave the disk and go back to the cloud-only
  // list. Anything edited or queued stays. Resolves the count removed.
  function evictOnDemand(folder) {
    return betweenSyncs(function () {
      if (!under(folder, DRIVE_ROOT)) return 0;
      var lm = getLocalManifest(), n = 0, chain = Promise.resolve();
      Object.keys(lm.files).forEach(function (p) {
        if (!under(p, folder) || queueHas(p) || keptOffline(p)) return;
        chain = chain.then(function () {
          var entry = lm.files[p];
          return localState(p, entry, null).then(function (state) {
            if (state !== "clean" && state !== "absent") return null;
            return (state === "absent" ? Promise.resolve() : ownRemove(p)).then(function () {
              var cur = getLocalManifest();
              delete cur.files[p];
              setLocalManifest(cur);
              var od = getOnDemand();
              od[p] = entry;
              setOnDemand(od);
              n++;
            });
          }).catch(function () {});
        });
      });
      return chain.then(function () { return n; });
    });
  }

  // Delete in the cloud: Drive files at or under `path` that this device
  // holds only as cloud-only entries. Each one is taken into the local
  // manifest exactly as the cloud has it and queued; with no file on
  // the disk the next push reads that as a deletion (VD-3), the same
  // way as a synced file deleted here. A version changed elsewhere in
  // the meantime is not this entry: the pull downloads it and the
  // edit wins (VD-4). Files on the disk are the caller's (Files moves
  // them to the Trash). Resolves the count queued.
  function removeOnDemand(path) {
    return betweenSyncs(function () {
      if (typeof path !== "string" || !under(path, DRIVE_ROOT) || path === DRIVE_ROOT) return 0;
      var od = getOnDemand(), lm = getLocalManifest(), picked = [];
      Object.keys(od).forEach(function (p) {
        if (!under(p, path) || !od[p] || typeof od[p].h !== "string") return;
        if (!lm.files[p]) lm.files[p] = od[p];
        delete od[p];
        picked.push(p);
      });
      if (!picked.length) return 0;
      setLocalManifest(lm);
      setOnDemand(od);
      queueTouchMany(picked);
      armDebounce();
      tellQueue();
      return picked.length;
    });
  }

  function setKeptOffline(folder, on) {
    if (typeof folder !== "string" || !under(folder, DRIVE_ROOT)) return false;
    var l = offlineFolders().filter(function (f) { return f !== folder; });
    if (on) l.push(folder);
    if (l.length) writeJson(OFFLINE_KEY, l); else { try { localStorage.removeItem(OFFLINE_KEY); } catch (e) {} }
    if (on) {
      // Its files are fetched by the next sync: forget the cached rev so
      // an idle check does not skip the download.
      setRev(null);
      setTimeout(function () { sync("offline").catch(function () {}); }, 0);
    }
    return true;
  }

  // ---------- Full sync (pull → apply → push-if-queued) ----------
  function sync(reason) {
    if (syncInFlight) return Promise.reject(new Error("vault busy"));
    if (!usable())    return Promise.resolve({ ok: true, skipped: true });
    syncInFlight = true;
    emit("start", reason);
    var release;
    idle = new Promise(function (r) { release = r; });

    var stats = { downloaded: 0, uploaded: 0, deleted: 0, kept: 0, failed: 0, conflicts: 0 };
    var tries = 0;

    function attempt() {
      var lm = getLocalManifest();
      var cloud = null;                             // what THIS attempt pulled
      // The disk must answer first: an unavailable disk (EIO) reads
      // like "every file is missing" — never sync against that.
      return fsReady()
        .then(seedOnce)
        .then(function () { return fetchCloudManifest(lm); })
        .then(function (c) {
          cloud = c;
          if (cloud.rev === null) {
            setOnDemand({});                         // nothing is in the cloud
            // VD-1: no manifest in the cloud. Whatever this device
            // holds as "synced" is not there (any more) — it goes up
            // again; nothing local is touched.
            Object.keys(lm.files).forEach(function (p) {
              if (!queueHas(p)) queueTouch(p);
            });
          }
          return applyRemote(cloud, lm, stats);
        })
        .then(function (lm) {
          // VD-KEY: a LEGACY entry whose file is on this device is
          // converted by pushing it once more (new key, new name).
          Object.keys(lm.files).forEach(function (p) {
            if (lm.files[p] && lm.files[p].v === 1 && !queueHas(p)) queueTouch(p);
          });
          if (!getQueue().length) {                 // nothing local pending
            setLocalManifest(lm);
            // The rev is remembered ONLY when every file was applied:
            // it is what lets the next idle check skip the download.
            setRev(stats.failed === 0 ? cloud.rev : null);
            return { rev: cloud.rev, manifest: lm };
          }
          return pushCloud(lm, cloud, stats).then(function (res) {
            // Success: the conditional write landed on the rev we
            // pulled. Probe the new rev once so REV_KEY stays an
            // honest record; failure is non-fatal.
            setLocalManifest(lm);
            return ST().getRevision(MANIFEST_KEY).then(function (newRev) {
              setRev((stats.failed === 0 && !getQueue().length) ? newRev : null);
              return res;
            }).catch(function () {
              setRev(null);
              return res;
            });
          });
        })
        .catch(function (err) {
          // Conflict: another device's push beat ours. Retry the FULL
          // sync — fresh pull merges their work, then we push ours on
          // top. Bounded: give up loudly rather than loop forever.
          if (err && err.message === "storage-conflict" && tries < MAX_SYNC_TRIES) {
            tries++;
            emit("conflict-retry", tries);
            return attempt();
          }
          throw err;
        });
    }

    return attempt()
      .then(function () { return recheckSent(); })
      .then(function () {
        syncInFlight = false;
        release();
        lastError = null;
        lastOkAt = Date.now();
        // A conflict that has been pushed is over: forget the markers
        // of paths that are no longer queued.
        try {
          var cm = readJson(CONFLICT_KEY);
          if (cm) {
            var keepC = {}, anyC = false;
            Object.keys(cm).forEach(function (p) { if (queueHas(p)) { keepC[p] = cm[p]; anyC = true; } });
            if (anyC) writeJson(CONFLICT_KEY, keepC); else localStorage.removeItem(CONFLICT_KEY);
          }
        } catch (eC) {}
        emit("done", reason);
        listeners.forEach(function (fn) {
          try { fn("stats", stats); } catch (e) {}
        });
        return { ok: true, stats: stats };
      })
      .catch(function (err) {
        syncInFlight = false;
        release();
        lastError = (err && (err.message || err.name)) || "error";
        emit("fail", reason + " — " + (err && err.message));
        throw err;
      });
  }

  // ---------- Debounced auto-sync ----------
  function armDebounce() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!usable()) return;
    function fire() {
      debounceTimer = null;
      if (!getQueue().length) return;
      if (syncInFlight) { debounceTimer = setTimeout(fire, 1000); return; }
      sync("debounce").catch(function () {});
    }
    debounceTimer = setTimeout(fire, DEBOUNCE_MS);
  }

  // ---------- Auto engine ----------
  function startAutoEngine() {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        if (getQueue().length) sync("hide").catch(function () {});
      } else {
        sync("visible").catch(function () {});
      }
    });
    window.addEventListener("online", function () {
      sync("online").catch(function () {});
    });
    // Disk hooks fire queueAdd() → debounce covers active editing.
    // Boot reconcile: catch up remote changes on load.
    setTimeout(function () { sync("boot").catch(function () {}); }, 4000);
    // FILES-V: the vault is the only channel of the Files disk now,
    // so it follows the engine's own rhythm too — after every
    // successful engine cycle, look at the manifest (one metadata
    // call when nothing moved).
    try {
      if (S() && typeof S().onAutoSync === "function") {
        S().onAutoSync(function (kind) {
          if (kind === "done") sync("engine").catch(function () {});
        });
      }
    } catch (e) {}
  }

  // ---------- Public API ----------
  // ---------- VD-GC · clean-up of unused objects (2026-10-31) ----------
  // Deleted and replaced files leave their encrypted objects in the
  // cloud. Only when the person asks (Settings › Sync), the objects no
  // manifest entry names any more are removed. The rules are the ones
  // orOS Drive keeps (koulaxizis/oros-drive vault/clean.go), each one
  // against a way to lose a file:
  //   · No manifest, a manifest that cannot be opened, or no vault key:
  //     nothing is removed (VD-1; without the key the keyed names
  //     cannot be told apart). An entry without a hash holds it too.
  //   · Always the cloud manifest itself, read fresh (never this
  //     device's cache, which lacks on-demand and failed entries), and
  //     its revision must be the same before and after the read.
  //   · An object is in use under every name an entry can have: the
  //     keyed name and the legacy "objects/<h>", whatever its "v".
  //   · Only names "objects/<64 hex>" are ever removed; the manifest,
  //     key.json and anything else are never touched.
  //   · Only objects the provider stored GC_MIN_AGE_DAYS or more ago
  //     (a device uploads objects before the manifest that names
  //     them); an object without a time is never old.
  //   · Fewer than nine in ten of the named objects listed = something
  //     is off (a partial listing, another key): nothing is removed.
  //   · The manifest revision is checked before every removal; when it
  //     moved, the clean-up stops (run it again for a fresh look).
  //   · Afterwards the manifest is read again. An object it names again
  //     (a device re-uploaded the same content, which on Dropbox keeps
  //     the old time, just before writing its manifest) is put back
  //     from this device's copy; what cannot be put back is reported.
  //     The uploading device also looks again (recheckSent).
  var GC_MIN_AGE_DAYS = 30;
  var GC_MIN_AGE_MS   = GC_MIN_AGE_DAYS * 864e5;
  var GC_OBJECT       = /^objects\/[0-9a-f]{64}$/;

  // The cloud manifest as stored: { rev, files } (files null = none).
  function gcManifest() {
    return ST().getRevision(MANIFEST_KEY).then(function (rev) {
      if (rev === null) return { rev: null, files: null };
      return ST().getObject(MANIFEST_KEY).then(function (buf) {
        if (!buf) throw new Error("clean-moved");
        return openManifest(buf);
      }).then(function (m) {
        return ST().getRevision(MANIFEST_KEY).then(function (again) {
          if (again !== rev) throw new Error("clean-moved");
          return { rev: rev, files: m.files };
        });
      });
    });
  }

  // Object names an entry can be stored under → its hash.
  function gcNames(files, keys) {
    var names = {}, hashes = [], seen = {}, bad = false;
    Object.keys(files || {}).forEach(function (p) {
      var e = files[p];
      if (!e || typeof e.h !== "string" || !e.h) { bad = true; return; }
      if (seen[e.h]) return;
      seen[e.h] = true;
      hashes.push(e.h);
    });
    return Promise.all(hashes.map(function (h) {
      names[(OBJECTS_PREFIX + h).toLowerCase()] = h;
      return keys ? objectKey(h).then(function (k) { names[k] = h; }) : null;
    })).then(function () { return { names: names, hashes: hashes, bad: bad }; });
  }

  function gcScan(now) {
    if (!usable()) return Promise.reject(new Error("not-connected"));
    var cloud, keys, ref;
    return gcManifest().then(function (c) {
      cloud = c;
      return c.files ? loadVaultKeys(false) : null;
    }).then(function (k) {
      keys = k || null;
      return gcNames(cloud.files, keys);
    }).then(function (r) {
      ref = r;
      return ST().listInfo("");
    }).then(function (list) {
      var u = { files: 0, fileBytes: 0, objects: 0, stored: 0, unused: 0, unusedBytes: 0,
                free: 0, freeBytes: 0, missing: 0, otherBytes: 0, hold: "" };
      var free = [], have = {};
      Object.keys(cloud.files || {}).forEach(function (p) {
        var e = cloud.files[p];
        u.files++;
        if (e && typeof e.s === "number" && e.s > 0) u.fileBytes += e.s;
      });
      (list || []).forEach(function (o) {
        var key = String(o && o.key || ""), size = +(o && o.size) || 0;
        if (!GC_OBJECT.test(key)) { u.otherBytes += size; return; }
        u.objects++;
        u.stored += size;
        have[key] = true;
        if (Object.prototype.hasOwnProperty.call(ref.names, key)) return;
        u.unused++;
        u.unusedBytes += size;
        var at = +o.modified || 0;
        if (at > 0 && now - at >= GC_MIN_AGE_MS) {
          u.free++;
          u.freeBytes += size;
          free.push({ key: key, size: size });
        }
      });
      var found = 0;
      var byHash = {};
      Object.keys(ref.names).forEach(function (n) { if (have[n]) byHash[ref.names[n]] = true; });
      ref.hashes.forEach(function (h) { if (byHash[h]) found++; else u.missing++; });
      if (!cloud.files) u.hold = "no-manifest";
      else if (!keys || ref.bad || found * 10 < ref.hashes.length * 9) u.hold = "mismatch";
      if (u.hold) { u.free = 0; u.freeBytes = 0; free = []; }
      return { u: u, rev: cloud.rev, free: free };
    });
  }

  // What the vault holds; changes nothing.
  // → { files, fileBytes, objects, stored, unused, unusedBytes, free,
  //     freeBytes, missing, otherBytes, hold: "" | "no-manifest" | "mismatch" }
  function gcUsage() {
    return gcScan(Date.now()).then(function (s) { return s.u; });
  }

  // Put back a removed object the manifest names again, from this
  // device's own copy (hash-checked). Resolves true when it is back.
  function gcHeal(hash, legacy) {
    var lm = getLocalManifest().files;
    var paths = Object.keys(lm).filter(function (p) { return lm[p] && lm[p].h === hash; });
    function next(i) {
      if (i >= paths.length) return Promise.resolve(false);
      return FS().read(paths[i]).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
        return VC().sha256Hex(buf).then(function (h) {
          if (h !== hash) return next(i + 1);
          var put = legacy
            ? VC().encryptBytes(buf).then(function (sealed) {
                return ST().putObject(OBJECTS_PREFIX + hash, new Blob([sealed]));
              })
            : uploadObject(buf, hash);
          return put.then(function () { return true; });
        });
      }, function () { return next(i + 1); });
    }
    return next(0);
  }

  // After removals: read the manifest again; every removed object it
  // names is put back or reported in `lost` (paths).
  function gcAfter(gone, out) {
    if (!Object.keys(gone).length) return Promise.resolve(out);
    function read(tries) {
      return gcManifest().catch(function (e) {
        if (e && e.message === "clean-moved" && tries < 3) return read(tries + 1);
        throw e;
      });
    }
    return read(0).then(function (cloud) {
      if (!cloud.files) return out;
      var hit = {};                                   // hash → { legacy, paths }
      return gcNames(cloud.files, vaultKeys).then(function (ref) {
        Object.keys(gone).forEach(function (n) {
          if (!Object.prototype.hasOwnProperty.call(ref.names, n)) return;
          var h = ref.names[n];
          hit[h] = hit[h] || { legacy: false, keyed: false, paths: [] };
          if (n === (OBJECTS_PREFIX + h).toLowerCase()) hit[h].legacy = true; else hit[h].keyed = true;
        });
        Object.keys(cloud.files).forEach(function (p) {
          var e = cloud.files[p];
          if (e && hit[e.h]) hit[e.h].paths.push(p);
        });
        return Object.keys(hit).reduce(function (chain, h) {
          return chain.then(function () {
            var wants = [];
            if (hit[h].keyed) wants.push(false);
            if (hit[h].legacy) wants.push(true);
            return wants.reduce(function (c2, legacy) {
              return c2.then(function (ok) {
                return gcHeal(h, legacy).catch(function () { return false; })
                  .then(function (one) { return ok && one; });
              });
            }, Promise.resolve(true)).then(function (ok) {
              if (ok) out.healed++;
              else out.lost = out.lost.concat(hit[h].paths);
            });
          });
        }, Promise.resolve());
      });
    }).then(function () { return out; });
  }

  // Remove what gcScan finds removable (looks again first).
  // → { removed, bytes, stopped (the vault moved: run it again),
  //     healed, lost: [path] }. Rejects "clean-no-manifest",
  //     "clean-mismatch", "clean-moved" or a storage error.
  function gcCleanUp() {
    return betweenSyncs(function () {
      return gcScan(Date.now()).then(function (s) {
        if (s.u.hold === "no-manifest") throw new Error("clean-no-manifest");
        if (s.u.hold) throw new Error("clean-mismatch");
        var out = { removed: 0, bytes: 0, stopped: false, healed: 0, lost: [] }, gone = {};
        var chain = s.free.reduce(function (c, o) {
          return c.then(function () {
            if (out.stopped) return null;
            return ST().getRevision(MANIFEST_KEY).then(function (rev) {
              if (rev !== s.rev) { out.stopped = true; return null; }
              return ST().deleteObject(o.key).then(function () {
                gone[o.key] = true;
                out.removed++;
                out.bytes += o.size;
              });
            });
          });
        }, Promise.resolve());
        return chain.then(function () {
          return gcAfter(gone, out);
        }, function (err) {
          return gcAfter(gone, out).catch(function () {}).then(function () { throw err; });
        });
      });
    });
  }

  // The uploading side of the same race: every object a push uploaded
  // is looked at again by the syncs that follow (SENT_KEY, device-
  // local), until one at least GC_RECHECK_MS after the upload still
  // finds it. One that a clean-up elsewhere removed in the meantime
  // is queued again; the next push finds it missing (objectStored)
  // and uploads it once more.
  var SENT_KEY        = "oros-vault-sent";       // { path: [hash, uploadedAt] }
  var GC_RECHECK_MS   = 10000;
  function noteSent(sent) {
    if (!sent.length) return;
    var m = readJson(SENT_KEY) || {}, now = Date.now();
    sent.forEach(function (ph) { m[ph[0]] = [ph[1], now]; });
    writeJson(SENT_KEY, m);
  }
  function recheckSent() {
    var m = readJson(SENT_KEY);
    if (!m || typeof m !== "object") return Promise.resolve();
    var lm = getLocalManifest().files;
    return Object.keys(m).reduce(function (chain, path) {
      return chain.then(function () {
        var it = m[path], cur = lm[path];
        if (!Array.isArray(it) || !cur || cur.h !== it[0]) { delete m[path]; return null; }
        return loadVaultKeys(false).then(function (k) {
          if (!k) return;                              // looked at again next time
          return objectKey(it[0]).then(function (key) {
            return ST().getRevision(key);
          }).then(function (rev) {
            if (rev === null) { delete m[path]; queueAdd(path); }
            else if (Date.now() - (+it[1] || 0) >= GC_RECHECK_MS) delete m[path];
          });
        }).catch(function () {});
      });
    }, Promise.resolve()).catch(function () {}).then(function () {
      try {
        if (Object.keys(m).length) writeJson(SENT_KEY, m); else localStorage.removeItem(SENT_KEY);
      } catch (e) {}
    });
  }

  window.orosVault = {
    version: "0.1.0",

    // Disk integration (FILES-V): fs.js calls these for EVERY
    // mutation of the disk, whoever made it —
    //   after a write:           orosVault.fileChanged(path)
    //   after a delete / a move: orosVault.touchTree(path)
    // The module's own writes (applying a remote change) are ignored.
    fileChanged: function (path) {
      if (typeof path !== "string" || !path || ownWrites[path]) return;
      queueAdd(path);
    },
    fileDeleted: function (path) {
      if (ownWrites[path]) return;
      queueAdd(path);             // pushCloud turns "queued + gone" into a deletion
    },
    // FILES-V: "something changed at or under this path" (delete,
    // move, folder operations). Returns a promise of the count queued.
    touchTree: touchTree,
    // FILES-V: for the Files pill.
    status: function () {
      return { usable: usable(), queued: getQueue().length, busy: syncInFlight,
               lastError: lastError, lastOkAt: lastOkAt };
    },

    // Manual triggers
    sync: sync,
    isQueued: queueHas,
    queueLength: function () { return getQueue().length; },

    // Status feedback (shell dot / Files toolbar)
    // Returns an unsubscribe function (an app frame that closes must
    // not leave its listener behind in the shell).
    onStatus: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    },

    // Read access for Files UI (manifest meta per path)
    manifestEntry: function (path) {
      return getLocalManifest().files[path] || null;
    },
    localPaths: function () {
      return Object.keys(getLocalManifest().files);
    },

    // VD-OD: orOS Drive folders, on demand.
    driveRoot: DRIVE_ROOT,
    // Files at or under `prefix` that are in the cloud only:
    // [{ path, h, s, m, mime }] (no content on this device yet).
    remoteOnly: function (prefix) {
      var od = getOnDemand(), out = [];
      Object.keys(od).forEach(function (p) {
        if (!prefix || under(p, prefix)) {
          var e = od[p];
          out.push({ path: p, h: e.h, s: e.s, m: e.m, mime: e.mime });
        }
      });
      return out;
    },
    isRemoteOnly: function (path) {
      return Object.prototype.hasOwnProperty.call(getOnDemand(), path);
    },
    fetch: fetchOnDemand,
    evict: evictOnDemand,
    removeRemote: removeOnDemand,
    offlineFolders: offlineFolders,
    isKeptOffline: keptOffline,
    setKeptOffline: setKeptOffline,

    // VD-GC: clean-up of unused cloud objects, only when asked.
    usage: gcUsage,
    cleanUp: gcCleanUp,
    cleanMinAgeDays: GC_MIN_AGE_DAYS
  };

  // ---------- Boot ----------
  startAutoEngine();
  console.log("[orOS] vault.js v0.1.0 booted");
})();