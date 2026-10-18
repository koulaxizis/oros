// ============================================================
// orOS — one-time import from a Google account (google-import.js)
// ============================================================
// Shared by Calendar (Google Calendar), To-Do (Google Tasks), Feeds
// (YouTube subscriptions), Shelf (Google Books), Files (picked files
// from Google Drive and Google Photos, files/gmedia.js) and Photo Lab
// (one picture from Google Photos). The same flow as
// Contacts' "From an account" (contacts/accounts.js):
//   - the person signs in to Google in a small window opened in the
//     click itself (popup blockers), OAuth 2.0 token flow
//     (response_type=token), one read-only scope, no refresh token,
//     no secret, no relay
//   - Google answers to contacts/oauth-callback.html (the one redirect
//     address registered with Google), which hands the answer back
//     over a BroadcastChannel plus a localStorage record; the state
//     must match the one sent
//   - the app reads with the token (GET only), then the token is
//     revoked at oauth2.googleapis.com/revoke right away, read or not
//   - nothing is stored: the token lives in memory for the read only
// The client id: orOS's own (BUILTIN, the same as Contacts' CLIENT.google
// — tests/google-import.test.js keeps them equal), or the person's own
// id set in Contacts › From an account › Use my own app id (the same
// device-local pref, localStorage "oros-contacts-oauth").
//
// API (window.OrosGoogleImport; module.exports in Node):
//   ready() / clientId() / redirectUri() / SCOPES
//   run({ scope, read: function (token, api) → Promise, progress })
//     → Promise { data, revoked }; must be called inside the click
//     handler. api = { getJson(url), pages(urlFor, each, max) }
//   cancel()                   → stops waiting for the sign-in window
//   message(err, lang)         → the person-facing text for an error
//   hash(s)                    → 64-bit FNV-1a hex (stable ids)
//   getJson(url, token), pages(token, urlFor, each, max), revoke(token)
//   send(url, token, method, body) → POST / DELETE with a JSON body
//     (only the Photos Picker needs it: it makes and ends a session)
//   getBlob(url, token, maxBytes) → Blob; rejects { code: "big" } past
//     maxBytes (the length header first, then the bytes read)
//   apiKey() / driveReady() / APP_ID: Google Drive's file picker also
//     wants a browser API key (built in for orOS's own app; with an
//     own client id, the person's own key set next to it in Contacts) and the Cloud project
//     number. api (in run) has send / getBlob too.
// ============================================================
(function (root) {
  "use strict";

  // Google Cloud › OAuth client (Web application), the same id as
  // CLIENT.google in contacts/accounts.js.
  var BUILTIN = "97712435228-us9qmufgtniombc9ducde9gsvt5hj98h.apps.googleusercontent.com";
  var PREFS_KEY = "oros-contacts-oauth";       // Contacts' "Use my own app id"
  var CB_KEY = "oros-contacts-oauth-cb";       // written by contacts/oauth-callback.js
  var CB_CHANNEL = "oros-contacts-oauth";
  var AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
  var REVOKE = "https://oauth2.googleapis.com/revoke";
  var MAX_PAGES = 100;
  var SCOPES = {
    calendar: "https://www.googleapis.com/auth/calendar.readonly",
    tasks: "https://www.googleapis.com/auth/tasks.readonly",
    youtube: "https://www.googleapis.com/auth/youtube.readonly",
    // Books has no read-only scope; orOS only sends GET requests.
    books: "https://www.googleapis.com/auth/books",
    // Google Photos Picker: only what the person picks in Google's own
    // picker, read-only.
    photos: "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
    // Drive: only the files the person picks in the Google Picker (or
    // that orOS made, which is none). orOS only reads them.
    drive: "https://www.googleapis.com/auth/drive.file"
  };
  // The Google Cloud project behind BUILTIN (its number, the Picker's
  // "app id"); an own client id brings its own project, see appId().
  var APP_ID = "97712435228";
  // The Picker's browser key for the same project. It is public by design:
  // Google only accepts it from useoros.online and only for the Picker API.
  var BUILTIN_KEY = "AIzaSyCe3dmRctmtxMdAJTImDFRdAKyV5Jj84m8";

  var S = {
    en: {
      noclient: "Google is not set up in this orOS. You can add your own app id in Contacts › From an account.",
      popup: "The sign-in window was blocked. Allow pop-ups for orOS and try again.",
      cancelled: "Sign-in cancelled.",
      timeout: "The sign-in took too long. Try again.",
      notenabled: "Google answered 403: this service is not enabled yet for orOS's Google app.",
      scope: "Google did not share this data. Try again and allow reading it when you sign in.",
      auth: "Google did not accept the sign-in ({e}). Try again.",
      network: "Could not reach Google. Check the connection and try again.",
      other: "Could not read from Google ({e})."
    },
    el: {
      noclient: "Το Google δεν έχει ρυθμιστεί σε αυτό το orOS. Μπορείς να βάλεις δικό σου αναγνωριστικό εφαρμογής στις Επαφές › Από λογαριασμό.",
      popup: "Το παράθυρο σύνδεσης μπλοκαρίστηκε. Επίτρεψε τα αναδυόμενα για το orOS και δοκίμασε ξανά.",
      cancelled: "Η σύνδεση ακυρώθηκε.",
      timeout: "Η σύνδεση άργησε πολύ. Δοκίμασε ξανά.",
      notenabled: "Η Google απάντησε 403: αυτή η υπηρεσία δεν έχει ενεργοποιηθεί ακόμα για την εφαρμογή Google του orOS.",
      scope: "Η Google δεν έδωσε αυτά τα δεδομένα. Δοκίμασε ξανά και επίτρεψε την ανάγνωσή τους όταν συνδέεσαι.",
      auth: "Η Google δεν δέχτηκε τη σύνδεση ({e}). Δοκίμασε ξανά.",
      network: "Η Google δεν είναι προσβάσιμη. Έλεγξε τη σύνδεση και δοκίμασε ξανά.",
      other: "Η ανάγνωση από τη Google απέτυχε ({e})."
    }
  };
  function message(e, lang) {
    // Greek when asked, else the page's pack language
    // (i18n/<code>/google-import.js, "google-import" in data-app)
    var I = root.orosI18n, L = lang === "el" ? "el" : (I && I.lang() !== "el" ? I.lang() : "en");
    var tab = S[L] || (I ? I.table(S, "google-import", L) : S.en), c = e && e.code;
    var k = tab[c] !== undefined && c !== "other" ? c : "other";
    return tab[k].replace("{e}", String((e && (e.detail || e.code)) || "?").slice(0, 80));
  }

  // ---------- client id ----------
  function prefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function clientId() {
    var own = prefs().google;
    return (typeof own === "string" && /^[A-Za-z0-9._-]{1,200}$/.test(own) ? own : "") || BUILTIN;
  }
  function ready() { return !!clientId(); }
  // The Drive picker's browser API key: an own one from Contacts › From an
  // account › Use my own app id ("googleKey"), else the built-in one, which
  // only fits the built-in client id's project.
  function apiKey() {
    var k = prefs().googleKey;
    if (typeof k === "string" && /^[A-Za-z0-9_-]{20,120}$/.test(k)) return k;
    return clientId() === BUILTIN ? BUILTIN_KEY : "";
  }
  function driveReady() { return ready() && !!apiKey(); }
  // The project number: the leading digits of the client id in use.
  function appId() {
    var m = /^(\d{6,20})-/.exec(clientId());
    return m ? m[1] : APP_ID;
  }

  // The callback page sits next to Contacts, found from this file's
  // own address (orOS root), so every app frame uses the same one.
  var CALLBACK = "";
  try {
    var cs = typeof document !== "undefined" && document.currentScript;
    if (cs && cs.src) CALLBACK = new URL("contacts/oauth-callback.html", cs.src).href;
  } catch (e) {}
  function redirectUri() {
    var u = CALLBACK;
    if (!u) { try { u = new URL("../contacts/oauth-callback.html", location.href).href; } catch (e) { u = ""; } }
    return u.split(/[?#]/)[0];
  }

  // ---------- helpers ----------
  function err(code, detail) { var e = new Error(code); e.code = code; e.detail = detail || ""; return e; }
  function rand(n) {
    var a = new Uint8Array(n), bin = "";
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  // 64-bit FNV-1a (two seeds), hex: stable ids from Google's ids.
  function hash(s) {
    s = String(s);
    function fnv(seed) {
      var h = seed >>> 0;
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return ("0000000" + h.toString(16)).slice(-8);
    }
    return fnv(2166136261) + fnv(0x9747b28c);
  }

  // A 403 says why in its body: the API not switched on for the app's
  // Google Cloud project, or the person did not grant the scope.
  function why403(text) {
    if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(text)) return "scope";
    return "notenabled";
  }
  function getJson(url, token) {
    return fetch(url, { headers: { Authorization: "Bearer " + token, Accept: "application/json" }, cache: "no-store", credentials: "omit" })
      .then(function (r) {
        if (r.status === 401) throw err("auth", "401");
        if (r.status === 403) return r.text().then(function (t) { throw err(why403(t), "403"); }, function () { throw err("notenabled", "403"); });
        if (!r.ok) throw err("http", String(r.status));
        return r.json().catch(function () { throw err("http", "json"); });
      }, function () { throw err("network"); });
  }
  // POST / DELETE with a JSON body (the Photos Picker's session).
  function send(url, token, method, body) {
    var o = { method: method, headers: { Authorization: "Bearer " + token, Accept: "application/json" }, cache: "no-store", credentials: "omit" };
    if (body !== undefined) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
    return fetch(url, o).then(function (r) {
      if (r.status === 401) throw err("auth", "401");
      if (r.status === 403) return r.text().then(function (t) { throw err(why403(t), "403"); }, function () { throw err("notenabled", "403"); });
      if (!r.ok) throw err("http", String(r.status));
      if (r.status === 204) return {};
      return r.text().then(function (t) { try { return t ? JSON.parse(t) : {}; } catch (e) { throw err("http", "json"); } });
    }, function () { throw err("network"); });
  }
  // The bytes of one file, with the token; past maxBytes → "big"
  // (the Content-Length first, so a large file is not read at all).
  function getBlob(url, token, maxBytes) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var o = { headers: { Authorization: "Bearer " + token }, cache: "no-store", credentials: "omit" };
    if (ctl) o.signal = ctl.signal;
    return fetch(url, o).then(function (r) {
      if (r.status === 401) throw err("auth", "401");
      if (r.status === 403) return r.text().then(function (t) { throw err(why403(t), "403"); }, function () { throw err("notenabled", "403"); });
      if (!r.ok) throw err("http", String(r.status));
      var len = Number(r.headers && r.headers.get ? r.headers.get("Content-Length") : NaN);
      if (maxBytes && isFinite(len) && len > maxBytes) { try { if (ctl) ctl.abort(); } catch (e) {} throw err("big", String(len)); }
      return r.blob().then(function (b) {
        if (maxBytes && b.size > maxBytes) throw err("big", String(b.size));
        return b;
      });
    }, function () { throw err("network"); });
  }

  // Every page: urlFor(cursor) ("" first); each(data) returns the next
  // cursor ("" or nothing = the last page). Stops at max pages and on
  // a cursor that does not move.
  function pages(token, urlFor, each, max) {
    var n = 0;
    max = max || MAX_PAGES;
    function step(cur) {
      return getJson(urlFor(cur), token).then(function (d) {
        n++;
        var next = each(d) || "";
        if (next && next !== cur && n < max) return step(String(next));
        return n;
      });
    }
    return step("");
  }
  // Google's own page cursor, only when it looks like one.
  function nextToken(d) {
    var t = d && d.nextPageToken;
    return typeof t === "string" && /^[A-Za-z0-9_.~=+\/-]{1,2000}$/.test(t) ? t : "";
  }
  function revoke(token) {
    return fetch(REVOKE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "token=" + encodeURIComponent(token)
    }).then(function (r) { return r.ok; }, function () { return false; });
  }

  // Wait for the callback page's answer for this state (BroadcastChannel,
  // or the localStorage record when the channel is missed).
  var abort = null;
  function cancel() { if (abort) abort(); }
  function waitAnswer(state) {
    return new Promise(function (resolve, reject) {
      var done = false, bc = null, timer = null, poll = null;
      function finish(cb) {
        if (done || !cb || cb.state !== state) return;
        done = true;
        try { localStorage.removeItem(CB_KEY); } catch (e) {}
        cleanup();
        if (cb.error) reject(err(cb.error === "access_denied" ? "cancelled" : "auth", String(cb.error).slice(0, 64)));
        else resolve(cb);
      }
      function readStore() {
        try { finish(JSON.parse(localStorage.getItem(CB_KEY) || "null")); } catch (e) {}
      }
      function onStorage(e) { if (e.key === CB_KEY) readStore(); }
      function cleanup() {
        clearTimeout(timer);
        clearInterval(poll);
        abort = null;
        root.removeEventListener("storage", onStorage);
        try { if (bc) bc.close(); } catch (e) {}
      }
      try { bc = new BroadcastChannel(CB_CHANNEL); bc.onmessage = function (e) { finish(e.data); }; } catch (e) {}
      root.addEventListener("storage", onStorage);
      // No "window closed = cancelled" check: Google's sign-in pages cut
      // the link to their opener (COOP), so `closed` reads true at once.
      poll = setInterval(readStore, 1000);
      abort = function () { if (!done) { done = true; cleanup(); reject(err("cancelled")); } };
      timer = setTimeout(function () { if (!done) { done = true; cleanup(); reject(err("timeout")); } }, 10 * 60 * 1000);
    });
  }

  // Must run inside the click handler: opens the sign-in window
  // synchronously. opts: { scope, read(token, api) → Promise, progress }.
  // Resolves { data, revoked }; the token is revoked on every way out.
  function run(opts) {
    opts = opts || {};
    var scope = String(opts.scope || "");
    if (!/^https:\/\/www\.googleapis\.com\/auth\/[a-z.]+$/.test(scope) || typeof opts.read !== "function") return Promise.reject(err("other", "scope"));
    var id = clientId();
    if (!id) return Promise.reject(err("noclient"));
    if (abort) abort();                          // one sign-in at a time
    var state = rand(24), redirect = redirectUri();
    try { localStorage.removeItem(CB_KEY); } catch (e) {}
    var win = null;
    try { win = root.open("about:blank", "oros-google-signin", "popup,width=520,height=720"); } catch (e) { win = null; }
    if (!win) return Promise.reject(err("popup"));
    var url = AUTH + "?" + new URLSearchParams({
      client_id: id, redirect_uri: redirect, response_type: "token", scope: scope,
      state: state, include_granted_scopes: "false", prompt: "select_account"
    }).toString();
    try { win.location.href = url; } catch (e) {
      try { win.close(); } catch (e2) {}
      return Promise.reject(err("popup"));
    }
    var token = "";
    function forget() {
      var tk = token;
      token = "";
      try { if (win && !win.closed) win.close(); } catch (e) {}
      return tk ? revoke(tk) : Promise.resolve(false);
    }
    var api = {
      getJson: function (u) { return getJson(u, token); },
      pages: function (urlFor, each, max) { return pages(token, urlFor, each, max); },
      send: function (u, method, body) { return send(u, token, method, body); },
      getBlob: function (u, max) { return getBlob(u, token, max); },
      nextToken: nextToken
    };
    return waitAnswer(state).then(function (cb) {
      if (!cb.token) throw err("auth", "no token");
      token = String(cb.token);
      if (opts.progress) opts.progress(0);
      return opts.read(token, api);
    }).then(function (data) {
      return forget().then(function (revoked) { return { data: data, revoked: revoked }; });
    }, function (e) {
      return forget().then(function () { throw e; });
    });
  }

  // A sign-in answer nobody picked up (the app closed meanwhile) must
  // not linger: drop it when it is more than two minutes old.
  try {
    if (typeof localStorage !== "undefined") {
      var old = JSON.parse(localStorage.getItem(CB_KEY) || "null");
      if (old && !(Date.now() - old.t < 120000)) localStorage.removeItem(CB_KEY);
    }
  } catch (e) {}

  var api = {
    BUILTIN: BUILTIN, BUILTIN_KEY: BUILTIN_KEY, SCOPES: SCOPES, PREFS_KEY: PREFS_KEY, CB_KEY: CB_KEY, APP_ID: APP_ID,
    ready: ready, clientId: clientId, redirectUri: redirectUri,
    apiKey: apiKey, driveReady: driveReady, appId: appId, send: send, getBlob: getBlob,
    run: run, cancel: cancel, message: message, hash: hash,
    getJson: getJson, pages: pages, nextToken: nextToken, revoke: revoke
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosGoogleImport = api;
})(typeof self !== "undefined" ? self : globalThis);
