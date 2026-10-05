// ============================================================
// orOS — storage-adapters.js (Unified Storage Adapter Layer)
// OROS_BIBLE Part VI — "Unified Storage Adapter Rule"
//
// One contract, many providers. Every cloud provider sits behind
// the same adapter interface; nothing ABOVE this layer (sync.js,
// apps, Vault Drive) may talk to a provider directly.
//
// Adapter contract (mandatory operations):
//   connect()                            → redirect user to OAuth consent
//   handleRedirect() → Promise<bool>     → consumed on boot (callback legs)
//   disconnect()                         → forget tokens (LOCAL only)
//   isConnected() → bool
//   getUserInfo() → Promise<{email,name}>
//   putObject(key, data)                 → chunked inside, transparent
//   getText(key) → Promise<string|null>  → missing object ⇒ null
//   getObject(key) → Promise<Uint8Array|null> → missing ⇒ null
//   deleteObject(key)                    → idempotent (missing ⇒ resolves)
//   listPrefix(prefix) → Promise<string[]>
//   getRevision(key) → Promise<rev|null>
//   putIfMatch(key, data, expectedRev) → Promise<{ok,newRev}>
//        Dropbox: NATIVE conditional write (mode update + rev).
//        pCloud:  read-revision-compare-write fallback (Bible §VI).
//
// Key semantics: keys are RELATIVE FLAT paths at the root of the
// provider's sandbox — Dropbox app folder root, pCloud /orOS
// folder — e.g. "orOS-data.json", "orOS-backup-2026-….json".
//
// INTERIM COEXISTENCE: sync.js still owns its own Dropbox OAuth and
// I/O. This layer reads/writes the EXACT same oros-db-* localStorage
// keys, so states stay coherent. When sync.js is rewired (next dose)
// its internal Dropbox code is deleted and this becomes the single
// path. Both redirect handlers may race the code exchange during the
// interim — the loser logs one harmless warn and resolves false.
//
// VERIFY BEFORE PRODUCTION (Bible "no guessing"):
//   · pCloud chunked upload (upload_init / upload_write / upload_save)
//   · pCloud "missing object" result codes (2055/2059 — and whether
//     2005 ever appears on the paths we use)
// Both must be exercised with the Wave-2 console test snippet on a
// real account before this file ships to stable. Marked VERIFY below.
// ============================================================
(function () {
  "use strict";

  // ---------- Shared helpers ----------
  var PROVIDER_KEY = "oros-sync-provider";   // "dropbox" | "pcloud"

  function toBytes(data) {
    if (typeof data === "string") {
      return Promise.resolve(new TextEncoder().encode(data));
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      return data.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    if (data instanceof Uint8Array) return Promise.resolve(data);
    if (data && data.buffer instanceof ArrayBuffer) {
      return Promise.resolve(new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength));
    }
    return Promise.reject(new Error("unsupported data type"));
  }

  function toBlob(data) {
    return toBytes(data).then(function (bytes) { return new Blob([bytes]); });
  }

  function sha256Hex(bytes) {
    return crypto.subtle.digest("SHA-256", bytes).then(function (hash) {
      var hex = "", view = new Uint8Array(hash);
      for (var i = 0; i < view.length; i++) {
        hex += ("0" + view[i].toString(16)).slice(-2);
      }
      return hex;
    });
  }

  // Content-addressed keys for Vault Drive objects (Bible §VI):
  // objects/<sha256-of-content>
  function makeContentKey(data) {
    return toBytes(data).then(sha256Hex).then(function (hash) {
      return "objects/" + hash;
    });
  }

  // ---------- Adapter registry ----------
  var adapters = {};

  function registerAdapter(impl) { adapters[impl.name] = impl; }

  function currentAdapter() {
    var name = localStorage.getItem(PROVIDER_KEY);
    var a = name && adapters[name];
    return a || adapters.dropbox || null;
  }

  function delegate(fn) {
    return function () {
      var a = currentAdapter();
      if (!a) return Promise.reject(new Error("no storage adapter"));
      return a[fn].apply(a, arguments);
    };
  }

  // ============================================================
  // Dropbox adapter (PKCE OAuth, same oros-db-* keys as sync.js)
  // ============================================================
  (function () {
    var APP_KEY    = "wnohlxz79ie8w3e";
    var TOKEN_API  = "https://api.dropboxapi.com/oauth2/token";
    var AUTH_URL   = "https://www.dropbox.com/oauth2/authorize";
    var RPC_API    = "https://api.dropboxapi.com/2/";
    var CONTENT_API = "https://content.dropboxapi.com/2/";

    var SINGLE_UPLOAD_LIMIT = 150 * 1024 * 1024;   // Bible §VI ceiling
    var SESSION_CHUNK       = 32 * 1024 * 1024;

    var accessToken   = null;
    var refreshToken  = null;
    var tokenExpiry   = 0;
    var cachedAccount = null;
    var refreshInFlight = null;

    function redirectUri() { return window.location.origin + "/"; }

    function pathOf(key) { return "/" + String(key).replace(/^\/+/, ""); }
    function normKey(lowerPath) { return String(lowerPath).replace(/^\//, ""); }
    function apiArg(obj) { return JSON.stringify(obj); }

    // ----- tokens (mirrors sync.js storage keys) -----
    function loadTokens() {
      accessToken  = localStorage.getItem("oros-db-access")  || null;
      refreshToken = localStorage.getItem("oros-db-refresh") || null;
      tokenExpiry  = parseInt(localStorage.getItem("oros-db-expiry") || "0", 10) || 0;
      try {
        var acc = localStorage.getItem("oros-db-account");
        cachedAccount = acc ? JSON.parse(acc) : null;
      } catch (e) { cachedAccount = null; }
    }

    function saveTokens(tokens) {
      accessToken  = tokens.access_token  || null;
      refreshToken = tokens.refresh_token || refreshToken || null;
      tokenExpiry  = Date.now() + ((tokens.expires_in || 14400) - 300) * 1000;
      localStorage.setItem("oros-db-access",  accessToken  || "");
      localStorage.setItem("oros-db-refresh", refreshToken || "");
      localStorage.setItem("oros-db-expiry",  String(tokenExpiry));
    }

    function b64urlEncode(buf) {
      var bytes = new Uint8Array(buf), str = "";
      for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
      return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    // ----- OAuth (PKCE) -----
    function startOAuth() {
      var verifierBytes = new Uint8Array(32);
      crypto.getRandomValues(verifierBytes);
      var verifier = b64urlEncode(verifierBytes.buffer);
      sessionStorage.setItem("oros-pkce-verifier", verifier);

      var challengeInput = new TextEncoder().encode(verifier);
      return crypto.subtle.digest("SHA-256", challengeInput).then(function (digest) {
        window.location.href = AUTH_URL +
          "?response_type=code" +
          "&client_id=" + encodeURIComponent(APP_KEY) +
          "&redirect_uri=" + encodeURIComponent(redirectUri()) +
          "&token_access_type=offline" +
          "&code_challenge=" + encodeURIComponent(b64urlEncode(digest)) +
          "&code_challenge_method=S256";
      });
    }

    function handleRedirect() {
      var params = new URLSearchParams(window.location.search);
      var code = params.get("code");
      if (!code) return Promise.resolve(false);
      var verifier = sessionStorage.getItem("oros-pkce-verifier");
      if (!verifier) return Promise.resolve(false);

      var body = new URLSearchParams({
        grant_type:    "authorization_code",
        code:          code,
        client_id:     APP_KEY,
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
          saveTokens(tokens);
          window.history.replaceState({}, "", "/");
          return true;
        })
        .catch(function (err) {
          // Interim: sync.js may have consumed the code first —
          // its tokens are OUR tokens (same localStorage keys).
          console.warn("orOS storage: dropbox redirect handling failed:", err);
          sessionStorage.removeItem("oros-pkce-verifier");
          window.history.replaceState({}, "", "/");
          loadTokens();
          return !!(accessToken || refreshToken);
        });
    }

    function ensureFreshToken() {
      if (accessToken && Date.now() < tokenExpiry) return Promise.resolve(accessToken);
      return refreshAccessToken();
    }

    function refreshAccessToken() {
      if (!refreshToken) return Promise.reject(new Error("not-connected"));
      if (refreshInFlight) return refreshInFlight;   // one flight, shared

      var body = new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
        client_id:     APP_KEY
      });
      refreshInFlight = fetch(TOKEN_API, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
      })
        .then(function (res) {
          if (!res.ok) throw new Error("auth refresh failed: " + res.status);
          return res.json();
        })
        .then(function (tokens) {
          saveTokens(tokens);
          return accessToken;
        })
        .finally(function () { refreshInFlight = null; });
      return refreshInFlight;
    }

    // ----- API plumbing -----
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

    // Returns parsed json, DOES NOT throw on 409/missing — caller
    // decides. Throws on every other non-ok status.
    function rpcJson(endpoint, args) {
      return rpc(endpoint, args).then(function (res) {
        if (res.status === 409) return null;
        if (!res.ok) throw new Error("dropbox " + endpoint + " failed: " + res.status);
        return res.json();
      });
    }

    function rawDownload(path) {
      return ensureFreshToken().then(function (token) {
        return fetch(CONTENT_API + "files/download", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Dropbox-API-Arg": apiArg({ path: path })
          }
        });
      }).then(function (res) {
        if (res.status === 409) return null;   // missing — empty cloud is fine
        if (!res.ok) throw new Error("dropbox download failed: " + res.status);
        return res;
      });
    }

    // Returns { conflict, rev }. mode: "overwrite" | update-object.
    function singleUpload(path, blob, mode) {
      return ensureFreshToken().then(function (token) {
        return fetch(CONTENT_API + "files/upload", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/octet-stream",
            "Dropbox-API-Arg": apiArg({
              path: path,
              mode: mode || "overwrite",
              autorename: false,
              mute: true
            })
          },
          body: blob
        });
      }).then(function (res) {
        if (res.status === 409) return { conflict: true, rev: null };
        if (!res.ok) throw new Error("dropbox upload failed: " + res.status);
        return res.json().then(function (j) { return { conflict: false, rev: j.rev }; });
      });
    }

    // Session upload for >150MB objects (Bible §VI mandatory).
    // Offset discipline: append_v2's cursor.offset = bytes already
    // uploaded (START of the chunk being appended), finish carries
    // the total. Verified against Dropbox API v2 upload sessions.
    function sessionUpload(path, blob) {
      return ensureFreshToken().then(function (token) {
        var sessionId = null;
        var offset = 0;

        function send(url, arg, chunk) {
          return fetch(url, {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + token,
              "Content-Type": "application/octet-stream",
              "Dropbox-API-Arg": apiArg(arg)
            },
            body: chunk || ""
          });
        }

        function start() {
          var chunk = blob.slice(0, SESSION_CHUNK);
          return send(CONTENT_API + "files/upload_session/start", { close: false }, chunk)
            .then(function (res) {
              if (!res.ok) throw new Error("session start failed: " + res.status);
              return res.json();
            })
            .then(function (j) {
              sessionId = j.session_id;
              offset = chunk.size;
            });
        }

        function append() {
          if (offset >= blob.size) return finish();
          var chunk = blob.slice(offset, Math.min(offset + SESSION_CHUNK, blob.size));
          var at = offset;
          return send(CONTENT_API + "files/upload_session/append_v2",
            { cursor: { session_id: sessionId, offset: at }, close: false }, chunk)
            .then(function (res) {
              if (!res.ok) throw new Error("session append failed: " + res.status);
              offset = at + chunk.size;
              return append();
            });
        }

        function finish() {
          return send(CONTENT_API + "files/upload_session/finish", {
            cursor: { session_id: sessionId, offset: offset },
            commit: { path: path, mode: "overwrite", autorename: false, mute: true }
          }, "")
            .then(function (res) {
              if (!res.ok) throw new Error("session finish failed: " + res.status);
              return res.json();
            });
        }

        return start().then(append);
      });
    }

    // ----- Adapter -----
    var adapter = {
      name: "dropbox",

      connect:        startOAuth,
      handleRedirect: handleRedirect,
      isConnected:    function () { return !!(accessToken || refreshToken); },

      disconnect: