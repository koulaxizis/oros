// ============================================================
// orOS Contacts — one-time import from an online account
// (contacts/accounts.js)
// ============================================================
// "From an account": the person signs in to Google or Microsoft
// (Outlook.com, Hotmail, Microsoft 365) in a small window, orOS reads
// their contacts ONCE, straight from the browser, and lets the access
// go at once. Nothing is stored: the token lives in memory for the
// read only, Google's token is revoked right after it, Microsoft's
// (which has no revoke call) is dropped and expires by itself within
// the hour. No refresh token is ever asked for. The read contacts go
// through the same review as a file import (importplan.js).
//
// Sign-in, browser only, no secret:
//   Google    — OAuth 2.0 token flow (response_type=token, scope
//               contacts.readonly); People API connections + groups.
//   Microsoft — OAuth 2.0 code flow with PKCE on the "common"
//               endpoint (scope Contacts.Read); Graph /me/contacts
//               and every contact folder.
// Both answer to contacts/oauth-callback.html, which only passes the
// answer back (BroadcastChannel, localStorage fallback).
//
// Client ids: an OAuth client id is not a secret. orOS's own ids go
// in CLIENT below once registered (redirect URI
// https://useoros.online/contacts/oauth-callback.html). Anyone can
// also register their own and enter it under "Use my own app id"
// (kept on this device only, localStorage "oros-contacts-oauth").
//
// Pure mappers (also used by the node tests):
//   fromGoogle(person, groupNames) / fromGraph(contact) → parser shape
// ============================================================
(function (root) {
  "use strict";

  var CLIENT = {
    google: "97712435228-us9qmufgtniombc9ducde9gsvt5hj98h.apps.googleusercontent.com",   // Chris, 2026-10-14 (Google Cloud › OAuth client, Web application)
    microsoft: ""     // Microsoft Entra › App registrations (SPA, personal + work accounts)
  };
  var PREFS_KEY = "oros-contacts-oauth";
  var CB_KEY = "oros-contacts-oauth-cb";
  var CB_CHANNEL = "oros-contacts-oauth";
  var MAX_PAGES = 60;
  var MAX_CONTACTS = 20000;

  var PROVIDERS = {
    google: {
      auth: "https://accounts.google.com/o/oauth2/v2/auth",
      scope: "https://www.googleapis.com/auth/contacts.readonly",
      api: "https://people.googleapis.com/v1/"
    },
    microsoft: {
      auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      scope: "Contacts.Read",
      api: "https://graph.microsoft.com/v1.0/"
    }
  };

  // ---------- pure mappers ----------
  function s(v, n) { return (typeof v === "string" ? v : "").trim().slice(0, n); }
  function blank() {
    return {
      given: "", middle: "", family: "", nickname: "", org: "", jobTitle: "",
      phones: [], emails: [], addresses: [], websites: [], im: [],
      events: [], cats: [], note: "", photo: null, starred: false
    };
  }
  function pick(arr) {
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr.filter(function (x) { return x && x.metadata && x.metadata.primary; })[0] || arr[0];
  }
  function oneOf(t, allowed, map) {
    t = String(t || "").toLowerCase();
    if (map && map[t]) return map[t];
    return allowed.indexOf(t) !== -1 ? t : "other";
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function validDay(m, d) {
    return m >= 1 && m <= 12 && d >= 1 && d <= new Date(2000, m, 0).getDate();
  }
  function ev(type, m, d, y, label) {
    m = +m; d = +d; y = +y;
    if (!validDay(m, d)) return null;
    return { day: pad(m) + "-" + pad(d), year: (y >= 1850 && y <= 2200) ? y : null, type: type, label: s(label, 40) };
  }
  function pushUnique(arr, row, key) {
    if (!row || !key(row)) return;
    if (!arr.some(function (x) { return key(x) === key(row); })) arr.push(row);
  }
  function vkey(r) { return String(r.v).toLowerCase(); }
  function fallbackName(c) {
    if (c.given || c.family || c.org || c.nickname) return;
    c.given = (c.emails[0] && c.emails[0].v.slice(0, 60)) || (c.phones[0] && c.phones[0].v.slice(0, 60)) || "";
  }

  // People API person → parser shape. groupNames: resourceName → name
  // (user groups only; "contactGroups/starred" marks a favourite).
  function fromGoogle(p, groupNames) {
    var c = blank();
    if (!p || typeof p !== "object") return c;
    var n = pick(p.names);
    if (n) {
      c.given = s(n.givenName, 60);
      c.middle = s(n.middleName, 60);
      c.family = s(n.familyName, 60);
      if (!c.given && !c.family && n.displayName) c.given = s(n.displayName, 60);
    }
    var nk = pick(p.nicknames);
    if (nk) c.nickname = s(nk.value, 60);
    var o = pick(p.organizations);
    if (o) { c.org = s(o.name, 80); c.jobTitle = s(o.title, 80); }
    (p.phoneNumbers || []).forEach(function (r) {
      pushUnique(c.phones, r && s(r.value, 40) ? { v: s(r.value, 40), type: oneOf(r.type, ["mobile", "home", "work", "main"]) } : null, vkey);
    });
    (p.emailAddresses || []).forEach(function (r) {
      pushUnique(c.emails, r && s(r.value, 120) ? { v: s(r.value, 120), type: oneOf(r.type, ["home", "work"]) } : null, vkey);
    });
    (p.addresses || []).forEach(function (r) {
      if (!r) return;
      var a = {
        street: s(r.streetAddress, 120), city: s(r.city, 60), region: s(r.region, 60),
        zip: s(r.postalCode, 20), country: s(r.country, 60), type: oneOf(r.type, ["home", "work"])
      };
      if (a.street || a.city || a.region || a.zip || a.country) c.addresses.push(a);
    });
    (p.urls || []).forEach(function (r) {
      pushUnique(c.websites, r && s(r.value, 300) ? {
        v: s(r.value, 300), type: oneOf(r.type, ["home", "work", "blog"], { homepage: "home", profile: "other" })
      } : null, vkey);
    });
    (p.imClients || []).forEach(function (r) {
      pushUnique(c.im, r && s(r.username, 120) ? { v: s(r.username, 120), type: oneOf(r.type, ["home", "work"]) } : null, vkey);
    });
    var b = pick(p.birthdays);
    if (b && b.date) {
      var e = ev("birthday", b.date.month, b.date.day, b.date.year, "");
      if (e) c.events.push(e);
    }
    (p.events || []).forEach(function (r) {
      if (!r || !r.date) return;
      var anni = String(r.type || "").toLowerCase() === "anniversary";
      var e2 = ev(anni ? "anniversary" : "custom", r.date.month, r.date.day, r.date.year, anni ? "" : (r.formattedType || r.type));
      if (e2) c.events.push(e2);
    });
    var bio = pick(p.biographies);
    if (bio) c.note = s(bio.value, 500);
    (p.memberships || []).forEach(function (m) {
      var rn = m && m.contactGroupMembership && m.contactGroupMembership.contactGroupResourceName;
      if (!rn) return;
      if (rn === "contactGroups/starred") { c.starred = true; return; }
      var name = groupNames && groupNames[rn];
      if (name && c.cats.indexOf(name) === -1) c.cats.push(s(name, 40));
    });
    fallbackName(c);
    return c;
  }

  // Graph contact → parser shape.
  function fromGraph(g) {
    var c = blank();
    if (!g || typeof g !== "object") return c;
    c.given = s(g.givenName, 60);
    c.middle = s(g.middleName, 60);
    c.family = s(g.surname, 60);
    if (!c.given && !c.family && g.displayName) c.given = s(g.displayName, 60);
    c.nickname = s(g.nickName, 60);
    c.org = s(g.companyName, 80);
    c.jobTitle = s(g.jobTitle, 80);
    var ph = function (v, type) { pushUnique(c.phones, s(v, 40) ? { v: s(v, 40), type: type } : null, vkey); };
    ph(g.mobilePhone, "mobile");
    (g.homePhones || []).forEach(function (v) { ph(v, "home"); });
    (g.businessPhones || []).forEach(function (v) { ph(v, "work"); });
    (g.emailAddresses || []).forEach(function (r) {
      pushUnique(c.emails, r && s(r.address, 120) ? { v: s(r.address, 120), type: "other" } : null, vkey);
    });
    [["homeAddress", "home"], ["businessAddress", "work"], ["otherAddress", "other"]].forEach(function (k) {
      var r = g[k[0]];
      if (!r || typeof r !== "object") return;
      var a = {
        street: s(r.street, 120), city: s(r.city, 60), region: s(r.state, 60),
        zip: s(r.postalCode, 20), country: s(r.countryOrRegion, 60), type: k[1]
      };
      if (a.street || a.city || a.region || a.zip || a.country) c.addresses.push(a);
    });
    if (s(g.businessHomePage, 300)) c.websites.push({ v: s(g.businessHomePage, 300), type: "work" });
    (g.imAddresses || []).forEach(function (v) {
      pushUnique(c.im, s(v, 120) ? { v: s(v, 120), type: "other" } : null, vkey);
    });
    // "1990-05-14T00:00:00Z"; Outlook stores a year-less birthday as 1604
    var m = typeof g.birthday === "string" && g.birthday.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      var e = ev("birthday", m[2], m[3], m[1], "");
      if (e) c.events.push(e);
    }
    c.note = s(g.personalNotes, 500);
    (g.categories || []).forEach(function (cat) {
      var n = s(cat, 40);
      if (n && c.cats.indexOf(n) === -1) c.cats.push(n);
    });
    fallbackName(c);
    return c;
  }

  // ---------- browser side ----------
  function prefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function setOwnId(provider, id) {
    var p = prefs();
    id = String(id || "").trim().slice(0, 200);
    if (id && !/^[A-Za-z0-9._-]+$/.test(id)) return false;
    if (id) p[provider] = id; else delete p[provider];
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) {}
    return true;
  }
  function clientId(provider) { return prefs()[provider] || CLIENT[provider] || ""; }
  function ready(provider) { return !!clientId(provider); }

  function rand(n) {
    var a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return b64url(a);
  }
  function b64url(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function challenge(verifier) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
      .then(function (h) { return b64url(new Uint8Array(h)); });
  }
  function redirectUri() { return new URL("oauth-callback.html", location.href).href.split("?")[0]; }

  function err(code, detail) { var e = new Error(code); e.code = code; e.detail = detail || ""; return e; }

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
        if (cb.error) reject(err(cb.error === "access_denied" ? "cancelled" : "auth", cb.error));
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
        window.removeEventListener("storage", onStorage);
        try { if (bc) bc.close(); } catch (e) {}
      }
      try { bc = new BroadcastChannel(CB_CHANNEL); bc.onmessage = function (e) { finish(e.data); }; } catch (e) {}
      window.addEventListener("storage", onStorage);
      // No "window closed = cancelled" check: the sign-in pages cut the
      // link to their opener (COOP), so `closed` reads true at once.
      // The person cancels in Contacts instead (cancel()).
      poll = setInterval(readStore, 1000);
      abort = function () { if (!done) { done = true; cleanup(); reject(err("cancelled")); } };
      timer = setTimeout(function () { if (!done) { done = true; cleanup(); reject(err("timeout")); } }, 10 * 60 * 1000);
    });
  }

  function getJson(url, token) {
    return fetch(url, { headers: { Authorization: "Bearer " + token, Accept: "application/json" }, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) throw err("auth", "401");
        if (r.status === 403) return r.text().then(function (t) { throw err("forbidden", t.slice(0, 300)); });
        if (!r.ok) throw err("http", String(r.status));
        return r.json();
      }, function () { throw err("network"); });
  }

  // ---- Google ----
  function readGoogle(token, progress) {
    var P = PROVIDERS.google, names = {};
    return getJson(P.api + "contactGroups?pageSize=1000&groupFields=name,groupType", token)
      .then(function (g) {
        (g && g.contactGroups || []).forEach(function (cg) {
          if (cg && cg.groupType === "USER_CONTACT_GROUP" && cg.resourceName) names[cg.resourceName] = cg.formattedName || cg.name || "";
        });
      }, function () { /* groups are optional */ })
      .then(function () {
        var out = [], pages = 0;
        var fields = "names,nicknames,emailAddresses,phoneNumbers,addresses,organizations,birthdays,events,urls,imClients,biographies,memberships";
        function page(tok) {
          var url = P.api + "people/me/connections?pageSize=1000&personFields=" + fields +
            (tok ? "&pageToken=" + encodeURIComponent(tok) : "");
          return getJson(url, token).then(function (d) {
            (d && d.connections || []).forEach(function (p) { if (out.length < MAX_CONTACTS) out.push(fromGoogle(p, names)); });
            if (progress) progress(out.length);
            pages++;
            if (d && d.nextPageToken && pages < MAX_PAGES && out.length < MAX_CONTACTS) return page(d.nextPageToken);
            return out;
          });
        }
        return page("");
      });
  }
  function revokeGoogle(token) {
    return fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "token=" + encodeURIComponent(token)
    }).then(function (r) { return r.ok; }, function () { return false; });
  }

  // ---- Microsoft ----
  var GRAPH_SELECT = "givenName,middleName,surname,displayName,nickName,companyName,jobTitle,emailAddresses," +
    "mobilePhone,homePhones,businessPhones,homeAddress,businessAddress,otherAddress,birthday,personalNotes," +
    "businessHomePage,imAddresses,categories";
  function readGraph(token, progress) {
    var P = PROVIDERS.microsoft, out = [], pages = 0;
    function all(url) {
      return getJson(url, token).then(function (d) {
        (d && d.value || []).forEach(function (g) { if (out.length < MAX_CONTACTS) out.push(fromGraph(g)); });
        if (progress) progress(out.length);
        pages++;
        var next = d && d["@odata.nextLink"];
        if (typeof next === "string" && next.indexOf(P.api) === 0 && pages < MAX_PAGES && out.length < MAX_CONTACTS) return all(next);
      });
    }
    return all(P.api + "me/contacts?$top=500&$select=" + GRAPH_SELECT)
      .then(function () {
        return getJson(P.api + "me/contactFolders?$top=100&$select=id", token).then(function (d) {
          var ids = (d && d.value || []).map(function (f) { return f && f.id; })
            .filter(function (id) { return typeof id === "string" && /^[A-Za-z0-9_=-]+$/.test(id); });
          return ids.reduce(function (p, id) {
            return p.then(function () {
              return all(P.api + "me/contactFolders/" + id + "/contacts?$top=500&$select=" + GRAPH_SELECT);
            });
          }, Promise.resolve());
        }, function () { /* folders are optional */ });
      })
      .then(function () { return out; });
  }
  function msToken(code, verifier, redirect) {
    var P = PROVIDERS.microsoft;
    var body = new URLSearchParams({
      client_id: clientId("microsoft"), grant_type: "authorization_code", code: code,
      redirect_uri: redirect, code_verifier: verifier, scope: P.scope
    });
    return fetch(P.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j || !j.access_token) throw err("auth", (j && j.error) || String(r.status));
        return j.access_token;
      });
    }, function () { throw err("network"); });
  }

  // Must run inside the click handler (popup blockers): opens the
  // sign-in window synchronously, then resolves with
  // { provider, contacts: [parser shape], revoked }.
  function run(provider, progress) {
    var P = PROVIDERS[provider];
    if (!P) return Promise.reject(err("provider"));
    var id = clientId(provider);
    if (!id) return Promise.reject(err("noclient"));
    var state = rand(24), redirect = redirectUri(), verifier = rand(48);
    try { localStorage.removeItem(CB_KEY); } catch (e) {}
    var win = window.open("about:blank", "oros-contacts-signin", "popup,width=520,height=720");
    if (!win) return Promise.reject(err("popup"));
    var go;
    if (provider === "google") {
      go = Promise.resolve(P.auth + "?" + new URLSearchParams({
        client_id: id, redirect_uri: redirect, response_type: "token", scope: P.scope,
        state: state, include_granted_scopes: "false", prompt: "select_account"
      }).toString());
    } else {
      go = challenge(verifier).then(function (ch) {
        return P.auth + "?" + new URLSearchParams({
          client_id: id, redirect_uri: redirect, response_type: "code", response_mode: "query",
          scope: P.scope, state: state, code_challenge: ch, code_challenge_method: "S256",
          prompt: "select_account"
        }).toString();
      });
    }
    var token = "";
    return go.then(function (url) {
      try { win.location.href = url; } catch (e) { throw err("popup"); }
      return waitAnswer(state);
    }).then(function (cb) {
      if (provider === "google") {
        if (!cb.token) throw err("auth", "no token");
        return cb.token;
      }
      if (!cb.code) throw err("auth", "no code");
      return msToken(cb.code, verifier, redirect);
    }).then(function (tk) {
      token = tk;
      if (progress) progress(0);
      return provider === "google" ? readGoogle(token, progress) : readGraph(token, progress);
    }).then(function (contacts) {
      return forget().then(function (revoked) {
        return { provider: provider, contacts: contacts, revoked: revoked };
      });
    }, function (e) {
      return forget().then(function () { throw e; });
    });
    // Let the access go: Google revokes; Microsoft has no revoke call,
    // the token is dropped here and expires by itself.
    function forget() {
      var tk = token;
      token = "";
      try { if (win && !win.closed) win.close(); } catch (e) {}
      if (!tk) return Promise.resolve(false);
      return provider === "google" ? revokeGoogle(tk) : Promise.resolve(false);
    }
  }

  // A sign-in answer nobody picked up (Contacts closed meanwhile)
  // must not linger: drop it when it is more than two minutes old.
  try {
    if (typeof localStorage !== "undefined") {
      var old = JSON.parse(localStorage.getItem(CB_KEY) || "null");
      if (old && !(Date.now() - old.t < 120000)) localStorage.removeItem(CB_KEY);
    }
  } catch (e) {}

  var api = {
    fromGoogle: fromGoogle, fromGraph: fromGraph,
    ready: ready, clientId: clientId, setOwnId: setOwnId, ownId: function (p) { return prefs()[p] || ""; },
    builtIn: function (p) { return !!CLIENT[p]; },
    redirectUri: redirectUri, run: run, cancel: cancel, CB_KEY: CB_KEY
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosContactsAccounts = api;
})(typeof self !== "undefined" ? self : this);
