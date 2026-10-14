// ============================================================
// orOS Podcasts — gpodder.js (gpodder API v2 sync, v1.0.0, wave 42)
// Subscriptions and episode actions with the user's OWN account on
// gpodder.net (or a compatible server) or a Nextcloud with the
// GPodder Sync app. Straight from the browser: the Mail relay's "web"
// op only does anonymous GETs, so a server that sends no CORS headers
// cannot be reached (the app then offers OPML + an episode-actions
// JSON file instead).
//
// Loaded by the app window only (podcasts/index.html). Node tests
// load it with require(); it needs podcasts/core.js (OrosPodcastsCore).
//
// Device-local state (never synced, "oros-podcasts-gpodder"):
//   { kind, server, user, device, subsTs, actTs, mark, known[], last, err }
//   kind: "gpodder" | "nextcloud"; subsTs/actTs: the server's own
//   "timestamp" answers (seconds) for ?since=; mark: ms of the start of
//   the last good sync (episode rows changed after it are sent);
//   known: feed addresses on both sides after the last sync.
// The password is sealed with a non-extractable AES-GCM key in
// IndexedDB "oros-podcasts-sync" (Mail's pattern), never in the slice.
//
// Sections: 1. Config + addresses  2. Wire formats  3. Subscriptions
// plan  4. Episode actions  5. Network  6. Sealed password
// ============================================================
(function (root) {
  "use strict";
  var C = root.OrosPodcastsCore || (typeof require === "function" ? require("./core.js").OrosPodcastsCore : null);

  // ---------- 1. Config + addresses ----------
  var DEF_SERVER = { gpodder: "https://gpodder.net", nextcloud: "" };
  var CHUNK = 500;                          // episode actions per upload
  function clean(s, max) { return C.clean(typeof s === "string" ? s : "", max); }
  // https only (http just for a server on this machine / the LAN by
  // name "localhost"), no credentials, no query, no trailing slash.
  function normServer(u) {
    u = clean(u, 300);
    if (!u) return "";
    if (!/^[a-z]+:\/\//i.test(u)) u = "https://" + u;
    var x;
    try { x = new URL(u); } catch (e) { return ""; }
    if (x.username || x.password || x.search || x.hash) return "";
    if (x.protocol !== "https:" && !(x.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname))) return "";
    return (x.origin + x.pathname).replace(/\/+$/, "").replace(/\/index\.php$/, "");
  }
  function normConfig(c) {
    c = c && typeof c === "object" ? c : {};
    var kind = c.kind === "nextcloud" ? "nextcloud" : "gpodder";
    var dev = String(c.device || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
    var known = [];
    (Array.isArray(c.known) ? c.known : []).forEach(function (u) {
      var s = C.safeUrl(u);
      if (s && known.length < 2000 && known.indexOf(s) < 0) known.push(s);
    });
    return {
      kind: kind,
      server: normServer(c.server) || DEF_SERVER[kind],
      user: clean(c.user, 100),
      device: dev || "oros",
      subsTs: num(c.subsTs), actTs: num(c.actTs), mark: num(c.mark),
      known: known, last: num(c.last), err: clean(c.err, 40)
    };
  }
  function num(v) { v = +v; return isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function ready(cfg) { return !!(cfg && cfg.server && cfg.user); }
  function enc(s) { return encodeURIComponent(s); }
  function urls(cfg) {
    var b = cfg.server;
    if (cfg.kind === "nextcloud") {
      var a = b + "/index.php/apps/gpoddersync/";
      return {
        device: "",
        subsGet: function (since) { return a + "subscriptions?since=" + (since || 0); },
        subsPost: a + "subscription_change/create",
        actGet: function (since) { return a + "episode_action?since=" + (since || 0); },
        actPost: a + "episode_action/create"
      };
    }
    var u = enc(cfg.user), d = enc(cfg.device);
    return {
      device: b + "/api/2/devices/" + u + "/" + d + ".json",
      subsGet: function (since) { return b + "/api/2/subscriptions/" + u + "/" + d + ".json?since=" + (since || 0); },
      subsPost: b + "/api/2/subscriptions/" + u + "/" + d + ".json",
      actGet: function (since) { return b + "/api/2/episodes/" + u + ".json?since=" + (since || 0); },
      actPost: b + "/api/2/episodes/" + u + ".json"
    };
  }
  // "Basic …" for user:password, UTF-8 (btoa alone breaks on Greek).
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function b64(bytes) {
    var out = "", i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63];
    }
    var r = bytes.length - i;
    if (r === 1) { var a = bytes[i] << 16; out += B64[a >> 18 & 63] + B64[a >> 12 & 63] + "=="; }
    else if (r === 2) { var b = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64[b >> 18 & 63] + B64[b >> 12 & 63] + B64[b >> 6 & 63] + "="; }
    return out;
  }
  function utf8(s) {
    var out = [];
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      var c = s.codePointAt(i);
      if (c > 0xffff) i++;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
      else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return out;
  }
  function basicAuth(user, pass) { return "Basic " + b64(utf8(String(user) + ":" + String(pass))); }

  // ---------- 2. Wire formats ----------
  // gpodder timestamps: "2026-10-14T08:30:00" (UTC, no zone).
  function isoTime(ms) { return new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19); }
  function parseTime(s) {
    if (typeof s === "number") return s > 1e11 ? Math.floor(s) : Math.floor(s * 1000);
    s = clean(s, 40);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)?$/.test(s)) return 0;
    if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += "Z";
    var t = Date.parse(s);
    return isFinite(t) && t > 0 ? t : 0;
  }
  function urlList(a, max) {
    var out = [];
    (Array.isArray(a) ? a : []).forEach(function (u) {
      var s = C.safeUrl(typeof u === "string" ? u.trim() : "");
      if (s && out.length < (max || 5000)) out.push(s);
    });
    return out;
  }
  // { add, remove, timestamp } (both servers).
  function parseSubs(j) {
    if (!j || typeof j !== "object" || Array.isArray(j)) return null;
    return { add: urlList(j.add), remove: urlList(j.remove), ts: num(j.timestamp) };
  }
  var ACTIONS = { play: 1, download: 1, "delete": 1, "new": 1, flattr: 1 };
  function int0(v) { v = +v; return isFinite(v) && v >= 0 && v < 1e7 ? Math.floor(v) : -1; }
  function normAction(a) {
    if (!a || typeof a !== "object") return null;
    var pod = C.safeUrl(typeof a.podcast === "string" ? a.podcast.trim() : "");
    var ep = C.safeUrl(typeof a.episode === "string" ? a.episode.trim() : "");
    var act = String(a.action || "").toLowerCase();
    if (!pod || !ep || !ACTIONS[act]) return null;
    var o = { podcast: pod, episode: ep, guid: clean(a.guid, 500), action: act, t: parseTime(a.timestamp) };
    if (act === "play") {
      var p = int0(a.position);
      if (p < 0) return null;
      o.pos = p;
      var tot = int0(a.total), st = int0(a.started);
      o.total = tot > 0 ? tot : 0;
      o.started = st >= 0 ? st : 0;
    }
    return o;
  }
  // { actions: [...], timestamp } (gpodder.net and Nextcloud) or a bare
  // array (an exported file).
  function parseActions(j) {
    var list = Array.isArray(j) ? j : j && typeof j === "object" && Array.isArray(j.actions) ? j.actions : null;
    if (!list) return null;
    var out = [];
    list.forEach(function (a) { var x = normAction(a); if (x && out.length < 50000) out.push(x); });
    return { actions: out, ts: j && !Array.isArray(j) ? num(j.timestamp) : 0 };
  }

  // ---------- 3. Subscriptions plan ----------
  // local: the slice's shows; known: feed addresses after the last sync;
  // remote: parseSubs answer since then. Adding wins over a removal of
  // unknown order; a remote removal only touches a show both sides had.
  //   → { sub: [urls to subscribe here], unsub: [show ids to drop here],
  //       upAdd: [urls], upRemove: [urls], known: [urls after the sync] }
  function subsPlan(local, known, remote) {
    var L = {}, K = {}, RA = {}, RR = {};
    (local || []).forEach(function (s) { var k = C.feedKey(s.url); if (k) L[k] = s; });
    (known || []).forEach(function (u) { var k = C.feedKey(u); if (k) K[k] = u; });
    remote = remote || { add: [], remove: [] };
    remote.add.forEach(function (u) { var k = C.feedKey(u); if (k) RA[k] = u; });
    remote.remove.forEach(function (u) { var k = C.feedKey(u); if (k && !RA[k]) RR[k] = u; });
    var sub = [], unsub = [], upAdd = [], upRemove = [], after = {};
    Object.keys(L).forEach(function (k) { after[k] = L[k].url; });
    Object.keys(RA).forEach(function (k) { if (!L[k]) { sub.push(RA[k]); after[k] = RA[k]; } });
    Object.keys(RR).forEach(function (k) { if (L[k] && K[k]) { unsub.push(L[k].id); delete after[k]; } });
    // Added here since the last sync: sent (also over a remote removal).
    Object.keys(L).forEach(function (k) { if (!K[k] && !RA[k]) upAdd.push(L[k].url); });
    Object.keys(K).forEach(function (k) { if (!L[k] && !RA[k] && !RR[k]) upRemove.push(K[k]); });
    var keys = Object.keys(after).sort();
    return { sub: sub, unsub: unsub, upAdd: upAdd, upRemove: upRemove, known: keys.map(function (k) { return after[k]; }) };
  }

  // ---------- 4. Episode actions ----------
  // The newest action per episode (by time; equal times: the later in
  // the list), only "play" and "new" (download/delete are about files
  // on the other device).
  function newestActions(actions) {
    var by = {};
    (actions || []).forEach(function (a) {
      if (a.action !== "play" && a.action !== "new") return;
      var k = C.feedKey(a.podcast) + "|" + (a.guid || a.episode);
      if (!by[k] || a.t >= by[k].t) by[k] = a;
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }
  // The cached episode an action is about: same enclosure address, else
  // same guid (eps: the show's cached episodes [{id, guid?, audio, pub, dur}]).
  // A guid alone also names it: episode ids come from the guid.
  function matchEpisode(sid, a, eps) {
    var i, e;
    for (i = 0; i < (eps || []).length; i++) { e = eps[i]; if (e.audio && C.safeUrl(e.audio) === a.episode) return e; }
    if (a.guid) {
      var id = C.episodeId(sid, { guid: a.guid });
      for (i = 0; i < (eps || []).length; i++) { e = eps[i]; if (e.id === id || (e.guid && e.guid === a.guid)) return e; }
    }
    return null;
  }
  // Applies remote actions to the slice. Each one counts only when it is
  // newer than what this side knows (row m); the row takes the action's
  // own time (never later than now), so it is not sent back.
  //   find(a) → { id, s, pd, dur } | null.  → { data, n }
  function applyActions(data, actions, find, now) {
    var n = 0;
    newestActions(actions).forEach(function (a) {
      var ep = find(a);
      if (!ep) return;
      var row = null;
      for (var i = 0; i < data.eps.length; i++) if (data.eps[i].id === ep.id) { row = data.eps[i]; break; }
      var at = Math.min(a.t || 0, now);
      if (!at || (row && row.m >= at)) return;
      var next;
      if (a.action === "new") next = C.setProgress(data, ep, 0, ep.dur || 0, 0, at);
      else {
        var total = a.total || ep.dur || 0;
        var done = total > 0 && a.pos >= total * C.LIM.played;
        next = C.setProgress(data, ep, done ? 0 : a.pos, total, done ? 1 : 0, at);
      }
      if (next !== data) { data = next; n++; }
    });
    return { data: data, n: n };
  }
  // Rows changed after mark, as gpodder actions. info(epId) → { feed,
  // audio, guid } | null (episodes no longer in the cache are skipped).
  // skip: { epId: 1 } (a newer remote action already answered them).
  function actionsUp(data, info, mark, device, skip) {
    var out = [];
    (data.eps || []).forEach(function (e) {
      if (e.m <= (mark || 0) || (skip && skip[e.id])) return;
      var x = info(e.id);
      if (!x || !x.feed || !x.audio) return;
      var a = { podcast: x.feed, episode: x.audio, action: "play", timestamp: isoTime(e.m) };
      if (device) a.device = device;
      if (x.guid) a.guid = x.guid;
      if (e.x) {
        var d = e.d || x.dur || 0;
        if (!d) return;                     // "played" needs a length to say it
        a.started = 0; a.position = d; a.total = d;
      } else if (e.p > 0) {
        a.started = 0; a.position = e.p;
        if (e.d) a.total = e.d; else { delete a.started; }
      } else a.action = "new";
      out.push(a);
    });
    out.sort(function (p, q) { return p.timestamp < q.timestamp ? -1 : p.timestamp > q.timestamp ? 1 : 0; });
    return out;
  }
  function chunks(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size || CHUNK) out.push(list.slice(i, i + (size || CHUNK)));
    return out;
  }

  // ---------- 5. Network ----------
  function SyncError(code, status) { this.code = code; this.status = status || 0; }
  function request(cfg, pass, method, url, body) {
    if (root.navigator && root.navigator.onLine === false) return Promise.reject(new SyncError("offline"));
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 30000) : null;
    var init = { method: method, mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "Authorization": basicAuth(cfg.user, pass), "Accept": "application/json" } };
    if (ctl) init.signal = ctl.signal;
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch(url, init).then(function (r) {
      if (timer) clearTimeout(timer);
      if (r.status === 401 || r.status === 403) throw new SyncError("auth", r.status);
      if (r.status === 404) throw new SyncError("notfound", r.status);
      if (!r.ok) throw new SyncError("http", r.status);
      return r.text().then(function (t) {
        if (!t) return {};
        try { return JSON.parse(t); } catch (e) { throw new SyncError("bad"); }
      });
    }, function () {
      if (timer) clearTimeout(timer);
      // A fetch that never got an answer: a blocked CORS check looks the
      // same as a dead server from a page; "cors" is the likely one.
      throw new SyncError(ctl && ctl.signal.aborted ? "timeout" : "cors");
    });
  }

  // ---------- 6. Sealed password ----------
  var DB = "oros-podcasts-sync", dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var rq;
      try { rq = root.indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
      rq.onupgradeneeded = function () { if (!rq.result.objectStoreNames.contains("keys")) rq.result.createObjectStore("keys"); };
      rq.onsuccess = function () { var d = rq.result; d.onversionchange = function () { d.close(); dbp = null; }; resolve(d); };
      rq.onerror = rq.onblocked = function () { reject(rq.error || new Error("idb")); };
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function idb(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction("keys", mode), res;
        var r = fn(tx.objectStore("keys"));
        if (r) r.onsuccess = function () { res = r.result; };
        tx.oncomplete = function () { resolve(res); };
        tx.onerror = tx.onabort = function () { reject(tx.error); };
      });
    });
  }
  function deviceKey() {
    return idb("readonly", function (s) { return s.get("device"); }).then(function (k) {
      if (k) return k;
      return root.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]).then(function (nk) {
        return idb("readwrite", function (s) { s.put(nk, "device"); }).then(function () { return nk; });
      });
    });
  }
  function savePass(pass) {
    return deviceKey().then(function (key) {
      var iv = root.crypto.getRandomValues(new Uint8Array(12));
      return root.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(pass)).then(function (sealed) {
        return idb("readwrite", function (s) { s.put({ iv: iv.buffer, data: sealed }, "gpodder"); });
      });
    }).then(function () { return true; }, function () { return false; });
  }
  function loadPass() {
    return idb("readonly", function (s) { return s.get("gpodder"); }).then(function (rec) {
      if (!rec) return "";
      return deviceKey().then(function (key) {
        return root.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, key, rec.data);
      }).then(function (plain) { return new TextDecoder().decode(plain); });
    }).catch(function () { return ""; });
  }
  function dropPass() { return idb("readwrite", function (s) { s.delete("gpodder"); }).catch(function () {}); }

  var api = {
    CHUNK: CHUNK, normServer: normServer, normConfig: normConfig, ready: ready, urls: urls, basicAuth: basicAuth,
    isoTime: isoTime, parseTime: parseTime, parseSubs: parseSubs, normAction: normAction, parseActions: parseActions,
    subsPlan: subsPlan, newestActions: newestActions, matchEpisode: matchEpisode, applyActions: applyActions,
    actionsUp: actionsUp, chunks: chunks, SyncError: SyncError, request: request,
    savePass: savePass, loadPass: loadPass, dropPass: dropPass
  };
  root.OrosPodcastsGpodder = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
