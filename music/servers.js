// ============================================================
// orOS Music — servers.js (the user's own music servers, v1.0.0)
// Music from servers the user runs or rents, each with their own
// address and login:
//   subsonic  Subsonic / OpenSubsonic API (Navidrome, Airsonic,
//             Gonic, Ampache, LMS, …): salted token, never the
//             password itself when the server allows it.
//   jellyfin  Jellyfin API: signs in once, keeps only the access
//             token it gets back.
//   funkwhale Funkwhale API v1 (federated, open source): public
//             pods without a login, or an access token from
//             Settings › Applications.
//   webdav    WebDAV (Nextcloud, ownCloud, a NAS…): folders; needs
//             the server to allow requests from orOS (CORS).
//   dropbox   the Dropbox connection of the Files app (Files ›
//             Dropbox); folders, played through temporary links.
// Plus two kinds of public links that need no account:
//   playlist files (M3U / M3U8, PLS, XSPF) and music RSS feeds
//   (Podcasting 2.0 music feeds such as Wavlake, any RSS with audio
//   enclosures): their songs are "link" refs { s "ln", u https }.
//
// Device only: the list of servers ("oros-music-servers") and, sealed
// in IndexedDB "oros-music-srv" with a key that cannot leave this
// browser, the passwords and tokens. Nothing of it is synced. A song
// from a server travels in playlists and likes as
//   { k "sv:…", s "sv", sh (server id), ii (the server's item id),
//     ai? / ri? (album / artist id), ca? (cover id) }
// and plays on every device where the same server is connected (the
// server id is a hash of type + address + user).
// Server requests always go straight from the browser: never through
// the relay (they carry the user's login). Audio streams straight
// from the server too.
// Runs in the Music window (browse, connect) and in the shell (the
// player asks it where a song plays from: host.js loads it on first
// need). Pure parts run in Node: tests/music-servers.test.js.
//
// Sections:
//   1. Helpers, errors, MD5
//   2. Server list (device) + sealed secrets
//   3. Subsonic / OpenSubsonic
//   4. Jellyfin
//   5. Funkwhale
//   6. WebDAV
//   7. Dropbox (the Files connection)
//   8. Playlist files + music feeds
//   9. Network + drivers
//  10. Public API
// ============================================================
(function (root) {
  "use strict";

  var C = root.OrosMusicCore || (typeof require === "function" ? require("./core.js").OrosMusicCore : null);
  var LS_KEY = "oros-music-servers", DEV_KEY = "oros-music-devid", DB_NAME = "oros-music-srv";
  var MAX_SERVERS = 20, PAGE = 40;
  var CLIENT = "orOS";
  var TYPES = {
    subsonic: { name: "Subsonic / Navidrome", lib: true },
    jellyfin: { name: "Jellyfin", lib: true },
    funkwhale: { name: "Funkwhale", lib: true },
    webdav: { name: "WebDAV / Nextcloud", lib: false },
    dropbox: { name: "Dropbox", lib: false }
  };
  var AUDIO_RE = /\.(mp3|m4a|m4b|aac|mp4|ogg|oga|opus|flac|wav|wave|weba|webm)$/i;
  var LIST_RE = /\.(m3u8?|pls|xspf)$/i;

  // ---------- 1. Helpers, errors, MD5 ----------
  function SvError(code) { this.code = code; }
  SvError.prototype.toString = function () { return "SvError: " + this.code; };
  function str(v, max) { return C.clean(v == null ? "" : String(v), max || 200); }
  function idStr(v, max) {
    if (typeof v === "number" && isFinite(v)) v = String(v);
    // eslint-disable-next-line no-control-regex
    return typeof v === "string" && v.length > 0 && v.length <= (max || 1000) && !/[\u0000-\u001f\u007f]/.test(v) ? v : "";
  }
  function https(u) { return typeof u === "string" && /^https:\/\/[^\s"'<>]+$/i.test(u) && u.length <= 1000 ? u : ""; }
  function enc(v) { return encodeURIComponent(v); }
  function qs(o) {
    return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== null && o[k] !== ""; })
      .map(function (k) { return enc(k) + "=" + enc(o[k]); }).join("&");
  }
  function arr(v) { return Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []; }
  function utf8Bytes(s) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(s);
    var b = unescape(encodeURIComponent(s)), out = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  function hex(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16); return s; }
  function b64(s) {
    var b = utf8Bytes(s), bin = "";
    for (var i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
    return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  }
  function randHex(n) {
    var b = new Uint8Array(n);
    var cr = root.crypto;
    if (cr && typeof cr.getRandomValues === "function") cr.getRandomValues(b);
    else for (var i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    return hex(b);
  }
  // MD5, for the Subsonic token (md5(password + salt)); nothing else.
  var MD5_K = [], MD5_R = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (var mk = 0; mk < 64; mk++) MD5_K[mk] = Math.floor(Math.abs(Math.sin(mk + 1)) * 4294967296) | 0;
  function md5(s) {
    var b = utf8Bytes(String(s)), n = b.length, words = (((n + 8) >>> 6) + 1) * 16, W = new Array(words), i;
    for (i = 0; i < words; i++) W[i] = 0;
    for (i = 0; i < n; i++) W[i >> 2] |= b[i] << ((i % 4) * 8);
    W[n >> 2] |= 0x80 << ((n % 4) * 8);
    W[words - 2] = (n * 8) | 0;
    W[words - 1] = Math.floor(n / 0x20000000);
    var h = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476];
    for (var o = 0; o < words; o += 16) {
      var a = h[0], bb = h[1], c = h[2], d = h[3];
      for (var j = 0; j < 64; j++) {
        var f, g, r = j >> 4;
        if (r === 0) { f = (bb & c) | (~bb & d); g = j; }
        else if (r === 1) { f = (d & bb) | (~d & c); g = (5 * j + 1) % 16; }
        else if (r === 2) { f = bb ^ c ^ d; g = (3 * j + 5) % 16; }
        else { f = c ^ (bb | ~d); g = (7 * j) % 16; }
        var sh = MD5_R[r * 4 + (j % 4)], x = (a + f + MD5_K[j] + W[o + g]) | 0, tmp = d;
        d = c; c = bb;
        bb = (bb + ((x << sh) | (x >>> (32 - sh)))) | 0;
        a = tmp;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    }
    var out = "";
    h.forEach(function (v) { for (var k = 0; k < 4; k++) { var x = (v >>> (k * 8)) & 255; out += (x < 16 ? "0" : "") + x.toString(16); } });
    return out;
  }

  // ---------- 2. Server list (device) + sealed secrets ----------
  // An address as the user typed it → "https://host[:port][/path]"
  // with no trailing slash (and no "/rest", "/web/…" or "/api/v1"
  // the user may have copied with it). "" when it is not one.
  function normBase(type, u) {
    u = String(u || "").trim();
    if (!u) return "";
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = "https://" + u;
    var m = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)/i.exec(u);
    if (!m || /@/.test(m[2])) return "";
    var path = m[3].replace(/\/+$/, "");
    if (type === "subsonic") path = path.replace(/\/rest(\/[^/]*)?$/i, "");
    if (type === "jellyfin") path = path.replace(/\/web(\/.*)?$/i, "");
    if (type === "funkwhale") path = path.replace(/\/(api\/v1|library|about)(\/.*)?$/i, "");
    return m[1].toLowerCase() + "://" + m[2].toLowerCase() + path;
  }
  // The web version of orOS is https: browsers then block plain http
  // servers, except one on this computer.
  function allowedBase(b, pageProto) {
    if (/^https:\/\//.test(b)) return true;
    if (!/^http:\/\//.test(b)) return false;
    if (pageProto === "http:") return true;
    return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(b);
  }
  function serverId(type, base, user) {
    return C.hash(type + "|" + String(base || "").toLowerCase() + "|" + String(user || "").toLowerCase()).slice(0, 12);
  }
  var SH_RE = /^[0-9a-z]{6,14}$/;
  function normDir(d) {
    d = String(d || "").trim().replace(/\\/g, "/");
    if (!d || d === "/") return "/";
    if (d[0] !== "/") d = "/" + d;
    return d.replace(/\/+$/, "").replace(/\/{2,}/g, "/");
  }
  function normServer(o) {
    if (!o || typeof o !== "object" || !TYPES[o.ty] || !SH_RE.test(o.id)) return null;
    var b = o.ty === "dropbox" ? "" : normBase(o.ty, o.b);
    if (o.ty !== "dropbox" && !b) return null;
    var s = { id: o.id, ty: o.ty, n: str(o.n, 60) || TYPES[o.ty].name, b: b, us: str(o.us, 120), add: +o.add > 0 ? +o.add : 0 };
    if (o.ty === "webdav" || o.ty === "dropbox") s.dir = normDir(o.dir);
    if (o.ty === "jellyfin" && idStr(o.uid, 64)) s.uid = o.uid;
    return s;
  }
  function readList() {
    try {
      var a = JSON.parse(root.localStorage.getItem(LS_KEY) || "[]");
      return (Array.isArray(a) ? a : []).map(normServer).filter(Boolean).slice(0, MAX_SERVERS);
    } catch (e) { return []; }
  }
  function writeList(l) { try { root.localStorage.setItem(LS_KEY, JSON.stringify(l.slice(0, MAX_SERVERS))); } catch (e) {} }
  function deviceId() {
    var id = "";
    try { id = root.localStorage.getItem(DEV_KEY) || ""; } catch (e) {}
    if (!/^[0-9a-f]{16,40}$/.test(id)) { id = randHex(16); try { root.localStorage.setItem(DEV_KEY, id); } catch (e) {} }
    return id;
  }
  function idb(name, stores, store, mode, fn) {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = root.indexedDB.open(name, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () { var d = req.result; stores.forEach(function (s) { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); }); };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var d = req.result, res;
        var tx = d.transaction(store, mode);
        var r = fn(tx.objectStore(store));
        if (r) r.onsuccess = function () { res = r.result; };
        tx.oncomplete = function () { d.close(); resolve(res); };
        tx.onerror = tx.onabort = function () { d.close(); reject(tx.error); };
      };
    });
  }
  function sdb(store, mode, fn) { return idb(DB_NAME, ["keys", "creds"], store, mode, fn); }
  function sealKey(db) {
    return db("keys", "readonly", function (s) { return s.get("device"); }).then(function (k) {
      if (k) return k;
      return root.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]).then(function (nk) {
        return db("keys", "readwrite", function (s) { s.put(nk, "device"); }).then(function () { return nk; });
      });
    });
  }
  function seal(db, id, obj) {
    return sealKey(db).then(function (key) {
      var iv = root.crypto.getRandomValues(new Uint8Array(12));
      return root.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, utf8Bytes(JSON.stringify(obj)))
        .then(function (data) { return db("creds", "readwrite", function (s) { s.put({ iv: iv.buffer, data: data }, id); }); });
    });
  }
  function unseal(db, id) {
    return db("creds", "readonly", function (s) { return s.get(id); }).then(function (rec) {
      if (!rec) return null;
      return sealKey(db).then(function (key) {
        return root.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, key, rec.data);
      }).then(function (plain) {
        try { var j = JSON.parse(new TextDecoder().decode(plain)); return j && typeof j === "object" ? j : null; } catch (e) { return null; }
      });
    });
  }
  var secrets = {};          // id -> secret object, once unsealed
  function secretOf(id) {
    if (secrets[id] !== undefined) return Promise.resolve(secrets[id]);
    if (!root.indexedDB || !root.crypto || !root.crypto.subtle) return Promise.resolve(null);
    return unseal(sdb, id).catch(function () { return null; }).then(function (s) { secrets[id] = s || null; return secrets[id]; });
  }

  // ---------- 3. Subsonic / OpenSubsonic ----------
  // sec: { t, s } (token + salt) | { p: "enc:…" } (servers that do not
  // take tokens, e.g. LDAP logins).
  function ssAuth(user, sec) {
    var o = { u: user, v: "1.16.1", c: CLIENT, f: "json" };
    if (sec && sec.t && sec.s) { o.t = sec.t; o.s = sec.s; }
    else if (sec && sec.p) o.p = sec.p;
    return o;
  }
  function ssUrl(srv, sec, method, params) {
    return srv.b + "/rest/" + method + "?" + qs(Object.assign(ssAuth(srv.us, sec), params || {}));
  }
  function ssToken(pw, salt) { return { t: md5(String(pw) + salt), s: salt }; }
  function ssCheck(j) {
    var r = j && j["subsonic-response"];
    if (!r || typeof r !== "object") throw new SvError("format");
    if (r.status === "ok") return r;
    var c = r.error && +r.error.code;
    throw new SvError(c === 40 ? "auth" : c === 41 ? "token" : c === 50 ? "perm" : c === 20 || c === 30 ? "version" : c === 70 ? "notfound" : "http");
  }
  function key(sh, ii) { return "sv:" + C.hash(sh + "|" + ii); }
  function ssSong(sh, s) {
    var id = idStr(s && s.id, 200);
    if (!id || s.isDir === true || s.isVideo === true) return null;
    var r = { k: key(sh, id), s: "sv", sh: sh, ii: id, t: str(s.title) || "?", a: str(s.artist || s.displayArtist) };
    if (str(s.album)) r.al = str(s.album);
    if (+s.duration > 0) r.d = Math.round(+s.duration);
    if (idStr(s.albumId, 200)) r.ai = String(s.albumId);
    if (idStr(s.artistId, 200)) r.ri = String(s.artistId);
    if (idStr(s.coverArt, 200)) r.ca = String(s.coverArt);
    var o = C.normRef(r);
    if (o && +s.track > 0) o.n = +s.track;
    return o;
  }
  function ssAlbum(a) {
    var id = idStr(a && a.id, 200);
    if (!id) return null;
    return { id: id, n: str(a.name || a.album || a.title) || "?", a: str(a.artist || a.displayArtist), ri: idStr(a.artistId, 200) ? String(a.artistId) : "",
      ca: idStr(a.coverArt, 200) ? String(a.coverArt) : "", y: +a.year > 0 ? +a.year : 0, c: +a.songCount > 0 ? +a.songCount : 0 };
  }
  function ssArtist(a) {
    var id = idStr(a && a.id, 200);
    return id ? { id: id, n: str(a.name) || "?", ca: idStr(a.coverArt, 200) ? String(a.coverArt) : "", c: +a.albumCount || 0 } : null;
  }
  function ssParseAlbums(j) {
    var r = ssCheck(j), l = arr(r.albumList2 && r.albumList2.album).map(ssAlbum).filter(Boolean);
    return { list: l, more: l.length >= PAGE };
  }
  function ssParseAlbum(j, sh) {
    var a = ssCheck(j).album || {};
    return { album: ssAlbum(a), tracks: arr(a.song).map(function (s) { return ssSong(sh, s); }).filter(Boolean) };
  }
  function ssParseArtists(j) {
    var r = ssCheck(j), out = [];
    arr(r.artists && r.artists.index).forEach(function (ix) { arr(ix.artist).forEach(function (a) { var x = ssArtist(a); if (x) out.push(x); }); });
    return { list: out, more: false };
  }
  function ssParseArtist(j) {
    var a = ssCheck(j).artist || {};
    return { artist: ssArtist(a), albums: arr(a.album).map(ssAlbum).filter(Boolean), tracks: [] };
  }
  function ssParseSearch(j, sh) {
    var r = ssCheck(j).searchResult3 || {};
    return { songs: arr(r.song).map(function (s) { return ssSong(sh, s); }).filter(Boolean),
      albums: arr(r.album).map(ssAlbum).filter(Boolean), artists: arr(r.artist).map(ssArtist).filter(Boolean) };
  }
  function ssParsePlaylists(j) {
    var r = ssCheck(j);
    return { list: arr(r.playlists && r.playlists.playlist).map(function (p) {
      var id = idStr(p && p.id, 200);
      return id ? { id: id, n: str(p.name) || "?", c: +p.songCount || 0, ca: idStr(p.coverArt, 200) ? String(p.coverArt) : "" } : null;
    }).filter(Boolean), more: false };
  }
  function ssParsePlaylist(j, sh) {
    var p = ssCheck(j).playlist || {};
    return { pl: { id: String(p.id || ""), n: str(p.name) || "?" }, tracks: arr(p.entry).map(function (s) { return ssSong(sh, s); }).filter(Boolean) };
  }
  function ssParseSongs(j, sh) {
    var r = ssCheck(j), box = r.randomSongs || r.songsByGenre || r.topSongs || {};
    return { list: arr(box.song).map(function (s) { return ssSong(sh, s); }).filter(Boolean), more: false };
  }

  // ---------- 4. Jellyfin ----------
  function jfAuthHeader(dev, token) {
    return 'MediaBrowser Client="' + CLIENT + '", Device="Browser", DeviceId="' + dev + '", Version="1.0"' + (token ? ', Token="' + token + '"' : "");
  }
  function jfUrl(srv, path, params) { return srv.b + path + (params ? "?" + qs(params) : ""); }
  var JF_FIELDS = "PrimaryImageAspectRatio,ChildCount,ProductionYear,AlbumArtist,ParentIndexNumber";
  function jfTicks(v) { return +v > 0 ? Math.round(+v / 1e7) : 0; }
  function jfSong(sh, it) {
    var id = idStr(it && it.Id, 64);
    if (!id || (it.Type && it.Type !== "Audio") || (it.MediaType && it.MediaType !== "Audio")) return null;
    var ar = arr(it.ArtistItems)[0] || arr(it.AlbumArtists)[0] || {};
    var r = { k: key(sh, id), s: "sv", sh: sh, ii: id, t: str(it.Name) || "?", a: str(arr(it.Artists)[0] || it.AlbumArtist || ar.Name) };
    if (str(it.Album)) r.al = str(it.Album);
    if (jfTicks(it.RunTimeTicks)) r.d = jfTicks(it.RunTimeTicks);
    if (idStr(it.AlbumId, 64)) r.ai = it.AlbumId;
    if (idStr(ar.Id, 64)) r.ri = ar.Id;
    if (it.AlbumId && it.AlbumPrimaryImageTag) r.ca = it.AlbumId;
    else if (it.ImageTags && it.ImageTags.Primary) r.ca = id;
    var o = C.normRef(r);
    if (o && +it.IndexNumber > 0) o.n = +it.IndexNumber;
    return o;
  }
  function jfAlbum(it) {
    var id = idStr(it && it.Id, 64);
    if (!id) return null;
    var ar = arr(it.AlbumArtists)[0] || {};
    return { id: id, n: str(it.Name) || "?", a: str(it.AlbumArtist || ar.Name), ri: idStr(ar.Id, 64) || "",
      ca: it.ImageTags && it.ImageTags.Primary ? id : "", y: +it.ProductionYear || 0, c: +it.ChildCount || 0 };
  }
  function jfArtist(it) {
    var id = idStr(it && it.Id, 64);
    return id ? { id: id, n: str(it.Name) || "?", ca: it.ImageTags && it.ImageTags.Primary ? id : "", c: +it.AlbumCount || 0 } : null;
  }
  function jfItems(j) { return arr(j && j.Items); }
  function jfMore(j, start, got) { return !!j && +j.TotalRecordCount > start + got; }

  // ---------- 5. Funkwhale ----------
  function fwUrl(srv, path, params) { return srv.b + "/api/v1/" + path + (params ? "?" + qs(params) : ""); }
  function fwArtistOf(x) {
    var cr = arr(x && x.artist_credit);
    if (cr.length) {
      return { n: str(cr.map(function (c) { return (c.credit || (c.artist && c.artist.name) || "") + (c.joinphrase || ""); }).join("")),
        id: cr[0].artist && cr[0].artist.id != null ? String(cr[0].artist.id) : "" };
    }
    var a = x && x.artist;
    return { n: str(a && a.name), id: a && a.id != null ? String(a.id) : "" };
  }
  function fwCover(x) {
    var c = x && (x.cover || x.attachment_cover);
    var u = c && c.urls ? (c.urls.medium_square_crop || c.urls.large_square_crop || c.urls.original) : "";
    return idStr(u, 500) && /^(https?:\/\/|\/)/.test(u) ? u : "";
  }
  function fwListenId(tr) {
    var m = /\/listen\/([0-9a-f-]{8,64})\/?/i.exec(String((tr && tr.listen_url) || ""));
    return m ? m[1] : idStr(tr && tr.uuid, 64);
  }
  function fwSong(sh, tr) {
    var id = fwListenId(tr);
    if (!id) return null;
    var ar = fwArtistOf(tr), al = tr.album || {}, up = arr(tr.uploads)[0] || {};
    var r = { k: key(sh, id), s: "sv", sh: sh, ii: id, t: str(tr.title) || "?", a: ar.n || fwArtistOf(al).n };
    if (str(al.title)) r.al = str(al.title);
    if (+up.duration > 0) r.d = Math.round(+up.duration);
    if (al.id != null && idStr(String(al.id), 64)) r.ai = String(al.id);
    if (ar.id) r.ri = ar.id;
    var cv = fwCover(tr) || fwCover(al);
    if (cv) r.ca = cv;
    var o = C.normRef(r);
    if (o && +tr.position > 0) o.n = +tr.position;
    return o;
  }
  function fwAlbum(x) {
    if (!x || x.id == null) return null;
    var ar = fwArtistOf(x);
    return { id: String(x.id), n: str(x.title) || "?", a: ar.n, ri: ar.id, ca: fwCover(x),
      y: +(String(x.release_date || "").slice(0, 4)) || 0, c: +x.tracks_count || 0 };
  }
  function fwArtist(x) {
    return x && x.id != null ? { id: String(x.id), n: str(x.name) || "?", ca: fwCover(x), c: arr(x.albums).length || +x.albums_count || 0 } : null;
  }
  function fwPage(j, map) { return { list: arr(j && j.results).map(map).filter(Boolean), more: !!(j && j.next) }; }

  // ---------- 6. WebDAV ----------
  var PROPFIND = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/>' +
    "<d:getcontentlength/><d:getcontenttype/><d:getlastmodified/></d:prop></d:propfind>";
  function xmlText(s) {
    return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, function (m, e) {
      var l = e.toLowerCase();
      if (l === "lt") return "<"; if (l === "gt") return ">"; if (l === "quot") return '"'; if (l === "apos") return "'"; if (l === "amp") return "&";
      var n = l[1] === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }).trim();
  }
  // The first <prefix:name>…</prefix:name> inside s, any prefix.
  function tag(s, name) {
    var m = new RegExp("<(?:[A-Za-z0-9_-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?" + name + ">", "i").exec(s);
    return m ? m[1] : "";
  }
  function hasTag(s, name) { return new RegExp("<(?:[A-Za-z0-9_-]+:)?" + name + "[\\s/>]", "i").test(s); }
  function pathOf(u) { var m = /^https?:\/\/[^/]+(\/[^?#]*)?/i.exec(u); return (m && m[1]) || "/"; }
  function decPath(p) { try { return decodeURIComponent(p); } catch (e) { return p; } }
  function encPath(p) { return String(p).split("/").map(function (x) { return enc(x); }).join("/"); }
  // A 207 Multi-Status answer → the folders and files in dir.
  function davParse(xml, base, dir) {
    var rootPath = decPath(pathOf(base + "/")).replace(/\/+$/, "");
    var here = normDir(dir);
    var dirs = [], files = [];
    String(xml || "").split(/<(?:[A-Za-z0-9_-]+:)?response[\s>]/i).slice(1).forEach(function (blk) {
      var href = xmlText(tag(blk, "href"));
      if (!href) return;
      var p = decPath(pathOf(/^https?:/i.test(href) ? href : "https://x" + (href[0] === "/" ? "" : "/") + href));
      if (p.indexOf(rootPath) !== 0) return;
      var rel = normDir(p.slice(rootPath.length));
      if (rel === here) return;                          // the folder itself
      var name = xmlText(tag(blk, "displayname")) || rel.split("/").pop();
      if (hasTag(tag(blk, "resourcetype"), "collection")) dirs.push({ p: rel, n: name });
      else files.push({ p: rel, n: name, sz: +xmlText(tag(blk, "getcontentlength")) || 0, ty: xmlText(tag(blk, "getcontenttype")).toLowerCase() });
    });
    var coll = C.collator ? C.collator("en") : null;
    var byName = function (a, b) { return coll ? coll.compare(a.n, b.n) : (a.n < b.n ? -1 : a.n > b.n ? 1 : 0); };
    return { dirs: dirs.sort(byName), files: files.sort(byName) };
  }
  function fileSong(sh, p, name) {
    var nm = C.fromName(name || p.split("/").pop());
    var o = C.normRef({ k: key(sh, p), s: "sv", sh: sh, ii: p, t: nm.t || name || "?", a: nm.a || "" });
    if (o && nm.n) o.n = nm.n;
    return o;
  }
  function davFolder(sh, parsed) {
    return { dirs: parsed.dirs, lists: parsed.files.filter(function (f) { return LIST_RE.test(f.n); }),
      songs: parsed.files.filter(function (f) { return !LIST_RE.test(f.n) && (AUDIO_RE.test(f.n) || /^audio\//.test(f.ty)); }).map(function (f) { return fileSong(sh, f.p, f.n); }).filter(Boolean) };
  }

  // ---------- 7. Dropbox (the Files connection) ----------
  // Files keeps its Dropbox login sealed in "oros-files-dbx" (see
  // files/dropbox.js); Music only reads it, and writes it back when
  // it refreshes an expired access token.
  var DBX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token", DBX_RPC = "https://api.dropboxapi.com/2/";
  function fdb(store, mode, fn) { return idb("oros-files-dbx", ["keys", "creds"], store, mode, fn); }
  var dbxRefreshing = null;
  function dbxToken(force) {
    if (!root.indexedDB || !root.crypto || !root.crypto.subtle) return Promise.reject(new SvError("dropbox"));
    return unseal(fdb, "dropbox").catch(function () { return null; }).then(function (r) {
      if (!r || typeof r.access !== "string" || !r.access) throw new SvError("dropbox");
      if (!force && +r.exp > Date.now()) return r.access;
      if (!r.refresh) throw new SvError("dropbox");
      if (dbxRefreshing) return dbxRefreshing;
      dbxRefreshing = root.fetch(DBX_TOKEN_URL, {
        method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: qs({ grant_type: "refresh_token", refresh_token: r.refresh, client_id: r.key })
      }).then(function (res) {
        if (res.status === 400 || res.status === 401) throw new SvError("dropbox");
        if (!res.ok) throw new SvError("http");
        return res.json();
      }, function () { throw new SvError("net"); }).then(function (j) {
        if (!j || typeof j.access_token !== "string") throw new SvError("dropbox");
        var life = Math.max(60, (+j.expires_in || 14400) - 300);
        var rec = Object.assign({}, r, { access: j.access_token, exp: Date.now() + life * 1000 });
        if (typeof j.refresh_token === "string" && j.refresh_token) rec.refresh = j.refresh_token;
        return seal(fdb, "dropbox", rec).then(function () { return rec.access; });
      });
      var clear = function () { dbxRefreshing = null; };
      dbxRefreshing.then(clear, clear);
      return dbxRefreshing;
    });
  }
  function dbxCall(endpoint, args, retried) {
    return dbxToken(!!retried).then(function (at) {
      return req(DBX_RPC + endpoint, { method: "POST", headers: { Authorization: "Bearer " + at, "Content-Type": "application/json" }, body: JSON.stringify(args), raw: true });
    }).then(function (res) {
      if (res.status === 401 && !retried) return dbxCall(endpoint, args, true);
      if (res.status === 401) throw new SvError("dropbox");
      if (res.status === 409) throw new SvError("notfound");
      if (res.status === 429) throw new SvError("busy");
      if (!res.ok) throw new SvError("http");
      return res.json();
    });
  }
  function dbxParse(sh, entries) {
    var dirs = [], files = [];
    arr(entries).forEach(function (e) {
      if (!e || typeof e.name !== "string") return;
      if (e[".tag"] === "folder") dirs.push({ p: e.path_display || e.path_lower, n: e.name });
      else if (e[".tag"] === "file") files.push({ p: e.path_display || e.path_lower, n: e.name, sz: +e.size || 0, ty: "" });
    });
    return davFolder(sh, { dirs: dirs.sort(function (a, b) { return a.n.localeCompare(b.n); }), files: files.sort(function (a, b) { return a.n.localeCompare(b.n); }) });
  }

  // ---------- 8. Playlist files + music feeds ----------
  function absUrl(u, base) {
    u = String(u || "").trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (!base) return "";
    try { return new URL(u, base).href; } catch (e) { return ""; }
  }
  function linkRef(e) {
    var u = https(e.u);
    if (!u) return null;
    var r = { k: "ln:" + C.hash(u), s: "ln", u: u, t: str(e.t) || decPath(u.split(/[?#]/)[0].split("/").pop()).replace(/\.[a-z0-9]{2,5}$/i, "") || "?", a: str(e.a) };
    if (str(e.al)) r.al = str(e.al);
    if (+e.d > 0) r.d = Math.round(+e.d);
    if (https(e.art)) r.art = e.art;
    if (https(e.pg)) r.pg = e.pg;
    return C.normRef(r);
  }
  // text of an .m3u/.m3u8/.pls/.xspf → { title, entries: [{ u?, path?, t, a, al, d, art }] }
  function parsePlaylist(text, name, baseUrl) {
    text = String(text || "").replace(/^﻿/, "");
    var out = { title: "", entries: [] };
    var add = function (loc, meta) {
      loc = String(loc || "").trim();
      if (!loc) return;
      var e = Object.assign({ t: "", a: "", al: "", d: 0, art: "" }, meta || {});
      if (/^file:\/\//i.test(loc)) e.path = decPath(loc.replace(/^file:\/\/(localhost)?/i, ""));
      else if (/^https?:\/\//i.test(loc) || baseUrl) { var u = absUrl(loc, baseUrl); if (u) e.u = u; else e.path = loc; }
      else e.path = loc.replace(/\\/g, "/");
      if (out.entries.length < 5000) out.entries.push(e);
    };
    var head = text.slice(0, 400).trim();
    if (/<playlist[\s>]/i.test(head) || /\.xspf$/i.test(name || "")) {
      out.title = xmlText(tag(text.split(/<trackList/i)[0], "title"));
      text.split(/<track[\s>]/i).slice(1).forEach(function (blk) {
        blk = blk.split(/<\/track>/i)[0];
        add(xmlText(tag(blk, "location")), { t: xmlText(tag(blk, "title")), a: xmlText(tag(blk, "creator")), al: xmlText(tag(blk, "album")),
          d: (+xmlText(tag(blk, "duration")) || 0) / 1000, art: xmlText(tag(blk, "image")) });
      });
      return out;
    }
    if (/^\[playlist\]/i.test(head) || /\.pls$/i.test(name || "")) {
      var f = {}, ti = {}, le = {};
      text.split(/\r?\n/).forEach(function (line) {
        var m = /^\s*(File|Title|Length)(\d+)\s*=\s*(.*)$/i.exec(line);
        if (!m) return;
        var kk = m[1].toLowerCase();
        (kk === "file" ? f : kk === "title" ? ti : le)[+m[2]] = m[3].trim();
      });
      Object.keys(f).map(Number).sort(function (a, b) { return a - b; }).forEach(function (i) {
        add(f[i], { t: ti[i] || "", d: +le[i] > 0 ? +le[i] : 0 });
      });
      return out;
    }
    var meta = null;
    text.split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var m = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)?[^,]*,(.*)$/i.exec(line);
      if (m) {
        var d = +m[1] > 0 ? +m[1] : 0, ta = m[2].trim(), parts = ta.split(/\s+[-–—]\s+/);
        meta = parts.length >= 2 ? { a: parts[0], t: parts.slice(1).join(" - "), d: d } : { t: ta, d: d };
        return;
      }
      var pm = /^#PLAYLIST:\s*(.+)$/i.exec(line);
      if (pm) { out.title = pm[1].trim(); return; }
      var am = /^#EXTALB:\s*(.+)$/i.exec(line);
      if (am) { meta = Object.assign(meta || {}, { al: am[1].trim() }); return; }
      if (line[0] === "#") return;
      add(line, meta);
      meta = null;
    });
    return out;
  }
  // A feed parsed by ../feeds/core.js (parseFeed) → its songs.
  function feedSongs(feed) {
    if (!feed || !Array.isArray(feed.items)) return [];
    return feed.items.map(function (it) {
      if (!it || !it.enc || !/^audio\//.test(it.enc.type || "audio/")) return null;
      return linkRef({ u: it.enc.url, t: it.title, a: it.author || feed.title, al: it.author ? feed.title : "", art: it.img || feed.icon, pg: it.link });
    }).filter(Boolean);
  }

  // ---------- 9. Network + drivers ----------
  function req(url, o) {
    o = o || {};
    if (root.navigator && root.navigator.onLine === false) return Promise.reject(new SvError("offline"));
    if (typeof root.fetch !== "function") return Promise.reject(new SvError("net"));
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var tm = ctl ? setTimeout(function () { ctl.abort(); }, o.timeout || 20000) : 0;
    return root.fetch(url, { method: o.method || "GET", headers: o.headers || {}, body: o.body, mode: "cors", credentials: "omit",
      referrerPolicy: "no-referrer", cache: "no-store", signal: ctl ? ctl.signal : undefined }).then(function (r) {
      clearTimeout(tm);
      if (o.raw) return r;
      if (r.status === 401 || r.status === 403) throw new SvError("auth");
      if (r.status === 404) throw new SvError("notfound");
      if (r.status === 429) throw new SvError("busy");
      if (!r.ok) throw new SvError("http");
      return r;
    }, function (e) { clearTimeout(tm); throw new SvError(e && e.name === "AbortError" ? "timeout" : "net"); });
  }
  function json(url, o) {
    return req(url, o).then(function (r) { return r.json().then(null, function () { throw new SvError("format"); }); });
  }
  function jfHead(sec) { return { Authorization: jfAuthHeader(deviceId(), sec && sec.tok), Accept: "application/json" }; }
  function fwHead(sec) { return sec && sec.tok ? { Authorization: "Bearer " + sec.tok, Accept: "application/json" } : { Accept: "application/json" }; }
  function davHead(sec) { return sec && sec.au ? { Authorization: "Basic " + sec.au } : {}; }
  function davUrl(srv, p) { return srv.b + encPath(p === "/" ? "/" : p); }

  var DRV = {
    subsonic: {
      connect: function (srv, f) {
        var tok = ssToken(f.pw, randHex(6));
        var ping = function (sec) { return json(ssUrl(srv, sec, "ping")).then(function (j) { ssCheck(j); return sec; }); };
        return ping(tok).then(null, function (e) {
          if (e && e.code === "token") return ping({ p: "enc:" + hex(utf8Bytes(f.pw)) });
          throw e;
        });
      },
      albums: function (srv, sec, page) { return json(ssUrl(srv, sec, "getAlbumList2", { type: "newest", size: PAGE, offset: (page - 1) * PAGE })).then(ssParseAlbums); },
      album: function (srv, sec, id) { return json(ssUrl(srv, sec, "getAlbum", { id: id })).then(function (j) { return ssParseAlbum(j, srv.id); }); },
      artists: function (srv, sec) { return json(ssUrl(srv, sec, "getArtists")).then(ssParseArtists); },
      artist: function (srv, sec, id) { return json(ssUrl(srv, sec, "getArtist", { id: id })).then(ssParseArtist); },
      playlists: function (srv, sec) { return json(ssUrl(srv, sec, "getPlaylists")).then(ssParsePlaylists); },
      playlist: function (srv, sec, id) { return json(ssUrl(srv, sec, "getPlaylist", { id: id })).then(function (j) { return ssParsePlaylist(j, srv.id); }); },
      search: function (srv, sec, q) { return json(ssUrl(srv, sec, "search3", { query: q, songCount: 30, albumCount: 20, artistCount: 20 })).then(function (j) { return ssParseSearch(j, srv.id); }); },
      random: function (srv, sec) { return json(ssUrl(srv, sec, "getRandomSongs", { size: 50 })).then(function (j) { return ssParseSongs(j, srv.id); }); },
      source: function (srv, sec, item) { return Promise.resolve(ssUrl(srv, sec, "stream", { id: item.ii })); },
      cover: function (srv, sec, ca) { return ssUrl(srv, sec, "getCoverArt", { id: ca, size: 300 }); }
    },
    jellyfin: {
      connect: function (srv, f) {
        return json(jfUrl(srv, "/Users/AuthenticateByName"), { method: "POST", headers: Object.assign(jfHead(null), { "Content-Type": "application/json" }),
          body: JSON.stringify({ Username: f.us, Pw: f.pw }) }).then(function (j) {
          if (!j || typeof j.AccessToken !== "string" || !j.User || !idStr(j.User.Id, 64)) throw new SvError("auth");
          srv.uid = j.User.Id;
          return { tok: j.AccessToken };
        });
      },
      albums: function (srv, sec, page) {
        var start = (page - 1) * PAGE;
        return json(jfUrl(srv, "/Items", { UserId: srv.uid, IncludeItemTypes: "MusicAlbum", Recursive: "true", SortBy: "DateCreated,SortName",
          SortOrder: "Descending", Fields: JF_FIELDS, Limit: PAGE, StartIndex: start }), { headers: jfHead(sec) })
          .then(function (j) { var l = jfItems(j).map(jfAlbum).filter(Boolean); return { list: l, more: jfMore(j, start, l.length) }; });
      },
      album: function (srv, sec, id) {
        return Promise.all([
          json(jfUrl(srv, "/Items", { UserId: srv.uid, Ids: id, Fields: JF_FIELDS }), { headers: jfHead(sec) }),
          json(jfUrl(srv, "/Items", { UserId: srv.uid, ParentId: id, IncludeItemTypes: "Audio", Recursive: "true", SortBy: "ParentIndexNumber,IndexNumber,SortName", Fields: JF_FIELDS }), { headers: jfHead(sec) })
        ]).then(function (r) { return { album: jfAlbum(jfItems(r[0])[0]), tracks: jfItems(r[1]).map(function (it) { return jfSong(srv.id, it); }).filter(Boolean) }; });
      },
      artists: function (srv, sec, page) {
        var start = (page - 1) * 100;
        return json(jfUrl(srv, "/Artists/AlbumArtists", { UserId: srv.uid, SortBy: "SortName", Limit: 100, StartIndex: start }), { headers: jfHead(sec) })
          .then(function (j) { var l = jfItems(j).map(jfArtist).filter(Boolean); return { list: l, more: jfMore(j, start, l.length) }; });
      },
      artist: function (srv, sec, id) {
        return json(jfUrl(srv, "/Items", { UserId: srv.uid, AlbumArtistIds: id, IncludeItemTypes: "MusicAlbum", Recursive: "true", SortBy: "ProductionYear,SortName",
          SortOrder: "Descending", Fields: JF_FIELDS }), { headers: jfHead(sec) }).then(function (j) { return { artist: null, albums: jfItems(j).map(jfAlbum).filter(Boolean), tracks: [] }; });
      },
      playlists: function (srv, sec) {
        return json(jfUrl(srv, "/Items", { UserId: srv.uid, IncludeItemTypes: "Playlist", Recursive: "true", SortBy: "SortName", Fields: "ChildCount" }), { headers: jfHead(sec) })
          .then(function (j) {
            return { list: jfItems(j).filter(function (it) { return !it.MediaType || it.MediaType === "Audio"; }).map(function (it) {
              return idStr(it.Id, 64) ? { id: it.Id, n: str(it.Name) || "?", c: +it.ChildCount || 0, ca: it.ImageTags && it.ImageTags.Primary ? it.Id : "" } : null;
            }).filter(Boolean), more: false };
          });
      },
      playlist: function (srv, sec, id) {
        return json(jfUrl(srv, "/Playlists/" + enc(id) + "/Items", { UserId: srv.uid, Fields: JF_FIELDS }), { headers: jfHead(sec) })
          .then(function (j) { return { pl: { id: id, n: "" }, tracks: jfItems(j).map(function (it) { return jfSong(srv.id, it); }).filter(Boolean) }; });
      },
      search: function (srv, sec, q) {
        var get = function (type, lim) {
          return json(jfUrl(srv, "/Items", { UserId: srv.uid, searchTerm: q, IncludeItemTypes: type, Recursive: "true", Limit: lim, Fields: JF_FIELDS }), { headers: jfHead(sec) }).then(jfItems);
        };
        return Promise.all([get("Audio", 30), get("MusicAlbum", 20), get("MusicArtist", 20)]).then(function (r) {
          return { songs: r[0].map(function (it) { return jfSong(srv.id, it); }).filter(Boolean), albums: r[1].map(jfAlbum).filter(Boolean), artists: r[2].map(jfArtist).filter(Boolean) };
        });
      },
      random: function (srv, sec) {
        return json(jfUrl(srv, "/Items", { UserId: srv.uid, IncludeItemTypes: "Audio", Recursive: "true", SortBy: "Random", Limit: 50, Fields: JF_FIELDS }), { headers: jfHead(sec) })
          .then(function (j) { return { list: jfItems(j).map(function (it) { return jfSong(srv.id, it); }).filter(Boolean), more: false }; });
      },
      // The audio element cannot send headers: the token goes in the
      // address, to the user's own server only.
      source: function (srv, sec, item) {
        return Promise.resolve(jfUrl(srv, "/Audio/" + enc(item.ii) + "/universal", { UserId: srv.uid, DeviceId: deviceId(), api_key: sec && sec.tok,
          MaxStreamingBitrate: 320000, Container: "mp3,aac,m4a|aac,m4b|aac,flac,ogg,opus,webma,webm|webma,wav", TranscodingContainer: "mp3",
          TranscodingProtocol: "http", AudioCodec: "mp3" }));
      },
      cover: function (srv, sec, ca) { return jfUrl(srv, "/Items/" + enc(ca) + "/Images/Primary", { fillWidth: 300, fillHeight: 300, quality: 90 }); }
    },
    funkwhale: {
      connect: function (srv, f) {
        var sec = f.tok ? { tok: String(f.tok).trim() } : {};
        return json(fwUrl(srv, "albums/", { page_size: 1 }), { headers: fwHead(sec) }).then(function (j) {
          if (!j || !Array.isArray(j.results)) throw new SvError("format");
          return sec;
        });
      },
      albums: function (srv, sec, page) { return json(fwUrl(srv, "albums/", { ordering: "-creation_date", playable: "true", page: page, page_size: PAGE }), { headers: fwHead(sec) }).then(function (j) { return fwPage(j, fwAlbum); }); },
      album: function (srv, sec, id) {
        return Promise.all([
          json(fwUrl(srv, "albums/" + enc(id) + "/"), { headers: fwHead(sec) }),
          json(fwUrl(srv, "tracks/", { album: id, ordering: "disc_number,position", playable: "true", page_size: 100 }), { headers: fwHead(sec) })
        ]).then(function (r) { return { album: fwAlbum(r[0]), tracks: arr(r[1] && r[1].results).map(function (x) { return fwSong(srv.id, x); }).filter(Boolean) }; });
      },
      artists: function (srv, sec, page) { return json(fwUrl(srv, "artists/", { ordering: "name", has_albums: "true", playable: "true", page: page, page_size: 50 }), { headers: fwHead(sec) }).then(function (j) { return fwPage(j, fwArtist); }); },
      artist: function (srv, sec, id) {
        return Promise.all([
          json(fwUrl(srv, "artists/" + enc(id) + "/"), { headers: fwHead(sec) }),
          json(fwUrl(srv, "albums/", { artist: id, ordering: "-release_date", playable: "true", page_size: 50 }), { headers: fwHead(sec) })
        ]).then(function (r) { return { artist: fwArtist(r[0]), albums: fwPage(r[1], fwAlbum).list, tracks: [] }; });
      },
      playlists: function (srv, sec) {
        return json(fwUrl(srv, "playlists/", sec && sec.tok ? { scope: "me", page_size: 50 } : { ordering: "-modification_date", page_size: 30 }), { headers: fwHead(sec) })
          .then(function (j) { return fwPage(j, function (p) { return p && p.id != null ? { id: String(p.id), n: str(p.name) || "?", c: +p.tracks_count || 0, ca: "" } : null; }); });
      },
      playlist: function (srv, sec, id) {
        return json(fwUrl(srv, "playlists/" + enc(id) + "/tracks/", { page_size: 100 }), { headers: fwHead(sec) })
          .then(function (j) { return { pl: { id: id, n: "" }, tracks: arr(j && j.results).map(function (x) { return fwSong(srv.id, x && x.track ? x.track : x); }).filter(Boolean) }; });
      },
      search: function (srv, sec, q) {
        return json(fwUrl(srv, "search", { query: q }), { headers: fwHead(sec) }).then(function (j) {
          return { songs: arr(j && j.tracks).map(function (x) { return fwSong(srv.id, x); }).filter(Boolean),
            albums: arr(j && j.albums).map(fwAlbum).filter(Boolean), artists: arr(j && j.artists).map(fwArtist).filter(Boolean) };
        });
      },
      random: function (srv, sec) { return json(fwUrl(srv, "tracks/", { ordering: "random", playable: "true", page_size: 50 }), { headers: fwHead(sec) }).then(function (j) { return fwPage(j, function (x) { return fwSong(srv.id, x); }); }); },
      source: function (srv, sec, item) { return Promise.resolve(srv.b + "/api/v1/listen/" + enc(item.ii) + "/" + (sec && sec.tok ? "?" + qs({ token: sec.tok }) : "")); },
      cover: function (srv, sec, ca) { return /^https?:\/\//i.test(ca) ? ca : srv.b + ca; }
    },
    webdav: {
      connect: function (srv, f) {
        var sec = { au: b64(f.us + ":" + f.pw) };
        return req(davUrl(srv, srv.dir || "/"), { method: "PROPFIND", headers: Object.assign({ Depth: "0", "Content-Type": "application/xml; charset=utf-8" }, davHead(sec)), body: PROPFIND })
          .then(function (r) { if (r.status !== 207) throw new SvError("format"); return sec; });
      },
      folder: function (srv, sec, dir) {
        return req(davUrl(srv, dir), { method: "PROPFIND", headers: Object.assign({ Depth: "1", "Content-Type": "application/xml; charset=utf-8" }, davHead(sec)), body: PROPFIND })
          .then(function (r) { if (r.status !== 207) throw new SvError("format"); return r.text(); })
          .then(function (xml) { return davFolder(srv.id, davParse(xml, srv.b, dir)); });
      },
      // WebDAV wants the login in a header: the song is downloaded
      // (straight from the server) and plays from memory.
      source: function (srv, sec, item) {
        return req(davUrl(srv, item.ii), { headers: davHead(sec), timeout: 300000 }).then(function (r) { return r.blob(); });
      },
      text: function (srv, sec, p) { return req(davUrl(srv, p), { headers: davHead(sec) }).then(function (r) { return r.text(); }); }
    },
    dropbox: {
      connect: function (srv) { return dbxCall("files/list_folder", { path: srv.dir === "/" ? "" : srv.dir, limit: 1 }).then(function () { return {}; }); },
      folder: function (srv, sec, dir) {
        var all = [];
        var page = function (j, n) {
          all = all.concat(arr(j && j.entries));
          if (j && j.has_more && j.cursor && n < 10) return dbxCall("files/list_folder/continue", { cursor: j.cursor }).then(function (k) { return page(k, n + 1); });
          return dbxParse(srv.id, all);
        };
        return dbxCall("files/list_folder", { path: dir === "/" ? "" : dir, limit: 2000 }).then(function (j) { return page(j, 0); });
      },
      source: function (srv, sec, item) {
        return dbxCall("files/get_temporary_link", { path: item.ii }).then(function (j) { if (!j || !https(j.link)) throw new SvError("http"); return j.link; });
      },
      text: function (srv, sec, p) {
        return dbxCall("files/get_temporary_link", { path: p }).then(function (j) { return req(j.link); }).then(function (r) { return r.text(); });
      }
    }
  };

  // ---------- 10. Public API ----------
  var list = null;
  function servers() { if (!list) list = readList(); return list.slice(); }
  function get(id) { return servers().filter(function (s) { return s.id === id; })[0] || null; }
  function has(id) { return !!get(id); }
  function reload() { list = null; secrets = {}; }
  function withSec(id, fn) {
    var srv = get(id);
    if (!srv) return Promise.reject(new SvError("gone"));
    return secretOf(id).then(function (sec) {
      if (srv.ty !== "dropbox" && srv.ty !== "funkwhale" && !sec) throw new SvError("auth");
      return fn(srv, sec || {}, DRV[srv.ty]);
    });
  }
  // form: { ty, n, b, us, pw, tok, dir } → Promise<server>. Tests the
  // login first; keeps only what the server needs to play (see each
  // driver's connect), sealed.
  function connect(form, pageProto) {
    var ty = form && form.ty;
    if (!TYPES[ty]) return Promise.reject(new SvError("type"));
    var b = ty === "dropbox" ? "" : normBase(ty, form.b);
    if (ty !== "dropbox" && !b) return Promise.reject(new SvError("address"));
    if (ty !== "dropbox" && !allowedBase(b, pageProto || (root.location && root.location.protocol))) return Promise.reject(new SvError("http-only"));
    var us = str(form.us, 120);
    if ((ty === "subsonic" || ty === "jellyfin" || ty === "webdav") && (!us || !form.pw)) return Promise.reject(new SvError("login"));
    var dir = normDir(form.dir);
    var srv = { id: serverId(ty, ty === "dropbox" ? "dropbox" + dir.toLowerCase() : b, us), ty: ty, n: str(form.n, 60) || TYPES[ty].name, b: b, us: us, add: Date.now() };
    if (ty === "webdav" || ty === "dropbox") srv.dir = dir;
    return DRV[ty].connect(srv, { us: us, pw: String(form.pw || ""), tok: form.tok }).then(function (sec) {
      var save = function () {
        var l = servers().filter(function (s) { return s.id !== srv.id; });
        l.push(normServer(srv));
        list = l;
        writeList(l);
        secrets[srv.id] = sec;
        return srv;
      };
      if (!sec || !Object.keys(sec).length) { secrets[srv.id] = null; return save(); }
      return seal(sdb, srv.id, sec).then(save, function () { throw new SvError("seal"); });
    });
  }
  function remove(id) {
    list = servers().filter(function (s) { return s.id !== id; });
    writeList(list);
    delete secrets[id];
    if (!root.indexedDB) return Promise.resolve();
    return sdb("creds", "readwrite", function (s) { s.delete(id); }).catch(function () {});
  }
  function rename(id, n) {
    n = str(n, 60);
    if (!n) return;
    list = servers().map(function (s) { return s.id === id ? Object.assign({}, s, { n: n }) : s; });
    writeList(list);
  }
  // Unseal every secret once, so covers can be built at once.
  function ready() { return Promise.all(servers().map(function (s) { return secretOf(s.id); })).then(function () { return servers(); }); }
  function call(id, what, a1) {
    return withSec(id, function (srv, sec, d) {
      if (typeof d[what] !== "function") throw new SvError("unsupported");
      return d[what](srv, sec, a1 === undefined ? 1 : a1);
    });
  }
  // Where a song plays from: an address, or a Blob (WebDAV).
  function source(item) {
    if (!item || item.s !== "sv") return Promise.reject(new SvError("nosrc"));
    return withSec(item.sh, function (srv, sec, d) { return d.source(srv, sec, item); });
  }
  // A cover address, when the secret is unsealed already ("" else).
  function coverUrl(r) {
    if (!r || r.s !== "sv" || !r.ca) return "";
    var srv = get(r.sh);
    if (!srv || !DRV[srv.ty].cover || (srv.ty === "subsonic" && !secrets[srv.id])) return "";
    return DRV[srv.ty].cover(srv, secrets[srv.id] || {}, r.ca);
  }
  function albumCover(sid, ca) { return ca ? coverUrl({ s: "sv", sh: sid, ca: ca }) : ""; }
  // A playlist file kept on a WebDAV or Dropbox server.
  function fileText(id, p) { return call(id, "text", p); }

  // Another window (the Music app, the shell, another tab) changed the
  // list: read it again.
  try {
    if (typeof root.addEventListener === "function") root.addEventListener("storage", function (e) { if (!e || e.key === LS_KEY || e.key === null) reload(); });
  } catch (e) {}

  var api = {
    VERSION: "1.0.0", TYPES: TYPES, PAGE: PAGE, SvError: SvError,
    md5: md5, b64: b64, normBase: normBase, allowedBase: allowedBase, serverId: serverId, normServer: normServer, normDir: normDir,
    ssToken: ssToken, ssUrl: ssUrl, ssCheck: ssCheck, ssSong: ssSong, ssParseAlbums: ssParseAlbums, ssParseAlbum: ssParseAlbum,
    ssParseArtists: ssParseArtists, ssParseArtist: ssParseArtist, ssParseSearch: ssParseSearch, ssParsePlaylists: ssParsePlaylists,
    ssParsePlaylist: ssParsePlaylist, ssParseSongs: ssParseSongs,
    jfAuthHeader: jfAuthHeader, jfSong: jfSong, jfAlbum: jfAlbum, jfArtist: jfArtist,
    fwSong: fwSong, fwAlbum: fwAlbum, fwArtist: fwArtist, fwArtistOf: fwArtistOf,
    davParse: davParse, davFolder: davFolder, fileSong: fileSong, dbxParse: dbxParse, encPath: encPath,
    parsePlaylist: parsePlaylist, linkRef: linkRef, feedSongs: feedSongs, absUrl: absUrl, AUDIO_RE: AUDIO_RE, LIST_RE: LIST_RE,
    drivers: DRV,
    servers: servers, get: get, has: has, reload: reload, ready: ready, connect: connect, remove: remove, rename: rename,
    call: call, source: source, coverUrl: coverUrl, albumCover: albumCover, fileText: fileText
  };
  root.OrosMusicServers = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
