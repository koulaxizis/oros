// ============================================================
// orOS Maps — osm-api.js (OpenStreetMap sign-in + API, v1.0.0)
// Browser side of the OSM features: OAuth 2.0 (authorization code +
// PKCE, public client, no secret, no relay) and a small fetch wrapper
// for API 0.6. Pure parts live in osm.js (window.OrosMapsOSM).
//
// Sign-in: a popup opens <web>/oauth2/authorize; OSM sends it back to
// maps/osm-callback.html (same origin), which hands the code over on
// a BroadcastChannel AND in localStorage "oros-maps-osm-cb" (the
// redirect fallback when a popup is blocked, e.g. an installed app:
// the whole tab goes to OSM, comes back to /?open=maps, and Maps
// finishes the sign-in on boot). The state must match the one this
// device stored with its PKCE verifier, else the answer is dropped.
//
// Device-local keys (never synced; the factory reset sweeps oros-*):
//   oros-maps-osm       { srv, acc: { live|dev: { token, user, uid } } }
//   oros-maps-osm-pkce  { state, verifier, srv, redirect, mode, t }
//   oros-maps-osm-cb    { code?, error?, state, t }  (one-shot)
//   oros-maps-osm-dev   this device's id for drafts
//
// API (window.OrosMapsApi):
//   server() → "live"|"dev" · setServer(srv) · account(srv?) → {user,uid}|null
//   configured(srv?) · signIn() → Promise · finishPending() → Promise
//   signOut() · request(method, path, params, srv?, opts?) → Promise<json|text>
//   deviceId() · onChange(fn)
// Errors: rejected with { status, offline, text }.
// ============================================================
(function () {
  "use strict";
  var O = window.OrosMapsOSM;
  var KEY = "oros-maps-osm";
  var PKCE_KEY = "oros-maps-osm-pkce";
  var CB_KEY = "oros-maps-osm-cb";
  var DEV_KEY = "oros-maps-osm-dev";
  var PKCE_MAX_MS = 15 * 60 * 1000;
  var listeners = [];

  function readJSON(k) {
    try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v && typeof v === "object" ? v : null; }
    catch (e) { return null; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function store() {
    var s = readJSON(KEY) || {};
    if (s.srv !== "dev") s.srv = "live";
    if (!s.acc || typeof s.acc !== "object") s.acc = {};
    return s;
  }
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  function server() { return store().srv; }
  function setServer(srv) {
    var s = store();
    s.srv = srv === "dev" ? "dev" : "live";
    writeJSON(KEY, s);
    emit();
  }
  function acc(srv) {
    var a = store().acc[srv || server()];
    return a && typeof a.token === "string" && a.token ? a : null;
  }
  function account(srv) {
    var a = acc(srv);
    return a ? { user: a.user || "", uid: a.uid || 0 } : null;
  }
  function configured(srv) { return !!O.SERVERS[srv || server()].client; }

  function deviceId() {
    var id = "";
    try { id = localStorage.getItem(DEV_KEY) || ""; } catch (e) {}
    if (!O.DEV_RE.test(id)) {
      id = "d" + O.randomString(16).toLowerCase().replace(/[^a-z0-9]/g, "0");
      try { localStorage.setItem(DEV_KEY, id); } catch (e) {}
    }
    return id;
  }

  function redirectUri() {
    var u = new URL("osm-callback.html", location.href);
    return u.origin + u.pathname;
  }

  // ---------- sign-in ----------
  var waiting = null;      // { resolve, reject } of the running signIn()

  function signIn() {
    var srv = server();
    var s = O.SERVERS[srv];
    if (!s.client) return Promise.reject({ status: 0, text: "notconfigured" });
    var verifier = O.randomString(64);
    var state = O.randomString(24);
    var redirect = redirectUri();
    return O.pkceChallenge(verifier).then(function (challenge) {
      var rec = { state: state, verifier: verifier, srv: srv, redirect: redirect, mode: "popup", t: Date.now() };
      writeJSON(PKCE_KEY, rec);
      del(CB_KEY);
      var url = O.authorizeUrl(srv, { state: state, challenge: challenge, redirect: redirect });
      var w = null;
      try { w = window.open(url, "oros-osm-auth", "popup,width=520,height=720"); } catch (e) { w = null; }
      if (!w) {
        // Popup blocked (installed app, strict browser): whole tab.
        rec.mode = "redirect";
        writeJSON(PKCE_KEY, rec);
        var top = window;
        try { if (window.top && window.top.location.origin === location.origin) top = window.top; } catch (e) {}
        top.location.assign(url);
        return new Promise(function () {});          // the page leaves
      }
      return new Promise(function (resolve, reject) { waiting = { resolve: resolve, reject: reject }; });
    });
  }

  function takeCallback(cb) {
    if (!cb || typeof cb !== "object") return Promise.resolve(false);
    var p = readJSON(PKCE_KEY);
    if (!p || p.state !== cb.state || !cb.state || Date.now() - (p.t || 0) > PKCE_MAX_MS) {
      return Promise.resolve(false);                  // not ours / stale
    }
    del(PKCE_KEY);
    del(CB_KEY);
    if (cb.error || !cb.code) {
      var e = { status: 0, text: cb.error === "access_denied" ? "denied" : "failed" };
      if (waiting) { waiting.reject(e); waiting = null; }
      return Promise.reject(e);
    }
    var s = O.SERVERS[p.srv === "dev" ? "dev" : "live"];
    var body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(cb.code),
      redirect_uri: p.redirect,
      client_id: s.client,
      code_verifier: p.verifier
    });
    return fetch(s.web + "/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    }).then(function (r) {
      if (!r.ok) throw { status: r.status, text: "token" };
      return r.json();
    }).then(function (j) {
      var token = j && typeof j.access_token === "string" ? j.access_token : "";
      if (!token) throw { status: 0, text: "token" };
      var srv = p.srv === "dev" ? "dev" : "live";
      var st = store();
      st.acc[srv] = { token: token, user: "", uid: 0 };
      writeJSON(KEY, st);
      return request("GET", "/api/0.6/user/details.json", null, srv).then(function (u) {
        var user = u && u.user ? u.user : {};
        var st2 = store();
        if (st2.acc[srv]) {
          st2.acc[srv].user = O.cleanText(typeof user.display_name === "string" ? user.display_name : "", 255);
          st2.acc[srv].uid = typeof user.id === "number" ? user.id : 0;
          writeJSON(KEY, st2);
        }
      }, function () { /* signed in; the name comes later */ });
    }).then(function () {
      emit();
      if (waiting) { waiting.resolve(true); waiting = null; }
      return true;
    }, function (e) {
      if (waiting) { waiting.reject(e); waiting = null; }
      throw e;
    });
  }

  // Boot / storage event / channel: finish a sign-in whose answer
  // came back while this frame was away (redirect mode).
  function finishPending() {
    return takeCallback(readJSON(CB_KEY));
  }

  try {
    var bc = new BroadcastChannel("oros-maps-osm");
    bc.onmessage = function (e) {
      takeCallback(e.data).catch(function () {});
    };
  } catch (e) { /* old browser: the storage event below still works */ }
  window.addEventListener("storage", function (e) {
    if (e.key === CB_KEY && e.newValue) finishPending().catch(function () {});
  });

  function signOut(srv) {
    srv = srv || server();
    var a = acc(srv);
    var s = O.SERVERS[srv];
    var st = store();
    delete st.acc[srv];
    writeJSON(KEY, st);
    emit();
    if (a && s.client) {
      fetch(s.web + "/oauth2/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: a.token, client_id: s.client }).toString()
      }).catch(function () {});
    }
  }

  // ---------- API requests (one at a time) ----------
  var chain = Promise.resolve();

  // opts: { body (string or FormData), type (its Content-Type), text (answer as
  // text, e.g. changeset ids and diffResult XML) }
  function request(method, path, params, srv, opts) {
    srv = srv || server();
    opts = opts || {};
    var run = function () {
      var s = O.SERVERS[srv];
      var url = s.api + path;
      var qs = params ? new URLSearchParams(params).toString() : "";
      var init = { method: method, headers: { "Accept": opts.text ? "*/*" : "application/json" } };
      var a = acc(srv);
      if (a) init.headers.Authorization = "Bearer " + a.token;
      if (opts.body !== undefined) {
        if (qs) url += (url.indexOf("?") < 0 ? "?" : "&") + qs;
        // FormData (GPX upload): the browser sets the multipart boundary.
        if (!(typeof FormData !== "undefined" && opts.body instanceof FormData)) {
          init.headers["Content-Type"] = opts.type || "text/xml; charset=utf-8";
        }
        init.body = opts.body;
      } else if (qs) {
        if (method === "GET") url += (url.indexOf("?") < 0 ? "?" : "&") + qs;
        else {
          init.headers["Content-Type"] = "application/x-www-form-urlencoded";
          init.body = qs;
        }
      }
      return fetch(url, init).then(function (r) {
        if (r.status === 401 && a) {                 // revoked elsewhere
          var st = store(); delete st.acc[srv]; writeJSON(KEY, st); emit();
        }
        if (!r.ok) {
          return r.text().then(function (txt) {
            throw { status: r.status, text: O.cleanText(txt, 200) };
          }, function () { throw { status: r.status, text: "" }; });
        }
        return opts.text ? r.text() : r.json();
      }, function () {
        throw { status: 0, offline: true, text: "" };
      });
    };
    var p = chain.then(run, run);
    chain = p.catch(function () {});
    return p;
  }

  window.OrosMapsApi = {
    server: server, setServer: setServer, account: account, configured: configured,
    signIn: signIn, finishPending: finishPending, signOut: signOut,
    request: request, deviceId: deviceId, redirectUri: redirectUri,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
