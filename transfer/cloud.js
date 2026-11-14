/* ============================================================
   orOS Transfer — cloud.js (TRANSFER-1 wave 4: through the sender's Dropbox)
   ------------------------------------------------------------
   The sender's orOS seals every file on this device (the same pieces
   as the direct path: core.sealPiece, the key from the transfer code)
   and uploads the ciphertext to its own Dropbox app folder, under
   /transfer/<id>/ (sync.js orosSync.cloudDrop). Files go into packs
   of about PACK_MAX at file boundaries ("p0", "p1", …), so a folder of
   thousands of files needs only a few links. A sealed index ("index")
   lists the files (path, size, time, SHA-256, pack) and every pack's
   4-hour temporary link. The link the person sends is

     …/transfer/receive.html#d=<CODE>.<base64url(index link)>

   Everything after "#" stays in the browser. Dropbox stores only
   sealed bytes; the receiver needs no Dropbox account and no orOS.
   A pack is read as a stream and cut into pieces of known lengths;
   a dropped download goes on with a Range request from the last whole
   piece. The sender's page may close once the link is shown. Folders
   older than LINK_MS (+ a margin) are removed the next time Transfer
   opens (sweep), or at once with "Delete now".

   window.OrosTransferCloud = { fragment, parseFragment, okLink, plan,
     cipherLen, packLen, newId, idTime, sealIndex, openIndex, Cutter,
     send(opts) → Promise<{ id, url, exp }>, Receiver(opts), probe(drop, fetch),
     sweep(drop, now) }
   ============================================================ */
