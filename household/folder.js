// ============================================================
// orOS Household — folder.js (a household in a shared WebDAV or
// Nextcloud folder instead of the orOS relay; BR-HH wave 7g; no DOM)
// The engine (household/engine.js) talks to a household box with the
// relay's routes (relay/house.js). For a household whose entry has a
// `dav` folder, this file answers the same routes from files in that
// folder, so the engine's sync, join, approval and key rotation work
// unchanged. Everything in the folder is what the relay would hold:
// ciphertext and random ids (the household key never leaves the
// members' devices). The folder's own sign-in decides who may write;
// a removed member who still has it can delete files but cannot read
// what is written after the key rotation.
//   <folder>/oros-hh-<box>/meta.json   { v: 1, epoch } (key epoch)
//                        d/<k>.<rev>   a document (the highest rev
//                                      counts; a new rev is created with
//                                      If-None-Match: *, so two writers
//                                      of one rev cannot both win, then
//                                      the old one is deleted)
//                        i/<ih>.json   { exp, n } an open invite
//                        j/<rid>       { ih, at, b } a join request
//                        a/<rid>       { st: 1, b } accepted | { st: 2 }
//                        e/<mid>       a key envelope (bytes)
// No WebSocket and no wakes: a folder household is read when orOS
// opens, comes to the front, goes online, and every 10 minutes.
//   make({ fetch, relay }) → {
//     request(conf, method, box, path, o) → Promise of a Response with
//                       the relay's status, JSON and X-Rev header
//                       (o: { json, bytes, rev, invite, epoch, now })
//     probe(conf)    → Promise of "" (usable) or an error code
//   }
//   conf = { url (https, the folder), user, pass, relay (bool: through
//            the orOS relay's WebDAV pass-through, for servers without
//            CORS) }
//   clean(conf)      → conf or null
// Exposes window.OrosHouseFolder and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var DAV_RELAY = "https://oros-mail-relay.koulaxizis.workers.dev/dav";   // = sync.js
  var REQ_MS = 7 * 86400000, INVITE_USES = 20, PENDING = 10, DOCS = 64;
  var KEY_RE = /^[A-Za-z0-9_-]{1,32}$/, ID_RE = /^[A-Za-z0-9_-]{22}$/, HEX64_RE = /^[0-9a-f]{64}$/;
  var PROPFIND = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop>' +
    "<d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>";

  function str(x, max) { return typeof x === "string" && x.length <= max ? x : ""; }
  function clean(c) {
    if (!c || typeof c !== "object") return null;
    var url = str(c.url, 400).replace(/\/+$/, "");
    var u;
    try { u = new URL(url); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return null;
    return { url: url, user: str(c.user, 200), pass: str(c.pass, 400), relay: c.relay === true };
  }

  var TE = typeof TextEncoder === "function" ? new TextEncoder() : null;
  var TD = typeof TextDecoder === "function" ? new TextDecoder() : null;
  function b64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function sha256hex(s) { return root.crypto.subtle.digest("SHA-256", TE.encode(s)).then(hex); }
  function randId() {
    var b = root.crypto.getRandomValues(new Uint8Array(16));
    return b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function answer(status, obj, rev) {
    var h = { "Content-Type": "application/json" };
    if (rev !== undefined) h["X-Rev"] = String(rev);
    return new Response(JSON.stringify(obj), { status: status, headers: h });
  }
  function ok(data) { return answer(200, { ok: true, data: data }); }
  function err(status, code, extra) {
    var e = { code: code };
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return answer(status, { ok: false, error: e });
  }
  function bin(bytes, rev) {
    var h = { "Content-Type": "application/octet-stream" };
    if (rev !== undefined) h["X-Rev"] = String(rev);
    return new Response(bytes, { status: 200, headers: h });
  }

  // ---- multistatus (no DOMParser: tolerant of any prefix) ----
  function xmlText(s) {
    return String(s || "").replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, function (m, e) {
      var l = e.toLowerCase();
      if (l === "lt") return "<"; if (l === "gt") return ">"; if (l === "quot") return '"';
      if (l === "apos") return "'"; if (l === "amp") return "&";
      var n = l.charAt(1) === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }).trim();
  }
  function tag(s, name) {
    var m = new RegExp("<(?:[A-Za-z0-9_-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?" + name + ">", "i").exec(s);
    return m ? m[1] : "";
  }
  function names(xml) {
    var out = [], re = /<(?:[A-Za-z0-9_-]+:)?response[\s>][\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?response>/gi, m;
    while ((m = re.exec(xml))) {
      var href = xmlText(tag(m[0], "href")), p = href;
      var u = /^https?:\/\/[^/]+(\/[^?#]*)?/i.exec(href);
      if (u) p = u[1] || "/";
      try { p = decodeURIComponent(p); } catch (e) {}
      var dir = /\/$/.test(p) || /<(?:[A-Za-z0-9_-]+:)?collection[\s/>]/i.test(tag(m[0], "resourcetype"));
      var name = p.replace(/\/+$/, "").split("/").pop();
      var mod = Date.parse(xmlText(tag(m[0], "getlastmodified")));
      out.push({ name: name, dir: dir, size: parseInt(xmlText(tag(m[0], "getcontentlength")), 10) || 0, at: isFinite(mod) ? mod : 0 });
    }
    return out;
  }

  function make(o) {
    o = o || {};
    var fetchFn = o.fetch;
    var relayUrl = o.relay || DAV_RELAY;

    function dav(conf, method, rel, x) {
      x = x || {};
      var url = conf.url + rel, h = {};
      Object.keys(x.headers || {}).forEach(function (k) { h[k] = x.headers[k]; });
      if (conf.user || conf.pass) h.Authorization = "Basic " + b64(TE.encode(conf.user + ":" + conf.pass));
      var init = { method: method, headers: h, cache: "no-store" };
      if (x.body !== undefined) init.body = x.body;
      if (!conf.relay) return fetchFn(url, init);
      h["X-Oros-Target"] = url;
      return fetchFn(relayUrl, init).then(function (res) {
        var e = res.headers.get("X-Oros-Error");
        if (e) throw fail("dav-relay-" + e);
        return res;
      });
    }
    function fail(code) { var e = new Error(code); e.code = code; return e; }
    function davFail(res) {
      if (res.status === 401 || res.status === 403) throw fail("dav-auth");
      throw fail("dav-" + res.status);
    }
    function list(conf, rel) {
      return dav(conf, "PROPFIND", rel + "/", { headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" }, body: PROPFIND })
        .then(function (res) {
          if (res.status === 404) return null;
          if (res.status !== 207 && !res.ok) davFail(res);
          return res.text().then(function (xml) {
            var self = rel.split("/").pop();
            return names(xml).filter(function (n) { return n.name && n.name !== self; });
          });
        });
    }
    function getBytes(conf, rel) {
      return dav(conf, "GET", rel).then(function (res) {
        if (res.status === 404) return null;
        if (!res.ok) davFail(res);
        return res.arrayBuffer().then(function (b) { return new Uint8Array(b); });
      });
    }
    function getJson(conf, rel) {
      return getBytes(conf, rel).then(function (b) {
        if (!b) return null;
        try { return JSON.parse(TD.decode(b)); } catch (e) { return null; }
      });
    }
    // PUT; `only` = "new" (If-None-Match: *) → false when it exists.
    function put(conf, rel, body, only) {
      var h = { "Content-Type": "application/octet-stream" };
      if (only === "new") h["If-None-Match"] = "*";
      return dav(conf, "PUT", rel, { headers: h, body: body }).then(function (res) {
        if (res.status === 412) return false;
        if (!res.ok) davFail(res);
        return true;
      });
    }
    function putJson(conf, rel, obj, only) { return put(conf, rel, TE.encode(JSON.stringify(obj)), only); }
    function del(conf, rel) {
      return dav(conf, "DELETE", rel).then(function (res) {
        if (!res.ok && res.status !== 404) davFail(res);
        return res.ok;
      });
    }
    function mkcol(conf, rel) {
      return dav(conf, "MKCOL", rel).then(function (res) {
        if (res.ok || res.status === 405) return true;
        davFail(res);
      });
    }

    function docRevs(files) {
      var revs = {}, stale = [];
      (files || []).forEach(function (f) {
        var m = /^([A-Za-z0-9_-]{1,32})\.([1-9]\d{0,11})$/.exec(f.name);
        if (f.dir || !m) return;
        var k = m[1], r = +m[2];
        if (revs[k] === undefined) revs[k] = r;
        else { stale.push(k + "." + Math.min(revs[k], r)); revs[k] = Math.max(revs[k], r); }
      });
      return { revs: revs, stale: stale };
    }

    function request(confIn, method, box, path, x) {
      x = x || {};
      var conf = clean(confIn);
      if (!conf || !ID_RE.test(box || "")) return Promise.resolve(err(404, "gone"));
      var B = "/oros-hh-" + box, now = x.now || Date.now();
      var mm = /^(?:\/(d|i|j|a|r|e|p|rot|ws)(?:\/([A-Za-z0-9_-]{1,64}))?)?$/.exec(path || "");
      if (!mm) return Promise.resolve(err(404, "bad-request"));
      var part = mm[1] || "", arg = mm[2] || "";
      var meta = function () { return getJson(conf, B + "/meta.json"); };
      var withMeta = function (fn) {
        return meta().then(function (m) { return m && m.v === 1 && m.epoch >= 1 ? fn(m) : err(404, "gone"); });
      };

      // create
      if (!part && method === "POST") {
        return mkcol(conf, B).then(function () {
          return Promise.all(["d", "i", "j", "a", "e"].map(function (s) { return mkcol(conf, B + "/" + s); }));
        }).then(function () {
          return putJson(conf, B + "/meta.json", { v: 1, epoch: 1 }, "new");
        }).then(function (made) { return made ? ok({ epoch: 1 }) : err(409, "exists"); });
      }
      // what changed
      if (!part && method === "GET") {
        return withMeta(function (m) {
          if (x.epoch && m.epoch > x.epoch) return ok({ moved: true, epoch: m.epoch });
          return Promise.all([list(conf, B + "/d"), list(conf, B + "/j"), list(conf, B + "/a")]).then(function (r) {
            var d = docRevs(r[0]), size = 0, answered = {};
            (r[0] || []).forEach(function (f) { if (!f.dir) size += f.size; });
            (r[2] || []).forEach(function (f) { answered[f.name] = 1; });
            var reqs = (r[1] || []).filter(function (f) {
              return !f.dir && ID_RE.test(f.name) && !answered[f.name] && (!f.at || now - f.at < REQ_MS);
            }).sort(function (a, b) { return a.at - b.at; }).map(function (f) { return f.name; });
            // left behind by a writer that stopped between its two steps
            d.stale.forEach(function (n) { del(conf, B + "/d/" + n).catch(function () {}); });
            return ok({ epoch: m.epoch, revs: d.revs, size: size, reqs: reqs.slice(0, PENDING), last: now });
          });
        });
      }
      if (!part && method === "DELETE") {
        return dav(conf, "DELETE", B + "/").then(function (res) {
          if (!res.ok && res.status !== 404) davFail(res);
          return ok({ ok: true });
        });
      }
      if (part === "d" && KEY_RE.test(arg)) {
        return list(conf, B + "/d").then(function (files) {
          if (files === null) return err(404, "gone");
          var have = docRevs(files.filter(function (f) { return f.name.indexOf(arg + ".") === 0; })).revs[arg] || 0;
          if (method === "GET") {
            if (!have) return err(404, "none");
            return getBytes(conf, B + "/d/" + arg + "." + have).then(function (b) { return b ? bin(b, have) : err(404, "none"); });
          }
          var want = +(x.rev || 0);
          if (want !== have) return err(412, "stale", { rev: have });
          if (method === "DELETE") {
            if (!have) return ok({ rev: 0 });
            return del(conf, B + "/d/" + arg + "." + have).then(function () { return ok({ rev: 0 }); });
          }
          if (method !== "PUT") return err(404, "bad-request");
          if (!have && Object.keys(docRevs(files).revs).length >= DOCS) return err(413, "full");
          return put(conf, B + "/d/" + arg + "." + (have + 1), x.bytes, "new").then(function (made) {
            if (!made) return err(412, "stale", { rev: have + 1 });
            var next = have + 1;
            return (have ? del(conf, B + "/d/" + arg + "." + have).catch(function () {}) : Promise.resolve()).then(function () {
              return ok({ rev: next });
            });
          });
        });
      }
      if (part === "i") {
        if (method === "POST" && !arg) {
          var b = x.json || {};
          if (!HEX64_RE.test(b.ih || "") || !(b.exp > now) || !(b.n >= 1 && b.n <= INVITE_USES)) return Promise.resolve(err(400, "bad-request"));
          return withMeta(function () {
            return putJson(conf, B + "/i/" + b.ih + ".json", { exp: b.exp, n: b.n }).then(function () { return ok({ ok: true }); });
          });
        }
        if (method === "DELETE" && HEX64_RE.test(arg)) return del(conf, B + "/i/" + arg + ".json").then(function () { return ok({ ok: true }); });
        return Promise.resolve(err(404, "bad-request"));
      }
      if (part === "j" && method === "POST" && !arg) {
        var ih;
        return sha256hex(x.invite || "").then(function (h) {
          ih = h;
          return getJson(conf, B + "/i/" + ih + ".json");
        }).then(function (inv) {
          if (!inv || !(inv.exp > now) || !(inv.n > 0)) return err(404, "gone");
          return list(conf, B + "/j").then(function (js) {
            if ((js || []).filter(function (f) { return !f.dir && (!f.at || now - f.at < REQ_MS); }).length >= PENDING * 3) return err(429, "rate");
            var rid = randId();
            return putJson(conf, B + "/j/" + rid, { ih: ih, at: now, b: b64(x.bytes || new Uint8Array(0)) }, "new").then(function () {
              var left = inv.n - 1;
              return (left > 0 ? putJson(conf, B + "/i/" + ih + ".json", { exp: inv.exp, n: left }) : del(conf, B + "/i/" + ih + ".json"))
                .then(function () { return ok({ rid: rid }); });
            });
          });
        });
      }
      if (part === "a" && method === "GET" && ID_RE.test(arg)) {
        return Promise.all([sha256hex(x.invite || ""), getJson(conf, B + "/j/" + arg)]).then(function (r) {
          var q = r[1];
          if (!q || q.ih !== r[0] || now - q.at > REQ_MS) return err(404, "gone");
          return getJson(conf, B + "/a/" + arg).then(function (a) {
            if (!a) return answer(202, { ok: true, data: { wait: true } });
            if (a.st === 2) return err(410, "refused");
            return bin(unb64(a.b || ""));
          });
        });
      }
      if (part === "r" && ID_RE.test(arg)) {
        return Promise.all([getJson(conf, B + "/j/" + arg), getJson(conf, B + "/a/" + arg)]).then(function (r) {
          var q = r[0];
          if (!q || r[1] || now - q.at > REQ_MS) return err(404, "none");
          if (method === "GET") return bin(unb64(q.b || ""));
          if (method === "PUT") return putJson(conf, B + "/a/" + arg, { st: 1, b: b64(x.bytes || new Uint8Array(0)) }, "new").then(function () { return ok({ ok: true }); });
          if (method === "DELETE") {
            return putJson(conf, B + "/a/" + arg, { st: 2 }, "new").then(function () {
              return putJson(conf, B + "/j/" + arg, { ih: q.ih, at: q.at, b: "" });     // the request itself is dropped
            }).then(function () { return ok({ ok: true }); });
          }
          return err(404, "bad-request");
        });
      }
      if (part === "rot" && method === "POST" && !arg) {
        var rb = x.json || {};
        if (!(rb.epoch >= 2) || !rb.env || typeof rb.env !== "object") return Promise.resolve(err(400, "bad-request"));
        return withMeta(function (m) {
          if (rb.epoch !== m.epoch + 1) return err(412, "stale", { epoch: m.epoch });
          var ids = Object.keys(rb.env).filter(function (id) { return ID_RE.test(id) && typeof rb.env[id] === "string"; });
          return list(conf, B + "/e").then(function (old) {
            return Promise.all(ids.map(function (id) {
              return put(conf, B + "/e/" + id, b64uBytes(rb.env[id]));
            })).then(function () {
              return Promise.all((old || []).filter(function (f) { return !f.dir && ids.indexOf(f.name) < 0; }).map(function (f) {
                return del(conf, B + "/e/" + f.name);
              }));
            });
          }).then(function () {
            return putJson(conf, B + "/meta.json", { v: 1, epoch: rb.epoch });
          }).then(function () { return ok({ epoch: rb.epoch }); });
        });
      }
      if (part === "e" && ID_RE.test(arg)) {
        if (method === "GET") {
          return withMeta(function (m) {
            return getBytes(conf, B + "/e/" + arg).then(function (b) { return b ? bin(b, m.epoch) : err(404, "none"); });
          });
        }
        if (method === "PUT") return put(conf, B + "/e/" + arg, x.bytes).then(function () { return ok({ ok: true }); });
      }
      // No wakes and no live notices for a folder: the engine just goes on.
      if (part === "p") return Promise.resolve(err(404, "nopush"));
      return Promise.resolve(err(404, "bad-request"));
    }
    function b64uBytes(s) { return unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); }

    // Before a household is made there: the folder answers, takes a new
    // file only once (If-None-Match), and lists what is in it.
    function probe(confIn) {
      var conf = clean(confIn);
      if (!conf) return Promise.resolve("dav-url");
      var t = "/oros-hh-probe-" + randId();
      return list(conf, "").then(function (l) {
        if (l === null) throw fail("dav-404");
        return putJson(conf, t, { t: 1 }, "new");
      }).then(function (made) {
        if (!made) throw fail("dav-cond");
        return putJson(conf, t, { t: 2 }, "new");
      }).then(function (again) {
        return del(conf, t).then(function () {
          if (again) throw fail("dav-cond");     // the server ignores If-None-Match: two writers could both win
          return "";
        });
      }).catch(function (e) {
        return e && e.code ? e.code : (e instanceof TypeError ? "dav-cors" : "dav-net");
      });
    }

    return { request: request, probe: probe };
  }

  var api = { make: make, clean: clean, DAV_RELAY: DAV_RELAY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosHouseFolder = api;
})(typeof window !== "undefined" ? window : globalThis);
