// ============================================================
// orOS Studio — Nextcloud / WebDAV publishing (v1.0.0, wave P4 of
// "Publish as podcast"). Puts the show's site into a folder on the
// person's own WebDAV server (Nextcloud, ownCloud or any other) with
// their own account; the folder's public link (Nextcloud 29 or newer)
// is where podcast apps read it. Loaded by podcastui.js
// (window.StudioDavPub) and the tests.
//
// Rules (Bible STUDIO-POD P4):
// - The app password stays on this device (localStorage), never in
//   sync, a file, a log or an error text. Only "Authorization: Basic"
//   carries it.
// - Most servers send no CORS headers. With the person's switch on,
//   each request goes through the orOS relay's /dav pass-through
//   (relay/dav.js, at most 95 MB a request): nothing is stored there,
//   the audio only passes through. No relay change was needed.
// - Nothing is deleted: files are only added or replaced, so episodes
//   another device published stay online.
// - feed.xml is written on the version that was read (If-Match its
//   ETag, or If-None-Match: * when there was none): a feed another
//   device wrote meanwhile is never overwritten (dav-moved).
// - A file whose bytes and the server's ETag are the ones this device
//   sent last time is not sent again (episodes are large).
// ============================================================
(function (root) {
  "use strict";

  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev/dav";   // = sync.js DAV_RELAY
  var RELAY_MAX = 95 * 1024 * 1024;                                   // relay/dav.js DAV_LIMITS.putBytes
  var PATH_RE = /^[A-Za-z0-9._-]{1,80}(\/[A-Za-z0-9._-]{1,80}){0,3}$/;
  var TOKEN_RE = /^[A-Za-z0-9]{6,64}$/;
  var PROPFIND = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop>' +
    "<d:resourcetype/><d:getetag/><d:getcontentlength/></d:prop></d:propfind>";

  function fail(code, status) { var e = new Error(code); e.code = code; e.status = status || 0; return e; }

  // the WebDAV address of the show's folder: https, no user, query or fragment
  function normFolder(s) {
    var u;
    try { u = new URL(String(s || "").trim()); } catch (e) { return ""; }
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return "";
    if (u.username || u.password || u.search || u.hash) return "";
    var path = u.pathname.replace(/\/+$/, "");
    if (path.split("/").some(function (x) { return x === ".." || x === "."; })) return "";
    return u.origin + path;
  }
  // a Nextcloud public link of the folder → where its files are served
  // https://host[/sub][/index.php]/s/TOKEN → https://host[/sub]/public.php/dav/files/TOKEN/
  function parseShare(s) {
    var u;
    try { u = new URL(String(s || "").trim()); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.username || u.password) return null;
    var m = /^(.*?)(?:\/index\.php)?\/s\/([^\/]+)\/?$/.exec(u.pathname) || /^(.*?)\/public\.php\/dav\/files\/([^\/]+)\/?$/.exec(u.pathname);
    if (!m || !TOKEN_RE.test(m[2]) || /\/\.\.?(\/|$)/.test(m[1])) return null;
    return { token: m[2], base: u.origin + m[1] + "/public.php/dav/files/" + m[2] + "/" };
  }

  function etagOf(v) { return String(v || "").replace(/^W\//, "").replace(/^"|"$/g, ""); }
  function unent(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }
  // a 207 multistatus → [{ name (last part, decoded), dir, etag }]; the first is the folder itself
  function listing(xml) {
    var out = [], re = /<(?:[A-Za-z0-9_-]+:)?response[\s>][\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?response>/g, m;
    while ((m = re.exec(String(xml || "")))) {
      var r = m[0];
      var href = /<(?:[A-Za-z0-9_-]+:)?href>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?href>/.exec(r);
      if (!href) continue;
      var path = unent(href[1].trim()).replace(/^https?:\/\/[^\/]+/, "").replace(/\/+$/, "");
      var name = path.split("/").pop();
      try { name = decodeURIComponent(name); } catch (e) { /* keep it */ }
      var et = /<(?:[A-Za-z0-9_-]+:)?getetag>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?getetag>/.exec(r);
      out.push({ name: name, dir: /<(?:[A-Za-z0-9_-]+:)?collection\s*\/?>/.test(r), etag: et ? etagOf(unent(et[1].trim())) : "" });
    }
    return out;
  }

  // deps: { fetch, conf: { url, user, relay }, pass, sha1(Uint8Array) → Promise<hex> | hex,
  //         bytes(data) → Promise<Uint8Array> }
  function client(deps) {
    var conf = deps.conf || {}, base = normFolder(conf.url);
    var auth = "Basic " + b64(String(conf.user || "") + ":" + String(deps.pass || ""));
    function enc(rel) { return rel ? "/" + rel.split("/").map(encodeURIComponent).join("/") : ""; }
    function call(method, rel, opts) {
      opts = opts || {};
      var target = base + enc(rel) + (opts.dir ? "/" : "");
      var h = { "Authorization": auth };
      Object.keys(opts.headers || {}).forEach(function (k) { h[k] = opts.headers[k]; });
      if (conf.relay) h["X-Oros-Target"] = target;
      var init = { method: method, headers: h, credentials: "omit", cache: "no-store" };
      if (opts.body !== undefined) init.body = opts.body;
      return Promise.resolve().then(function () { return deps.fetch(conf.relay ? (deps.relayUrl || RELAY) : target, init); }).then(function (r) {
        var head = function (k) { return r.headers && r.headers.get ? r.headers.get(k) : null; };
        if (conf.relay) {
          if (head("X-Oros-Status")) throw fail("dav-url");
          var code = head("X-Oros-Error");
          if (code === "too-big" || code === "length") throw fail("dav-big");
          if (code === "bad-target" || code === "port") throw fail("dav-target");
          if (code) throw fail("dav-net");
        }
        return r.text().then(function (txt) { return { status: r.status, text: txt, etag: etagOf(head("OC-ETag") || head("ETag")) }; });
      }, function () { throw fail(conf.relay ? "dav-net" : "dav-cors"); });
    }
    function must(res, what) {
      if (res.status >= 200 && res.status < 300) return res;
      if (res.status === 401) throw fail("dav-auth", 401);
      if (res.status === 403) throw fail("dav-perm", 403);
      if (res.status === 404 && what === "folder") throw fail("dav-folder", 404);
      if (res.status === 412) throw fail("dav-moved", 412);
      if (res.status === 413) throw fail("dav-big", 413);
      if (res.status === 507) throw fail("dav-full", 507);
      throw fail("dav-http", res.status);
    }
    return { base: base, call: call, must: must };
  }
  function b64(s) {
    var bytes = new TextEncoder().encode(s), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  }

  // files: [{ path, data }] (data: Uint8Array or Blob), relative to the folder
  // opts: { sent: { path: { h, e } } (what this device sent last time), feedEtag ("" = no feed was there),
  //         onStep(step, i, n) }
  // → Promise<{ changed, sent }>
  function publish(deps, files, opts) {
    opts = opts || {};
    var c = client(deps), sent = {}, old = opts.sent && typeof opts.sent === "object" ? opts.sent : {};
    var step = function (k, i, n) { if (opts.onStep) try { opts.onStep(k, i || 0, n || 0); } catch (e) { /* the UI only */ } };
    if (!c.base) return Promise.reject(fail("dav-url"));
    if (files.some(function (f) { return !PATH_RE.test(f.path) || /(^|\/)\.\.?(\/|$)/.test(f.path); })) return Promise.reject(fail("dav-name"));
    var size = function (d) { return d && typeof d.size === "number" ? d.size : d.length; };
    if (deps.conf.relay && files.some(function (f) { return size(f.data) > RELAY_MAX; })) return Promise.reject(fail("dav-big"));
    var dirs = [];
    files.forEach(function (f) { var i = f.path.lastIndexOf("/"); if (i > 0 && dirs.indexOf(f.path.slice(0, i)) < 0) dirs.push(f.path.slice(0, i)); });
    var tags = {};   // path → the server's ETag now
    function look(dir) {
      return c.call("PROPFIND", dir, { dir: true, headers: { "Depth": "1", "Content-Type": "application/xml; charset=utf-8" }, body: PROPFIND }).then(function (res) {
        if (res.status === 404 && dir) return null;
        c.must(res, "folder");
        if (res.status !== 207) throw fail("dav-notdav");
        listing(res.text).slice(1).forEach(function (x) { if (!x.dir) tags[(dir ? dir + "/" : "") + x.name] = x.etag; });
        return true;
      });
    }
    var changed = 0, i = 0;
    step("folder");
    return look("").then(function () {
      return dirs.reduce(function (pr, d) {
        return pr.then(function () { return look(d); }).then(function (there) {
          if (there) return;
          return c.call("MKCOL", d, { dir: true }).then(function (res) { if (res.status !== 405) c.must(res); });
        });
      }, Promise.resolve());
    }).then(function () {
      // the feed last, so a site is never online with a feed naming files not there yet
      var order = files.filter(function (f) { return f.path !== "feed.xml"; }).concat(files.filter(function (f) { return f.path === "feed.xml"; }));
      return order.reduce(function (pr, f) {
        return pr.then(function () {
          step("file", ++i, order.length);
          return Promise.resolve(deps.bytes(f.data)).then(function (bytes) {
            return Promise.resolve(deps.sha1(bytes)).then(function (h) {
              var was = old[f.path], now = tags[f.path];
              if (was && was.h === h && now && was.e === now) { sent[f.path] = was; return; }
              var hd = { "Content-Type": "application/octet-stream" };
              if (f.path === "feed.xml") {
                if (opts.feedEtag) hd["If-Match"] = '"' + opts.feedEtag + '"';
                else hd["If-None-Match"] = "*";
              }
              return c.call("PUT", f.path, { headers: hd, body: f.data }).then(function (res) {
                c.must(res);
                changed++;
                sent[f.path] = { h: h, e: res.etag || "" };
              });
            });
          });
        });
      }, Promise.resolve());
    }).then(function () {
      // the ETags the server gave the files sent (not every server answers a PUT with one)
      var need = Object.keys(sent).filter(function (p) { return !sent[p].e; });
      if (!need.length) return;
      tags = {};
      var ds = [""].concat(dirs);
      return ds.reduce(function (pr, d) { return pr.then(function () { return look(d); }); }, Promise.resolve()).then(function () {
        need.forEach(function (p) { sent[p].e = tags[p] || ""; });
      }, function () { /* next time they are sent again; nothing lost */ });
    }).then(function () { return { changed: changed, sent: sent }; });
  }

  // the published feed, read through WebDAV (fresh, no cache) → { text, etag }; text "" when there is none
  function readFeed(deps) {
    var c = client(deps);
    if (!c.base) return Promise.reject(fail("dav-url"));
    return c.call("GET", "feed.xml").then(function (res) {
      if (res.status === 404) return { text: "", etag: "" };
      c.must(res, "folder");
      return { text: res.text, etag: res.etag };
    });
  }

  var api = {
    RELAY: RELAY, RELAY_MAX: RELAY_MAX,
    normFolder: normFolder, parseShare: parseShare, listing: listing, etagOf: etagOf,
    publish: publish, readFeed: readFeed
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioDavPub = api;
})(typeof window !== "undefined" ? window : this);
