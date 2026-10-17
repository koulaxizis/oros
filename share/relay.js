// ============================================================
// orOS "Send to someone" — share/relay.js (pure core, v1.0.0)
// Links with an expiry (BR-SHARE-RELAY): the item goes to the orOS
// relay as AES-256-GCM pieces and the link carries only the address
// and the key:
//   https://useoros.online/share/#r1.<id>.<key>.<n>
//   https://useoros.online/share/#q1.<id>.<key>.<n>.<salt>   (password)
// id = 16 random bytes, key = 32 random bytes, n = number of pieces,
// salt = 16 bytes; all base64url. The part after "#" never reaches a
// server, so the relay never sees the key. With a password the key
// that opens the pieces is HKDF-SHA-256(key ‖ PBKDF2-SHA-256(password,
// salt, 600,000)): the link alone is useless, the password alone too.
//
// Plain text of the item: [flag] + JSON { v:1, x: expiry ms, e: the
// BR-SHARE envelope {v,k,d} }, deflated when flag = 1. Flag 2 (an
// album, share wave 4): [2] + u32 big-endian length L + L bytes of
// deflated JSON + a byte run of photos ("bin", not compressed: they
// are JPEG already). It is cut into
// pieces; piece i = iv (12) ‖ AES-GCM(text, AAD "orOS share|<id>|i|n"),
// at most PIECE bytes, so the relay cannot swap, drop or reorder them.
// The sender keeps a revoke secret (32 bytes) that never goes into the
// link; the relay stores only its SHA-256 (relay/share.js).
//
// Used by the shell's send window (share/send.js) and the receiving
// page (share/view.js). No DOM, no storage; fetch is passed in or the
// global one. Node tests load it as is.
//
// API (window.OrosShareRelay / module.exports):
//   RELAY, PIECE, MAX_PIECES, MAX_PLAIN, DAYS, ITER
//   parse(code)                       → { kind:"r1"|"q1", id, key, n, salt? } | null
//   isLocked(code)                    → true for q1
//   pack(env, exp, bin?)              → Promise<plain bytes>
//   seal(key, id, plain, pw?, salt?)  → Promise<[piece bytes]>
//   unseal(key, id, pieces, pw?, salt?) → Promise<plain bytes> (throws "pass" / "bad")
//   unpack(plain)                     → Promise<{ x, e, bin? }> (throws "bad" / "big")
//   create(env, { days, password?, bin?, now?, fetch?, relay? })
//                                     → Promise<{ code, id, del, exp }>
//   open(code, { password?, now?, fetch?, relay? })
//                                     → Promise<{ e, x, bin? } | { error }>
//        error: "gone" (missing, expired or revoked) | "pass" | "bad" | "big" | "net"
//   revoke(id, del, { fetch?, relay? }) → Promise<true> (throws "net")
// create() throws Error(code): "full" | "rate" | "nostore" | "net" | "bad".
// ============================================================
(function (root) {
  "use strict";

  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = mail.js
  var PIECE = 262144;               // bytes of one piece on the relay (relay/share.js SHR_LIMITS.chunk)
  var MAX_PIECES = 200;
  var MAX_PLAIN = 4194304;          // bytes after decompression (bomb guard)
  var DAYS = [1, 7, 30];
  var ITER = 600000;
  var DAY = 86400000;
  var INFO = "orOS share q1";
  var CODE_RE = /^(r1|q1)\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})\.([1-9]\d{0,2})(?:\.([A-Za-z0-9_-]{22}))?$/;

  // ---------- bytes ----------
  function b64u(bytes) {
    var bin = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(s) {
    var b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    var bin = atob(b), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function cr() {
    var c = (typeof crypto !== "undefined" && crypto) || (root && root.crypto);
    if (!c || !c.subtle) throw new Error("crypto");
    return c;
  }
  function rand(n) { return cr().getRandomValues(new Uint8Array(n)); }
  function utf8(s) { return new TextEncoder().encode(s); }
  function hexOf(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
  }
  function hasZip() { return typeof CompressionStream === "function" && typeof DecompressionStream === "function"; }
  function deflate(bytes) {
    var s = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Response(s).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  function inflate(bytes) {
    var reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    var parts = [], total = 0;
    function step() {
      return reader.read().then(function (r) {
        if (r.done) return join(parts, total);
        total += r.value.length;
        if (total > MAX_PLAIN) { try { reader.cancel(); } catch (e) {} throw new Error("big"); }
        parts.push(r.value);
        return step();
      });
    }
    return step();
  }
  function join(parts, total) {
    var out = new Uint8Array(total), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  // ---------- link code ----------
  function parse(code) {
    var m = CODE_RE.exec(String(code || ""));
    if (!m) return null;
    if ((m[1] === "q1") !== !!m[5]) return null;
    var n = +m[4];
    if (n > MAX_PIECES) return null;
    var o = { kind: m[1], id: m[2], key: m[3], n: n };
    if (m[5]) o.salt = m[5];
    return o;
  }
  function isLocked(code) { return /^q1\./.test(String(code || "")); }

  // ---------- keys ----------
  function contentKey(keyB64, password, saltB64, usage) {
    var c = cr(), key = unb64u(keyB64);
    if (!password) return c.subtle.importKey("raw", key, { name: "AES-GCM" }, false, [usage]);
    return c.subtle.importKey("raw", utf8(String(password)), "PBKDF2", false, ["deriveBits"]).then(function (base) {
      return c.subtle.deriveBits({ name: "PBKDF2", salt: unb64u(saltB64), iterations: ITER, hash: "SHA-256" }, base, 256);
    }).then(function (bits) {
      var ikm = new Uint8Array(64);
      ikm.set(key, 0); ikm.set(new Uint8Array(bits), 32);
      return c.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
    }).then(function (h) {
      return c.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(INFO) },
        h, { name: "AES-GCM", length: 256 }, false, [usage]);
    });
  }
  function aad(id, i, n) { return utf8("orOS share|" + id + "|" + i + "|" + n); }

  // ---------- plain text ----------
  function pack(env, exp, bin) {
    var raw = utf8(JSON.stringify({ v: 1, x: exp, e: env }));
    if (bin) {
      if (!hasZip()) return Promise.reject(new Error("bad"));
      return deflate(raw).then(function (z) {
        var out = new Uint8Array(5 + z.length + bin.length);
        out[0] = 2;
        new DataView(out.buffer).setUint32(1, z.length);
        out.set(z, 5);
        out.set(bin, 5 + z.length);
        return out;
      });
    }
    if (!hasZip()) return Promise.resolve(withFlag(0, raw));
    return deflate(raw).then(function (z) { return withFlag(1, z); });
  }
  function withFlag(f, bytes) {
    var out = new Uint8Array(bytes.length + 1);
    out[0] = f; out.set(bytes, 1);
    return out;
  }
  function unpack(plain) {
    if (!plain || !plain.length || plain[0] > 2) return Promise.reject(new Error("bad"));
    var body = plain.subarray(1), bin = null;
    if (plain[0] === 2) {
      if (plain.length < 5) return Promise.reject(new Error("bad"));
      var L = new DataView(plain.buffer, plain.byteOffset + 1, 4).getUint32(0);
      if (L < 1 || 5 + L > plain.length) return Promise.reject(new Error("bad"));
      body = plain.subarray(5, 5 + L);
      bin = plain.subarray(5 + L);
    }
    var p = plain[0] !== 0 ? (hasZip() ? inflate(body) : Promise.reject(new Error("bad"))) : Promise.resolve(body);
    return p.then(function (bytes) {
      if (bytes.length > MAX_PLAIN) throw new Error("big");
      var o;
      try { o = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch (e) { throw new Error("bad"); }
      if (!o || o.v !== 1 || typeof o.x !== "number" || !o.e || typeof o.e !== "object") throw new Error("bad");
      return bin ? { x: o.x, e: o.e, bin: bin } : { x: o.x, e: o.e };
    });
  }

  // ---------- pieces ----------
  var ROOM = PIECE - 28;            // plain bytes per piece (iv 12 + tag 16)
  function seal(keyB64, id, plain, password, saltB64) {
    var n = Math.max(1, Math.ceil(plain.length / ROOM));
    if (n > MAX_PIECES) return Promise.reject(new Error("big"));
    return contentKey(keyB64, password, saltB64, "encrypt").then(function (k) {
      var jobs = [];
      for (var i = 0; i < n; i++) {
        (function (i) {
          var iv = rand(12);
          jobs.push(cr().subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: aad(id, i, n) }, k,
            plain.subarray(i * ROOM, Math.min(plain.length, (i + 1) * ROOM))).then(function (ct) {
            return join([iv, new Uint8Array(ct)], 12 + ct.byteLength);
          }));
        })(i);
      }
      return Promise.all(jobs);
    });
  }
  function unseal(keyB64, id, pieces, password, saltB64) {
    var n = pieces.length;
    return contentKey(keyB64, password, saltB64, "decrypt").then(function (k) {
      return Promise.all(pieces.map(function (p, i) {
        if (!p || p.length < 29 || p.length > PIECE) return Promise.reject(new Error("bad"));
        return cr().subtle.decrypt({ name: "AES-GCM", iv: p.subarray(0, 12), additionalData: aad(id, i, n) }, k, p.subarray(12))
          .then(function (pt) { return new Uint8Array(pt); }, function () { throw new Error(password ? "pass" : "bad"); });
      }));
    }).then(function (parts) {
      return join(parts, parts.reduce(function (s, p) { return s + p.length; }, 0));
    });
  }

  // ---------- network ----------
  function fetchFn(opts) {
    var f = opts && opts.fetch;
    if (f) return f;
    if (typeof fetch === "function") return function (u, o) { return fetch(u, o); };
    throw new Error("net");
  }
  function base(opts) { return String((opts && opts.relay) || RELAY).replace(/\/+$/, ""); }
  function op(opts, body) {
    return fetchFn(opts)(base(opts) + "/v1", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ op: "shr" }, body)), credentials: "omit", cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (j) { return j; }, function () { return null; });
      }, function () { throw new Error("net"); })
      .then(function (j) {
        if (j && j.ok) return j.data;
        var code = j && j.error && j.error.code;
        throw new Error(["full", "rate", "nostore", "gone", "incomplete"].indexOf(code) >= 0 ? code : (j ? "bad" : "net"));
      });
  }

  function create(env, opts) {
    opts = opts || {};
    var days = DAYS.indexOf(opts.days) >= 0 ? opts.days : 7;
    var now = opts.now || Date.now();
    var exp = now + days * DAY;
    var id = b64u(rand(16)), key = b64u(rand(32)), del = b64u(rand(32));
    var password = opts.password ? String(opts.password) : "";
    var salt = password ? b64u(rand(16)) : "";
    var pieces;
    return pack(env, exp, opts.bin || null).then(function (plain) {
      return seal(key, id, plain, password, salt);
    }).then(function (p) {
      pieces = p;
      return cr().subtle.digest("SHA-256", utf8(del));
    }).then(function (h) {
      var size = pieces.reduce(function (s, x) { return s + x.length; }, 0);
      return op(opts, { act: "new", id: id, delh: hexOf(h), exp: exp, n: pieces.length, size: size });
    }).then(function (d) {
      var tok = d && d.tok;
      if (typeof tok !== "string") throw new Error("bad");
      var f = fetchFn(opts), i = 0;
      function next() {
        if (i >= pieces.length) return op(opts, { act: "fin", id: id, tok: tok });
        var at = i++;
        return f(base(opts) + "/s/" + id + "/" + at, { method: "PUT", body: pieces[at], credentials: "omit", cache: "no-store",
          headers: { "Authorization": "Bearer " + tok, "Content-Type": "application/octet-stream" } })
          .then(function (r) { if (!r.ok) throw new Error(r.status === 429 ? "rate" : "bad"); return next(); },
                function () { throw new Error("net"); });
      }
      return next();
    }).then(function () {
      var code = (password ? "q1." : "r1.") + id + "." + key + "." + pieces.length + (password ? "." + salt : "");
      return { code: code, id: id, del: del, exp: exp };
    });
  }

  function open(code, opts) {
    opts = opts || {};
    var c = parse(code);
    if (!c) return Promise.resolve({ error: "bad" });
    if (c.kind === "q1" && !opts.password) return Promise.resolve({ error: "pass" });
    var f;
    try { f = fetchFn(opts); } catch (e) { return Promise.resolve({ error: "net" }); }
    var gets = [];
    for (var i = 0; i < c.n; i++) {
      gets.push(f(base(opts) + "/s/" + c.id + "/" + i, { credentials: "omit", cache: "no-store" }).then(function (r) {
        if (r.status === 404) throw new Error("gone");
        if (!r.ok) throw new Error("net");
        return r.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
      }, function () { throw new Error("net"); }));
    }
    return Promise.all(gets).then(function (pieces) {
      return unseal(c.key, c.id, pieces, opts.password, c.salt);
    }).then(unpack).then(function (o) {
      if (o.x <= (opts.now || Date.now())) return { error: "gone" };
      return o;
    }, function (e) {
      var m = e && e.message;
      return { error: ["gone", "pass", "big", "net"].indexOf(m) >= 0 ? m : "bad" };
    });
  }

  function revoke(id, del, opts) {
    return op(opts, { act: "del", id: id, del: del }).then(function () { return true; }, function (e) {
      throw new Error(e && e.message === "net" ? "net" : "bad");
    });
  }

  var api = { RELAY: RELAY, PIECE: PIECE, MAX_PIECES: MAX_PIECES, MAX_PLAIN: MAX_PLAIN, DAYS: DAYS, ITER: ITER,
              parse: parse, isLocked: isLocked, pack: pack, seal: seal, unseal: unseal, unpack: unpack,
              create: create, open: open, revoke: revoke, _setIter: function (n) { ITER = n; } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosShareRelay = api;
})(typeof window !== "undefined" ? window : globalThis);
