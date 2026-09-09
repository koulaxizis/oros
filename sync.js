// ============================================================
// orOS Core v0.6 — Dropbox Sync module
//
// - window.orosSync — shared sync framework for the shell + all apps
// - Dropbox PKCE OAuth (app-folder scoped, no client secret)
// - AES-GCM + PBKDF2 client-side encryption (zero-knowledge)
// - Trusted device vault: passphrase sealed with a NON-EXTRACTABLE
//   AES key living in IndexedDB (opt-in per device).
// - Dirty flag: any slice change marks sync pending (persisted).
// - Auto engine: boot reconcile (pull, then push if dirty),
//   periodic push (default 3 min) when dirty, push on tab hide.
//
// v0.6 — PERSISTED SLICE REGISTRY + CARRY-FORWARD:
//   - registerSlice(name, get, set, storageKey?) persists the
//     storageKey → future boots hydrate lightweight proxies
//     (get/set read/write the app's localStorage directly), so
//     pushes/pulls carry app slices EVEN WHEN THE APP IS CLOSED.
//   - Unknown remote slices (app never registered anywhere on this
//     device) are held in a carry mailbox and pushed forward —
//     a device can never silently wipe app data it doesn't know.
// ============================================================
(function () {
  "use strict";

  // ---------- Configuration ----------
  var DROPBOX_APP_KEY = "wnohlxz79ie8w3e";
  var BLOB_PATH       = "/orOS-data.json";
  var BACKUP_PREFIX   = "/orOS-backup-";
  var MAX_BACKUPS     = 5;
  var BLOB_VERSION    = 1;
  var PBKDF2_ROUNDS   = 100000;
  var INTERVAL_KEY = "oros-sync-interval";   // minutes; 0 = off
  var DIRTY_KEY       = "oros-sync-dirty";
  var VAULT_KEY       = "oros-vault-data";   // localStorage: sealed passphrase
  var SLICES_KEY      = "oros-slices";       // persisted registry: name -> storageKey
  var CARRY_KEY       = "oros-remote-carry"; // mailbox: name -> data (unknown slices)

  var TOKEN_API   = "https://api.dropboxapi.com/oauth2/token";
  var AUTH_URL    = "https://www.dropbox.com/oauth2/authorize";
  var RPC_API     = "https://api.dropboxapi.com/2/";
  var CONTENT_API = "https://content.dropboxapi.com/2/";

  // ---------- Internal state ----------
  var accessToken   = null;
  var refreshToken  = null;
  var tokenExpiry  = 0;
  var cachedAccount = null;
  var passphrase    = null;      // memory
  var vaultReady    = false;

  var slices = {};

  // Subscribers for subtle auto-sync feedback (shell status dot pulse)
  var autoListeners = [];

  // Engine guards: never two pushes/pulls racing each other
  var pushInFlight = false;
  var lastPushFailed = false;

  // ---------- Base64 helpers ----------
  function b64encode(buf) {
    var bytes = new Uint8Array(buf);
    var str = "";
    for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str);
  }

  function b64decode(b64) {
    var str = atob(b64);
    var bytes = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
    return bytes;
  }

  function b64urlEncode(buf) {
    return b64encode(buf)
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // ---------- PKCE OAuth ----------
  function startOAuth() {
    var verifierBytes = new Uint8Array(32);
    crypto.getRandomValues(verifierBytes);
    var verifier = b64urlEncode(verifierBytes.buffer);

    sessionStorage.setItem("oros-pkce-verifier", verifier);

    var challengeInput = new TextEncoder().encode(verifier);
    return crypto.subtle.digest("SHA-256", challengeInput).then(function (digest) {
      var challenge = b64urlEncode(digest);
      window.location.href = AUTH_URL +
        "?response_type=code" +
        "&client_id=" + encodeURIComponent(DROPBOX_APP_KEY) +
        "&redirect_uri=" + encodeURIComponent(redirectUri()) +
        "&token_access_type=offline" +
        "&code_challenge=" + encodeURIComponent(challenge) +
        "&code_challenge_method=S256";
    });
  }

  function redirectUri() {
    return window.location.origin + "/";
  }

  function handleOAuthRedirect() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get("code");
    if (!code) return Promise.resolve(false);

    var verifier = sessionStorage.getItem("oros-pkce-verifier");
    if (!verifier) return Promise.resolve(false);

    var body = new URLSearchParams({
      grant_type:    "authorization_code",
      code:          code,
      client_id:     DROPBOX_APP_KEY,
      redirect_uri:  redirectUri(),
      code_verifier: verifier
    });

    return fetch(TOKEN_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    })
      .then(function (res) {
        if (!res.ok) throw new Error("token exchange failed: " + res.status);
        return res.json();
      })
      .then(function (tokens) {
        sessionStorage.removeItem("oros-pkce-verifier");
        storeTokens(tokens);
        window.history.replaceState({}, "", "/");
        return true;
      })
      .catch(function (err) {
        console.warn("orOS sync: OAuth redirect handling failed:", err);
        window.history.replaceState({}, "", "/");
        return false;
      });
  }

  function storeTokens(tokens) {
    accessToken  = tokens.access_token || null;
    refreshToken = tokens.refresh_token || refreshToken || null;
    tokenExpiry  = Date.now() + ((tokens.expires_in || 14400) - 300) * 1000;

    localStorage.setItem("oros-db-access",  accessToken  || "");
    localStorage.setItem("oros-db-refresh", refreshToken || "");
    localStorage.setItem("oros-db-expiry",  String(tokenExpiry));
  }

  function restoreTokens() {
    accessToken   = localStorage.getItem("oros-db-access")  || null;
    refreshToken  = localStorage.getItem("oros-db-refresh") || null;
    tokenExpiry  = parseInt(localStorage.getItem("oros-db-expiry") || "0", 10) || 0;
    cachedAccount = null;
    try {
      var acc = localStorage.getItem("oros-db-account");
      if (acc) cachedAccount = JSON.parse(acc);
    } catch (e) { cachedAccount = null; }
  }

  function refreshAccessToken() {
    if (!refreshToken) return Promise.reject(new Error("not-connected"));

    var body = new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
      client_id:     DROPBOX_APP_KEY
    });

    return fetch(TOKEN_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    })
      .then(function (res) {
        if (!res.ok) throw new Error("auth refresh failed: " + res.status);
        return res.json();
      })
      .then(function (tokens) {
        storeTokens(tokens);
        return accessToken;
      });
  }

  function ensureFreshToken() {
    if (accessToken && Date.now() < tokenExpiry) return Promise.resolve(accessToken);
    return refreshAccessToken();
  }

  // ---------- Dropbox API wrappers ----------
  function rpc(endpoint, args) {
    return ensureFreshToken().then(function (token) {
      return fetch(RPC_API + endpoint, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(args || {})
      });
    });
  }

  function contentDownload(path) {
    return ensureFreshToken().then(function (token) {
      return fetch(CONTENT_API + "files/download", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Dropbox-API-Arg": JSON.stringify({ path: path })
        }
      });
    });
  }

  function contentUpload(path, text) {
    return ensureFreshToken().then(function (token) {
      return fetch(CONTENT_API + "files/upload", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({
            path: path,
            mode: "overwrite",
            autorename: false,
            mute: true
          })
        },
        body: text
      });
    });
  }

  function getUserInfo() {
    if (cachedAccount) return Promise.resolve(cachedAccount);
    return rpc("users/get_current_account", {})
      .then(function (res) {
        if (!res.ok) throw new Error("account info failed: " + res.status);
        return res.json();
      })
      .then(function (info) {
        cachedAccount = { email: info.email, name: info.name.display_name };
        localStorage.setItem("oros-db-account", JSON.stringify(cachedAccount));
        return cachedAccount;
      });
  }

  // ---------- Crypto (blob): AES-GCM + PBKDF2 ----------
  function deriveKey(salt) {
    var material = new TextEncoder().encode(passphrase);
    return crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveKey"])
      .then(function (key) {
        return crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: salt, iterations: PBKDF2_ROUNDS, hash: "SHA-256" },
          key,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );
      });
  }

  function encryptBlob(payloadObj) {
    var salt = new Uint8Array(16); crypto.getRandomValues(salt);
    var iv   = new Uint8Array(12); crypto.getRandomValues(iv);
    var plain = new TextEncoder().encode(JSON.stringify(payloadObj));

    return deriveKey(salt).then(function (key) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plain);
    })
      .then(function (cipher) {
        return JSON.stringify({
          ver:  BLOB_VERSION,
          salt: b64encode(salt.buffer),
          iv:   b64encode(iv.buffer),
          data: b64encode(cipher)
        });
      });
  }

  function decryptBlob(blobText) {
    var blob = JSON.parse(blobText);
    if (!blob || blob.ver !== BLOB_VERSION) {
      return Promise.reject(new Error("unsupported blob version"));
    }
    var salt = b64decode(blob.salt);
    var iv   = b64decode(blob.iv);
    var data = b64decode(blob.data);

    return deriveKey(salt).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, data);
    })
      .then(function (plain) {
        return JSON.parse(new TextDecoder().decode(plain));
      });
  }

  // ---------- Trusted device vault (IndexedDB, non-extractable key) ----------
  // The device key is generated ONCE per device and stored in IndexedDB as a
  // CryptoKey object with extractable=false — the raw bytes can never be
  // read by JS. It can only be USED to seal/unseal the passphrase.
  // The sealed passphrase (iv + ciphertext, base64) lives in localStorage.

  function openVaultDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open("oros-vault", 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore("keys");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  function idbRequest(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror   = function () { reject(request.error); };
    });
  }

  function getDeviceKey(db) {
    return idbRequest(db.transaction("keys").objectStore("keys").get("device"))
      .then(function (existing) {
        if (existing) return existing;
        // First run on this device: generate + persist the non-extractable key
        return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
          .then(function (key) {
            return idbRequest(db.transaction("keys", "readwrite")
              .objectStore("keys").put(key, "device"))
              .then(function () { return key; });
          });
      });
  }

  function sealPassphrase(pass) {
    return openVaultDb()
      .then(getDeviceKey)
      .then(function (key) {
        var iv = new Uint8Array(12); crypto.getRandomValues(iv);
        var plain = new TextEncoder().encode(pass);
        return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plain)
          .then(function (sealed) {
            localStorage.setItem(VAULT_KEY, JSON.stringify({
              iv: b64encode(iv.buffer),
              data: b64encode(sealed)
            }));
          });
      });
  }

  function unsealPassphrase() {
    var raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return Promise.resolve(null);
    var record;
    try { record = JSON.parse(raw); } catch (e) { return Promise.resolve(null); }

    return openVaultDb()
      .then(getDeviceKey)
      .then(function (key) {
        return crypto.subtle.decrypt(
          { name: "AES-GCM", iv: b64decode(record.iv) },
          key,
          b64decode(record.data)
        );
      })
      .then(function (plain) {
        return new TextDecoder().decode(plain);
      })
      .catch(function () {
        return null;   // wrong vault (e.g. cleared IDB) — treat as absent
      });
  }

  function clearVault() {
    localStorage.removeItem(VAULT_KEY);
    return openVaultDb().then(function (db) {
      return idbRequest(db.transaction("keys", "readwrite")
        .objectStore("keys").delete("device"));
    }).catch(function () { /* vault already gone — fine */ });
  }

  // ---------- Slices (v0.6: persisted registry + proxies + carry) ----------

  function readJson(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeJson(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }

  function readCarry() { return readJson(CARRY_KEY); }
  function writeCarry(obj) {
    if (obj && Object.keys(obj).length > 0) writeJson(CARRY_KEY, obj);
    else localStorage.removeItem(CARRY_KEY);
  }

  function persistSliceEntry(name, storageKey) {
    var reg = readJson(SLICES_KEY) || {};
    reg[name] = storageKey;
    writeJson(SLICES_KEY, reg);
  }

  // Boot-time: for every persisted registration without a live slice,
  // install a lightweight proxy that reads/writes the app's localStorage
  // directly. Result: app slices travel in pushes/pulls EVEN WHEN THE
  // APP IS CLOSED (root cause of the v0.5 sync loss).
  function hydratePersistedSlices() {
    var reg = readJson(SLICES_KEY) || {};
    Object.keys(reg).forEach(function (name) {
      if (slices[name]) return;          // live registration always wins
      var storageKey = reg[name];
      slices[name] = {
        live: false,
        get: function () { return readJson(storageKey); },
        set: function (data) { writeJson(storageKey, data); }
      };
    });
  }

  function registerSlice(name, getter, setter, storageKey) {
    slices[name] = { get: getter, set: setter, live: true };

    if (storageKey) persistSliceEntry(name, storageKey);

    // Mailbox flush: if remote data for this slice was carried while it
    // was unknown on this device, deliver it through the (now live)
    // setter — the app picks it up from its own storage.
    var carry = readCarry();
    if (carry && carry[name] !== undefined) {
      var data = carry[name];
      delete carry[name];
      writeCarry(carry);
      try { slices[name].set(data); } catch (e) {}
    }
  }

  function collectPayload() {
    var payload = { shell: null, apps: {}, meta: {} };
    Object.keys(slices).forEach(function (name) {
      var data;
      try { data = slices[name].get(); } catch (e) { data = null; }
      if (name === "shell") payload.shell = data;
      else payload.apps[name] = data;
    });

    // Carry-forward: remote slices UNKNOWN on this device travel
    // forward untouched — a device must never wipe app data it
    // doesn't know about. Entries whose slice has since become
    // known (live or proxied) are dropped: local state is
    // authoritative there.
    var carry = readCarry();
    if (carry) {
      var changed = false;
      Object.keys(carry).forEach(function (name) {
        if (slices[name]) { delete carry[name]; changed = true; }
        else payload.apps[name] = carry[name];
      });
      if (changed) writeCarry(carry);
    }

    payload.meta = { lastPush: new Date().toISOString(), device: navigator.userAgent.slice(0, 80) };
    return payload;
  }

  function applyPayload(payload) {
    if (!payload) return 0;
    var applied = 0;
    if (payload.shell && slices.shell) {
      try { slices.shell.set(payload.shell); applied++; } catch (e) {}
    }
    if (payload.apps) {
      var carry = readCarry() || {};
      var carryChanged = false;
      Object.keys(payload.apps).forEach(function (name) {
        var data = payload.apps[name];
        if (data === null || data === undefined) return;
        if (slices[name]) {
          try { slices[name].set(data); applied++; } catch (e) {}
        } else {
          // Unknown slice: park it in the carry mailbox. Never dropped,
          // never overwritten — the next push relays it forward.
          carry[name] = data;
          carryChanged = true;
        }
      });
      if (carryChanged) writeCarry(carry);
    }
    return applied;
  }

  // ---------- Backups ----------
  function backupExistingRemote() {
    return rpc("files/copy_v2", {
      from_path: BLOB_PATH,
      to_path:   BACKUP_PREFIX + new Date().toISOString().replace(/[:.]/g, "-") + ".json"
    })
      .then(function () { return true; })
      .catch(function () { return false; });   // nothing pushed yet — fine
  }

  function pruneBackups() {
    return rpc("files/list_folder", { path: "", recursive: false })
      .then(function (res) {
        if (!res.ok) return [];
        return res.json();
      })
      .then(function (listing) {
        var backups = (listing.entries || [])
          .filter(function (e) { return e.name && e.name.indexOf("orOS-backup-") === 0; })
          .sort(function (a, b) { return a.name < b.name ? 1 : -1; });

        var doomed = backups.slice(MAX_BACKUPS);
        return Promise.all(doomed.map(function (f) {
          return rpc("files/delete_v2", { path: f.path_lower }).catch(function () {});
        }));
      })
      .catch(function () { /* best-effort */ });
  }

  // ---------- Dirty flag ----------
  function markDirty() {
    localStorage.setItem(DIRTY_KEY, "1");
  }
  function clearDirty() {
    localStorage.removeItem(DIRTY_KEY);
  }
  function isDirty() {
    return localStorage.getItem(DIRTY_KEY) === "1";
  }

  // ---------- Pull / Push ----------
  function pull() {
    if (!isConnected()) return Promise.reject(new Error("not-connected"));
    if (!passphrase)    return Promise.reject(new Error("no-passphrase"));

    return contentDownload(BLOB_PATH)
      .then(function (res) {
        if (res.status === 409) return null;
        if (!res.ok) throw new Error("download failed: " + res.status);
        return res.text();
      })
      .then(function (blobText) {
        if (!blobText) return { ok: true, empty: true, applied: 0 };
        return decryptBlob(blobText)
          .then(function (payload) {
            var applied = applyPayload(payload);
            return { ok: true, empty: false, applied: applied };
          });
      });
  }

  function push() {
    if (!isConnected()) return Promise.reject(new Error("not-connected"));
    if (!passphrase)    return Promise.reject(new Error("no-passphrase"));
    if (pushInFlight)   return Promise.reject(new Error("push already in flight"));

    pushInFlight = true;
    var payload = collectPayload();
    var encryptedText = null;

    return encryptBlob(payload)
      .then(function (text) {
        encryptedText = text;
        return backupExistingRemote();
      })
      .then(function () {
        return contentUpload(BLOB_PATH, encryptedText);
      })
      .then(function (res) {
        if (!res.ok) throw new Error("upload failed: " + res.status);
        return pruneBackups();
      })
      .then(function () {
        clearDirty();
        return { ok: true };
      })
      .finally(function () {
        pushInFlight = false;
      });
  }

  // ---------- Auto engine ----------
  function emitAutoEvent(kind, detail) {
    autoListeners.forEach(function (fn) {
      try { fn(kind, detail); } catch (e) {}
    });
  }

  function autoSyncAttempt(reason) {
    if (!isConnected() || !passphrase || !isDirty()) return;
    if (pushInFlight) return;
    if (!navigator.onLine) return;              // no wasted attempts offline

    emitAutoEvent("start", reason);
    push()
      .then(function () { emitAutoEvent("done", reason); })
      .catch(function (err)  { emitAutoEvent("fail", reason); });
  }

  // Boot: pull latest silently, then push if this device is dirty.
  function reconcileOnBoot() {
    if (!isConnected() || !passphrase) return;

    if (!navigator.onLine) return;

    emitAutoEvent("start", "boot");
    pull()
      .then(function () {
        if (isDirty()) return push().then(function () { emitAutoEvent("done", "boot"); });
        emitAutoEvent("done", "boot");
      })
      .catch(function () { emitAutoEvent("fail", "boot"); });
  }

  function getIntervalMinutes() {
    var v = parseInt(localStorage.getItem(INTERVAL_KEY) || "3", 10);
    return isNaN(v) ? 3 : v;
  }

  function setIntervalMinutes(minutes) {
    localStorage.setItem(INTERVAL_KEY, String(minutes));
    scheduleAutoInterval();          // applies immediately, no reboot
  }

  var autoTimerId = null;
  function scheduleAutoInterval() {
    if (autoTimerId) { clearInterval(autoTimerId); autoTimerId = null; }
    var mins = getIntervalMinutes();
    if (mins <= 0) return;            // Off: no periodic attempts
    autoTimerId = setInterval(function () { autoSyncAttempt("interval"); },
                              mins * 60 * 1000);
  }

  function startAutoEngine() {
    scheduleAutoInterval();

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        // Last reliable moment before tab death — fire silently
        autoSyncAttempt("hide");
      }
    });
  }

  // ---------- Connection lifecycle ----------
  function isConnected() {
    return !!(accessToken || refreshToken);
  }

  function connect() {
    return startOAuth();
  }

  function disconnect() {
    accessToken  = null;
    refreshToken = null;
    tokenExpiry  = 0;
    cachedAccount = null;
    passphrase   = null;
    localStorage.removeItem("oros-db-access");
    localStorage.removeItem("oros-db-refresh");
    localStorage.removeItem("oros-db-expiry");
    localStorage.removeItem("oros-db-account");
  }

  // Extended unlock: setPassphrase(pw, remember)
  // remember=true seals pw into the device vault (opt-in per device).
  function setPassphrase(pw, remember) {
    passphrase = pw;
    if (remember) {
      sealPassphrase(pw).catch(function (err) {
        console.warn("orOS sync: vault seal failed:", err);
      });
    }
  }

  // Boot-time: unseal from vault if present (call before startAutoEngine)
  function unlockFromVault() {
    if (passphrase) return Promise.resolve(true);
    return unsealPassphrase()
      .then(function (pw) {
        if (pw) { passphrase = pw; return true; }
        return false;
      });
  }

  function hasDeviceVault() {
    return !!localStorage.getItem(VAULT_KEY);
  }

  function clearDevice() {
    passphrase = null;
    return clearVault();
  }

  // ---------- Boot sequence ----------
  restoreTokens();

  // Hydrate persisted slice proxies BEFORE any pull/push can fire —
  // this is what makes app slices travel while apps are closed.
  hydratePersistedSlices();

  var redirectHandled = handleOAuthRedirect();

  // Vault unlock chain: after redirect handling settles, unseal + auto-engine
  var vaultUnlocked = redirectHandled.then(function () {
    return unlockFromVault().then(function (ok) {
      vaultReady = ok;
      // Start auto engine only when we can actually sync
      startAutoEngine();
      if (isConnected() && passphrase) reconcileOnBoot();
      return ok;
    });
  });

  // ---------- Public API ----------
  window.orosSync = {
    // Lifecycle
    connect:            connect,
    disconnect:         disconnect,
    isConnected:         isConnected,
    getUserInfo:         getUserInfo,
    redirectHandled:     redirectHandled,
    vaultUnlocked:       vaultUnlocked,    // promise<bool>: true if auto-unlocked

    // Data
    pull:               pull,
    push:               push,

    // Local rescue backup (plaintext, unencrypted)
    exportData: function () {
      var payload = collectPayload();
      payload.meta = {
        ver: BLOB_VERSION,
        exportedAt: new Date().toISOString()
      };
      return JSON.stringify(payload, null, 2);
    },

    importData: function (jsonText) {
      var payload = JSON.parse(jsonText);   // throws on invalid JSON
      if (!payload || typeof payload !== "object" ||
          (!payload.shell && !payload.apps)) {
        throw new Error("bad backup file");
      }
      var applied = applyPayload(payload);
      markDirty();   // imported data wins over cloud → next push uploads it
      return applied;
    },

    // Passphrase / vault
    setPassphrase:      setPassphrase,    // (pw, remember?) — remember = seal to device
    hasPassphrase:      function () { return passphrase !== null; },
    forgetPassphrase:   function () { passphrase = null; },   // session only
    clearDevice:        clearDevice,      // forget + wipe device vault
    hasDeviceVault:     hasDeviceVault,

    // App integration
    registerSlice:      registerSlice,    // (name, get, set, storageKey?)
    markDirty:          markDirty,        // apps call this on data change
    getIntervalMinutes: getIntervalMinutes,
    setIntervalMinutes: setIntervalMinutes,
    isDirty:            isDirty,

    // Auto-sync feedback (optional, for UI status pulse)
    onAutoSync:         function (fn) { if (typeof fn === "function") autoListeners.push(fn); },

    // Engine kick (manual triggers from shell, e.g. after manual unlock)
    kickAutoEngine:     function () {
      if (isConnected() && passphrase) {
        reconcileOnBoot();
      }
    },

    // Error mapping
    errorKey: function (err) {
      var msg = (err && err.message) || "";
      if (msg === "not-connected")  return "sync.err.notconnected";
      if (msg === "no-passphrase")  return "sync.err.nopass";
      if (/blob version/.test(msg)) return "sync.err.version";
      if (/token|401|400/.test(msg)) return "sync.err.auth";
      return "sync.err.generic";
    }
  };
})();