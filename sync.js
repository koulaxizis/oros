// ============================================================
// orOS Core v0.9.2 — Dropbox Sync module (Zero-Knowledge Sync v0.9)
// 2026-10-07 (core audit):
//   SY-Q1 — a FULL localStorage (R30) no longer breaks the engine or
//     its callers. markDirty() never throws (it used to throw into
//     every caller: a language toggle failed, an alarm never rang);
//     the dirty state is kept in memory when it cannot be stored. A
//     token refresh keeps the new token in memory. A mailbox copy or
//     deferral flag that cannot be saved stops the next upload
//     ("storage-full", nothing is overwritten in the cloud); a
//     baseline that cannot be saved is kept in memory.
// 2026-10-06 (audit; the version line above is unchanged on purpose):
//   SY-D1 — every upload is CONDITIONAL on the cloud revision this
//     device last pulled and applied (Dropbox mode "update"/"add" +
//     strict_conflict). A refused write → pull, merge, retry. No
//     device can replace a blob it has not seen any more.
//   SY-D2 — cloud backup copies: one per device per day, newest 7.
//   SY-D4 — storage adapter: conditional writes are the provider's own
//     ("add" / "update"), no read-compare-write window.
//   VD-KEY — changePassphrase re-wraps /vault/key.json (two steps
//     around the blob), so the Vault survives a passphrase change.
//   SY-D6 — a merge function that throws no longer means "take the
//     remote copy": local stays, the cloud copy is relayed.
//   SY-D5 — a live registration made from the app frame ends when
//     that frame shows another document: the slice returns to its
//     stored (proxy) form.
//   SY-D3 — a true conflict on a CLOSED app that can merge when open
//     is deferred: local stays, the cloud copy is relayed untouched,
//     the app's own merge joins both at its next open.
//   SY-1 — factory reset also deletes /vault. SY-2 — a failed
//     adapter upload rejects.
// v0.9.2 — applyPayload unknown-slice carry: FRESH read-modify-write
//   (parkRemote may have written the mailbox earlier in the SAME
//   loop — a pre-loop snapshot would clobber that park, destroying
//   another device's only surviving copy of its work).
// v0.9.1 — CRITICAL: contentDownload no longer throws on 409
//   (empty cloud). The eager !res.ok throw made every caller's
//   status===409 branch unreachable: push-on-empty-cloud failed,
//   pull-on-empty-cloud surfaced a generic error instead of the
//   honest "cloud is empty" toast, and changePassphrase broke on
//   a fresh reset. Status errors also pass through unwrapped so
//   errorKey() maps auth failures correctly.
//
// v0.8.1 — divergence-guard hardening: a MISSING baseline counts
//   as DIVERGED (not clean) for mergeless slices (baselineExists
//   discriminator in applySlice).
//
// - window.orosSync — shared sync framework for the shell + all apps
// - Dropbox PKCE OAuth (app-folder scoped, no client secret)
// - AES-GCM + PBKDF2 client-side encryption (zero-knowledge)
// - Trusted device vault: passphrase sealed with a NON-EXTRACTABLE
//   AES key living in IndexedDB (opt-in per device).
// - Dirty flag: any slice change marks sync pending (persisted).
// - Auto engine: boot reconcile (pull, then push if dirty),
//   periodic push (default 3 min) when dirty, push on tab hide,
//   reconcile on tab-visible AND on "online" (v0.8).
//
// v0.6 — PERSISTED SLICE REGISTRY + CARRY-FORWARD:
//   - registerSlice(name, get, set, storageKey?) persists the
//     storageKey → future boots hydrate lightweight proxies
//     (get/set read/write the app's localStorage directly), so
//     pushes/pulls carry app slices EVEN WHEN THE APP IS CLOSED.
//   - Unknown remote slices (app never registered anywhere on this
//     device) are held in a carry mailbox and pushed forward —
//     a device can never silently wipe app data it doesn't know.
//
// v0.7 — SLICE MERGE API + FULL RECONCILE:
//   - registerSlice(..., mergeFn?) — opt-in 5th argument. Apps
//     with multi-entity data (To-Do, Kanban) supply mergeFn so
//     concurrent edits on two open devices CONVERGE instead of
//     last-write-wins wiping one side.
//   - mergeFn(local, remote) → merged state. Must be deterministic:
//     both devices, given the same two inputs, must produce the
//     same output (tie-breaks: bigger mtime wins, then lexicographic).
//   - Engine flow per slice on pull:
//       merged = merge(local, remote)
//       if merged ≠ local → set(merged) + re-render (count++)
//       if merged ≠ remote → cloud is stale → markDirty → next
//       push uploads the converged state.
//     Equality via JSON.stringify — payloads are plain JSON.
//   - CONTRACT: setter may receive (data, info) where
//     info.merged === true means the value came from a merge, not
//     a wholesale remote overwrite (apps use it for a toast).
//     Legacy setters ignore the second argument — safe.
//
// v0.8 — DIVERGENCE GUARD (offline / closed-app data loss):
//   - ROOT CAUSE FIXED (reported live): an offline edit made while
//     an app was CLOSED was destroyed by the first online pull —
//     the hydrated proxy (mergeless) applied the remote blob
//     WHOLESALE over localStorage, and the follow-up push uploaded
//     the wipe. Unpushed local work was destroyable.
//   - Per-slice baselines ("oros-sync-baselines"): content hash of
//     each slice as last KNOWN-SYNCED (recorded on every successful
//     push and on every clean apply).
//   - applySlice guard: a MERGELESS slice (closed-app proxy, or an
//     app without mergeFn) whose local content DIVERGES from its
//     baseline carries unpushed local work → remote is NEVER
//     applied over it. Instead the remote parks in the carry
//     mailbox, local is flagged dirty (cloudStale) and the next
//     push uploads the local work as the new truth.
//   - Parked remotes survive until the app opens LIVE and
//     registers WITH a merge function — registerSlice's flush
//     merges them into local, so both sides' work converges
//     (a carried snapshot can never clobber newer local work).
//     Mergeless live slices apply parked data only when local
//     storage is empty (restore case); otherwise the parked
//     snapshot is by construction older than this device's last
//     successful push and is dropped.
//   - collectPayload no longer DROPS carry entries for known
//     slices — they are divergence lifelines, not relics.
//   - "online" event: the engine reconciles the moment
//     connectivity returns (was: interval / tab-visible only).
//   - BOOTSTRAP: a missing baseline (first run after upgrade)
//     counts as CLEAN — pre-v0.8 devices were LWW-synced already,
//     so their first guarded pull behaves exactly like before.
//   - ACCEPTED LIMIT: two devices offline-editing the same CLOSED
//     app converge only when one of them opens it live somewhere
//     (merge needs app code). Nothing unpushed is ever destroyed;
//     the losing side's work re-emerges through the parked
//     snapshot on the next live merge.
// ============================================================
(function () {
  "use strict";

  // ---------- Configuration ----------
  var DROPBOX_APP_KEY = "wnohlxz79ie8w3e";
  var BLOB_PATH       = "/orOS-data.json";
  var BACKUP_PREFIX   = "/orOS-backup-";
  var MAX_BACKUPS     = 7;                    // SY-D2
  var BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;  // SY-D2: one cloud backup per device per day
  var BACKUP_STAMP_KEY = "oros-sync-last-backup";   // device-local: ms of this device's last backup copy
  var MAX_PUSH_RETRIES = 3;                   // SY-D1: pull-merge-retry rounds after a conflict
  var BLOB_VERSION    = 1;
  var PBKDF2_ROUNDS   = 100000;
  var INTERVAL_KEY = "oros-sync-interval";   // minutes; 0 = off
  var DIRTY_KEY       = "oros-sync-dirty";
  var VAULT_KEY       = "oros-vault-data";   // localStorage: sealed passphrase
  var SLICES_KEY      = "oros-slices";       // persisted registry: name -> storageKey
  var CARRY_KEY       = "oros-remote-carry"; // mailbox: name -> data (unknown + parked-remote slices)
  var MERGE_REG_KEY   = "oros-slices-merge"; // SY-D3: name -> 1 for apps whose LIVE registration brought a mergeFn
  var DEFER_KEY       = "oros-sync-deferred"; // SY-D3: name -> 1 while a closed app's conflict waits for its live merge

  // SY-R (FILES-V): slices that no longer travel in the blob.
  // "files-disk" was the whole Files disk as ONE snapshot; the disk
  // now syncs per file through Vault Drive (vault.js). A retired
  // name is never registered, never applied, never carried in the
  // mailbox and never uploaded — so the old snapshot leaves the cloud
  // blob with the next push. Manual backups still contain the disk:
  // the shell adds it on export and reads it on import.
  var RETIRED_SLICES = { "files-disk": true };
  var BASELINES_KEY   = "oros-sync-baselines"; // v0.8: name -> hash(last synced content)
  var DEBOUNCE_MS     = 5000;                // v0.7.1: quiet period after last edit

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

  var slices = {};

  // Subscribers for subtle auto-sync feedback (shell status dot pulse)
  var autoListeners = [];

  // Engine guards: never two pushes/pulls racing each other
  var pushInFlight = false;
  var pullInFlight = false;
  var reconcileInFlight = false;

  // sync #1: dirty generation counter. Incremented on EVERY
  // markDirty() — lets push() tell "the dirty flag I am about to
  // clear is still the one my payload was collected for" from
  // "an edit raced my upload and the flag now stands for NEWER,
  // unuploaded work". Without it, clearDirty() after a slow
  // upload silently stranded raced edits until the next
  // unrelated user action.
  var dirtyGen = 0;

  // v0.9 Part 4: timestamp of the last pull that PROVED the current
  // passphrase decrypts the cloud blob (or the cloud is empty).
  // Feeds ensureCloudReadable() — the push-side stale-passphrase
  // guard below.
  var lastSuccessfulPullAt = 0;

  // SY-D1 — OPTIMISTIC CONCURRENCY. Revision of the cloud blob whose
  // content this device has INCORPORATED (pulled, decrypted, applied):
  //   undefined = unknown (boot, disconnect, after a conflict)
  //   null      = the cloud is known to be EMPTY
  //   string    = Dropbox "rev" of the blob we last applied / uploaded
  // Every upload is conditional on it. If another device pushed in
  // between, Dropbox refuses the write and the engine pulls, merges
  // and retries — a device can no longer replace a blob it has not
  // seen (the lost-update hole: tab-hide and manual pushes uploaded
  // blind, and a clean closed-app proxy on the other device then
  // LWW-applied the stale copy over its own newer edit).
  var cloudRev;
  // null = not probed yet; true/false = can the browser read the
  // "dropbox-api-result" response header (it carries the rev)?
  var revHeaderWorks = null;

  // v0.7.1: debounced reconcile timer (one shot at a time)
  var debounceTimer = null;

  // Factory reset: suspension flag — freezes the ENTIRE engine
  // (pull/push/reconcile/auto-attempt entry gates) so nothing can
  // race the wipe.
  var suspended = false;

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
        sessionStorage.removeItem("oros-pkce-verifier");   // SY-R4: failed
                              // exchange leaves a dead verifier behind —
                              // symmetric with the success path, and a
                              // retry starts clean instead of stale.
        window.history.replaceState({}, "", "/");
        return false;
      });
  }

  function storeTokens(tokens) {
    accessToken  = tokens.access_token || null;
    refreshToken = tokens.refresh_token || refreshToken || null;
    tokenExpiry  = Date.now() + ((tokens.expires_in || 14400) - 300) * 1000;

    // SY-Q1: a full store must not turn a good token into a failed
    // refresh — the tokens above already serve this session.
    try {
      localStorage.setItem("oros-db-access",  accessToken  || "");
      localStorage.setItem("oros-db-refresh", refreshToken || "");
      localStorage.setItem("oros-db-expiry",  String(tokenExpiry));
    } catch (e) {
      console.warn("orOS sync: tokens not saved (storage full?):", e && e.name);
    }
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

  var refreshInFlight = null;

  function refreshAccessToken() {
    if (!refreshToken) return Promise.reject(new Error("not-connected"));

    // SP4: memoize the in-flight refresh. Concurrent API legs (pull
    // racing a push, several rpc() calls in one tick) each saw the
    // same expired token and fired their OWN refresh — the loser
    // could burn a rotating refresh_token and hard-fail with
    // "auth refresh failed". One flight at a time; everyone awaits
    // the same promise.
    if (refreshInFlight) return refreshInFlight;

    var body = new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
      client_id:     DROPBOX_APP_KEY
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
        storeTokens(tokens);
        return accessToken;
      })
      .finally(function () {
        refreshInFlight = null;
      });
    return refreshInFlight;
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
    }).then(function (res) {
      // 409 = "path/not_found" — EMPTY CLOUD (first push, factory reset).
      // ALL callers branch on res.status === 409 themselves (pull →
      // {empty:true}, ensureCloudReadable → skip, changePassphrase →
      // accept-new). This wrapper must therefore NEVER throw on 409 —
      // v0.9.1 fix: the eager !res.ok throw made every 409 branch in
      // the engine unreachable and broke push-on-empty-cloud entirely.
      // Any OTHER non-ok status is a real failure and stays fatal.
      if (!res.ok && res.status !== 409) {
        console.warn("orOS sync: Dropbox download failed:", res.status);
        throw new Error("download failed: " + res.status);
      }
      return res;
    }).catch(function (err) {
      // Wrap only GENUINE network failures (fetch rejects with
      // TypeError when the request never lands). Our own status
      // errors must pass through intact — the old blanket wrap
      // disguised auth failures as "check your connection" and
      // broke the errorKey() mapping.
      if (err instanceof TypeError) {
        console.error("orOS sync: contentDownload network error:", err);
        throw new Error("network error: " + (err.message || "unknown"));
      }
      throw err;
    });
  }

  // SY-D1: `rev` makes the write CONDITIONAL (Dropbox native modes):
  //   string → {".tag":"update","update":rev}: lands only if the file
  //            is still at that revision;
  //   null   → "add": lands only if NO file exists at the path;
  //   undefined → plain overwrite (no caller left in the engine).
  // strict_conflict closes the documented soft spots of both modes
  // (deleted file, identical content). A refused write answers 409
  // with error_summary "path/conflict/…" — callers branch on it.
  function contentUpload(path, text, rev) {
    var arg = { path: path, mode: "overwrite", autorename: false, mute: true };
    if (rev === null) {
      arg.mode = "add";
      arg.strict_conflict = true;
    } else if (typeof rev === "string" && rev) {
      arg.mode = { ".tag": "update", "update": rev };
      arg.strict_conflict = true;
    }
    return ensureFreshToken().then(function (token) {
      return fetch(CONTENT_API + "files/upload", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify(arg)
        },
        body: text
      });
    });
  }

  // SY-D1: was this 409 a refused conditional write?
  function uploadConflict(res) {
    return res.json().catch(function () { return null; }).then(function (body) {
      var sum = (body && typeof body.error_summary === "string") ? body.error_summary : "";
      return { conflict: /conflict/.test(sum), summary: sum };
    });
  }

  // SY-D1: download the blob TOGETHER with its revision.
  // Resolves { text: string|null, rev: string|null|undefined }
  // (text null + rev null = empty cloud).
  // Fast path: the rev rides the download's own response header.
  // Fallback (header not readable): ask for the metadata FIRST, then
  // download. If another device pushes between the two calls we hold
  // NEWER content under an OLDER rev — the next conditional upload is
  // then refused and we simply pull again. The opposite order could
  // pair OLDER content with a NEWER rev, i.e. a silent overwrite.
  function revFromDownload(res) {
    try {
      var h = res.headers.get("dropbox-api-result");
      if (h) {
        var meta = JSON.parse(h);
        if (meta && typeof meta.rev === "string" && meta.rev) return meta.rev;
      }
    } catch (e) {}
    return undefined;
  }

  function fetchCloudBlobSlow() {
    return rpc("files/get_metadata", { path: BLOB_PATH })
      .then(function (res) {
        if (res.status === 409) return null;                 // no file (yet)
        if (!res.ok) throw new Error("metadata failed: " + res.status);
        return res.json().then(function (meta) {
          return (meta && typeof meta.rev === "string" && meta.rev) ? meta.rev : undefined;
        });
      })
      .then(function (revBefore) {
        return contentDownload(BLOB_PATH).then(function (res) {
          if (res.status === 409) return { text: null, rev: null };
          if (!res.ok) throw new Error("download failed: " + res.status);
          return res.text().then(function (text) {
            // A file that appeared AFTER the metadata call has no rev
            // we can vouch for → undefined (push will look again).
            return { text: text, rev: (revBefore === null) ? undefined : revBefore };
          });
        });
      });
  }

  function fetchCloudBlob() {
    if (revHeaderWorks === false) return fetchCloudBlobSlow();
    return contentDownload(BLOB_PATH).then(function (res) {
      if (res.status === 409) return { text: null, rev: null };
      if (!res.ok) throw new Error("download failed: " + res.status);
      var rev = revFromDownload(res);
      if (rev === undefined) {
        revHeaderWorks = false;
        return fetchCloudBlobSlow();
      }
      revHeaderWorks = true;
      return res.text().then(function (text) { return { text: text, rev: rev }; });
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
        try { localStorage.setItem("oros-db-account", JSON.stringify(cachedAccount)); } catch (e) {}
        return cachedAccount;
      });
  }

  // ---------- v0.10 — UNIFIED STORAGE ADAPTER (Vault Drive, Wave 2) ----------
  // Bible rule: orOS applications MUST NEVER call provider APIs
  // directly — they talk to THIS surface only. Dropbox is today's
  // implementation; any provider satisfying the same contract is a
  // drop-in replacement. Contract:
  //   storage.putObject(key, blob, knownRev?) — upload opaque bytes
  //     (knownRev: undefined = overwrite, null = create only, rev =
  //     replace only that revision; refused → "storage-conflict").
  //     The condition is enforced by the provider itself (Dropbox
  //     write modes "add" / "update" + strict_conflict) — atomic.
  //   storage.getObject(key) → Promise<ArrayBuffer|null>
  //     (null = object missing — never an error).
  //   storage.deleteObject(key) → Promise<true> (gone = success).
  //   storage.listPrefix(prefix) → Promise<string[]> (relative keys).
  //   storage.getRevision(key) → Promise<string|null>.
  // Chunked uploads LIVE INSIDE the adapter (upload sessions);
  // callers always pass ONE whole Blob. Content is expected to be
  // ALREADY ENCRYPTED — the adapter never sees plaintext.

  var ADAPTER_ROOT    = "/vault";
  var SESSION_CHUNK   = 4 * 1024 * 1024;    // 4 MiB per session append
  var SINGLE_SHOT_MAX = 150 * 1024 * 1024;  // Dropbox single-upload cap

  function adapterPath(key) {
    return ADAPTER_ROOT + "/" + String(key).replace(/^\/+/, "");
  }

  function adapterEnsureConnected() {
    if (suspended)      return Promise.reject(new Error("engine-suspended"));
    if (!isConnected()) return Promise.reject(new Error("not-connected"));
    return Promise.resolve();
  }

  // SY-D4: the adapter's conditional write is the provider's own
  // (same modes as the blob, SY-D1), not read-rev-compare-write:
  //   knownRev undefined → plain overwrite (immutable objects)
  //   knownRev null      → "add": the key must NOT exist yet
  //   knownRev string    → "update": the key must still be at that rev
  // Read-then-write left a window in which another device's write was
  // silently replaced — and vault.js treats a path missing from the
  // manifest as a remote deletion.
  function adapterCommit(path, knownRev) {
    var c = { path: path, mode: "overwrite", autorename: false, mute: true };
    if (knownRev === null) {
      c.mode = "add";
      c.strict_conflict = true;
    } else if (typeof knownRev === "string" && knownRev) {
      c.mode = { ".tag": "update", "update": knownRev };
      c.strict_conflict = true;
    }
    return c;
  }

  function adapterUploadOnce(path, body, knownRev) {
    return ensureFreshToken().then(function (token) {
      return fetch(CONTENT_API + "files/upload", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify(adapterCommit(path, knownRev))
        },
        body: body
      });
    });
  }

  function adapterSessionCall(endpoint, apiArg, chunk) {
    return ensureFreshToken().then(function (token) {
      return fetch(CONTENT_API + endpoint, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify(apiArg)
        },
        body: chunk
      });
    });
  }

  // No-size-limit upload: session start (first chunk) → append_v2
  // (4 MiB pieces) → finish (commit). The whole Blob still lives in
  // RAM (SubtleCrypto has no streaming) — documented Wave 2 limit.
  // SY-5: the Dropbox endpoints are "files/upload_session/…" (singular).
  // The plural spelling used here answers 404, so no object above
  // SINGLE_SHOT_MAX (150 MB) could ever be uploaded.
  function adapterUploadSession(path, blob, knownRev) {
    var sessionId = null;
    var offset = 0;
    var first = blob.slice(0, SESSION_CHUNK);

    return adapterSessionCall("files/upload_session/start", { close: false }, first)
      .then(function (res) {
        if (!res.ok) throw new Error("session start failed: " + res.status);
        offset += first.size;
        return res.json();
      })
      .then(function (started) {
        sessionId = started.session_id;
        function appendNext() {
          if (offset >= blob.size) return Promise.resolve();
          var chunk = blob.slice(offset, offset + SESSION_CHUNK);
          var arg = { cursor: { session_id: sessionId, offset: offset }, close: false };
          return adapterSessionCall("files/upload_session/append_v2", arg, chunk)
            .then(function (res) {
              if (!res.ok) throw new Error("session append failed: " + res.status);
              offset += chunk.size;
              return appendNext();
            });
        }
        return appendNext();
      })
      .then(function () {
        var arg = {
          cursor: { session_id: sessionId, offset: offset },
          commit: adapterCommit(path, knownRev)      // SY-D4
        };
        return adapterSessionCall("files/upload_session/finish", arg, new Blob([]));
      })
      .then(function (res) {
        if (res.status === 409 && knownRev !== undefined) {
          return uploadConflict(res).then(function (c) {
            throw new Error(c.conflict ? "storage-conflict"
                                       : "session finish failed: 409 " + c.summary);
          });
        }
        if (!res.ok) throw new Error("session finish failed: " + res.status);
        return res.json().catch(function () { return null; });
      });
  }

  function adapterRevision(key) {
    return rpc("files/get_metadata", { path: adapterPath(key) })
      .then(function (res) {
        if (res.status === 409) return null;   // not found — no revision
        if (!res.ok) throw new Error("metadata failed: " + res.status);
        return res.json();
      })
      .then(function (meta) { return meta ? (meta.rev || "") : null; });
  }

  function adapterList(prefix) {
    var base = adapterPath(prefix || "");
    var out = [];
    function page(cursor) {
      var req = cursor
        ? rpc("files/list_folder/continue", { cursor: cursor })
        : rpc("files/list_folder", { path: ADAPTER_ROOT, recursive: true, limit: 2000 });
      return req
        .then(function (res) {
          if (res.status === 409) return { entries: [], has_more: false };  // no /vault yet
          if (!res.ok) throw new Error("list failed: " + res.status);
          return res.json();
        })
        .then(function (listing) {
          (listing.entries || []).forEach(function (e) {
            if (!e.path_lower) return;
            if (e.path_lower.indexOf(base) === 0 && e.path_lower !== base + "/") {
              out.push(e.path_lower.slice(ADAPTER_ROOT.length + 1));
            }
          });
          if (listing.has_more && listing.cursor) return page(listing.cursor);
          return out;
        });
    }
    return page(null);
  }

  var storageAdapter = {
    putObject: function (key, blob, knownRev) {
      return adapterEnsureConnected().then(function () {
        if (!(blob instanceof Blob)) blob = new Blob([blob]);
        var path = adapterPath(key);
        // knownRev: undefined = unconditional (immutable content-
        // addressed objects), null = "must not exist yet", string =
        // "must still be at this revision" (SY-D4, adapterCommit).
        // A refused conditional write rejects with "storage-conflict".
        var doUpload = (blob.size > SINGLE_SHOT_MAX)
          ? function () { return adapterUploadSession(path, blob, knownRev); }
          : function () {
              // SY-2: the single-shot leg returned the raw Response and
              // nobody looked at it — a 401/429/507 resolved as success
              // (the session leg already throws). Same contract now.
              return adapterUploadOnce(path, blob, knownRev).then(function (res) {
                if (res.status === 409 && knownRev !== undefined) {
                  return uploadConflict(res).then(function (c) {
                    throw new Error(c.conflict ? "storage-conflict"
                                               : "upload failed: 409 " + c.summary);
                  });
                }
                if (!res.ok) throw new Error("upload failed: " + res.status);
                return res;
              });
            };
        return doUpload();
      });
    },

    getObject: function (key) {
      return adapterEnsureConnected().then(function () {
        return contentDownload(adapterPath(key)).then(function (res) {
          if (res.status === 409) return null;   // missing — honest null
          if (!res.ok) throw new Error("download failed: " + res.status);
          return res.arrayBuffer();              // BINARY — never .text()
        });
      });
    },

    deleteObject: function (key) {
      return adapterEnsureConnected().then(function () {
        return rpc("files/delete_v2", { path: adapterPath(key) }).then(function (res) {
          if (res.ok || res.status === 409) return true;  // gone = deleted
          throw new Error("delete failed: " + res.status);
        });
      });
    },

    listPrefix: function (prefix) {
      return adapterEnsureConnected().then(function () { return adapterList(prefix); });
    },

    getRevision: function (key) {
      return adapterEnsureConnected().then(function () { return adapterRevision(key); });
    }
  };

  // ---------- Vault crypto primitives (Wave 2) ----------
  // Same passphrase-derived key model as the main blob (deriveKey).
  // Object envelopes are RAW BINARY: salt(16) | iv(12) | ciphertext
  // — no base64 inflation on the wire. JSON envelopes (manifest)
  // reuse encryptBlob/decryptBlob.

  function sha256Hex(buf) {
    return crypto.subtle.digest("SHA-256", buf).then(function (d) {
      var bytes = new Uint8Array(d), s = "";
      for (var i = 0; i < bytes.length; i++) {
        s += ("0" + bytes[i].toString(16)).slice(-2);
      }
      return s;
    });
  }

  function encryptBytes(buf) {
    if (!passphrase) return Promise.reject(new Error("no-passphrase"));
    var salt = new Uint8Array(16); crypto.getRandomValues(salt);
    var iv   = new Uint8Array(12); crypto.getRandomValues(iv);
    return deriveKey(salt).then(function (key) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, buf);
    }).then(function (cipher) {
      var env = new Uint8Array(16 + 12 + cipher.byteLength);
      env.set(salt, 0);
      env.set(iv, 16);
      env.set(new Uint8Array(cipher), 28);
      return env.buffer;
    });
  }

  function decryptBytes(envBuf) {
    if (!passphrase) return Promise.reject(new Error("no-passphrase"));
    var env = new Uint8Array(envBuf);
    if (env.length < 28) return Promise.reject(new Error("bad vault envelope"));
    var salt = env.slice(0, 16);
    var iv   = env.slice(16, 28);
    var data = env.slice(28);
    return deriveKey(salt).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, data);
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
      var payload = JSON.parse(new TextDecoder().decode(plain));
      // Check pwEpoch against local known epoch
      var cloudEpoch = (payload.meta && payload.meta.pwEpoch) || 0;
      var localEpoch = getWVEpoch();
      if (localEpoch > 0 && cloudEpoch > localEpoch) {
        console.warn("orOS sync: pwEpoch mismatch detected — passphrase changed elsewhere?");
      }
      return payload;
    });
  }

  // ---------- VD-KEY: re-wrapping the Vault Drive key ----------
  // Vault Drive content is encrypted with a random vault key; the
  // cloud keeps that key in /vault/key.json as { ver:1, wraps:[…] },
  // each wrap = the key sealed (encryptBlob) with ONE passphrase.
  // A passphrase change must therefore re-wrap this one small file —
  // before VD-KEY the Vault was sealed with the passphrase itself and
  // a change left it unreadable on every device.
  // Two steps around the blob re-encryption, so that no failure in
  // between can lock anybody out:
  //   begin  → wraps = [new, old]   (either passphrase opens the key)
  //   finish → wraps = [new]        (after the blob has landed)
  var VAULT_KEY_FILE = "key.json";

  // encryptBlob / decryptBlob read `passphrase` synchronously when
  // they are called — so a temporary swap around the CALL is enough.
  function withPass(pw, fn) {
    var prev = passphrase;
    passphrase = pw;
    try { return fn(); } finally { passphrase = prev; }
  }

  function vaultKeyDoc() {
    return storageAdapter.getRevision(VAULT_KEY_FILE).then(function (rev) {
      if (rev === null) return null;
      return storageAdapter.getObject(VAULT_KEY_FILE).then(function (buf) {
        if (!buf) return null;
        return { rev: rev, doc: JSON.parse(new TextDecoder().decode(buf)) };
      });
    });
  }

  // Resolves a finish() function. Rejects (and the passphrase change
  // is ABORTED with nothing changed) when the key file exists but
  // cannot be read or written — a silent skip here is exactly how
  // the Vault got locked out.
  function vaultRewrapBegin(oldPw, newPw) {
    var noop = function () { return Promise.resolve(); };
    return vaultKeyDoc().then(function (cur) {
      if (!cur) return noop;                              // no Vault yet
      var wraps = (cur.doc && Array.isArray(cur.doc.wraps)) ? cur.doc.wraps : [];
      function openAt(i) {
        if (i >= wraps.length) return Promise.resolve(null);
        return withPass(oldPw, function () { return decryptBlob(wraps[i]); })
          .then(function (o) { return (o && typeof o.k === "string") ? o : openAt(i + 1); },
                function () { return openAt(i + 1); });
      }
      return openAt(0).then(function (keyObj) {
        if (!keyObj) {
          // The key file is sealed with some OTHER passphrase: this
          // device could not open the Vault anyway. Nothing to carry.
          console.warn("orOS sync: vault key not opened by the old passphrase — left as is");
          return noop;
        }
        var payload = { k: keyObj.k };
        return Promise.all([
          withPass(newPw, function () { return encryptBlob(payload); }),
          withPass(oldPw, function () { return encryptBlob(payload); })
        ]).then(function (sealed) {
          return storageAdapter.putObject(VAULT_KEY_FILE,
            JSON.stringify({ ver: 1, wraps: [sealed[0], sealed[1]] }), cur.rev)
            .then(function () {
              return function finish() {
                return storageAdapter.getRevision(VAULT_KEY_FILE).then(function (rev2) {
                  if (rev2 === null) return null;
                  return storageAdapter.putObject(VAULT_KEY_FILE,
                    JSON.stringify({ ver: 1, wraps: [sealed[0]] }), rev2);
                }).catch(function (e) {
                  // Both wraps stay: still correct, the old passphrase
                  // simply keeps opening the vault key until a later change.
                  console.warn("orOS sync: vault key finish step skipped:", e && e.message);
                });
              };
            });
        });
      });
    }).catch(function (e) {
      throw new Error((e && e.message === "storage-conflict") ? "cloud-changed"
                                                              : "vault-key-rewrap-failed");
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
  
  
  // ---------- Slices (v0.6 registry + proxies + v0.8 divergence guard) ----------

  function readJson(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  // Returns false when the write failed (SY-Q1: a full store).
  function writeJson(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); return true; }
    catch (e) { return false; }
  }

  // SY-Q1 — set when a write the NEXT UPLOAD depends on could not be
  // saved: a mailbox copy (a parked cloud version, an unknown app's
  // data to relay) or a deferral flag. Uploading then would replace
  // the cloud's copy that this device failed to keep. Reset at the
  // start of every apply (each apply parks everything again);
  // checked by pushAttempt right before the upload.
  var storeFailed = false;
  // SP3 — STRICT variant, used ONLY by proxy set(): quota failures
  // must THROW. applyPayload runs set() inside try/catch and skips
  // baseline recording + the applied counter on failure, so a failed
  // write is honestly reported as "not applied". The silent variant
  // above did the opposite: recorded the remote hash as synced while
  // local storage kept older content → the NEXT pull misread local
  // as diverged (unpushed) and pushed the STALE local over the
  // cloud. Quota must never launder into remote data loss.
  function writeJsonStrict(key, obj) {
    localStorage.setItem(key, JSON.stringify(obj));
  }

  function readCarry() { return readJson(CARRY_KEY); }
  function writeCarry(obj) {
    if (obj && Object.keys(obj).length > 0) {
      if (!writeJson(CARRY_KEY, obj)) storeFailed = true;   // SY-Q1
    }
    else localStorage.removeItem(CARRY_KEY);
  }

  // SY-D3 — tiny persisted name sets.
  function flagHas(key, name) {
    var o = readJson(key);
    return !!(o && o[name]);
  }
  function flagSet(key, name, on) {
    var o = readJson(key) || {};
    if (!!o[name] === !!on) return;
    if (on) o[name] = 1; else delete o[name];
    if (Object.keys(o).length > 0) {
      if (!writeJson(key, o)) storeFailed = true;           // SY-Q1
    }
    else { try { localStorage.removeItem(key); } catch (e) {} }
  }
  function isDeferred(name) { return flagHas(DEFER_KEY, name); }
  var mergeBroken = {};         // SY-D6: name -> true while that slice's merge function throws
  function deferredNames() { return Object.keys(readJson(DEFER_KEY) || {}); }

  function persistSliceEntry(name, storageKey) {
    var reg = readJson(SLICES_KEY) || {};
    reg[name] = storageKey;
    writeJson(SLICES_KEY, reg);
  }

  // ---------- v0.8: per-slice baselines ----------
  // Baseline = content hash of a slice AS LAST SUCCESSFULLY SYNCED
  // (recorded on clean apply AND on push). A mergeless slice whose
  // local hash differs from its baseline carries UNSYNCED local
  // work → the divergence guard refuses to let a remote blob
  // overwrite it.
  // Bootstrap: a MISSING baseline counts as clean. Pre-v0.8 devices
  // were pure LWW — their state at upgrade time is by definition
  // "what the cloud last gave them" — so the first guarded pull
  // behaves exactly like the old engine, then baselines start
  // accumulating from the first push/apply.
  function hashString(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;   // djb2 — fast, deterministic
    }
    return h.toString(36);
  }

  // SY-Q1: baselines that could not be saved (full store) stay valid
  // in memory for the rest of the session, and are written with the
  // next baseline write that succeeds.
  var baselinePending = {};
  function readBaselines() {
    var bl = readJson(BASELINES_KEY) || {};
    Object.keys(baselinePending).forEach(function (n) { bl[n] = baselinePending[n]; });
    return bl;
  }
  
    // v0.8.1: does a baseline EXIST for this slice? Distinct from
  // "baseline matches": a MISSING baseline means we don't KNOW what
  // the cloud last saw — bootstrap territory. Combined with an armed
  // dirty flag, that is exactly the reported offline-loss blind
  // spot: a device upgraded mid-session carries unpushed offline
  // edits with NO baseline yet. Such a local is NOT clean.
    function baselineExists(name) {
    var bl = readBaselines();
    var b = bl[name];
    return !(b === undefined || b === null);
  }

  function recordBaseline(name, str) {
    var bl = readBaselines();
    bl[name] = hashString(str);
    if (writeJson(BASELINES_KEY, bl)) baselinePending = {};
    else baselinePending[name] = bl[name];
  }

  function baselineMatches(name, localStr) {
    var bl = readBaselines();
    var b = bl[name];
    // Missing = clean ONLY for legacy callers. Since v0.8.1,
    // applySlice ORs in baselineExists() FIRST — a missing baseline
    // counts as DIVERGED there — so this branch can never weaken
    // the divergence guard.
    if (b === undefined || b === null) return true;
    return b === hashString(localStr);
  }

  // Park a remote snapshot for a KNOWN slice we refused to apply.
  // It is NOT forwarded in the payload (the payload entry for a
  // known slice comes from slice.get() — local state is what we're
  // pushing as the new truth). The parked copy survives in the
  // mailbox until the app opens LIVE and its mergeFn unions both
  // sides' work at registerSlice-flush. CollectPayload never drops
  // parked entries for known slices — divergence lifelines.
  function parkRemote(name, remoteData) {
    var carry = readCarry() || {};
    // A freshly downloaded remote is by construction the newest
    // cloud truth this device has seen — unconditional overwrite.
    carry[name] = remoteData;
    writeCarry(carry);
  }

  // Boot-time: for every persisted registration without a live slice,
  // install a lightweight proxy that reads/writes the app's localStorage
  // directly. Result: app slices travel in pushes/pulls EVEN WHEN THE
  // APP IS CLOSED (root cause of the v0.5 sync loss).
  // NOTE: proxies have NO mergeFn (app code cannot run) → guarded LWW
  // while the app is closed (v0.8): remote applies only onto CLEAN
  // locals; a diverged proxy holds its ground, parks the remote and
  // pushes itself. Merge resumes on the next live registration.
  function hydratePersistedSlices() {
    var reg = readJson(SLICES_KEY) || {};
    Object.keys(reg).forEach(function (name) {
      if (RETIRED_SLICES[name]) return;  // SY-R: purged below
      if (slices[name]) return;          // live registration always wins
      slices[name] = makeProxySlice(reg[name]);
    });
  }

  // The closed-app form of a slice: its localStorage key, read and
  // written directly, no merge function.
  function makeProxySlice(storageKey) {
    return {
      live: false,
      get: function () { return readJson(storageKey); },
      set: function (data) { writeJsonStrict(storageKey, data); },
      merge: null
    };
  }

  // SY-D5 — A LIVE REGISTRATION ENDS WITH ITS APP. An app registers
  // its slice with functions that live in its iframe. When the app
  // was closed (or another one opened in the same frame) the engine
  // kept calling those functions for the rest of the session: code of
  // a document that no longer exists, reading its last in-memory
  // state instead of what is stored, and painting into nothing. Such
  // a slice was also "live" for ever, so the closed-app conflict rule
  // (SY-D3) never applied to it.
  // The registration remembers which document the app frame showed
  // when a FOREIGN-realm getter arrived; once the frame shows another
  // document, the slice goes back to its stored form (the same proxy
  // a fresh boot would create). Shell-realm registrations (pet,
  // shell, notifications, the shell's own proxies) are never touched.
  function appFrameDoc() {
    try {
      var fr = document.getElementById("app-frame");
      return fr ? (fr.contentDocument || null) : null;
    } catch (e) { return null; }
  }
  function reapClosedApps() {
    var cur = appFrameDoc();
    Object.keys(slices).forEach(function (name) {
      var s = slices[name];
      if (!s || !s.live || !s.ownerDoc || !s.storageKey) return;
      if (s.ownerDoc === cur) return;
      slices[name] = makeProxySlice(s.storageKey);
    });
  }

  // v0.7: 5th argument = optional mergeFn(local, remote) → merged.
  // Backward compatible: existing 4-arg registrations behave as before.
  function registerSlice(name, getter, setter, storageKey, mergeFn) {
    if (RETIRED_SLICES[name]) {
      // A cached older shell.js may still try. Not an error.
      console.warn("[orOS sync] retired slice ignored: " + name);
      return;
    }
    // SY-D5: a getter from another realm = registered by the app in
    // the frame; remember that document (see reapClosedApps).
    var ownerDoc = null;
    try { if (!(getter instanceof Function)) ownerDoc = appFrameDoc(); } catch (eOwn) {}
    slices[name] = {
      get: getter,
      set: setter,
      live: true,
      merge: (typeof mergeFn === "function") ? mergeFn : null,
      ownerDoc: ownerDoc,
      storageKey: storageKey || null
    };

    if (storageKey) persistSliceEntry(name, storageKey);

    // SY-D3: remember that this app can merge when it is open — the
    // closed-app proxy has no mergeFn of its own and needs to know.
    // And the app is live now: whatever conflict was deferred for it
    // is resolved by the mailbox flush right below (merge of the
    // parked cloud copy with local) and by every pull from here on.
    flagSet(MERGE_REG_KEY, name, !!storageKey && !!slices[name].merge);
    flagSet(DEFER_KEY, name, false);
    if (mergeBroken[name]) delete mergeBroken[name];   // SY-D6: a fresh registration gets a fresh chance

    // Mailbox flush: if remote data for this slice was carried here —
    // parked by the divergence guard while the app was closed, or
    // carried while the slice was unknown on this device — deliver it
    // now, through the (live, possibly merge-capable) slice:
    //   · mergeFn exists → merge(carried, local): BOTH sides' work
    //     survives. Marked dirty if the result differs from local —
    //     the converged state reaches the cloud on the next push.
    //   · no mergeFn → apply ONLY when local is empty (fresh-install
    //     restore case). Otherwise the parked snapshot is by
    //     construction older than this device's last successful push
    //     (the guard only parks for KNOWN slices when local diverged
    //     — and a diverged local always gets pushed) → dropped.
    // Either way the mailbox entry is CONSUMED (parked data never
    // replays twice).
    var carry = readCarry();
    if (carry && carry[name] !== undefined) {
      var data = carry[name];
      // SY6: consume-on-success. The old upfront delete meant a
      // throwing set() (quota via a strict setter, app bug) hit the
      // catch with the parked copy ALREADY GONE — the other
      // device's only surviving copy of its work, destroyed with
      // nothing applied. The entry is now removed only after the
      // flush landed (or was deliberately dropped); a failed flush
      // replays at the next registration.
      var consumeCarry = false;
      try {
        var local = null;
        try { local = slices[name].get(); } catch (e) { local = null; }

        if (slices[name].merge && local !== null && data !== null) {
          try {
            var merged = slices[name].merge(
              JSON.parse(JSON.stringify(local)), JSON.parse(JSON.stringify(data)));
            if (merged !== null && typeof merged !== "undefined") data = merged;
          } catch (e) {
            // Bad merge on replay: keep local, drop the parked copy —
            // local is authoritative and already marked dirty below
            // if it still diverges.
          }
          var localStr = JSON.stringify(local);
          var dataStr  = JSON.stringify(data);
          if (dataStr !== localStr) markDirty();
          slices[name].set(data, { merged: true });
          consumeCarry = true;                  // landed — safe to consume
          recordBaseline(name, dataStr);       // flushed through set — synced-ish, push will confirm
        } else if (slices[name].merge && (local === null || data === null)) {
          // Degenerate pair (one side empty): whichever exists wins.
          if (data !== null) {
            slices[name].set(data);
            consumeCarry = true;
            markDirty();
          }
        } else {
          // Mergeless live slice: apply only the empty-local restore.
          // (SY3: reuse the `local` snapshot read at the top of the
          // flush — the second get() was leftover from an older shape
          // and could theoretically race the first read.)
          if (local === null || local === undefined) {
            slices[name].set(data);
            markDirty();
          }
          consumeCarry = true;   // applied restore OR deliberate drop
                                // (parked copy by construction older
                                // than this device's last push)
        }
      } catch (e) {
        // Failed flush — consumeCarry stays false, the parked copy
        // survives and replays at the next registration.
      }
      if (consumeCarry) {
        delete carry[name];
        writeCarry(carry);
      }
    }

    // v0.7.1b: an app just OPENED — pull immediately so the freshly
    // registered (merge-capable) slice catches up what happened
    // elsewhere while it was closed. Without this, device B only
    // learned remote changes at the next interval tick; opening an
    // app was silently a no-sync event.
    if (isConnected() && passphrase) {
      setTimeout(function () { reconcile("register"); }, 100);
    }
  }

  // forCloud = true ONLY for the upload in pushAttempt (SY-D3): a
  // closed app whose conflict is deferred sends the CLOUD's own copy
  // (parked in the mailbox) instead of its local one — the cloud and
  // the other devices stay exactly as they are until this app opens
  // and merges. Manual export and the folder export pass nothing and
  // always carry this device's own local data.
  function collectPayload(forCloud) {
    reapClosedApps();                       // SY-D5
    var payload = { shell: null, apps: {}, meta: {} };
    var relayCarry = forCloud ? (readCarry() || {}) : null;
    Object.keys(slices).forEach(function (name) {
      var data;
      if (relayCarry && (mergeBroken[name] || (!slices[name].live && isDeferred(name))) &&
          relayCarry[name] !== undefined && relayCarry[name] !== null) {
        data = JSON.parse(JSON.stringify(relayCarry[name]));
      } else {
        try { data = slices[name].get(); } catch (e) { data = null; }
      }
      if (name === "shell") payload.shell = data;
      else payload.apps[name] = data;
    });

    // Carry-forward: remote slices UNKNOWN on this device travel
    // forward untouched — a device must never wipe app data it
    // doesn't know about. Entries for KNOWN slices are NOT relayed
    // (the payload already carries that slice's local state) and
    // NOT dropped either (v0.8): they are parked divergence
    // lifelines waiting for the app's live registration + merge.
    // Their disposal is owned by the registerSlice flush.
    var carry = readCarry();
    if (carry) {
      Object.keys(carry).forEach(function (name) {
        if (!slices[name]) {
          payload.apps[name] = carry[name];   // unknown → relay forward
        }
      });
      // (No known-slice deletion here anymore — see comment above.)
    }

    var epoch = getWVEpoch();

    // CRITICAL SAFEGUARD: a mergeless slice (closed-app proxy) whose
    // local content is empty BUT lacks a baseline indicates "never
    // pushed before". DO NOT upload an empty blob for such slices —
    // it would overwrite non-empty data from other devices. Exception:
    // if the slice is empty AND baseline exists AND cloud is empty
    // (first-run on this device only), allow the push.
    var baselines = readBaselines();
    Object.keys(slices).forEach(function (name) {
      if (name === "shell") return;
      var data = payload.apps[name];
      if (!slices[name].merge &&
          (data === null || data === undefined ||
           JSON.stringify(data) === "{}" || JSON.stringify(data) === 'null') &&
          !baselines[name]) {
        // Slice has never been pushed; empty local = nothing to send
        delete payload.apps[name];
        console.warn('[orOS sync] Guarded empty slice:', name, '- not uploading');
      }
    });

    payload.meta = {
      lastPush: new Date().toISOString(),
      device:   navigator.userAgent.slice(0, 80),
      pwEpoch:  epoch > 0 ? epoch : 0   // SY-3: survive every push, not just
                                        // the changePassphrase upload — the
                                        // epoch must travel with the data or
                                        // the decryptBlob mismatch check
                                        // goes permanently silent.
    };
    return payload;
  }

  // Apply ONE remote slice onto local state. Merge-aware, and —
  // v0.8 — divergence-aware:
  //
  //   1. Slice has a mergeFn AND both sides exist:
  //        merged = merge(local, remote)
  //      a thrown error degrades to plain remote-apply (LWW) so one
  //      bad merge never blocks syncing.
  //   2. Mergeless slice, local exists, local DIVERGES from its
  //      baseline (unpushed local work — the offline/closed-app
  //      case): remote is NEVER applied. It parks in the mailbox,
  //      the slice reports cloudStale → dirty → the next push
  //      uploads the local work as the new truth.
  //   3. Mergeless slice, local clean (or empty): classic LWW —
  //      remote replaces local. Safe: nothing local is unpushed.
  //
  // Returns { changed, cloudStale, data, baselineCandidate }:
  //   changed    — final differs from local → caller should set() it
  //   cloudStale — final differs from remote → converged result must
  //                reach the cloud via the next push
  //   baselineCandidate — string to record as the new baseline after
  //                a successful set() (null = do NOT touch baseline:
  //                the guarded skip kept local diverged on purpose)
  function applySlice(name, remoteData) {
    var slice = slices[name];

    var local = null;
    try { local = slice.get(); } catch (e) { local = null; }
    var localStr = local === null ? "null" : JSON.stringify(local);

    // --- v0.8.1 divergence guard (mergeless slices only) ---
    // Unpushed local work: hold our ground, park theirs.
    // Discriminator (v0.8.1 fix): UNPUSHED = baseline missing OR
    // hash differs from baseline. The v0.8 "missing baseline =
    // clean" bootstrap was WRONG for the live failure: a device
    // upgraded mid-session carried an unpushed offline edit with NO
    // baseline yet, the guard read it as "clean" and allowed a
    // wholesale LWW wipe. A missing baseline is NOT proof of clean
    // — treat it as diverged and let the push prove otherwise.
    // Merge-capable slices are exempt (their mergeFn handles every
    // combination correctly, including missing baselines).
    if (!slice.merge && local !== null && remoteData !== null) {
      var remoteStr = JSON.stringify(remoteData);
      var unpushed = !baselineExists(name) ||
                     !baselineMatches(name, localStr);
      if (unpushed && remoteStr !== localStr) {
        // SY-D3 — TRUE CONFLICT on a closed app that CAN merge when
        // open: local has work the cloud never saw, AND the cloud
        // copy is not the one this device last synced (or nothing was
        // ever synced here). Pushing local would replace the other
        // device's work in the cloud — and on that device, where a
        // clean proxy would then adopt it. Instead: keep local, park
        // the cloud copy, relay it untouched (collectPayload), and
        // let the app's own merge join both the next time it opens
        // here. Nothing is overwritten anywhere in the meantime.
        // (Only-local-changed — cloud still equals the baseline — is
        // not a conflict and takes the old path below: local goes up.)
        if (!slice.live && flagHas(MERGE_REG_KEY, name) &&
            (isDeferred(name) || !baselineExists(name) ||
             !baselineMatches(name, remoteStr))) {
          parkRemote(name, remoteData);
          flagSet(DEFER_KEY, name, true);
          return {
            changed: false,
            cloudStale: false,         // the cloud keeps its own copy
            data: local,
            baselineCandidate: null
          };
        }
        parkRemote(name, remoteData);
        return {
          changed: false,
          cloudStale: true,          // local must reach the cloud instead
          data: local,
          baselineCandidate: null    // local stays "diverged" until ITS push
        };
      }
      // Both sides ended up identical: nothing left to defer.
      if (remoteStr === localStr && isDeferred(name)) flagSet(DEFER_KEY, name, false);
    }

    var final = remoteData;
    if (slice.merge && local !== null && remoteData !== null) {
      try {
        // Clone BOTH inputs: merge functions stay pure, caller-owned
        // state is never mutated by a merge that misbehaves.
        final = slice.merge(JSON.parse(localStr), JSON.parse(JSON.stringify(remoteData)));
        if (final === null || typeof final === "undefined") final = remoteData;
        if (mergeBroken[name]) delete mergeBroken[name];
      } catch (e) {
        // SY-D6 — A MERGE THAT THROWS MUST NOT COST ANYBODY'S DATA.
        // The old fallback was "take the remote copy" ("degrade to
        // LWW, keep syncing"): one exception inside an app's merge
        // function silently replaced this device's data with the
        // cloud's. Now nothing is replaced on either side: local
        // stays, the cloud copy is parked and relayed untouched by
        // the next upload (same mechanics as a deferred slice), and
        // the failure is in the console. The slice simply does not
        // sync until its merge works again.
        try { console.error("[orOS sync] merge failed for \"" + name + "\" — local kept, cloud copy relayed:", e); } catch (e2) {}
        mergeBroken[name] = true;
        parkRemote(name, remoteData);
        return {
          changed: false,
          cloudStale: false,
          data: local,
          baselineCandidate: null
        };
      }
    }

    var finalStr = final === null ? "null" : JSON.stringify(final);
    return {
      changed: finalStr !== localStr,
      cloudStale: finalStr !== (remoteData === null ? "null" : JSON.stringify(remoteData)),
      data: final,
      baselineCandidate: finalStr       // applied (or already equal) → synced
    };
  }

  // SY-R: forget everything this device still holds about a retired
  // slice (registry entry, mailbox copy, baseline, deferral flag).
  function purgeRetired() {
    Object.keys(RETIRED_SLICES).forEach(function (name) {
      try {
        var reg = readJson(SLICES_KEY);
        if (reg && reg[name] !== undefined) { delete reg[name]; writeJson(SLICES_KEY, reg); }
        var carry = readCarry();
        if (carry && carry[name] !== undefined) { delete carry[name]; writeCarry(carry); }
        var base = readJson(BASELINES_KEY);
        if (base && base[name] !== undefined) { delete base[name]; writeJson(BASELINES_KEY, base); }
        flagSet(DEFER_KEY, name, false);
        flagSet(MERGE_REG_KEY, name, false);
      } catch (e) {}
    });
  }

  function applyPayload(payload) {
    if (!payload) return 0;
    reapClosedApps();                       // SY-D5
    storeFailed = false;                    // SY-Q1: this apply parks everything again
    var applied = 0;
    var cloudStaleAny = false;

    if (payload.shell && slices.shell) {
      var rs = applySlice("shell", payload.shell);
      if (rs.changed) {
        try {
          slices.shell.set(rs.data, { merged: !!slices.shell.merge });
          if (rs.baselineCandidate !== null) recordBaseline("shell", rs.baselineCandidate);
          applied++;
        } catch (e) {}
      } else if (rs.baselineCandidate !== null) {
        // Clean no-op apply: refresh/keep the baseline honest —
        // same convergence-reset contract as the apps branch below.
        recordBaseline("shell", rs.baselineCandidate);
      }
      if (rs.cloudStale) cloudStaleAny = true;
    }

    if (payload.apps) {
      Object.keys(payload.apps).forEach(function (name) {
        var data = payload.apps[name];
        if (data === null || data === undefined) return;
        if (RETIRED_SLICES[name]) return;   // SY-R: neither applied nor carried
        if (slices[name]) {
          var ra = applySlice(name, data);
          if (ra.changed) {
            try {
              slices[name].set(ra.data, { merged: !!slices[name].merge });
              if (ra.baselineCandidate !== null) recordBaseline(name, ra.baselineCandidate);
              applied++;
            } catch (e) {}
          } else if (ra.baselineCandidate !== null) {
            // Clean no-op (local == remote == synced content): keep the
            // baseline honest. This is also the convergence reset for
            // the device that just got back the very content it pushed.
            recordBaseline(name, ra.baselineCandidate);
          }
          if (ra.cloudStale) cloudStaleAny = true;
        } else {
          // Unknown slice: park it in the carry mailbox. Never dropped,
          // never overwritten — the next push relays it forward.
          // v0.9.2 FRESH read-modify-write: parkRemote() may have
          // written the mailbox EARLIER in this same loop (a diverged
          // known slice guarding itself). A snapshot taken before the
          // loop would silently clobber that park — destroying the
          // other device's only surviving copy of its work.
          var liveCarry = readCarry() || {};
          liveCarry[name] = data;
          writeCarry(liveCarry);
        }
      });
    }

    // Merge convergence OR guarded divergence produced something the
    // cloud lacks → mark dirty → the very next push uploads the
    // converged/diverged state. THIS is what stops both the classic
    // two-open-devices ping-pong AND the offline-proxy wipe: the
    // winning content is always what reaches the cloud, never
    // an artifact of apply-order.
    if (cloudStaleAny) markDirty();

    return applied;
  }
  
  
  // ---------- Backups ----------
  function backupExistingRemote() {
    return rpc("files/copy_v2", {
      from_path: BLOB_PATH,
      to_path:   BACKUP_PREFIX + new Date().toISOString().replace(/[:.]/g, "-") + ".json"
    })
      .then(function (res) { return !!(res && res.ok); })   // SY-D2: a refused
                                // copy (409 = nothing to copy) is NOT a backup
      .catch(function () { return false; });   // nothing pushed yet — fine
  }

  // SY-D2 — spaced cloud backups. A copy before EVERY push with only
  // the newest few kept meant the whole safety net covered the last
  // minute of typing (a push follows every 5s burst). Now: one copy
  // per device per day, newest MAX_BACKUPS kept — a week of history
  // from one device. The copy is the blob as it was BEFORE today's
  // first push, i.e. yesterday's last state. Best-effort, as before:
  // a failed copy never blocks the push and is retried at the next.
  function maybeBackup() {
    if (cloudRev === null) return Promise.resolve(false);   // empty cloud — nothing to copy
    var last = parseInt(localStorage.getItem(BACKUP_STAMP_KEY) || "0", 10) || 0;
    var now = Date.now();
    if (last > now) last = 0;                               // clock moved back
    if (now - last < BACKUP_EVERY_MS) return Promise.resolve(false);
    return backupExistingRemote().then(function (made) {
      if (!made) return false;
      try { localStorage.setItem(BACKUP_STAMP_KEY, String(now)); } catch (e) {}
      return pruneBackups().then(function () { return true; });
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
          .sort(function (a, b) { return a.name < b.name ? 1 : -1; });

        var doomed = backups.slice(MAX_BACKUPS);
        return Promise.all(doomed.map(function (f) {
          return rpc("files/delete_v2", { path: f.path_lower }).catch(function () {});
        }));
      })
      .catch(function () { /* best-effort */ });
  }

  // ---------- Dirty flag ----------
  // SY-Q1: the dirty state also lives in memory. On a full store the
  // persisted flag cannot be written, and markDirty() used to THROW
  // into whoever called it — every app save, the shell's settings,
  // the alarm engine (a due alarm then never rang).
  var dirtyMem = false;
  function markDirty() {
    dirtyGen++;                                // sync #1
    dirtyMem = true;
    try { localStorage.setItem(DIRTY_KEY, "1"); } catch (e) {}
    resetDebounce();
  }

  // v0.7.1 — sync-on-change, debounced.
  // Five seconds of quiet after the LAST edit → full reconcile
  // (pull → merge → push). Burst edits coalesce into ONE round-trip.
  //
  // Safety properties (all inherited, nothing new to prove):
  //   · Fires only if STILL dirty — a successful push in between
  //     (hide/interval/debounce) cleared the flag and we no-op.
  //   · reconcile()'s in-flight guards absorb overlap with a running
  //     interval/visible reconcile — worst case it's a no-op.
  //   · Merge convergence marks dirty inside applyPayload → the
  //     converged state reaches the cloud ~5s later without waiting
  //     for the interval. Determinism prevents loops: once cloud ==
  //     local == merged, cloudStale goes false and the flag stays clean.
  //   · Zero cost offline / locked: timer arms only when a push could
  //     actually succeed (connected + passphrase).
  function resetDebounce() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!isConnected() || !passphrase) return;   // nothing to send anyway
    debounceTimer = setTimeout(debounceFire, DEBOUNCE_MS);
  }
  function debounceFire() {
    debounceTimer = null;
    if (!isDirty()) return;                      // already pushed elsewhere
    if (reconcileInFlight || pushInFlight || pullInFlight) {
      // SP5: the timer is consumed but the engine is busy with
      // another flight — this raced edit's ONLY scheduled uploader
      // just vanished, stranding it for the interval (default
      // 3 min) or the next user event. Re-arm short: retry as soon
      // as the engine frees up. Still isDirty()-guarded — a
      // converged state no-ops and never loops.
      debounceTimer = setTimeout(debounceFire, 1000);
      return;
    }
    reconcile("debounce");
  }
  function clearDirty() {
    dirtyMem = false;
    try { localStorage.removeItem(DIRTY_KEY); } catch (e) {}
  }
  function isDirty() {
    if (dirtyMem) return true;
    try { return localStorage.getItem(DIRTY_KEY) === "1"; } catch (e) { return false; }
  }

  // ---------- Pull / Push ----------
  
    // v0.9 Part 4 — PUSH GUARD (Trap 3: stale-passphrase overwrite).
  // Never overwrite a cloud blob this device's passphrase cannot
  // decrypt. A device whose passphrase changed ELSEWHERE (this
  // whole saga's origin) that force-pushes or pushes on tab-hide
  // would re-encrypt the cloud with the OLD passphrase and lock out
  // every correctly-updated device. Verification = download + try
  // decrypt; skipped while a recent pull already proved it
  // (reconcile's pull→push pair costs nothing extra). Empty cloud =
  // nothing to protect. Network failures REJECT this chain and the
  // push is refused (offline it could not land anyway) — every other
  // failure surfaces at upload time.
  var PULL_TRUST_MS = 30000;

    function ensureCloudReadable() {
    if (Date.now() - lastSuccessfulPullAt < PULL_TRUST_MS) {
      return Promise.resolve();
    }
    return contentDownload(BLOB_PATH)
      .then(function (res) {
        // 409 = empty cloud (nothing to protect). ANY OTHER non-ok
        // is an INCONCLUSIVE check — a server error must NOT be
        // laundered into "empty cloud = free to overwrite": that
        // re-opens the exact Trap-3 hole this guard exists to close
        // (stale local passphrase + indeterminate cloud → overwrite).
        // Reject → the push refuses to run; the next attempt rechecks.
        // SY1: 409 IS conclusive — arm the trust window so pushes on
        // a persistently empty cloud don't re-download every time
        // (pull() already does this in its own empty branch).
        if (res.status === 409) {
          lastSuccessfulPullAt = Date.now();
          return null;
        }
        if (!res.ok) throw new Error("download failed: " + res.status);
        return res.text();
      })
      .then(function (blobText) {
        if (!blobText) return;
        return decryptBlob(blobText).then(function () {
          lastSuccessfulPullAt = Date.now();   // proven — window re-arms
        });
        // OperationError rejects the chain → push refuses to run.
      });
  }


  // SY-D1: the download-decrypt-apply core, shared by pull() and by
  // push()'s "learn the cloud first" / conflict-retry legs (which
  // already hold the push lock and must not go through pull()'s
  // entry gates). cloudRev moves ONLY after the blob was decrypted
  // and applied — a rev we could not read or apply is never ours.
  function syncDown() {
    return fetchCloudBlob().then(function (cloud) {
      if (!cloud.text) {
        lastSuccessfulPullAt = Date.now();   // empty cloud — any passphrase OK
        cloudRev = null;
        return { ok: true, empty: true, applied: 0 };
      }
      return decryptBlob(cloud.text).then(function (payload) {
        var applied = applyPayload(payload);
        lastSuccessfulPullAt = Date.now(); // passphrase PROVEN against cloud
        cloudRev = cloud.rev;              // may be undefined (fallback race) → push re-learns
        return { ok: true, empty: false, applied: applied };
      });
    });
  }

  function pull() {
    if (suspended)      return Promise.reject(new Error("engine-suspended"));
    if (!isConnected()) return Promise.reject(new Error("not-connected"));
    if (!passphrase)    return Promise.reject(new Error("no-passphrase"));
    // SP2: the manual UI paths (Pull button, shortcut, sync dot,
    // unlock flow) call pull() DIRECTLY — unlike reconcile, nothing
    // upstream guarantees an idle engine. A pull racing a push
    // downloads the PRE-push cloud and then LWW-applies it over the
    // just-uploaded state (local clean, baseline = new) → silent
    // local/cloud split with a clean dirty flag. Refuse instead —
    // the honest error beats the silent clobber. Two concurrent
    // pulls are equally refused (double-apply of merges).
    if (pushInFlight)   return Promise.reject(new Error("push already in flight"));
    if (pullInFlight)   return Promise.reject(new Error("pull already in flight"));

    pullInFlight = true;
    return syncDown()
      .catch(function (err) {
        console.error("orOS sync: pull() failed:", err);
        throw err;
      })
      .finally(function () {
        pullInFlight = false;
      });
  }

  function push() {
    if (suspended)      return Promise.reject(new Error("engine-suspended"));
    if (!isConnected()) return Promise.reject(new Error("not-connected"));
    if (!passphrase)    return Promise.reject(new Error("no-passphrase"));
    if (pushInFlight)   return Promise.reject(new Error("push already in flight"));
    // SY5: the SP2 mirror. A push racing an in-flight pull uploads
    // the FRESH local state, while the pull then applies the
    // PRE-upload cloud over it — local silently reverts to the older
    // remote, and because final == remote the dirty flag stays
    // clean (cloudStale false): only the next interval pull
    // self-heals it. Unsequenced callers are the manual shortcut,
    // tab-hide autoSyncAttempt and any direct UI push. Refuse — the
    // honest busy beats the transient revert. Safe for reconcile():
    // its pull().then(push) chain runs AFTER pull's .finally
    // released the flag, so the sequenced path never trips this.
    if (pullInFlight)   return Promise.reject(new Error("pull already in flight"));

    pushInFlight = true;
    return pushAttempt(0)
      .finally(function () {
        pushInFlight = false;
      });
  }

  // SY-D1: one conditional upload round. Called again (bounded) after
  // a refused write, each time with a FRESH payload collected after
  // the cloud's newer state was pulled and merged.
  function pushAttempt(attempt) {
    // Unknown cloud (no pull yet this session, or a conflict just told
    // us it moved): learn it first — download, decrypt, apply.
    var learn = (cloudRev === undefined) ? syncDown() : Promise.resolve();
    var payload = null;
    var encryptedText = null;
    var dirtyGenAtCollect = 0;
    var revAtCollect;

    return learn
      .then(function () {
        // Still unknown = the provider gave us no revision at all.
        // Refuse: an unconditional overwrite is exactly what this
        // engine no longer does.
        if (cloudRev === undefined) throw new Error("cloud-rev-unknown");
        // SY-Q1: a cloud copy this device had to keep (mailbox,
        // deferral flag) could not be saved — uploading now would
        // replace it. Forget the rev so the next attempt downloads,
        // applies and parks again.
        if (storeFailed) {
          cloudRev = undefined;
          throw new Error("storage-full");
        }
        payload = collectPayload(true);   // SY-D3: deferred closed apps relay the cloud copy
        dirtyGenAtCollect = dirtyGen;   // sync #1: generation of the
                                        // dirty state this payload
                                        // represents. Edits landing
                                        // after this point are NOT in
                                        // this upload — their flag
                                        // must survive the push.
        revAtCollect = cloudRev;        // the state this payload was merged against
        return ensureCloudReadable();
      })
      .then(function () { return encryptBlob(payload); })
      .then(function (text) {
        encryptedText = text;
        return maybeBackup();           // SY-D2
      })
      .then(function () {
        return contentUpload(BLOB_PATH, encryptedText, revAtCollect);
      })
      .then(function (res) {
        if (res.status === 409) {
          return uploadConflict(res).then(function (c) {
            if (c.conflict) {
              cloudRev = undefined;     // the cloud moved — look again
              throw new Error("cloud-changed");
            }
            throw new Error("upload failed: 409 " + c.summary);
          });
        }
        if (!res.ok) throw new Error("upload failed: " + res.status);
        return res.json().catch(function () { return null; });
      })
      .then(function (meta) {
        // The blob in the cloud is now exactly our payload.
        cloudRev = (meta && typeof meta.rev === "string" && meta.rev) ? meta.rev : undefined;
        // v0.8: the push that just succeeded IS the moment "what the
        // cloud holds" and "what the local slices hold" became one.
        // Record the baselines for every slice we just uploaded —
        // this is what makes the NEXT pull able to tell "local has
        // unpushed work" (hash ≠ baseline) from "local is exactly
        // what we shipped" (hash == baseline → clean LWW apply OK).
        // #S2-fix: baseline describes the PAYLOAD WE UPLOADED, not a
        // re-read of live state. Between collectPayload() and this
        // success moment, a user edit can change a slice — stamping
        // THAT as "synced" (while the cloud holds the older payload)
        // defeats the next pull's divergence guard and lets a remote
        // LWW wipe the newer local edit. The payload snapshot taken
        // at collect time is exactly what the cloud now holds.
        Object.keys(slices).forEach(function (name) {
          // SY-D3: a deferred slice uploaded the CLOUD's copy, not its
          // local one — that is no proof of "local is synced".
          if (mergeBroken[name] || (!slices[name].live && isDeferred(name))) return;
          var data = (name === "shell") ? payload.shell : payload.apps[name];
          recordBaseline(name, (data === null || data === undefined) ? "null" : JSON.stringify(data));
        });
        // sync #1: clear the flag ONLY when no markDirty() landed
        // between collectPayload() and this success moment. An edit
        // that raced the upload is by construction NOT in this
        // payload — wiping its flag would strand it until the next
        // unrelated edit. Keeping the flag makes the 5s debounce /
        // interval push the raced edit normally.
        if (dirtyGen === dirtyGenAtCollect) clearDirty();
        return { ok: true };
      })
      .catch(function (err) {
        if (err && err.message === "cloud-changed" && attempt < MAX_PUSH_RETRIES) {
          return pushAttempt(attempt + 1);   // pull + merge + fresh payload
        }
        throw err;   // dirty flag untouched — nothing was uploaded
      });
  }

  // ---------- Auto engine ----------

  // Full reconcile: pull → merge/guard → push-if-needed. Used by
  // boot, the periodic interval, tab-visible, "online" and app
  // register. The pull itself may set the dirty flag (merge
  // convergence OR guarded divergence) — intentional, that's how
  // merged/local-won results propagate. Guarded: never two
  // reconciles or a reconcile racing a manual push.
  function reconcile(reason) {
    if (suspended) return;                      // factory reset owns the engine
    if (!isConnected() || !passphrase) return;
    if (!navigator.onLine) return;
    // SY-R1: a manual pull in flight is ALSO a busy engine — entering
    // here made pull() reject ("pull already in flight") and surfaced
    // a FALSE "fail" auto event on the sync dot. Skip silently instead.
    if (reconcileInFlight || pushInFlight || pullInFlight) return;

    reconcileInFlight = true;
    emitAutoEvent("start", reason);

    pull()
      .then(function () {
        if (isDirty()) {
          return push();          // user changes OR merge convergence OR held-ground divergence
        }
        return { ok: true };
      })
      .then(function () {
        reconcileInFlight = false;
        emitAutoEvent("done", reason);
      })
      .catch(function (err) {
        reconcileInFlight = false;
        emitAutoEvent("fail", reason);
      });
  }

  // Push-only attempt (tab hide): pulling costs round-trips we may
  // not have before the tab dies — a dirty push is the only thing
  // that guarantees zero local loss at close time.
  function autoSyncAttempt(reason) {
    if (suspended) return;                      // factory reset owns the engine
    if (!isConnected() || !passphrase || !isDirty()) return;
    if (pushInFlight || reconcileInFlight) return;
    if (pullInFlight) return;   // SY5: hide-push racing a manual/interval pull
                                // → silent skip (SY-R1 doctrine), no red dot.
                                // Data is safe in localStorage; the next
                                // visible reconcile uploads it.
    if (!navigator.onLine) return;              // no wasted attempts offline

    emitAutoEvent("start", reason);
    push()
      .then(function () { emitAutoEvent("done", reason); })
      .catch(function (err)  { emitAutoEvent("fail", reason); });
  }

  function emitAutoEvent(kind, detail) {
    autoListeners.forEach(function (fn) {
      try { fn(kind, detail); } catch (e) {}
    });
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
    autoTimerId = setInterval(function () { reconcile("interval"); },
                              mins * 60 * 1000);
  }

  function startAutoEngine() {
    scheduleAutoInterval();

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        // Last reliable moment before tab death — push-only, silently
        autoSyncAttempt("hide");
      } else {
        // Coming BACK to this device: catch up what changed elsewhere
        // while we were away. (Multi-device liveness — v0.7.)
        reconcile("visible");
      }
    });

    // v0.8: connectivity returned — reconcile IMMEDIATELY. Before
    // this, an offline→online transition could only be caught by the
    // interval (up to 3 idle minutes) or a tab toggle — meanwhile
    // edits made offline sat unsafe (boot/visible apply paths ran
    // with them still unpushed). Now the moment the browser fires
    // "online", pull→guard→push runs: offline edits are either
    // uploaded as the new truth (clean guard path) or parked with
    // the local held diverged (guard path) — never wiped. In-flight
    // guards make this safe against any overlap with other triggers.
    window.addEventListener("online", function () {
      reconcile("online");
    });
  }
  
    // ---------- Factory reset (cloud wipe + revoke) ----------
  // suspendEngine(): freezes timers + entry gates. Idempotent.
  function suspendEngine() {
    suspended = true;
    if (autoTimerId) { clearInterval(autoTimerId); autoTimerId = null; }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  }

  // wipeEverything(): CLOUD-FIRST nuclear reset. Order is critical:
  //   1. suspend (nothing new can fire)
  //   2. wait out any in-flight push/reconcile (bounded 3s)
  //   3. DELETE every orOS file in the app folder (blob + backups)
  //   4. REVOKE this device's authorization at Dropbox (server-side)
  //   5. disconnect() locally (tokens, account cache, passphrase)
  // Works WITHOUT a passphrase — deletion and revoke never decrypt.
  // Resolves { wiped: n, revoked: bool } even when not connected
  // ({ wiped: 0 }) — the caller proceeds with the local wipe either way.
  function wipeEverything() {
    suspendEngine();

    // Bounded wait: an in-flight push MUST land before we delete,
    // or it would recreate the file after us. If it somehow exceeds
    // 3s, we proceed anyway — the revoke below kills its token after.
    function waitFlight(msLeft) {
      // SY9: a MANUAL pull in flight is engine business too — its
      // applyPayload microtasks could land BETWEEN the localStorage
      // sweep and the reload, writing oros-* keys back AFTER the
      // wipe (factoryResetPending cleans IndexedDB only — those
      // leftovers would survive the reset). Bounded by the same 3s
      // cap; a stuck pull costs at most 3s of patience.
      if (!pushInFlight && !reconcileInFlight && !pullInFlight) return Promise.resolve();
      if (msLeft <= 0) return Promise.resolve();
      return new Promise(function (r) {
        setTimeout(function () { r(waitFlight(msLeft - 150)); }, 150);
      });
    }

    return waitFlight(3000).then(function () {
      if (!isConnected()) return { wiped: 0, revoked: false };

      function delAll(paths) {
        return paths.reduce(function (chain, p) {
          return chain.then(function () {
            return rpc("files/delete_v2", { path: p }).catch(function () {});
          });
        }, Promise.resolve());
      }

      return rpc("files/list_folder", { path: "", recursive: false })
        .then(function (res) { return res.ok ? res.json() : { entries: [] }; })
        .catch(function () { return { entries: [] }; })
        .then(function (listing) {
          // SY-1: ADAPTER_ROOT ("/vault") is a FOLDER, so the name
          // filter below never matched it: every Vault Drive object
          // and its manifest survived a "brand new OS" reset. One
          // delete_v2 on the folder removes it recursively (409 when
          // it never existed — harmless).
          var paths = [BLOB_PATH, ADAPTER_ROOT];   // direct delete even if listing failed
          (listing.entries || []).forEach(function (e) {
            if (e.path_lower && e.name && e.name.indexOf("orOS-") === 0 &&
                paths.indexOf(e.path_lower) === -1) paths.push(e.path_lower);
          });
          var revoked = false;
          return delAll(paths)
            .then(function () {
              return rpc("auth/token/revoke", {})
                .then(function (res) { revoked = !!res.ok; })
                .catch(function () { revoked = false; });
            })
            .then(function () {
              disconnect();
              return { wiped: paths.length, revoked: revoked };
            });
        });
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
    cloudRev     = undefined;   // SY-D1: another account = another cloud
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
  
  function getWVEpoch() {
    var v = parseInt(localStorage.getItem("oros-sync-pw-epoch") || "0", 10);
    return isNaN(v) ? 0 : v;
  }

  // ---------- Boot sequence ----------
  restoreTokens();

  // Hydrate persisted slice proxies BEFORE any pull/push can fire —
  // this is what makes app slices travel while apps are closed. And
  // since v0.8 their applies run through the divergence guard: a
  // proxy whose local content diverged (unpushed offline work) never
  // loses it to a remote blob.
  purgeRetired();
  hydratePersistedSlices();

  var redirectHandled = handleOAuthRedirect();

  // Vault unlock chain: after redirect handling settles, unseal + auto-engine
  var vaultUnlocked = redirectHandled.then(function () {
    return unlockFromVault().then(function (ok) {
      // Start auto engine only when we can actually sync
      startAutoEngine();
      if (isConnected() && passphrase) reconcile("boot");
      return ok;
    });
  });

  // ---------- Public API ----------
  window.orosSync = {
    // Lifecycle
    connect:            connect,
    disconnect:         disconnect,
    isConnected:         isConnected,
    getUserInfo:        getUserInfo,
    redirectHandled:    redirectHandled,
    vaultUnlocked:      vaultUnlocked,    // promise<bool>: true if auto-unlocked

    // Data
    pull:               pull,
    push:               push,
    reconcile:          reconcile,        // pull→guard→push (UI may call)
    wipeEverything:     wipeEverything,   // factory reset: cloud wipe + revoke
    suspendEngine:      suspendEngine,

    // Local rescue backup (plaintext, unencrypted)
    exportData: function () {
      var payload = collectPayload();
      payload.meta = {
        ver: BLOB_VERSION,
        exportedAt: new Date().toISOString()
      };
      return JSON.stringify(payload, null, 2);
    },

    // Imports pass through the SAME guarded/merge-aware paths as a
    // cloud pull (applyPayload → applySlice): a merge-capable app
    // converges with the backup's content; a mergeless app applies
    // it only when local is clean/empty — a stale rescue file can no
    // longer clobber newer local work.
    importData: function (jsonText) {
      var payload = JSON.parse(jsonText);   // throws on invalid JSON
      if (!payload || typeof payload !== "object" ||
          (!payload.shell && !payload.apps)) {
        throw new Error("bad backup file");
      }
      var applied = applyPayload(payload);
      markDirty();   // imported result must reach the cloud
      return applied;
    },

    // Passphrase / vault
    setPassphrase:      setPassphrase,    // (pw, remember?) — remember = seal to device
    hasPassphrase:     function () { return passphrase !== null; },
    forgetPassphrase:  function () { passphrase = null; },   // session only
    clearDevice:       clearDevice,      // forget + wipe device vault
    hasDeviceVault:    hasDeviceVault,

    // App integration
    registerSlice:     registerSlice,    // (name, get, set, storageKey?, merge?)
    markDirty:         markDirty,        // apps call this on data change
    getIntervalMinutes: getIntervalMinutes,
    // SY-D3: names of closed apps whose local changes wait for a
    // merge (the shell turns each into one notice that opens the app).
    getDeferred:        deferredNames,
    setIntervalMinutes: setIntervalMinutes,
    isDirty:           isDirty,

    // Auto-sync feedback (optional, for UI status pulse)
    onAutoSync:         function (fn) { if (typeof fn === "function") autoListeners.push(fn); },

    // Engine kick (manual triggers from shell, e.g. after manual unlock)
    kickAutoEngine:     function () {
      if (isConnected() && passphrase) {
        reconcile("kick");
      }
    },

    // Wave 2 — Vault Drive: unified storage adapter (provider-
    // agnostic surface, Dropbox implementation) + vault crypto.
    storage: storageAdapter,
    vaultCrypto: {
      sha256Hex:    sha256Hex,     // ArrayBuffer → hex digest (content addressing)
      encryptBytes: encryptBytes,  // ArrayBuffer → sealed ArrayBuffer envelope
      decryptBytes: decryptBytes, // sealed envelope → plaintext ArrayBuffer
      encryptJson:  encryptBlob,   // object → sealed JSON string (manifest)
      decryptJson:  decryptBlob    // sealed JSON string → object
    },

          // Error mapping
  errorKey: function (err) {
      var msg = (err && err.message) || "";
      var name = (err && err.name) || "";
      if (msg === "not-connected")  return "sync.err.notconnected";
      if (msg === "no-passphrase")  return "sync.err.nopass";
      if (msg === "wrong-passphrase") return "sync.err.passphrase";
      // TR-R3 / SY-R3: healthy refusals (SP2 engine locks, factory
      // reset suspension) are NOT failures — an honest "busy" message
      // replaces the misleading generic "sync failed".
      if (/already in flight/.test(msg)) return "sync.err.busy";
      // SY-D1: other devices kept pushing through every retry round —
      // nothing was uploaded, nothing is lost, the next attempt wins.
      if (msg === "cloud-changed")      return "sync.err.busy";
      if (msg === "vault-key-rewrap-failed") return "sync.err.generic";
      if (msg === "engine-suspended")   return "sync.err.suspended";
      if (msg === "storage-full")       return "sync.err.storage";   // SY-Q1
      if (/blob version/.test(msg)) return "sync.err.version";
      if (/token|401|400/.test(msg)) return "sync.err.auth";
      if (name === "OperationError" || /OperationError/.test(msg)) return "sync.err.passphrase";
      return "sync.err.generic";
    },

    // v0.9 — CHANGE PASSPHRASE
    changePassphrase: function (oldPw, newPw, remember) {
      if (!oldPw || !newPw) {
        return Promise.reject(new Error("both passwords required"));
      }
      if (!isConnected()) {
        return Promise.reject(new Error("not-connected"));
      }
      if (suspended) {
        return Promise.reject(new Error("engine-suspended"));
      }
      if (pushInFlight || reconcileInFlight) {
        return Promise.reject(new Error("push already in flight"));
      }
      // SY8: mirror of the SP2/SY5 race family — a MANUAL pull in
      // flight keeps decrypting with whatever `passphrase` holds at
      // each await point, and changePassphrase flips that variable
      // mid-flight (passphrase = oldPw … = newPw). The racing pull
      // can then fail decryption with a PROVEN-good passphrase →
      // spurious OperationError → the misleading "passphrase changed
      // on another device" dialog right as the change succeeds.
      // Reject with the honest busy — errorKey maps it to
      // sync.err.busy; the retry is one click away.
      if (pullInFlight) {
        return Promise.reject(new Error("pull already in flight"));
      }
      pushInFlight = true;   // cp holds the engine lock for its whole
                             // flight — no concurrent push may encrypt
                             // with the mid-transition passphrase.

      // SY-D1: the blob is fetched WITH its revision and re-uploaded
      // conditionally — a push from another device between this
      // download and the re-encrypted upload is refused instead of
      // being silently replaced by the older content.
      var cpRev;
      return fetchCloudBlob()
        .then(function (cloud) {
          // Empty cloud → text null: fall through to the empty-cloud
          // branch BELOW. setPassphrase + markDirty happen there,
          // exactly once (a duplicate setPassphrase would run TWO
          // concurrent sealPassphrase() chains — on a first-ever vault
          // the race can leave a vault that can never unseal).
          cpRev = cloud.rev;
          return cloud.text;
        })
        .then(function (blobText) {
          if (!blobText) {
            cloudRev = null;            // SY-D1: known-empty cloud
            // VD-KEY: a vault key may exist even without a blob.
            return vaultRewrapBegin(oldPw, newPw).then(function (finishVault) {
              return finishVault();
            }).then(function () {
            setPassphrase(newPw, remember);
            // SY2: symmetrical with the non-empty path — the local
            // passphrase changed, so the local epoch advances. If a
            // second device ever pushes a cloud blob carrying the
            // OLD epoch, decryptBlob's mismatch check stays honest.
            localStorage.setItem("oros-sync-pw-epoch", String(getWVEpoch() + 1));
            markDirty();
            return { ok: true, changed: true };
            });
          }
          var salt = b64decode(JSON.parse(blobText).salt);
          var iv   = b64decode(JSON.parse(blobText).iv);
          var data = b64decode(JSON.parse(blobText).data);

          // Verify with the TYPED old passphrase — NEVER the
          // in-memory one. A vault-unlocked device must still prove
          // knowledge of the old passphrase before it may re-lock
          // the cloud with a new one.
          var prevPass = passphrase;
          passphrase = oldPw;
          return deriveKey(salt).then(function (key) {
            return crypto.subtle.decrypt(
              { name: "AES-GCM", iv: iv },
              key,
              data
            ).then(function (plain) {
              // Success — old passphrase correct
              var payload = JSON.parse(new TextDecoder().decode(plain));
              
              // Increment pwEpoch
              if (!payload.meta) payload.meta = {};
              payload.meta.pwEpoch = (payload.meta.pwEpoch || 0) + 1;

              // Now re-encrypt with new passphrase. Backup the
              // OLD-encrypted blob first: it is the only recovery
              // path if the new passphrase is ever forgotten while
              // the old one is remembered (zero-knowledge = no
              // backdoor). Mirrors push()'s overwrite-with-net rule.
              // VD-KEY: first make the vault key openable by BOTH
              // passphrases (or abort with nothing changed)…
              return vaultRewrapBegin(oldPw, newPw).then(function (finishVault) {
              passphrase = newPw;
              return encryptBlob(payload).then(function (encrypted) {
                if (cpRev === undefined) throw new Error("cloud-rev-unknown");
                return backupExistingRemote().then(function () {
                  return contentUpload(BLOB_PATH, encrypted, cpRev);
                })
                  .then(function (uploadRes) {
                    if (uploadRes.status === 409) {
                      return uploadConflict(uploadRes).then(function (c) {
                        throw new Error(c.conflict ? "cloud-changed"
                                                   : "upload failed: 409 " + c.summary);
                      });
                    }
                    if (!uploadRes.ok) throw new Error("upload failed: " + uploadRes.status);
                    // SY-D1: the cloud now holds the OLD remote content
                    // re-encrypted — not necessarily what this device
                    // last applied. Unknown → the next push pulls first.
                    cloudRev = undefined;
                    setPassphrase(newPw, remember);
                    // SY7: the blob just uploaded is encrypted with
                    // the passphrase now in memory — arm the trust
                    // window so the next push skips the redundant
                    // download+decrypt proof (same contract as the
                    // pull success path).
                    lastSuccessfulPullAt = Date.now();
                    // Deliberately NO clearDirty(): the re-encrypted
                    // blob is the OLD remote content, not this
                    // device's local state. If local had unsynced
                    // edits, the dirty flag must survive so the
                    // next reconcile pushes them (encrypted with the
                    // new passphrase — setPassphrase ran above).
                    // Update local vault epoch
                    localStorage.setItem("oros-sync-pw-epoch", String(payload.meta.pwEpoch));
                    // …and only now, with the blob safely under the
                    // new passphrase, drop the old wrap.
                    return finishVault().then(function () {
                      return { ok: true, changed: true };
                    });
                  });
              });
              });   // vaultRewrapBegin
            }).catch(function (err) {
              // Either the old passphrase was wrong (OperationError)
              // or the upload failed — either way the cloud blob is
              // UNCHANGED, so the in-memory passphrase must be
              // restored to the one that actually decrypts the cloud.
              passphrase = prevPass;
              var isDecryptFail = err && err.name === "OperationError";
              throw new Error(isDecryptFail ? "wrong-passphrase"
                                             : (err && err.message) || "change failed");
            });
          });
        })
        .catch(function (err) {
          if (err.message === "wrong-passphrase") {
            console.error("orOS sync: wrong old passphrase");
          }
          throw err;
        })
        .finally(function () {
          pushInFlight = false;   // released on EVERY exit path
        });
    }
  };
})();