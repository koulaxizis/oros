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
  function getQueue() { return readJson(QUEUE_KEY) || []; }
  function setQueue(q) {
    if (q && q.length) writeJson(QUEUE_KEY, q);
    else localStorage.removeItem(QUEUE_KEY);
  }
  function queueHas(path) { return getQueue().indexOf(path) !== -1; }

  function queueAdd(path) {
    var q = getQueue();
    if (q.indexOf(path) === -1) { q.push(path); setQueue(q); }
    armDebounce();
  }
  function queueRemove(path) {
    var q = getQueue();
    var i = q.indexOf(path);
    if (i !== -1) { q.splice(i, 1); setQueue(q); }
  }
  function clearQueue() { setQueue([]); }

  // ---------- Local manifest cache + rev ----------
  function emptyManifest() { return { ver: 1, files: {} }; }
  function getLocalManifest() { return readJson(LM_KEY) || emptyManifest(); }
  function setLocalManifest(m) { writeJson(LM_KEY, m); }
  function getRev() { return localStorage.getItem(REV_KEY) || null; }
  function setRev(r) {
    if (r) localStorage.setItem(REV_KEY, r);
    else localStorage.removeItem(REV_KEY);
  }

  // ---------- Cloud manifest fetch ----------
  // ABSENT-QUIET: probing an EMPTY vault costs one 409 per sweep
  // (boot + every tab-visible + every "online"). The browser paints
  // that 409 red in the console — alarming noise for a state the
  // code already handles. While no local work is queued, the
  // "absent" verdict is cached for ABSENT_TTL_MS. Freshness
  // contract: any queued push BYPASSES the cache (pushCloud needs
  // the true rev for its conditional write), and the first sweep
  // after the TTL lapses re-probes — a manifest created by another
  // device is picked up within ~ABSENT_TTL_MS.
  function fetchCloudManifest() {
    var queued = getQueue().length > 0;
    var absentAt = parseInt(localStorage.getItem(ABSENT_KEY) || "0", 10) || 0;
    if (!queued && Date.now() - absentAt < ABSENT_TTL_MS) {
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
        return VC().decryptJson(new TextDecoder().decode(buf))
          .then(function (m) {
            if (!m || m.ver !== 1 || !m.files) {
              throw new Error("bad manifest");
            }
            return { rev: rev, manifest: m };
          });
      });
    });
  }

  // ---------- Object download / decrypt ----------
  function downloadObject(hash) {
    return ST().getObject(OBJECTS_PREFIX + hash).then(function (buf) {
      if (!buf) throw new Error("missing vault object: " + hash);
      return VC().decryptBytes(buf);
    });
  }

  // ---------- Pull: apply remote changes onto local FS ----------
  // Rules (per path, remote manifest = cloud truth):
  //   · path queued locally            → SKIP (local work wins; the
  //                                      queue is the in-flight override)
  //   · remote entry ≠ local cache     → download + decrypt + FS write
  //   · path in cache, gone from cloud → delete local file (remote
  //                                      deletion) unless queued
  function applyRemote(cloud, lm, stats) {
    var cf = cloud.manifest.files;
    var work = [];

    Object.keys(cf).forEach(function (path) {
      if (queueHas(path)) return;                    // in-flight local edit
      var entry = cf[path];
      var cached = lm.files[path];
      if (cached && cached.h === entry.h) {
        lm.files[path] = entry;                      // meta refresh only
        return;
      }
      work.push(downloadObject(entry.h).then(function (plain) {
        return FS().write(path, new Blob([plain], {
          type: entry.mime || "application/octet-stream"
        })).then(function () {
          lm.files[path] = entry;
          stats.downloaded++;
        });
      }));
    });

    Object.keys(lm.files).forEach(function (path) {
      if (cf[path]) return;                          // still exists remotely
      if (queueHas(path)) return;                    // local edit in flight
      work.push(FS().rm(path).then(function () {
        delete lm.files[path];
        stats.deleted++;
      }).catch(function () {
        delete lm.files[path];                       // already gone locally
      }));
    });

    return Promise.all(work).then(function () { return lm; });
  }
  
    // ---------- Object upload (encrypt + content-address) ----------
  function uploadObject(plainBuf, hash) {
    return VC().encryptBytes(plainBuf).then(function (env) {
      return ST().putObject(OBJECTS_PREFIX + hash, new Blob([env]));
    });
  }

  // ---------- Push: upload queued local work, then manifest ----------
  // Uploads every queued path's current content (content-addressed,
  // immutable objects — no conditional write needed), then writes the
  // merged manifest CONDITIONALLY on the cloud rev we pulled. On
  // storage-conflict (another device won the race) we retry the whole
  // sync (MAX_SYNC_TRIES) so both sides' work converges.
  function pushCloud(lm, cloudRev, stats) {
    var queue = getQueue();

    var uploads = queue.map(function (path) {
      return FS().read(path).then(function (blob) {
        if (!blob) {                                 // deleted locally
          delete lm.files[path];
          stats.deleted++;
          return null;
        }
        return blob.arrayBuffer().then(function (buf) {
          return VC().sha256Hex(buf).then(function (hash) {
            var entry = {
              h: hash,
              s: blob.size,
              m: nowIso(),
              mime: blob.type || "application/octet-stream"
            };
            // Upload only if this hash is NOT already known —
            // copies/renames/re-pushes of identical content are free.
            var alreadyThere = cloudRev !== null && getLocalManifest().files[path] &&
              getLocalManifest().files[path].h === hash;
            var job = alreadyThere ? Promise.resolve() : uploadObject(buf, hash);
            return job.then(function () {
              lm.files[path] = entry;
              stats.uploaded++;
            });
          });
        });
      });
    });

    return Promise.all(uploads).then(function () {
      // Conditional manifest write — the convergence point.
      // SQ1: the queue is the record of "work that must reach the
      // cloud". Clearing it BEFORE the manifest write meant a
      // storage-conflict (another device won the race) entered the
      // retry with the queue ALREADY EMPTY — the winning device's
      // manifest never contained this device's queued paths and
      // the retry had nothing left to push. Clear only AFTER the
      // write lands; a conflict re-runs attempt() with the queue
      // intact (objects are content-addressed — re-uploads of
      // identical content are free) and both sides converge.
      return VC().encryptJson(lm).then(function (sealed) {
        return ST().putObject(MANIFEST_KEY, sealed, cloudRev === null ? undefined : cloudRev)
          .then(function (res) { clearQueue(); return res; });
      });
    });
  }

  // ---------- Full sync (pull → apply → push-if-queued) ----------
  function sync(reason) {
    if (syncInFlight) return Promise.reject(new Error("vault busy"));
    if (!usable())    return Promise.resolve({ ok: true, skipped: true });
    syncInFlight = true;
    emit("start", reason);

    var stats = { downloaded: 0, uploaded: 0, deleted: 0 };
    var tries = 0;

    function attempt() {
      var lm = getLocalManifest();
      var pulledRev = null;                         // cloud rev THIS attempt pulled
      return fetchCloudManifest()
        .then(function (cloud) {
          pulledRev = cloud.rev;
          return applyRemote(cloud, lm, stats);
        })
        .then(function (lm) {
          if (!getQueue().length) {                 // nothing local pending
            setLocalManifest(lm);
            setRev(pulledRev);                      // honest cache of the cloud rev
            return { rev: pulledRev, manifest: lm };
          }
          return pushCloud(lm, pulledRev, stats).then(function (res) {
            // Success: the conditional write landed on pulledRev. The NEW
            // cloud rev is unknown (putObject hands back the raw Response)
            // — probe it once so REV_KEY is honest for the NEXT sync's
            // conditional write. Probe failure is non-fatal: rev=null just
            // means the next pull re-learns it.
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
      queueRemove(path);          // pushCloud deletes via queue presence…
      queueAdd(path);              // …so re-add to mark deletion pending
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