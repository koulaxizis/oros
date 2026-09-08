// ============================================================
// orOS Core v0 — Dropbox Sync module (final)
//
// - window.orosSync — shared sync framework for the shell + all apps
// - Dropbox provider: PKCE OAuth (no client secret), App-folder scoped
// - Client-side AES-GCM encryption: Dropbox sees ciphertext only
// - Blob (orOS-data.json) = { salt, iv, ver, data } — encrypted JSON:
//     { shell: {...}, apps: { <sliceName>: {...} }, meta: {...} }
// - Overwrite safety: remote blob backed up as orOS-backup-<ts>.json
//   before every push (keeps last 5 backups)
// - Passphrase: memory only, never persisted
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

  var TOKEN_API  = "https://api.dropboxapi.com/oauth2/token";
  var AUTH_URL   = "https://www.dropbox.com/oauth2/authorize";
  var RPC_API    = "https://api.dropboxapi.com/2/";
  var CONTENT_API = "https://content.dropboxapi.com/2/";

  // ---------- Internal state ----------
  var accessToken   = null;   // string | null
  var refreshToken  = null;
  var tokenExpiry  = 0;       // ms epoch
  var cachedAccount = null;   // { email, name }
  var passphrase    = null;   // memory only

  // Registered data slices (shell + apps)
  var slices = {};            // name -> { get: fn, set: fn }

  // ---------- Base64 / Base64URL helpers ----------
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

    // Survives the redirect round-trip, dies with the tab
    sessionStorage.setItem("oros-pkce-verifier", verifier);

    var challengeInput = new TextEncoder().encode(verifier);
    return crypto.subtle.digest("SHA-256", challengeInput).then(function (digest) {
      var challenge = b64urlEncode(digest);
      var url = AUTH_URL +
        "?response_type=code" +
        "&client_id=" + encodeURIComponent(DROPBOX_APP_KEY) +
        "&redirect_uri=" + encodeURIComponent(redirectUri()) +
        "&token_access_type=offline" +
        "&code_challenge=" + encodeURIComponent(challenge) +
        "&code_challenge_method=S256";
      window.location.href = url;   // leaves orOS — comes back with ?code=
    });
  }

  function redirectUri() {
    // Preserve nothing else: clean root, matches the Dropbox app settings
    return window.location.origin + "/";
  }

  // Called on boot when URL contains ?code= (returning from Dropbox)
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
        // Clean the ?code= out of the URL (keep nothing else)
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
    // Dropbox access tokens live ~4h; refresh 5 minutes early
    tokenExpiry  = Date.now() + ((tokens.expires_in || 14400) - 300) * 1000;

    localStorage.setItem("oros-db-access",  accessToken  || "");
    localStorage.setItem("oros-db-refresh", refreshToken || "");
    localStorage.setItem("oros-db-expiry",  String(tokenExpiry));
  }

  function restoreTokens() {
    accessToken  = localStorage.getItem("oros-db-access")  || null;
    refreshToken = localStorage.getItem("oros-db-refresh") || null;
    tokenExpiry  = parseInt(localStorage.getItem("oros-db-expiry") || "0", 10) || 0;
    cachedAccount = null;
    try {
      var acc = localStorage.getItem("oros-db-account");
      if (acc) cachedAccount = JSON.parse(acc);
    } catch (e) { cachedAccount = null; }
  }

  function refreshAccessToken() {
    if (!refreshToken) return Promise.reject(new Error("no refresh token"));

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
        if (!res.ok) throw new Error("refresh failed: " + res.status);
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

  // ---------- Crypto (AES-GCM + PBKDF2) ----------
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

  // ---------- Slice collection / application ----------
  function registerSlice(name, getter, setter) {
    slices[name] = { get: getter, set: setter };
  }

  function collectPayload() {
    var payload = { shell: null, apps: {}, meta: {} };
    Object.keys(slices).forEach(function (name) {
      var data;
      try { data = slices[name].get(); } catch (e) { data = null; }
      if (name === "shell") payload.shell = data;
      else payload.apps[name] = data;
    });
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
      Object.keys(payload.apps).forEach(function (name) {
        if (slices[name] && payload.apps[name] !== null) {
          try { slices[name].set(payload.apps[name]); applied++; } catch (e) {}
        }
      });
    }
    return applied;
  }

  // ---------- Backup handling ----------
  function backupExistingRemote() {
    return rpc("files/copy_v2", {
      from_path: BLOB_PATH,
      to_path:   BACKUP_PREFIX + new Date().toISOString().replace(/[:.]/g, "-") + ".json"
    })
      .then(function () { return true; })
      .catch(function (err) {
        // Expected when nothing was pushed yet — not an error for us
        return false;
      });
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
          .sort(function (a, b) { return a.name < b.name ? 1 : -1; }); // newest first

        var doomed = backups.slice(MAX_BACKUPS);   // everything past the last 5
        return Promise.all(doomed.map(function (f) {
          return rpc("files/delete_v2", { path: f.path_lower }).catch(function () {});
        }));
      })
      .catch(function () { /* listing failed — pruning is best-effort */ });
  }

  // ---------- Pull / Push ----------
  function pull() {
    if (!isConnected()) return Promise.reject(new Error("not-connected"));
    if (!passphrase)    return Promise.reject(new Error("no-passphrase"));

    return contentDownload(BLOB_PATH)
      .then(function (res) {
        if (res.status === 409) return null;      // not found on remote yet
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

    var payload = collectPayload();
    var encryptedText = null;

    return encryptBlob(payload)
      .then(function (text) {
        encryptedText = text;
        return backupExistingRemote();            // safety net BEFORE overwrite
      })
      .then(function () {
        return contentUpload(BLOB_PATH, encryptedText);
      })
      .then(function (res) {
        if (!res.ok) throw new Error("upload failed: " + res.status);
        return pruneBackups();
      })
      .then(function () {
        return { ok: true };
      });
  }

  // ---------- Connection lifecycle ----------
  function isConnected() {
    return !!(accessToken || refreshToken);
  }

  function connect() {
    return startOAuth();   // navigates away; returns after redirect back
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

  function setPassphrase(pw) {
    passphrase = pw;
  }

  // ---------- Boot ----------
  restoreTokens();
  var redirectHandled = handleOAuthRedirect();

  // ---------- Public API ----------
  window.orosSync = {
    // Lifecycle
    connect:            connect,
    disconnect:         disconnect,
    isConnected:        isConnected,
    getUserInfo:        getUserInfo,
    redirectHandled:    redirectHandled,   // promise<bool> — true if we just returned from Dropbox

    // Data
    pull:               pull,
    push:               push,

    // Passphrase (memory only)
    setPassphrase:      setPassphrase,
    hasPassphrase:      function () { return passphrase !== null; },
    forgetPassphrase:   function () { passphrase = null; },

    // App integration — future apps register their own slice
    registerSlice:      registerSlice,

    // Error code -> i18n key mapping (used by the shell UI)
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