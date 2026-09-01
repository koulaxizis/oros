/* ============================================================
   oros-sync.js v1.0 — Shared Cloud Sync Module (orOS Ecosystem)
   Author: Christos Koulaxizis | orOS Ecosystem
   ============================================================
   Usage (inside each app, e.g. kanban.js):

     var sync = window.orosSync.create({
       id: 'kanban',
       prefixes: ['oros_kanban_'],
       ui: {
         status: 'cloud-sync-status',
         last: 'cloud-sync-last',
         dir: 'sync-dir-display',
         dirName: 'sync-dir-name',
         connect: 'btn-cloud-connect',
         disconnect: 'btn-cloud-disconnect'
       }
     });
     window.orosSync.register(sync);
     sync.init();

   Each app writes its own file: oros-<id>-sync.json
   Shared theme/language live in oros-shared-settings.json
   ============================================================ */

(function() {
  'use strict';

  var SHARED_DB = 'oros_sync_shared';
  var SHARED_STORE = 'kv';
  var DIR_HANDLE_KEY = 'dir_handle';
  var SHARED_FILE = 'oros-shared-settings.json';
  var SHARED_KEYS = ['oros-theme', 'oros-language', 'oros-zen-mode'];

  var instances = {};
  var activeId = null;
  var sharedDirHandle = null;

  function isFSA() { return typeof window.showDirectoryPicker === 'function'; }

  // ---------- tiny IndexedDB helpers ----------
  function idbOpen(name) {
    return new Promise(function(resolve, reject) {
      if (!('indexedDB' in window)) { reject(new Error('No IndexedDB')); return; }
      var req = indexedDB.open(name, 1);
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror = function(e) { reject(e.target.error); };
    });
  }

  function idbPut(db, key, value) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  }

  function idbGet(db, key) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction('kv', 'readonly');
      var req = tx.objectStore('kv').get(key);
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function(e) { reject(e.target.error); };
    });
  }

  function idbDel(db, key) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  }

  // ---------- Factory ----------
  function create(cfg) {
    if (!cfg || !cfg.id) throw new Error('orosSync.create: id required');

    var S = {
      id: cfg.id,
      APP_NAME: 'orOS ' + cfg.id.charAt(0).toUpperCase() + cfg.id.slice(1),
      PREFIXES: cfg.prefixes || ['oros_' + cfg.id + '_'],
      FILE_NAME: 'oros-' + cfg.id + '-sync.json',
      LAST_SYNC_KEY: 'backup_latest',
      LAST_SYNC_LOCAL: 'oros_' + cfg.id + '_last_sync',
      DB_NAME: 'oros_' + cfg.id + '_sync',
      AUTO_INTERVAL_MS: (cfg.intervalMinutes || 5) * 60000,
      STATUS_LABELS: {
        'idle': '● Not configured',
        'synced': '✓ Synced',
        'syncing': '⟳ Syncing…',
        'error': '⚠ Sync error',
        'unsupported': '● IndexedDB only'
      },
      db: null,
      dirHandle: null,
      autoTimer: null,
      ui: cfg.ui || {},
      toast: cfg.toast || function(msg) { console.log('[oros-sync]', msg); }
    };

    // ----- Instance IDB -----
    S.initIDB = function() {
      return idbOpen(S.DB_NAME).then(function(db) { S.db = db; });
    };
    S.put = function(key, val) { return idbPut(S.db, key, val); };
    S.get = function(key) {
      return new Promise(function(resolve, reject) {
        if (!S.db) { reject(new Error('IDB not ready')); return; }
        var req = S.db.transaction('kv', 'readonly').objectStore('kv').get(key);
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function(e) { reject(e.target.error); };
      });
    };
    S.del = function(key) {
      return new Promise(function(resolve) {
        if (!S.db) { resolve(); return; }
        var tx = S.db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { resolve(); };
      });
    };

    // ----- Collect / Apply -----
    S.collectDatabase = function() {
      var data = {
        _meta: { app: S.APP_NAME, exportedAt: new Date().toISOString(), type: 'app-database', keyCount: 0 },
        localStorage: {}
      };
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;
        for (var p = 0; p < S.PREFIXES.length; p++) {
          if (key.indexOf(S.PREFIXES[p]) === 0) { data.localStorage[key] = localStorage.getItem(key); break; }
        }
      }
      data._meta.keyCount = Object.keys(data.localStorage).length;
      return data;
    };

    S.collectShared = function() {
      var shared = { _meta: { app: 'orOS', type: 'shared-settings', exportedAt: new Date().toISOString() }, settings: {} };
      for (var i = 0; i < SHARED_KEYS.length; i++) {
        var k = SHARED_KEYS[i];
        var v = localStorage.getItem(k);
        if (v !== null) shared.settings[v === undefined ? i : k] = v;
      }
      return shared;
    };

    S.applyRestoredData = function(data) {
      if (!data || !data._meta || data._meta.type !== 'app-database') return false;
      var toRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        for (var p = 0; p < S.PREFIXES.length; p++) {
          if (k.indexOf(S.PREFIXES[p]) === 0) { toRemove.push(k); break; }
        }
      }
      for (var r = 0; r < toRemove.length; r++) localStorage.removeItem(toRemove[r]);
      Object.keys(data.localStorage).forEach(function(key) { localStorage.setItem(key, data.localStorage[key]); });
      return true;
    };

    // ----- File System Access (shared folder across apps) -----
    S.isSupported = isFSA;

    S.pickDirectory = function() {
      if (!isFSA()) { S._showToast('File System Access API not available.'); return Promise.resolve(null); }
      return window.showDirectoryPicker({ mode: 'readwrite' }).then(function(handle) {
        sharedDirHandle = handle;
        S.dirHandle = handle;
        return S._ensureSharedDB().then(function() {
          return idbPut(sharedDB, DIR_HANDLE_KEY, handle);
        }).then(function() { return handle; });
      });
    };

    var sharedDB = null;
    S._ensureSharedDB = function() {
      if (sharedDB) return Promise.resolve(sharedDB);
      return idbOpen('oros_sync_shared').then(function(db) { sharedDB = db; return db; });
    };

    S._restoreSharedHandle = function() {
      if (sharedDirHandle) { S.dirHandle = sharedDirHandle; return Promise.resolve(sharedDirHandle); }
      return S._ensureSharedDB().then(function() {
        return idbGet(sharedDB, DIR_HANDLE_KEY).then(function(handle) {
          if (!handle) return null;
          var apply = function(h) { sharedDirHandle = h; S.dirHandle = h; return h; };
          if (!handle.queryPermission) { return apply(handle); }
          return handle.queryPermission({ mode: 'readwrite' }).then(function(perms) {
            if (perms === 'granted') { return apply(handle); }
            return handle.requestPermission({ mode: 'readwrite' }).then(function(rp) {
              return rp === 'granted' ? apply(handle) : null;
            });
          });
        });
      }).catch(function() { return null; });
    };

    S.writeToFile = function(data, fileName) {
      var fh = S.dirHandle;
      if (!fh) return Promise.reject(new Error('No directory handle'));
      return fh.getFileHandle(arguments.length > 2 ? arguments[2] : S.FILE_NAME, { create: true })
        .then(function(fileHandle) { return fileHandle.createWritable(); })
        .then(function(writable) { return writableWrite(writable, data); });
    };
    // (helper kept simple)
    function writableWrite(writable, data) {
      return writable.write(JSON.stringify(data, null, 2)).then(function() { return writable.close(); });
    }
    // Patch: use plain closures instead
    S.writeToFile = function(data, fileName) {
      if (!S.dirHandle) return Promise.reject(new Error('No directory handle'));
      var name = fileName || S.FILE_NAME;
      return S.dirHandle.getFileHandle(name, { create: true })
        .then(function(fh) { return fh.createWritable(); })
        .then(function(w) { return writableWrite(w, data); });
    };

    S.readFromFile = function(fileName) {
      if (!S.dirHandle) return Promise.reject(new Error('No directory handle'));
      return S.dirHandle.getFileHandle(fileName || S.FILE_NAME)
        .then(function(fh) { return fh.getFile(); })
        .then(function(file) { return file.text(); })
        .then(function(text) { return JSON.parse(text); });
    };

    // ----- Backup -----
    S.saveBackup = function() {
      var data = S.collectDatabase();
      var jobs = [idbPut(S.db, S.LAST_SYNC_KEY, data)];

      if (S.dirHandle) {
        jobs.push(S.writeToFile(data).then(function() { return true; })
          .catch(function(e) { console.warn('[oros-sync] file write failed:', e); return false; }));
        // Shared settings (theme/language) — harmless if written by multiple apps
        if (isFSA() && S.dirHandle) {
          jobs.push(
            S.dirHandle.getFileHandle(SHARED_FILE, { create: true })
              .then(function(fh) { return fh.createWritable(); })
              .then(function(w) { return writableWrite(w, S.collectShared()); })
              .catch(function() {})
          );
        }
      }

      return Promise.all(jobs).then(function() {
        var now = new Date().toISOString();
        localStorage.setItem(S.LAST_SYNC_LOCAL, now);
        S.updateStatus(S.dirHandle ? 'synced' : 'unsupported', now);
        S.updateDirDisplay();
        return true;
      });
    };

    S.collectShared = function() {
      var out = { _meta: { app: 'orOS', type: 'shared-settings', exportedAt: new Date().toISOString() }, settings: {} };
      for (var i = 0; i < SHARED_KEYS.length; i++) {
        var k = SHARED_KEYS[i];
        var v = localStorage.getItem(k);
        if (v !== null) out.settings[k] = v;
      }
      return out;
    };

    S.loadBackup = function() {
      return idbGet(S.db, S.LAST_SYNC_KEY).then(function(idbData) {
        if (!S.dirHandle) return idbData;
        return S.readFromFile().then(function(fileData) {
          var ft = fileData && fileData._meta ? new Date(fileData._meta.exportedAt).getTime() : 0;
          var it = idbData && idbData._meta ? new Date(idbData._meta.exportedAt).getTime() : 0;
          return fTimeCheck(ft(fileData), it(idbData));
          function ft(d) { return d && d._meta ? new Date(d._meta.exportedAt).getTime() : 0; }
          function fTimeCheck(f, i2) { return f >= i ? fileData : idbData; }
          function ft2() {}
        }).catch(function() { return idbData; });
      });
    };

    // Simplified, correct version (overrides the above intentionally)
    S.loadBackup = function() {
      return S.get(S.LAST_SYNC_KEY).then(function(idbData) {
        if (!S.dirHandle) return idbData;
        return S.readFromFile().then(function(fileData) {
          var fTime = fileData && fileData._meta ? new Date(fileData._meta.exportedAt).getTime() : 0;
          var iTime = idbData && idbData._meta ? new Date(idbData._meta.exportedAt).getTime() : 0;
          return fTime >= iTime ? fileData : idbData;
        }).catch(function() { return idbData; });
      });
    };

    // ----- Auto-sync -----
    S.startAutoSync = function() {
      S.stopAutoSync();
      S.autoTimer = setInterval(function() {
        S.saveBackup().catch(function(e) { console.warn('[oros-sync] auto failed:', e); });
      }, S.AUTO_INTERVAL_MS);
    };
    S.stopAutoSync = function() {
      if (S.autoTimer) { clearInterval(S.autoTimer); S.autoTimer = null; }
    };

    // ----- UI hooks -----
    S.updateStatus = function(status, timestamp) {
      var el = S.ui.status ? document.getElementById(S.ui.status) : null;
      if (el) {
        el.className = 'sync-status sync-' + status;
        el.textContent = S.STATUS_LABELS[status] || status;
      }
      var lastEl = S.ui.last ? document.getElementById(S.ui.last) : null;
      if (lastEl) {
        var saved = timestamp || localStorage.getItem(S.LAST_SYNC_LOCAL);
        lastEl.textContent = saved ? new Date(saved).toLocaleString() : '';
      }
    };

    S.updateDirDisplay = function() {
      var display = S.ui.dir ? document.getElementById(S.ui.dir) : null;
      var nameEl = S.ui.dirName ? document.getElementById(S.ui.dirName) : null;
      var conn = S.ui.connect ? document.getElementById(S.ui.connect) : null;
      var disc = S.ui.disconnect ? document.getElementById(S.ui.disconnect) : null;
      if (S.dirHandle && display && nameEl) {
        nameEl.textContent = S.dirHandle.name || 'Folder';
        display.style.display = '';
        if (conn) conn.style.display = 'none';
        if (disc) disc.style.display = '';
      } else {
        if (display) display.style.display = 'none';
        if (conn) conn.style.display = '';
        if (disc) disc.style.display = 'none';
      }
    };

    // ----- Actions -----
    S.syncNow = function() {
      S.updateStatus('syncing', null);
      return S.saveBackup().then(function() {
        if (S.toast) S.toast('Sync complete');
      }).catch(function(e) {
        S.updateStatus('error', null);
        if (S.toast) S.toast('Sync failed: ' + (e.message || e));
      });
    };

    S.disconnect = function() {
      S.dirHandle = null;
      S._ensureSharedDB().then(function() { return idbDel(sharedDB, DIR_HANDLE_KEY); }).then(function() {
        S.updateStatus('idle', null);
        S.updateDirDisplay();
        if (S.toast) S.toast('Sync disconnected.');
      });
    };

    S.restoreFromIDB = function() {
      idbGet(S.db, S.LAST_SYNC_KEY).then(function(data) {
        if (!data || !data._meta) { if (S.toast) S.toast('No IndexedDB backup found'); return; }
        var d = new Date(data._meta.exportedAt).toLocaleString();
        if (!confirm('Restore from backup (' + d + ')?\n\nReplaces current app data.')) return;
        S.applyRestoredData(data);
        if (S.toast) S.toast('Restored. Reloading…');
        setTimeout(function() { location.reload(); }, 800);
      });
    };

    S.restoreFromCloud = function() {
      if (!S.dirHandle) { if (S.toast) S.toast('No sync folder connected'); return; }
      S.readFromFile().then(function(data) {
        if (!data || !data._meta) { if (S.toast) S.toast('No sync file found'); return; }
        var d = new Date(data._meta.exportedAt).toLocaleString();
        if (!confirm('Restore from cloud file (' + d + ')?\n\nReplaces current app data.')) return;
        S.applyRestoredData(data);
        localStorage.setItem(S.LAST_SYNC_LOCAL, new Date().toISOString());
        if (S.toast) S.toast('Restored. Reloading…');
        setTimeout(function() { location.reload(); }, 800);
      }).catch(function() { if (S.toast) S.toast('Read error / no sync file'); });
    };

    S.checkRemoteUpdate = function() {
      if (!S.dirHandle) return;
      S.readFromFile().then(function(fileData) {
        if (!fileData || !fileData._meta) return;
        var fTime = new Date(fileData._meta.exportedAt).getTime();
        var lTime = localStorage.getItem(S.LAST_SYNC_LOCAL);
        var lTime = lTime ? new Date(lTime).getTime() : 0;
        if (fTime > lTime) {
          var ds = new Date(fTime).toLocaleString();
          if (confirm('Newer sync file found (' + ds + ').\n\nRestore data from cloud?')) {
            S.applyRestoredData(fileData);
            localStorage.setItem(S.LAST_SYNC_LOCAL, new Date().toISOString());
            setTimeout(function() { location.reload(); }, 800);
          }
        }
      }).catch(function() {});
    };

    // ----- Status -----
    S.updateStatus = function(status, timestamp) {
      var el = S.ui.status ? document.getElementById(S.ui.status) : null;
      if (el) {
        el.className = 'sync-status sync-' + status;
        el.textContent = S.STATUS_LABELS[status] || status;
      }
      var lastEl = S.ui.last ? document.getElementById(S.ui.last) : null;
      if (lastEl) {
        var saved = timestamp || localStorage.getItem(S.LAST_SYNC_LOCAL);
        lastEl.textContent = saved ? new Date(saved).toLocaleString() : '';
      }
    };

    S.updateDirDisplay = function() {
      var display = S.ui.dir ? document.getElementById(S.ui.dir) : null;
      var nameEl = S.ui.dirName ? document.getElementById(S.ui.dirName) : null;
      var conn = S.ui.connect ? document.getElementById(S.ui.connect) : null;
      var disc = S.ui.disconnect ? document.getElementById(S.ui.disconnect) : null;
      if (S.dirHandle && display && nameEl) {
        nameEl.textContent = S.dirHandle.name || 'Unknown folder';
        display.style.display = '';
        if (conn) conn.style.display = 'none';
        if (disc) disc.style.display = '';
      } else {
        if (display) display.style.display = 'none';
        if (conn) conn.style.display = '';
        if (disc) disc.style.display = 'none';
      }
    };

    // ----- Init -----
    S.init = function() {
      if (!('indexedDB' in window)) { S.updateStatus('error', null); return Promise.resolve(); }
      return idbOpen(S.DB_NAME).then(function(db) {
        S.db = db;
        return S._restoreSharedHandle();
      }).then(function(handle) {
        if (handle) {
          S.updateStatus('synced', localStorage.getItem(S.LAST_SYNC_LOCAL));
          S.updateDirDisplay();
          S.checkRemoteUpdate();
        } else {
          S.updateStatus(isFSA() ? 'idle' : 'unsupported', null);
          S.updateDirDisplay();
        }
        S.startAutoSync();
      }).catch(function(e) {
        console.warn('[oros-sync] init failed:', e);
        S.updateStatus('error', null);
      });
    };

    S._restoreSharedHandle = function() {
      if (sharedDirHandle) { S.dirHandle = sharedDirHandle; return Promise.resolve(sharedDirHandle); }
      return S._ensureSharedDB().then(function() {
        return idbGet(sharedDB, DIR_HANDLE_KEY).then(function(handle) {
          if (!handle) return null;
          var apply = function(h) { sharedDirHandle = h; S.dirHandle = h; return h; };
          if (!handle.queryPermission) return apply(handle);
          return handle.queryPermission({ mode: 'readwrite' }).then(function(perms) {
            if (perms === 'granted') return apply(handle);
            return handle.requestPermission({ mode: 'readwrite' }).then(function(rp) {
              return rp === 'granted' ? apply(handle) : null;
            }).catch(function() { return null; });
          });
        });
      });
    };

    S.toast = cfg.toast || null;
    return S;
  }

  // ---------- Registry ----------
  var registry = {};

  window.orosSync = {
    create: create,
    isSupported: isFSA,

    register: function(instance) {
      instances[instance.id] = instance;
      if (!activeId) activeId = instance.id;
      document.dispatchEvent(new CustomEvent('oros-sync-ready', { detail: { appId: instance.id } }));
      return instance;
    },

    use: function(id) { if (instances[id]) activeId = id; },

    get: function(id) {
      if (id) return instances[id] || null;
      return activeId ? instances[activeId] : null;
    },

    syncNow: function() {
      var inst = window.orosSync.get();
      if (inst && typeof inst.syncNow === 'function') inst.syncNow();
    }
  };
})();