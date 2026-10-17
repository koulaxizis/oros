// ============================================================
// orOS Certificates — signed check links (v1.0.0)
// Shared by the app (window.CertSign) and the static check page
// certificates/verify.html; also runs in Node tests (module.exports).
//
// A check link carries everything needed to check a certificate
// offline, with no server and no database:
//   <base>verify.html#c1.<payload>.<public key>.<signature>
//   payload    base64url of the compact payload bytes (see payload())
//   public key base64url of the compressed P-256 point (33 bytes)
//   signature  base64url of the ECDSA P-256 / SHA-256 signature over the
//              payload bytes (IEEE P1363, 64 bytes)
// The part after # never reaches a server.
// Trust comes from the key fingerprint (SHA-256 of the 33 key bytes,
// first 8 bytes as 4 groups): the issuer publishes it, the check page
// shows it.
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var PREFIX = "c1";
  var CAP = { no: 24, n: 80, t: 100, dates: 48, issuer: 80, place: 48, hours: 12, g: 40 };

  // ---------- bytes ----------
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function b64u(bytes) {
    var s = "", i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
      s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63];
    }
    if (bytes.length - i === 1) {
      var a = bytes[i] << 16;
      s += B64[a >> 18 & 63] + B64[a >> 12 & 63];
    } else if (bytes.length - i === 2) {
      var b = bytes[i] << 16 | bytes[i + 1] << 8;
      s += B64[b >> 18 & 63] + B64[b >> 12 & 63] + B64[b >> 6 & 63];
    }
    return s;
  }
  function unb64u(s) {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
    var out = [], acc = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      acc = acc << 6 | B64.indexOf(s.charAt(i));
      bits += 6;
      if (bits >= 8) { bits -= 8; out.push(acc >> bits & 255); }
    }
    return new Uint8Array(out);
  }
  function hex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return s.toUpperCase();
  }

  // ---------- P-256 point compression ----------
  // WebCrypto speaks uncompressed points (65 bytes); the link carries
  // the compressed one (33 bytes) and the check page restores y.
  var P = BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
  var Bc = BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b");
  function bytesToBig(b) { var n = BigInt(0); for (var i = 0; i < b.length; i++) n = (n << BigInt(8)) | BigInt(b[i]); return n; }
  function bigToBytes(n, len) {
    var out = new Uint8Array(len);
    for (var i = len - 1; i >= 0; i--) { out[i] = Number(n & BigInt(255)); n >>= BigInt(8); }
    return out;
  }
  function powMod(b, e, m) {
    var r = BigInt(1);
    b %= m;
    while (e > BigInt(0)) {
      if (e & BigInt(1)) r = r * b % m;
      b = b * b % m;
      e >>= BigInt(1);
    }
    return r;
  }
  function compress(raw) {
    if (!raw || raw.length !== 65 || raw[0] !== 4) return null;
    var out = new Uint8Array(33);
    out[0] = raw[64] & 1 ? 3 : 2;
    out.set(raw.subarray(1, 33), 1);
    return out;
  }
  function decompress(c) {
    if (!c || c.length !== 33 || (c[0] !== 2 && c[0] !== 3)) return null;
    var x = bytesToBig(c.subarray(1));
    if (x >= P) return null;
    var rhs = (powMod(x, BigInt(3), P) - BigInt(3) * x + Bc) % P;
    if (rhs < 0) rhs += P;
    var y = powMod(rhs, (P + BigInt(1)) / BigInt(4), P);
    if (y * y % P !== rhs) return null;                    // not on the curve
    if (Number(y & BigInt(1)) !== (c[0] & 1)) y = P - y;
    var out = new Uint8Array(65);
    out[0] = 4;
    out.set(c.subarray(1), 1);
    out.set(bigToBytes(y, 32), 33);
    return out;
  }

  // ---------- payload ----------
  // Compact bytes, so the QR code stays small enough to print:
  //   0x01, then the fields separated by 0x1E, each text as
  //   0x20–0x7E  ASCII
  //   0x80–0xFF  U+0380–U+03FF (Greek, one byte a letter)
  //   0x7F hi lo any other character of the BMP
  // Fields: number, name, title, dates, issuer, issued (YYYY-MM-DD),
  // place, hours, grade, lang ("el", another code such as "de", or
  // empty for English); trailing empty ones
  // are left out.
  var FIELDS = ["no", "n", "t", "dates", "issuer", "idate", "place", "hours", "g", "lang"];
  var LANG_RE = /^[a-z]{2,3}$/;
  function cut(s, n) {
    s = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
    return s.length > n ? s.slice(0, n - 1).trim() + "\u2026" : s;
  }
  function enc(str, out) {
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDFFF) { if (c <= 0xDBFF) i++; out.push(63); continue; }   // outside the BMP: "?"
      if (c >= 0x20 && c <= 0x7E) out.push(c);
      else if (c >= 0x0380 && c <= 0x03FF) out.push(0x80 + c - 0x0380);
      else if (c >= 0xA0) out.push(0x7F, c >> 8, c & 255);
    }
  }
  function dec(b, i, end) {
    var s = "";
    while (i < end) {
      var c = b[i];
      if (c >= 0x20 && c <= 0x7E) { s += String.fromCharCode(c); i++; }
      else if (c >= 0x80) { s += String.fromCharCode(0x0380 + c - 0x80); i++; }
      else if (c === 0x7F && i + 2 < end) {
        var cp = b[i + 1] << 8 | b[i + 2];
        if (cp < 0xA0 || (cp >= 0xD800 && cp <= 0xDFFF)) return null;
        s += String.fromCharCode(cp); i += 3;
      } else return null;
    }
    return s;
  }
  // f: { no (serial text), n, t, dates, issuer, idate, place, hours, g, lang } -> Uint8Array
  function payload(f) {
    f = f || {};
    var v = [cut(f.no, CAP.no), cut(f.n, CAP.n), cut(f.t, CAP.t), cut(f.dates, CAP.dates), cut(f.issuer, CAP.issuer),
      /^\d{4}-\d{2}-\d{2}$/.test(f.idate || "") ? f.idate : "", cut(f.place, CAP.place), cut(f.hours, CAP.hours),
      cut(f.g, CAP.g), LANG_RE.test(f.lang || "") && f.lang !== "en" ? f.lang : ""];
    while (v.length > 6 && v[v.length - 1] === "") v.pop();
    var out = [1];
    v.forEach(function (x, i) { if (i) out.push(0x1E); enc(x, out); });
    return new Uint8Array(out);
  }
  function readPayload(b) {
    if (!b || b.length < 6 || b.length > 1500 || b[0] !== 1) return null;
    var vals = [], start = 1;
    for (var i = 1; i <= b.length; i++) {
      if (i < b.length && b[i] === 0x7F) { i += 2; continue; }   // an escape's two bytes are never a separator
      if (i === b.length || b[i] === 0x1E) {
        var s = dec(b, start, i);
        if (s === null) return null;
        vals.push(s);
        start = i + 1;
      }
    }
    if (vals.length < 6 || vals.length > FIELDS.length) return null;
    var o = {};
    FIELDS.forEach(function (k, j) { o[k] = vals[j] || ""; });
    if (o.idate && !/^\d{4}-\d{2}-\d{2}$/.test(o.idate)) return null;
    o.lang = LANG_RE.test(o.lang) ? o.lang : "en";
    return o;
  }

  // ---------- links ----------
  function link(base, bytes, pub33, sig) {
    return base + "#" + PREFIX + "." + b64u(bytes) + "." + b64u(pub33) + "." + b64u(sig);
  }
  // Accepts a whole link, a hash or the bare code. -> { json, data, pub, sig } | null
  function parseLink(s) {
    if (typeof s !== "string") return null;
    s = s.trim();
    var h = s.indexOf("#");
    if (h >= 0) s = s.slice(h + 1);
    var parts = s.split(".");
    if (parts.length !== 4 || parts[0] !== PREFIX) return null;
    var pb = unb64u(parts[1]), pub = unb64u(parts[2]), sig = unb64u(parts[3]);
    if (!pb || !pub || !sig || pub.length !== 33 || sig.length !== 64) return null;
    var data = readPayload(pb);
    if (!data) return null;
    return { bytes: pb, data: data, pub: pub, sig: sig };
  }
  // "AB12-CD34-EF56-7890" from the first 8 bytes of SHA-256(pub33)
  function fmtFp(hash) {
    var h = hex(hash.subarray ? hash.subarray(0, 8) : hash.slice(0, 8));
    return h.match(/.{4}/g).join("-");
  }

  // ---------- WebCrypto (subtle passed in, so Node tests can use theirs) ----------
  var ALG = { name: "ECDSA", namedCurve: "P-256" }, SIG = { name: "ECDSA", hash: "SHA-256" };
  // A new key -> { x, y, d } (JWK base64url parts)
  function makeKey(subtle) {
    return subtle.generateKey(ALG, true, ["sign", "verify"]).then(function (kp) {
      return subtle.exportKey("jwk", kp.privateKey);
    }).then(function (j) { return { x: j.x, y: j.y, d: j.d }; });
  }
  // The compressed public key of a stored key
  function pubOf(k) {
    var x = unb64u(k.x), y = unb64u(k.y);
    if (!x || !y || x.length !== 32 || y.length !== 32) return null;
    var raw = new Uint8Array(65);
    raw[0] = 4; raw.set(x, 1); raw.set(y, 33);
    return compress(raw);
  }
  function fingerprint(subtle, pub33) {
    return subtle.digest("SHA-256", pub33).then(function (h) { return fmtFp(new Uint8Array(h)); });
  }
  var keyCache = {};
  function signer(subtle, k) {
    var id = k.x + k.d;
    if (!keyCache[id]) {
      keyCache[id] = subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: k.x, y: k.y, d: k.d, ext: true }, ALG, false, ["sign"]);
    }
    return keyCache[id];
  }
  // sign(subtle, key, base, fields) -> Promise<link>
  function sign(subtle, k, base, f) {
    var bytes = payload(f), pub = pubOf(k);
    if (!pub) return Promise.reject(new Error("key"));
    return signer(subtle, k).then(function (pk) {
      return subtle.sign(SIG, pk, bytes);
    }).then(function (sig) { return link(base, bytes, pub, new Uint8Array(sig)); });
  }
  // verify(subtle, parsed) -> Promise<bool>
  function verify(subtle, x) {
    var raw = x && decompress(x.pub);
    if (!raw) return Promise.resolve(false);
    return subtle.importKey("raw", raw, ALG, false, ["verify"]).then(function (pk) {
      return subtle.verify(SIG, pk, x.sig, x.bytes);
    }).catch(function () { return false; });
  }

  var api = {
    VERSION: VERSION, PREFIX: PREFIX, CAP: CAP,
    b64u: b64u, unb64u: unb64u, compress: compress, decompress: decompress,
    payload: payload, readPayload: readPayload, link: link, parseLink: parseLink, fmtFp: fmtFp,
    makeKey: makeKey, pubOf: pubOf, fingerprint: fingerprint, sign: sign, verify: verify
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CertSign = api;
})(typeof window !== "undefined" ? window : this);