(function (root) {
  "use strict";

  var C = root.OrosTransferCore || (typeof require === "function" ? require("./core.js") : null);
  var WC = root.crypto || (typeof require === "function" ? require("crypto").webcrypto : null);
  var enc = new TextEncoder(), dec = new TextDecoder();

  var PACK_MAX = 256 * 1048576;     // a pack closes at the first file boundary past this
  var LINK_MS = 4 * 3600000;        // Dropbox temporary links last 4 hours
  var LINK_SAFE = LINK_MS - 10 * 60000;   // what we promise: 3 h 50 min after the links were made
  var SWEEP_MS = LINK_MS + 15 * 60000;
  var READ = 16 * 61440;            // bytes read from a source file at a time
  var RETRIES = 3;
  var INDEX_MAX = 8 * 1048576;

  // ----- links and fragments -----
  function b64url(u8) { return C.b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64url(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return C.unb64(s);
  }
  function okLink(u) { return typeof u === "string" && u.length < 2000 && /^https:\/\/[a-z0-9.-]+\.dropboxusercontent\.com\/[^\s#]*$/i.test(u); }
  function fragment(code, link) { return "d=" + C.normCode(code) + "." + b64url(enc.encode(link)); }
  // "#d=CODE.LINK" (or without "#") → { code, link } | null
  function parseFragment(h) {
    var m = /^#?d=([0-9A-Za-z-]{12,20})\.([A-Za-z0-9_-]{10,3000})$/.exec(String(h || ""));
    if (!m) return null;
    var code = C.normCode(m[1]), link = "";
    try { link = dec.decode(unb64url(m[2])); } catch (e) { return null; }
    return code && okLink(link) ? { code: code, link: link } : null;
  }

  // ----- sizes -----
  function cipherLen(plain) { return C.HEAD + 12 + plain + 16; }
  function packLen(size) {
    var n = C.pieces(size), full = Math.max(0, n - 1);
    return n ? full * cipherLen(C.PIECE) + cipherLen(size - full * C.PIECE) : 0;
  }
  // [[file index, …], …]: files in order, a pack ends at the first boundary past max.
  function plan(files, max) {
    max = max || PACK_MAX;
    var packs = [], cur = [], len = 0;
    files.forEach(function (f, i) {
      cur.push(i); len += packLen(f.s);
      if (len >= max) { packs.push(cur); cur = []; len = 0; }
    });
    if (cur.length) packs.push(cur);
    return packs;
  }
  function newId(now) {
    var r = WC.getRandomValues(new Uint8Array(6));
    return (now || Date.now()).toString(36) + C.hex(r);
  }
  function idTime(id) { var t = parseInt(String(id).slice(0, 8), 36); return t > 0 ? t : 0; }

  // ----- the index: one AES-GCM box, additional data "oros-transfer/v1/index" -----
  function sealIndex(key, obj) {
    var iv = WC.getRandomValues(new Uint8Array(12));
    return WC.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: enc.encode(C.NS + "/index") }, key,
      enc.encode(JSON.stringify(obj))).then(function (ct) {
      var out = new Uint8Array(12 + ct.byteLength);
      out.set(iv, 0); out.set(new Uint8Array(ct), 12);
      return out;
    });
  }
  // bytes → { id, exp, files (checked), total, biggest, packs: [{ u, n, files: [i…] }], h: [hex…] } | null
  function openIndex(key, bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length < 28 || u8.length > INDEX_MAX) return Promise.resolve(null);
    return WC.subtle.decrypt({ name: "AES-GCM", iv: u8.subarray(0, 12), additionalData: enc.encode(C.NS + "/index") }, key, u8.subarray(12))
      .then(function (plain) {
        var o = JSON.parse(dec.decode(plain));
        if (!o || o.v !== 1 || !Array.isArray(o.files) || !Array.isArray(o.packs) || !o.packs.length || o.packs.length > 1000) return null;
        var ok = C.checkManifest(o.files);
        if (!ok) return null;
        var hs = [], ks = [];
        for (var i = 0; i < o.files.length; i++) {
          var f = o.files[i];
          if (!/^[0-9a-f]{64}$/.test(f.h || "") || !(f.k >= 0) || Math.floor(f.k) !== f.k || f.k >= o.packs.length) return null;
          if (i && f.k < o.files[i - 1].k) return null;
          hs.push(f.h); ks.push(f.k);
        }
        var packs = [];
        for (var k = 0; k < o.packs.length; k++) {
          var p = o.packs[k];
          if (!p || !okLink(p.u)) return null;
          var list = [], len = 0;
          ks.forEach(function (x, j) { if (x === k) { list.push(j); len += packLen(ok.files[j].s); } });
          if (!list.length || +p.n !== len) return null;
          packs.push({ u: p.u, n: len, files: list });
        }
        var exp = +o.exp || 0;
        return { id: String(o.id || ""), exp: exp, files: ok.files, total: ok.total, biggest: ok.biggest, packs: packs, h: hs, meta: C.cleanMeta(o.meta) };
      }).catch(function () { return null; });
  }

  // ----- cutting a pack stream into pieces of known lengths -----
  // lens: the cipher length of every piece in order. push(chunk) → [piece…]
  function Cutter(lens) {
    var at = 0, parts = [], have = 0;
    this.push = function (chunk) {
      var out = [];
      if (chunk && chunk.length) { parts.push(chunk); have += chunk.length; }
      while (at < lens.length && have >= lens[at]) {
        var need = lens[at], piece = new Uint8Array(need), o = 0;
        while (o < need) {
          var p = parts[0], take = Math.min(p.length, need - o);
          piece.set(p.subarray(0, take), o); o += take;
          if (take === p.length) parts.shift(); else parts[0] = p.subarray(take);
        }
        have -= need; at++;
        out.push(piece);
      }
      return out;
    };
    this.done = function () { return at >= lens.length; };
    this.extra = function () { return have; };
    // bytes of whole pieces taken so far, to resume a download from
    this.offset = function () { var s = 0; for (var i = 0; i < at; i++) s += lens[i]; return s; };
    this.drop = function () { parts = []; have = 0; };
  }
  function pieceLens(size) {
    var n = C.pieces(size), out = [];
    for (var i = 0; i < n; i++) out.push(cipherLen(Math.min(C.PIECE, size - i * C.PIECE)));
    return out;
  }

  function err(code, cause) { var e = new Error(code); e.code = code; e.cause = cause; return e; }

  // ----- the sender -----
  // opts: { code, files (manifest [{p,s,m}]), read(i, a, b) → Uint8Array, drop (orosSync.cloudDrop),
  //   temp() → Promise<{ write, close, file, remove }>, onProgress({ bytes, total, step }), cancelled() → bool, packMax?, now? }
  function send(o) {
    var id = newId(o.now && o.now()), files = o.files, packs = plan(files, o.packMax), hashes = [], keyP = C.derive(o.code);
    var total = files.reduce(function (s, f) { return s + f.s; }, 0), done = 0;
    function stop() { if (o.cancelled && o.cancelled()) throw err("cancelled"); }
    function progress(step) { if (o.onProgress) o.onProgress({ bytes: done, total: total, step: step }); }
    function sealFile(key, i, out) {
      var f = files[i], h = new C.Sha256(), pos = 0, n = 0;
      function next() {
        stop();
        if (pos >= f.s) { hashes[i] = h.hex(); return null; }
        var end = Math.min(f.s, pos + READ);
        return Promise.resolve(o.read(i, pos, end)).then(function (bytes) {
          if (!bytes || bytes.length !== end - pos) throw err("io");
          h.update(bytes);
          var q = Promise.resolve();
          for (var off = 0; off < bytes.length; off += C.PIECE) {
            (function (part) {
              q = q.then(function () { return C.sealPiece(key, i, n++, part); }).then(function (buf) { return out.write(buf); });
            })(bytes.subarray(off, Math.min(bytes.length, off + C.PIECE)));
          }
          return q.then(function () { pos = end; done += bytes.length; progress("seal"); return next(); });
        });
      }
      return next();
    }
    var lens = [];
    return keyP.then(function (keys) {
      var q = Promise.resolve();
      packs.forEach(function (list, k) {
        q = q.then(function () { return o.temp(); }).then(function (t) {
          var w = Promise.resolve();
          list.forEach(function (i) { w = w.then(function () { return sealFile(keys.key, i, t); }); });
          return w.then(function () { return t.close(); }).then(function () { return t.file(); }).then(function (file) {
            stop();
            lens[k] = file.size;
            progress("upload");
            return o.drop.put(id + "/p" + k, file);
          }).then(function () { return t.remove(); }, function (e) { return Promise.resolve(t.remove()).then(function () { throw e; }); });
        });
      });
      return q.then(function () {
        // links last 4 h from now: made only after every upload
        var links = [], l = Promise.resolve();
        packs.forEach(function (_, k) { l = l.then(function () { return o.drop.link(id + "/p" + k).then(function (u) { links[k] = u; }); }); });
        return l.then(function () {
          var t0 = o.now ? o.now() : Date.now();
          var idx = { v: 1, id: id, exp: t0 + LINK_SAFE, files: files.map(function (f, i) {
            var k = 0;
            packs.forEach(function (list, j) { if (list.indexOf(i) !== -1) k = j; });
            return { p: f.p, s: f.s, m: f.m, h: hashes[i], k: k };
          }), packs: packs.map(function (_, k) { return { u: links[k], n: lens[k] }; }) };
          var meta = C.cleanMeta(o.meta);
          if (meta) idx.meta = meta;                                  // D1: title and message, sealed with the index
          return sealIndex(keys.key, idx).then(function (box) { return o.drop.put(id + "/index", new Blob([box])); })
            .then(function () { return o.drop.link(id + "/index"); })
            .then(function (u) { progress("ready"); return { id: id, exp: idx.exp, frag: fragment(o.code, u) }; });
        });
      });
    }).catch(function (e) {
      // leave nothing behind on a failure or a cancel
      return Promise.resolve(o.drop.remove(id)).catch(function () {}).then(function () { throw e.code ? e : err(String(e && e.message || "").indexOf("dropbox-full") !== -1 ? "full" : "dropbox", e); });
    });
  }

  // ----- the receiver: the same phases and API as engine.js's receiver -----
  // opts: { code, link, fetch, onState(phase, info), onProgress({ bytes, total, file }) }
  function Receiver(o) {
    var self = this, F = o.fetch || (root.fetch && root.fetch.bind(root)), keys = null, idx = null, sink = null;
    var ended = false, ctl = null;
    this.phase = "";
    function set(p, info) { self.phase = p; if (o.onState) o.onState(p, info || {}); }
    function fail(code) { if (ended) return; ended = true; try { if (ctl) ctl.abort(); } catch (e) {} set("error", { e: code }); }
    function get(url, from) {
      var c = typeof AbortController === "function" ? new AbortController() : null;
      ctl = c;
      var h = from ? { Range: "bytes=" + from + "-" } : {};
      return F(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", headers: h, signal: c ? c.signal : undefined })
        .then(function (res) {
          if (res.status === 404 || res.status === 410 || res.status === 403 || res.status === 401) throw err("expired");
          if (!res.ok) throw err("lost");
          if (from && res.status !== 206) throw err("lost");
          return res;
        }, function (e) { throw e && e.code ? e : err("lost", e); });
    }
    this.mode = function () { return "cloud"; };
    this.start = function () {
      set("connecting");
      if (!C || !WC || !WC.subtle) { fail("nocrypto"); return self; }
      C.derive(o.code).then(function (k) { keys = k; return get(o.link); })
        .then(function (res) { return res.arrayBuffer(); })
        .then(function (buf) { return openIndex(keys.key, buf); })
        .then(function (x) {
          if (ended) return;
          if (!x) { fail("bad"); return; }
          if (x.exp && x.exp < Date.now()) { fail("expired"); return; }
          idx = x;
          set("offer", { files: x.files, total: x.total, biggest: x.biggest, mode: "cloud", exp: x.exp, meta: x.meta });
        }, function (e) { fail(e && e.code === "expired" ? "expired" : (e && e.code) || "lost"); });
      return self;
    };
    this.decline = function () { fail("declined"); };
    this.cancel = function () { fail("cancelled"); };
    this.accept = function (s) {
      if (!idx || self.phase !== "offer") return false;
      sink = s;
      set("receiving");
      var bad = [], bytes = 0, q = Promise.resolve();
      idx.packs.forEach(function (p) { q = q.then(function () { return readPack(p); }); });
      q.then(function () { if (!ended) { ended = true; set("done", { bad: bad }); } }, function (e) {
        var code = e && e.code ? e.code : "io";
        if (code === "stale") return;
        fail(code);
      });
      function readPack(p) {
        var lens = [], owner = [];
        p.files.forEach(function (i) { pieceLens(idx.files[i].s).forEach(function (l, n) { lens.push(l); owner.push([i, n]); }); });
        var cut = new Cutter(lens), at = 0, cur = -1, h = null, got = 0, tries = 0;
        function openFile(i) {
          cur = i; h = new C.Sha256(); got = 0;
          return Promise.resolve(sink.open(i, idx.files[i]));
        }
        function closeFile(i) {
          var ok = got === idx.files[i].s && h.hex() === idx.h[i];
          if (!ok) bad.push(i);
          cur = -1;
          if (o.onProgress) o.onProgress({ bytes: bytes, total: idx.total, file: i });
          return Promise.resolve(sink.close(i, ok));
        }
        // open the pack's files in order until file i is the open one
        // (empty files on the way are opened and closed at once)
        var fi = -1;
        function upTo(i) {
          if (cur === i) return Promise.resolve();
          var q2 = cur !== -1 ? closeFile(cur) : Promise.resolve();
          return q2.then(function () {
            fi++;
            if (fi >= p.files.length) throw err("bad");
            return openFile(p.files[fi]);
          }).then(function () { return upTo(i); });
        }
        function onPiece(buf) {
          var want = owner[at++], i = want[0], n = want[1];
          return upTo(i).then(function () { return C.openPiece(keys.key, buf); }).then(function (pc) {
            if (!pc || pc.file !== i || pc.n !== n) throw err("bad");
            h.update(pc.bytes); got += pc.bytes.length; bytes += pc.bytes.length;
            if (o.onProgress && n % 16 === 0) o.onProgress({ bytes: bytes, total: idx.total, file: i });
            return sink.write(i, pc.bytes);
          });
        }
        function pump(res) {
          if (!res.body || typeof res.body.getReader !== "function") {
            return res.arrayBuffer().then(function (b) { return feed(new Uint8Array(b)); });
          }
          var rd = res.body.getReader();
          function step() {
            if (ended) throw err("stale");
            return rd.read().then(function (r) {
              if (r.done) return null;
              return feed(r.value).then(step);
            }, function (e) { throw e && e.code ? e : err("lost", e); });
          }
          return step();
        }
        function feed(chunk) {
          var q3 = Promise.resolve();
          cut.push(chunk).forEach(function (pc) { q3 = q3.then(function () { return onPiece(pc); }); });
          return q3;
        }
        function attempt(from) {
          return get(p.u, from).then(pump).then(function () {
            if (!cut.done()) throw err("lost");
            if (cut.extra()) throw err("bad");
          }).catch(function (e) {
            if (ended) throw err("stale");
            if (e && (e.code === "lost") && tries++ < RETRIES && !cut.done()) {
              cut.drop();
              return new Promise(function (r) { setTimeout(r, 1500 * tries); }).then(function () { return attempt(cut.offset()); });
            }
            throw e;
          });
        }
        return attempt(0).then(function () {
          // every file of the pack is closed, the empty ones too
          return upTo(p.files[p.files.length - 1]).then(function () { return closeFile(cur); });
        });
      }
      return true;
    };
  }

  // ----- the first time on a device: can this browser read a temporary link at all? -----
  function probe(drop, F) {
    var id = newId(), bytes = WC.getRandomValues(new Uint8Array(32));
    return drop.put(id + "/probe", new Blob([bytes])).then(function () { return drop.link(id + "/probe"); }).then(function (u) {
      return F(u, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    }).then(function (res) { return res.ok ? res.arrayBuffer() : null; }).then(function (b) {
      var got = b ? new Uint8Array(b) : null;
      return !!got && got.length === bytes.length && got.every(function (x, i) { return x === bytes[i]; });
    }, function () { return false; }).then(function (ok) {
      return Promise.resolve(drop.remove(id)).catch(function () {}).then(function () { return ok; });
    });
  }
  // Folders older than SWEEP_MS → removed. Resolves the number removed.
  function sweep(drop, now) {
    now = now || Date.now();
    return drop.list().then(function (list) {
      var old = list.filter(function (x) { var t = idTime(x.id); return !t || now - t > SWEEP_MS; });
      return old.reduce(function (q, x) { return q.then(function () { return drop.remove(x.id); }); }, Promise.resolve()).then(function () { return old.length; });
    }).catch(function () { return 0; });
  }

  var api = {
    PACK_MAX: PACK_MAX, LINK_MS: LINK_MS, LINK_SAFE: LINK_SAFE, SWEEP_MS: SWEEP_MS,
    fragment: fragment, parseFragment: parseFragment, okLink: okLink, plan: plan, cipherLen: cipherLen, packLen: packLen,
    newId: newId, idTime: idTime, sealIndex: sealIndex, openIndex: openIndex, Cutter: Cutter, pieceLens: pieceLens,
    send: send, Receiver: Receiver, probe: probe, sweep: sweep
  };
  root.OrosTransferCloud = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
