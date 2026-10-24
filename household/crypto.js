// ============================================================
// orOS Household — encryption (WebCrypto only, no DOM)
// Shared by the shell engine and Node tests (tests/household-crypto.test.js).
//   K   household key: 32 random bytes (AES-256-GCM), one per key epoch;
//       never leaves the members' devices.
//   W   write token = base64url(HMAC-SHA256(K, "oros-household/write")):
//       what the relay checks (it keeps only SHA-256 of it).
//   I   invite secret: 32 random bytes, in the invite link's #fragment.
// Document bytes: "h" 0x01 flags(1) epoch(4, big endian) iv(12) AES-GCM,
// AAD "hh1|<box>|<doc>|<epoch>"; flags & 1 = deflate-raw before
// encryption. Join requests: AES-GCM with HKDF(I). Answers and key
// envelopes: ECDH P-256 with a fresh key → HKDF → AES-GCM, bytes =
// sender public key (65) iv(12) ciphertext, so only the holder of the
// member's private key opens them.
// Invite codes: "h1.<box>.<I>", or "h2.<box>.<salt>.<sealed I>" with a
// password (PBKDF2-SHA256, 600,000 rounds, as share links).
// Exposes window.OrosHouseCrypto and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var C = (root && root.crypto) || (typeof crypto !== "undefined" ? crypto : null);
  var S = C && C.subtle;
  var TE = new TextEncoder(), TD = new TextDecoder();
  var ITER = 600000;
  var B64U_RE = /^[A-Za-z0-9_-]+$/;
  var BOX_RE = /^[A-Za-z0-9_-]{22}$/;
  var SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

  function b64u(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(s) {
    if (typeof s !== "string" || !B64U_RE.test(s)) throw new Error("bad base64url");
    var t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    var out = new Uint8Array(t.length);
    for (var i = 0; i < t.length; i++) out[i] = t.charCodeAt(i);
    return out;
  }
  function randBytes(n) { return C.getRandomValues(new Uint8Array(n)); }
  function rand(n) { return b64u(randBytes(n)); }
  function cat(parts) {
    var n = 0, o = 0;
    parts.forEach(function (p) { n += p.length; });
    var out = new Uint8Array(n);
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }
  function sha256hex(str) {
    return S.digest("SHA-256", TE.encode(str)).then(function (d) {
      return Array.from(new Uint8Array(d), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
    });
  }

  // ---------- compression (where the browser has it) ----------
  function pipe(bytes, stream) {
    var w = stream.writable.getWriter();
    w.write(bytes); w.close();
    return new Response(stream.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  var canZip = typeof CompressionStream === "function" && typeof DecompressionStream === "function" && typeof Response === "function";
  function deflate(bytes) { return pipe(bytes, new CompressionStream("deflate-raw")); }
  function inflate(bytes) { return pipe(bytes, new DecompressionStream("deflate-raw")); }

  // ---------- household key ----------
  var keyCache = {};
  function aesKey(kB64) {
    if (!SECRET_RE.test(kB64 || "")) return Promise.reject(new Error("bad key"));
    if (!keyCache[kB64]) keyCache[kB64] = S.importKey("raw", unb64u(kB64), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    return keyCache[kB64];
  }
  function newKey() { return rand(32); }
  function writeToken(kB64) {
    return S.importKey("raw", unb64u(kB64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]).then(function (k) {
      return S.sign("HMAC", k, TE.encode("oros-household/write"));
    }).then(function (sig) { return b64u(new Uint8Array(sig)); });
  }
  function aad(box, doc, epoch) { return TE.encode("hh1|" + box + "|" + doc + "|" + epoch); }

  function seal(kB64, epoch, box, doc, obj) {
    var plain = TE.encode(JSON.stringify(obj));
    var zipped = canZip ? deflate(plain) : Promise.resolve(null);
    return Promise.all([aesKey(kB64), zipped]).then(function (r) {
      var useZip = !!(r[1] && r[1].length < plain.length);
      var body = useZip ? r[1] : plain;
      var iv = randBytes(12);
      return S.encrypt({ name: "AES-GCM", iv: iv, additionalData: aad(box, doc, epoch) }, r[0], body).then(function (ct) {
        var head = new Uint8Array(7);
        head[0] = 0x68; head[1] = 1; head[2] = useZip ? 1 : 0;
        head[3] = (epoch >>> 24) & 255; head[4] = (epoch >>> 16) & 255; head[5] = (epoch >>> 8) & 255; head[6] = epoch & 255;
        return cat([head, iv, new Uint8Array(ct)]);
      });
    });
  }
  function epochOf(bytes) {
    if (!bytes || bytes.length < 7 + 12 + 16 || bytes[0] !== 0x68 || bytes[1] !== 1) return 0;
    return ((bytes[3] << 24) >>> 0) + (bytes[4] << 16) + (bytes[5] << 8) + bytes[6];
  }
  // keys = { epoch: K }; rejects when the epoch's key is missing or the
  // bytes were changed.
  function open(keys, box, doc, bytes) {
    var ep = epochOf(bytes);
    if (!ep || !keys || !keys[ep]) return Promise.reject(new Error("nokey"));
    var zip = bytes[2] & 1;
    return aesKey(keys[ep]).then(function (k) {
      return S.decrypt({ name: "AES-GCM", iv: bytes.slice(7, 19), additionalData: aad(box, doc, ep) }, k, bytes.slice(19));
    }).then(function (pt) {
      pt = new Uint8Array(pt);
      if (!zip) return pt;
      if (!canZip) throw new Error("nozip");
      return inflate(pt);
    }).then(function (pt) { return JSON.parse(TD.decode(pt)); });
  }

  // ---------- member keys, answers and envelopes ----------
  function newMemberKey() {
    return S.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]).then(function (kp) {
      return Promise.all([S.exportKey("raw", kp.publicKey), S.exportKey("jwk", kp.privateKey)]);
    }).then(function (r) {
      var j = r[1];
      return { pub: b64u(new Uint8Array(r[0])), priv: { kty: "EC", crv: "P-256", d: j.d, x: j.x, y: j.y } };
    });
  }
  function wrapKey(bits, box, use) {
    return S.importKey("raw", bits, "HKDF", false, ["deriveKey"]).then(function (k) {
      return S.deriveKey({ name: "HKDF", hash: "SHA-256", salt: TE.encode("oros-household/" + box), info: TE.encode(use) },
                         k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function wrap(pubB64, box, obj) {
    var their;
    return S.importKey("raw", unb64u(pubB64), { name: "ECDH", namedCurve: "P-256" }, false, []).then(function (k) {
      their = k;
      return S.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    }).then(function (eph) {
      return Promise.all([S.deriveBits({ name: "ECDH", public: their }, eph.privateKey, 256), S.exportKey("raw", eph.publicKey)]);
    }).then(function (r) {
      var iv = randBytes(12);
      return wrapKey(r[0], box, "wrap").then(function (k) {
        return S.encrypt({ name: "AES-GCM", iv: iv }, k, TE.encode(JSON.stringify(obj)));
      }).then(function (ct) { return cat([new Uint8Array(r[1]), iv, new Uint8Array(ct)]); });
    });
  }
  function unwrap(privJwk, box, bytes) {
    if (!bytes || bytes.length < 65 + 12 + 16) return Promise.reject(new Error("short"));
    return Promise.all([
      S.importKey("jwk", { kty: "EC", crv: "P-256", d: privJwk.d, x: privJwk.x, y: privJwk.y, ext: true }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
      S.importKey("raw", bytes.slice(0, 65), { name: "ECDH", namedCurve: "P-256" }, false, [])
    ]).then(function (r) {
      return S.deriveBits({ name: "ECDH", public: r[1] }, r[0], 256);
    }).then(function (bits) { return wrapKey(bits, box, "wrap"); }).then(function (k) {
      return S.decrypt({ name: "AES-GCM", iv: bytes.slice(65, 77) }, k, bytes.slice(77));
    }).then(function (pt) { return JSON.parse(TD.decode(new Uint8Array(pt))); });
  }

  // ---------- invites ----------
  function inviteKey(iB64, box) { return wrapKey(unb64u(iB64), box, "invite"); }
  function inviteSeal(iB64, box, obj) {
    var iv = randBytes(12);
    return inviteKey(iB64, box).then(function (k) {
      return S.encrypt({ name: "AES-GCM", iv: iv }, k, TE.encode(JSON.stringify(obj)));
    }).then(function (ct) { return cat([iv, new Uint8Array(ct)]); });
  }
  function inviteOpen(iB64, box, bytes) {
    return inviteKey(iB64, box).then(function (k) {
      return S.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, k, bytes.slice(12));
    }).then(function (pt) { return JSON.parse(TD.decode(new Uint8Array(pt))); });
  }
  function pwKey(password, salt) {
    return S.importKey("raw", TE.encode(String(password).normalize("NFC")), "PBKDF2", false, ["deriveKey"]).then(function (k) {
      return S.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: ITER }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function makeCode(box, iB64, password) {
    if (!BOX_RE.test(box) || !SECRET_RE.test(iB64)) return Promise.reject(new Error("bad invite"));
    if (!password) return Promise.resolve("h1." + box + "." + iB64);
    var salt = randBytes(16), iv = randBytes(12);
    return pwKey(password, salt).then(function (k) {
      return S.encrypt({ name: "AES-GCM", iv: iv, additionalData: TE.encode(box) }, k, unb64u(iB64));
    }).then(function (ct) { return "h2." + box + "." + b64u(salt) + "." + b64u(cat([iv, new Uint8Array(ct)])); });
  }
  // A code, an invite link, or anything with one inside → parsed code.
  function parseCode(text) {
    var m = /(?:^|[#\/\s])(h1)\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})(?![A-Za-z0-9_.-])/.exec(String(text || ""));
    if (m) return { box: m[2], secret: m[3], locked: false };
    m = /(?:^|[#\/\s])(h2)\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{80,90})(?![A-Za-z0-9_.-])/.exec(String(text || ""));
    if (m) return { box: m[2], salt: m[3], sealed: m[4], locked: true };
    return null;
  }
  function unlock(parsed, password) {
    var raw = unb64u(parsed.sealed);
    return pwKey(password, unb64u(parsed.salt)).then(function (k) {
      return S.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12), additionalData: TE.encode(parsed.box) }, k, raw.slice(12));
    }).then(function (pt) { return { box: parsed.box, secret: b64u(new Uint8Array(pt)), locked: false }; });
  }

  var api = {
    ITER: ITER, b64u: b64u, unb64u: unb64u, rand: rand, sha256hex: sha256hex,
    newKey: newKey, writeToken: writeToken, seal: seal, open: open, epochOf: epochOf,
    newMemberKey: newMemberKey, wrap: wrap, unwrap: unwrap,
    inviteSeal: inviteSeal, inviteOpen: inviteOpen, makeCode: makeCode, parseCode: parseCode, unlock: unlock,
    _setIter: function (n) { ITER = n; api.ITER = n; }    // tests only
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosHouseCrypto = api;
})(typeof window !== "undefined" ? window : globalThis);
