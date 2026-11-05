// ============================================================
// orOS Music — lb.js (ListenBrainz with my own account, v1.0.0)
// Wave 6d of the "known artists" plan (2026-11-04). The person pastes
// their OWN ListenBrainz user token (listenbrainz.org › Settings);
// nothing here uses an orOS account or key.
//   - The token is sealed on this device (AES-GCM with a key that
//     cannot leave the browser, IndexedDB "oros-music-lb"), never
//     synced, never sent through the relay: only to
//     api.listenbrainz.org, in the Authorization header.
//   - Device-local "oros-music-lb" = { u user name, on 1|0 send listens }.
//   - Listens: "playing now" when a song starts, a listen once half
//     the song or four minutes have played (ListenBrainz's rule);
//     sent from the shell (host.js loads this file only when the
//     account is set), kept in "oros-music-lb-q" (≤ 200) while
//     offline and sent later as one import.
//   - Read with my user name only (public data): the playlists
//     ListenBrainz makes for me (Weekly Jams, Weekly Exploration…)
//     and my own playlists, as JSPF.
// Pure parts (payloads, the listen rule, JSPF) run in Node too;
// tests/music-artists.test.js covers them.
// ============================================================
(function (root) {
  "use strict";
  if (root.OrosMusicLB) return;
  var API = "https://api.listenbrainz.org/1/";
  var PREF = "oros-music-lb", QKEY = "oros-music-lb-q", DB = "oros-music-lb";
  var QMAX = 200;
  var TOKEN_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
  var USER_RE = /^[A-Za-z0-9_.@ -]{1,64}$/;
  var MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // ---------- 1. Pure ----------
  // eslint-disable-next-line no-control-regex
  function clean(v, n) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n || 300) : ""; }
  function okToken(t) { return typeof t === "string" && TOKEN_RE.test(t.trim()); }
  // A song counts as a listen after half its length or four minutes,
  // whichever comes first (songs under 30 s never count).
  function listenAt(d) { var s = +d || 0; return s > 0 && s < 30 ? Infinity : s > 0 ? Math.min(240, s / 2) : 240; }
  var SERVICE = { ia: "archive.org", jm: "jamendo.com", ov: "openverse.org", cc: "ccmixter.org" };
  // One listen of an item (the queue item shape of core.js).
  function listen(item, at, ver) {
    if (!item || !clean(item.t) || !clean(item.a)) return null;
    var meta = { artist_name: clean(item.a), track_name: clean(item.t) };
    if (clean(item.al)) meta.release_name = clean(item.al);
    var info = { media_player: "orOS Music", submission_client: "orOS Music", submission_client_version: clean(ver, 20) || "1" };
    if (+item.d > 0) info.duration_ms = Math.round(+item.d * 1000);
    if (SERVICE[item.s]) info.music_service = SERVICE[item.s];
    if (typeof item.pg === "string" && /^https:\/\/[^\s"'<>]{1,500}$/.test(item.pg)) info.origin_url = item.pg;
    meta.additional_info = info;
    var o = { track_metadata: meta };
    if (at) o.listened_at = Math.floor(at / 1000);
    return o;
  }
  function payload(type, listens) { return { listen_type: type, payload: listens }; }
  // JSPF (ListenBrainz playlists) -> { n, by, tracks: [{ k, t, a, al?, d?, rid? }] }
  function parsePlaylist(j) {
    var p = j && j.playlist;
    if (!p) return null;
    var tracks = (Array.isArray(p.track) ? p.track : []).slice(0, 500).map(function (x, i) {
      var t = clean(x && x.title), a = clean(x && x.creator);
      if (!t) return null;
      var id = String(x.identifier && (Array.isArray(x.identifier) ? x.identifier[0] : x.identifier) || "");
      var m = /musicbrainz\.org\/recording\/([0-9a-f-]{36})/.exec(id);
      var o = { t: t, a: a, n: i + 1 };
      if (clean(x.album)) o.al = clean(x.album);
      if (+x.duration > 0) o.d = Math.round(+x.duration / 1000);
      if (m && MBID_RE.test(m[1])) o.rid = m[1];
      return o;
    }).filter(Boolean);
    var pid = /\/playlist\/([0-9a-f-]{36})/.exec(String(p.identifier || ""));
    return { id: pid && MBID_RE.test(pid[1]) ? pid[1] : "", n: clean(p.title, 200) || "ListenBrainz", by: clean(p.creator, 64), tracks: tracks };
  }
  // A list of playlists -> [{ id, n, by }]
  function parsePlaylists(j) {
    var list = j && Array.isArray(j.playlists) ? j.playlists : [];
    return list.map(function (x) {
      var p = parsePlaylist(x);
      return p && p.id ? { id: p.id, n: p.n, by: p.by } : null;
    }).filter(Boolean).slice(0, 50);
  }
  function userPath(u) { return USER_RE.test(u || "") ? encodeURIComponent(u) : ""; }

  // ---------- 2. Device: settings, sealed token, queue ----------
  function prefs() {
    try { var o = JSON.parse(root.localStorage.getItem(PREF) || "null"); if (o && USER_RE.test(o.u || "")) return { u: o.u, on: o.on === 0 ? 0 : 1 }; } catch (e) {}
    return null;
  }
  function setPrefs(o) {
    try { if (o) root.localStorage.setItem(PREF, JSON.stringify({ u: o.u, on: o.on ? 1 : 0 })); else root.localStorage.removeItem(PREF); } catch (e) {}
  }
  function idb(store, mode, fn) {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = root.indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () { var d = req.result; ["keys", "creds"].forEach(function (s) { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); }); };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var d = req.result, res;
        var tx = d.transaction(store, mode), r = fn(tx.objectStore(store));
        if (r) r.onsuccess = function () { res = r.result; };
        tx.oncomplete = function () { d.close(); resolve(res); };
        tx.onerror = tx.onabort = function () { d.close(); reject(tx.error); };
      };
    });
  }
  function key() {
    return idb("keys", "readonly", function (s) { return s.get("device"); }).then(function (k) {
      if (k) return k;
      return root.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]).then(function (nk) {
        return idb("keys", "readwrite", function (s) { s.put(nk, "device"); }).then(function () { return nk; });
      });
    });
  }
  var tokenMem;
  function saveToken(tok) {
    return key().then(function (k) {
      var iv = root.crypto.getRandomValues(new Uint8Array(12));
      return root.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, k, new TextEncoder().encode(tok)).then(function (data) {
        return idb("creds", "readwrite", function (s) { s.put({ iv: iv.buffer, data: data }, "token"); });
      });
    }).then(function () { tokenMem = tok; });
  }
  function token() {
    if (tokenMem !== undefined) return Promise.resolve(tokenMem);
    if (!root.indexedDB || !root.crypto || !root.crypto.subtle) return Promise.resolve(null);
    return idb("creds", "readonly", function (s) { return s.get("token"); }).then(function (rec) {
      if (!rec) return null;
      return key().then(function (k) { return root.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, k, rec.data); })
        .then(function (p) { return new TextDecoder().decode(p); });
    }).catch(function () { return null; }).then(function (t) { tokenMem = okToken(t || "") ? t : null; return tokenMem; });
  }
  function forget() {
    tokenMem = null;
    setPrefs(null);
    try { root.localStorage.removeItem(QKEY); } catch (e) {}
    return idb("creds", "readwrite", function (s) { s.delete("token"); }).catch(function () {});
  }
  function queue() { try { var q = JSON.parse(root.localStorage.getItem(QKEY) || "[]"); return Array.isArray(q) ? q.slice(-QMAX) : []; } catch (e) { return []; } }
  function setQueue(q) { try { if (q.length) root.localStorage.setItem(QKEY, JSON.stringify(q.slice(-QMAX))); else root.localStorage.removeItem(QKEY); } catch (e) {} }

  // ---------- 3. Network ----------
  function call(method, path, tok, body) {
    var h = { Accept: "application/json" };
    if (tok) h.Authorization = "Token " + tok;
    if (body) h["Content-Type"] = "application/json";
    return root.fetch(API + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, credentials: "omit", referrerPolicy: "no-referrer", mode: "cors" })
      .then(function (r) {
        if (r.status === 401) throw { code: "token" };
        if (r.status === 429) throw { code: "busy" };
        if (!r.ok) throw { code: "http" };
        return r.json().catch(function () { return {}; });
      }, function () { throw { code: "net" }; });
  }
  // Connect: the token is checked first, saved only when valid.
  function connect(tok) {
    tok = String(tok || "").trim();
    if (!okToken(tok)) return Promise.reject({ code: "format" });
    return call("GET", "validate-token", tok).then(function (j) {
      if (!j || j.valid !== true || !USER_RE.test(j.user_name || "")) throw { code: "token" };
      return saveToken(tok).then(function () { setPrefs({ u: j.user_name, on: 1 }); return j.user_name; });
    });
  }
  var VER = "";
  function setVersion(v) { VER = clean(v, 20); }
  // Sends the queue first (as one import), then this listen.
  function send(type, item, at) {
    var p = prefs();
    if (!p || !p.on) return Promise.resolve(false);
    var l = listen(item, type === "playing_now" ? 0 : at, VER);
    if (!l) return Promise.resolve(false);
    return token().then(function (tok) {
      if (!tok) return false;
      if (type === "playing_now") return call("POST", "submit-listens", tok, payload("playing_now", [l])).then(function () { return true; }, function () { return false; });
      var q = queue().concat([l]);
      var body = q.length === 1 ? payload("single", q) : payload("import", q);
      return call("POST", "submit-listens", tok, body).then(function () { setQueue([]); return true; }, function (e) {
        if (e && e.code === "token") { setQueue([]); return false; }
        setQueue(q);
        return false;
      });
    });
  }
  function playlists(user) {
    var u = userPath(user);
    if (!u) return Promise.reject({ code: "user" });
    var get = function (path) { return call("GET", path, null).then(parsePlaylists, function () { return []; }); };
    return Promise.all([get("user/" + u + "/playlists/createdfor?count=25"), get("user/" + u + "/playlists?count=25")]).then(function (r) {
      var seen = {}, out = [];
      r[0].concat(r[1]).forEach(function (p) { if (!seen[p.id]) { seen[p.id] = 1; out.push(p); } });
      return out;
    });
  }
  function playlist(id) {
    if (!MBID_RE.test(id || "")) return Promise.reject({ code: "id" });
    return call("GET", "playlist/" + id, null).then(function (j) { var p = parsePlaylist(j); if (!p) throw { code: "http" }; return p; });
  }

  var api = {
    VERSION: "1.0.0", PREF: PREF, QKEY: QKEY, DB: DB, okToken: okToken, listenAt: listenAt, listen: listen, payload: payload,
    parsePlaylist: parsePlaylist, parsePlaylists: parsePlaylists,
    prefs: prefs, setPrefs: setPrefs, token: token, forget: forget, queue: queue, connect: connect, send: send, setVersion: setVersion,
    playlists: playlists, playlist: playlist
  };
  root.OrosMusicLB = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
