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
// are heavy on memory. Object GC (deleting unreferenced objects)
// is deferred — deleted files leave orphaned encrypted blobs that
// only occupy provider space, never leak anything.
// ============================================================
(function () {
  "use strict";

  // ---------- Configuration / constants ----------
  var MANIFEST_KEY   = "manifest.json";
  var KEY_FILE       = "key.json";                // VD-KEY: the wrapped vault key
  var OBJECTS_PREFIX = "objects/";
  var QUEUE_KEY      = "oros-vault-queue";        // dirty paths pending push
  var LM_KEY         = "oros-vault-manifest";     // local manifest cache
  var REV_KEY        = "oros-vault-rev";          // last-synced manifest rev
  var ABSENT_KEY     = "oros-vault-absent-at";    // ts of last "no manifest" probe
  var ABSENT_TTL_MS  = 60000;                     // absent-quiet window
  var DEBOUNCE_MS    = 3000;                      // auto-sync quiet period
  var MAX_SYNC_TRIES = 2;                         // conflict retry budget

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
  function queueAdd(path) {
    queueTouch(path);
    armDebounce();
  }
  // Settle what a sync really pushed: only generations it picked up.
  function queueSettle(done) {
    var m = getQueueMap();
    Object.keys(done).forEach(function (p) {
      if (m[p] === done[p]) delete m[p];
    });
    setQueueMap(m);
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
  function downloadObject(entry) {
    if (entry.v === 1) {                           // LEGACY object
      return ST().getObject(OBJECTS_PREFIX + entry.h).then(function (buf) {
        if (!buf) throw new Error("missing vault object");
        return VC().decryptBytes(buf);
      });
    }
    return loadVaultKeys(false).then(function (k) {
      if (!k) throw new Error("vault key missing");
      return objectKey(entry.h);
    }).then(function (key) {
      return ST().getObject(key);
    }).then(function (buf) {
      if (!buf) throw new Error("missing vault object");
      return openV2(buf);
    });
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

    Object.keys(cf).forEach(function (path) {
      chain = chain.then(function () {
        if (queueHas(path)) return null;               // in-flight local edit
        var entry = cf[path];
        if (!entry || typeof entry.h !== "string") return null;
        var cached = lm.files[path];
        if (cached && cached.h === entry.h) {
          lm.files[path] = entry;                      // meta refresh only
          return null;
        }
        return localState(path, cached, entry).then(function (state) {
          if (state === "remote") {                    // already there
            lm.files[path] = entry;
            setLocalManifest(lm);
            return null;
          }
          if (state === "changed") {                   // unsynced local work
            queueTouch(path);
            stats.kept++;
            return null;
          }
          return downloadObject(entry).then(function (plain) {
            if (queueHas(path)) return null;           // edited while downloading
            return FS().write(path, new Blob([plain], {
              type: entry.mime || "application/octet-stream"
            })).then(function () {
              lm.files[path] = entry;
              setLocalManifest(lm);
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
              : FS().rm(path).then(function () { stats.deleted++; });
            return gone.then(function () {
              delete lm.files[path];
              setLocalManifest(lm);
            });
          }).catch(function (e) { fileFail(stats, path, e); });
        });
      });
    }

    return chain.then(function () { return lm; });
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
                return stored ? null : uploadObject(buf, hash);
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
      var plain = new TextEncoder().encode(JSON.stringify({ ver: 2, files: lm.files }));
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
            return res;
          });
      });
    });
  }

  // ---------- Full sync (pull → apply → push-if-queued) ----------
  function sync(reason) {
    if (syncInFlight) return Promise.reject(new Error("vault busy"));
    if (!usable())    return Promise.resolve({ ok: true, skipped: true });
    syncInFlight = true;
    emit("start", reason);

    var stats = { downloaded: 0, uploaded: 0, deleted: 0, kept: 0, failed: 0 };
    var tries = 0;

    function attempt() {
      var lm = getLocalManifest();
      var cloud = null;                             // what THIS attempt pulled
      // The disk must answer first: an unavailable disk (EIO) reads
      // like "every file is missing" — never sync against that.
      return fsReady()
        .then(function () { return fetchCloudManifest(lm); })
        .then(function (c) {
          cloud = c;
          if (cloud.rev === null) {
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
            setRev(cloud.rev);                      // honest cache of the cloud rev
            return { rev: cloud.rev, manifest: lm };
          }
          return pushCloud(lm, cloud, stats).then(function (res) {
            // Success: the conditional write landed on the rev we
            // pulled. Probe the new rev once so REV_KEY stays an
            // honest record; failure is non-fatal.
            setLocalManifest(lm);
            return ST().getRevision(MANIFEST_KEY).then(function (newRev) {
              setRev(newRev);
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
      .then(function () {
        syncInFlight = false;
        emit("done", reason);
        listeners.forEach(function (fn) {
          try { fn("stats", stats); } catch (e) {}
        });
        return { ok: true, stats: stats };
      })
      .catch(function (err) {
        syncInFlight = false;
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
    // App-side hooks fire queueAdd() → debounce covers active editing.
    // Boot reconcile: catch up remote changes on load.
    setTimeout(function () { sync("boot").catch(function () {}); }, 4000);
  }

  // ---------- Public API ----------
  window.orosVault = {
    version: "0.1.0",

    // Files-app integration (called from files.js):
    //   AFTER every local write:   orosVault.fileChanged(path)
    //   AFTER every local delete: orosVault.fileDeleted(path)
    fileChanged: function (path) {
      queueAdd(path);
    },
    fileDeleted: function (path) {
      queueAdd(path);             // pushCloud turns "queued + gone" into a deletion
    },

    // Manual triggers
    sync: sync,
    isQueued: queueHas,
    queueLength: function () { return getQueue().length; },

    // Status feedback (shell dot / Files toolbar)
    onStatus: function (fn) { if (typeof fn === "function") listeners.push(fn); },

    // Read access for Files UI (manifest meta per path)
    manifestEntry: function (path) {
      return getLocalManifest().files[path] || null;
    },
    localPaths: function () {
      return Object.keys(getLocalManifest().files);
    }
  };

  // ---------- Boot ----------
  startAutoEngine();
  console.log("[orOS] vault.js v0.1.0 booted");
})();