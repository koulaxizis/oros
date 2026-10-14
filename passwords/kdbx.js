// ============================================================
// orOS Passwords — KeePass KDBX reader + KDBX 4 writer (Kdbx, v1.0.0)
// Our own code (no kdbx library): WebCrypto for SHA-256/512, HMAC
// and AES-256-CBC; ChaCha20 and Salsa20 below; Argon2d/Argon2id from
// the vendored hash-wasm (MIT). Pure, no DOM; the tests load it too.
//   1. Bytes, hashes, gzip
//   2. Stream ciphers: ChaCha20 (RFC 7539), Salsa20
//   3. KDFs: AES-KDF, Argon2d / Argon2id; composite key + key files
//   4. Header + variant dictionary
//   5. Small XML reader / writer (no DTD, no entities beyond the five
//      standard ones and numeric references; nothing is executed)
//   6. read(bytes, { password, keyFile }) → { entries, … }
//   7. write(entries, password, opts) → KDBX 4 bytes
// Attachments are not imported (counted); Twofish is refused.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module === "object" && module.exports;
  function subtle() { return globalThis.crypto.subtle; }
  var PmCore = NODE ? require("./pmcore.js") : root.PmCore;

  // ---------- 1. Bytes ----------
  function u8(x) { return x instanceof Uint8Array ? x : new Uint8Array(x); }
  function concat(list) {
    var len = 0, o = 0;
    list.forEach(function (a) { len += a.length; });
    var out = new Uint8Array(len);
    list.forEach(function (a) { out.set(a, o); o += a.length; });
    return out;
  }
  function eq(a, b) {
    if (a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }
  function hexOf(b) { var s = ""; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16); return s; }
  function fromHex(s) {
    var c = String(s).replace(/\s+/g, "");
    if (!/^([0-9a-fA-F]{2})*$/.test(c)) return null;
    var out = new Uint8Array(c.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(c.substr(i * 2, 2), 16);
    return out;
  }
  function b64(b) {
    var s = "", CH = 0x8000;
    for (var i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(String(s || "").replace(/\s+/g, ""));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function utf8(s) { return new TextEncoder().encode(s); }
  function fromUtf8(b) { return new TextDecoder("utf-8").decode(b); }
  function u32le(n) { var b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; }
  function u64le(n) { var b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; }
  function random(n) { var a = new Uint8Array(n); globalThis.crypto.getRandomValues(a); return a; }

  function sha256(b) { return subtle().digest("SHA-256", b).then(u8); }
  function sha512(b) { return subtle().digest("SHA-512", b).then(u8); }
  function hmac256(key, data) {
    return subtle().importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      .then(function (k) { return subtle().sign("HMAC", k, data); }).then(u8);
  }
  function aesCbc(key, iv, data, encrypt) {
    return subtle().importKey("raw", key, { name: "AES-CBC" }, false, [encrypt ? "encrypt" : "decrypt"])
      .then(function (k) { return subtle()[encrypt ? "encrypt" : "decrypt"]({ name: "AES-CBC", iv: iv }, k, data); })
      .then(u8);
  }
  function streamThrough(bytes, ts) {
    return new Response(new Blob([bytes]).stream().pipeThrough(ts)).arrayBuffer().then(u8);
  }
  function gunzip(b) {
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("no-gzip"));
    return streamThrough(b, new DecompressionStream("gzip"));
  }
  function gzip(b) {
    if (typeof CompressionStream !== "function") return Promise.reject(new Error("no-gzip"));
    return streamThrough(b, new CompressionStream("gzip"));
  }

  // ---------- 2. Stream ciphers ----------
  function rotl(v, c) { return (v << c) | (v >>> (32 - c)); }
  function words(bytes, at, n) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = [];
    for (var i = 0; i < n; i++) out.push(dv.getUint32(at + i * 4, true));
    return out;
  }
  var SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

  function chachaBlock(st, out) {
    var x = st.slice(), i;
    function qr(a, b, c, d) {
      x[a] = (x[a] + x[b]) | 0; x[d] = rotl(x[d] ^ x[a], 16);
      x[c] = (x[c] + x[d]) | 0; x[b] = rotl(x[b] ^ x[c], 12);
      x[a] = (x[a] + x[b]) | 0; x[d] = rotl(x[d] ^ x[a], 8);
      x[c] = (x[c] + x[d]) | 0; x[b] = rotl(x[b] ^ x[c], 7);
    }
    for (i = 0; i < 10; i++) {
      qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
      qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
    }
    var dv = new DataView(out.buffer);
    for (i = 0; i < 16; i++) dv.setUint32(i * 4, (x[i] + st[i]) | 0, true);
  }
  function salsaBlock(st, out) {
    var x = st.slice(), i;
    function r(a, b, c, k) { x[a] ^= rotl((x[b] + x[c]) | 0, k); }
    for (i = 0; i < 10; i++) {
      r(4, 0, 12, 7); r(8, 4, 0, 9); r(12, 8, 4, 13); r(0, 12, 8, 18);
      r(9, 5, 1, 7); r(13, 9, 5, 9); r(1, 13, 9, 13); r(5, 1, 13, 18);
      r(14, 10, 6, 7); r(2, 14, 10, 9); r(6, 2, 14, 13); r(10, 6, 2, 18);
      r(3, 15, 11, 7); r(7, 3, 15, 9); r(11, 7, 3, 13); r(15, 11, 7, 18);
      r(1, 0, 3, 7); r(2, 1, 0, 9); r(3, 2, 1, 13); r(0, 3, 2, 18);
      r(6, 5, 4, 7); r(7, 6, 5, 9); r(4, 7, 6, 13); r(5, 4, 7, 18);
      r(11, 10, 9, 7); r(8, 11, 10, 9); r(9, 8, 11, 13); r(10, 9, 8, 18);
      r(12, 15, 14, 7); r(13, 12, 15, 9); r(14, 13, 12, 13); r(15, 14, 13, 18);
    }
    var dv = new DataView(out.buffer);
    for (i = 0; i < 16; i++) dv.setUint32(i * 4, (x[i] + st[i]) | 0, true);
  }
  // A keystream that keeps its place across calls (inner streams XOR
  // the protected values one after the other).
  function keystream(state, block, bump) {
    var buf = new Uint8Array(64), pos = 64;
    return {
      xor: function (data) {
        var out = new Uint8Array(data.length);
        for (var i = 0; i < data.length; i++) {
          if (pos === 64) { block(state, buf); bump(state); pos = 0; }
          out[i] = data[i] ^ buf[pos++];
        }
        return out;
      }
    };
  }
  function chacha20(key, nonce, counter) {
    var st = SIGMA.concat(words(key, 0, 8), [counter >>> 0], words(nonce, 0, 3));
    return keystream(st, chachaBlock, function (s) { s[12] = (s[12] + 1) | 0; });
  }
  function salsa20(key, nonce) {
    var k = words(key, 0, 8), n = words(nonce, 0, 2);
    var st = [SIGMA[0], k[0], k[1], k[2], k[3], SIGMA[1], n[0], n[1], 0, 0, SIGMA[2], k[4], k[5], k[6], k[7], SIGMA[3]];
    return keystream(st, salsaBlock, function (s) { s[8] = (s[8] + 1) | 0; if (s[8] === 0) s[9] = (s[9] + 1) | 0; });
  }

  // ---------- 3. KDFs + composite key ----------
  var UUID = {
    aes: "31c1f2e6bf714350be5805216afc5aff",
    chacha: "d6038a2b8b6f4cb5a524339a31dbb59a",
    twofish: "ad68f29f576f4bb9a36ad47af965346c",
    aesKdf: "c9d9f39a628a4460bf740d08c18a4fea",
    aesKdf3: "7c02bb8279a74ac0927d114a00648238",
    argon2d: "ef636ddf8c29444b91f7a9a403e30a0c",
    argon2id: "9e298b1956db4773b23dfc3ec6f0a1e6"
  };
  var argonLoader = null;
  function setArgon2Loader(fn) { argonLoader = fn; }
  function argon() {
    if (argonLoader) return argonLoader();
    if (NODE) return Promise.resolve(require("../vendor/hash-wasm/argon2.umd.min.js"));
    if (root.hashwasm) return Promise.resolve(root.hashwasm);
    return Promise.reject(new Error("no-argon2"));
  }

  // E^rounds of each 16-byte half with AES-256(seed): one CBC call over
  // a zero buffer chains the encryptions (c[i] = E(c[i-1])).
  var AES_CHUNK = 65536;
  function aesKdf(seed, data, rounds) {
    return subtle().importKey("raw", seed, { name: "AES-CBC" }, false, ["encrypt"]).then(function (key) {
      var zero = new Uint8Array(16);
      function half(block) {
        var left = rounds;
        function step() {
          if (left <= 0) return Promise.resolve(block);
          var n = Math.min(left, AES_CHUNK), buf = new Uint8Array(n * 16);
          buf.set(block, 0);
          return subtle().encrypt({ name: "AES-CBC", iv: zero }, key, buf).then(function (ct) {
            block = new Uint8Array(ct, (n - 1) * 16, 16).slice();
            left -= n;
            return step();
          });
        }
        return step();
      }
      return half(data.slice(0, 16)).then(function (a) {
        return half(data.slice(16, 32)).then(function (b) { return sha256(concat([a, b])); });
      });
    });
  }

  function transformKey(kdf, composite) {
    if (kdf.uuid === UUID.aesKdf || kdf.uuid === UUID.aesKdf3) {
      if (!(kdf.rounds >= 0 && kdf.rounds <= 2e9)) return Promise.reject(new Error("kdf-params"));
      return aesKdf(kdf.seed, composite, kdf.rounds);
    }
    if (kdf.uuid === UUID.argon2d || kdf.uuid === UUID.argon2id) {
      if (kdf.version !== 0x13 || kdf.assoc || !(kdf.memory >= 8 * 1024 && kdf.memory <= 1024 * 1024 * 1024) ||
          !(kdf.iterations >= 1 && kdf.iterations <= 10000) || !(kdf.parallelism >= 1 && kdf.parallelism <= 64)) {
        return Promise.reject(new Error("kdf-params"));
      }
      return argon().then(function (impl) {
        var o = { password: composite, salt: kdf.salt, parallelism: kdf.parallelism, iterations: kdf.iterations,
                  memorySize: Math.floor(kdf.memory / 1024), hashLength: 32, outputType: "binary" };
        if (kdf.secret) o.secret = kdf.secret;
        return kdf.uuid === UUID.argon2d ? impl.argon2d(o) : impl.argon2id(o);
      }).then(u8);
    }
    return Promise.reject(new Error("kdf-unknown"));
  }

  // KeePass key files: XML v1 (base64) / v2 (hex), 32 raw bytes, 64
  // hex characters, anything else = its SHA-256.
  function keyFileKey(file) {
    file = u8(file);
    var text = null;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(file); } catch (e) { text = null; }
    if (text && /<KeyFile[\s>]/.test(text)) {
      try {
        var doc = parseXml(text), key = child(doc, "Key"), data = key && child(key, "Data");
        var ver = textOf(child(child(doc, "Meta"), "Version"));
        if (data) {
          if (/^2\./.test(ver)) { var h = fromHex(textOf(data)); if (h && h.length === 32) return Promise.resolve(h); }
          else { var d = unb64(textOf(data)); if (d.length === 32) return Promise.resolve(d); }
        }
      } catch (e) { /* fall through: hashed like any file */ }
    }
    if (file.length === 32) return Promise.resolve(file);
    if (file.length === 64 && text && /^[0-9a-fA-F]{64}$/.test(text)) return Promise.resolve(fromHex(text));
    return sha256(file);
  }
  function compositeKey(password, keyFile) {
    var parts = [];
    var p = password != null && password !== "" ? sha256(utf8(password)).then(function (h) { parts.push(h); })
                                                : Promise.resolve();
    return p.then(function () {
      if (!keyFile) return null;
      return keyFileKey(keyFile).then(function (k) { parts.push(k); });
    }).then(function () {
      if (!parts.length) throw new Error("no-key");
      return sha256(concat(parts));
    });
  }

  // ---------- 4. Header ----------
  var SIG1 = 0x9AA2D903, SIG2 = 0xB54BFB67;
  var VD = { u32: 0x04, u64: 0x05, bool: 0x08, i32: 0x0C, i64: 0x0D, str: 0x18, bytes: 0x42 };

  function readVariantDict(b) {
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength), p = 2, out = {};
    if ((dv.getUint16(0, true) & 0xFF00) !== 0x0100) throw new Error("bad-header");
    while (p < b.length) {
      var type = b[p++];
      if (type === 0) break;
      var kl = dv.getInt32(p, true); p += 4;
      var name = fromUtf8(b.subarray(p, p + kl)); p += kl;
      var vl = dv.getInt32(p, true); p += 4;
      var v = b.subarray(p, p + vl); p += vl;
      var vdv = new DataView(v.buffer, v.byteOffset, v.byteLength);
      if (type === VD.u32) out[name] = vdv.getUint32(0, true);
      else if (type === VD.i32) out[name] = vdv.getInt32(0, true);
      else if (type === VD.u64 || type === VD.i64) out[name] = Number(vdv.getBigUint64(0, true));
      else if (type === VD.bool) out[name] = v[0] !== 0;
      else if (type === VD.str) out[name] = fromUtf8(v);
      else out[name] = v.slice();
    }
    return out;
  }
  function writeVariantDict(items) {
    var parts = [new Uint8Array([0x00, 0x01])];
    items.forEach(function (it) {
      var name = utf8(it[0]), type = it[1], val = it[2], vb;
      if (type === VD.u32) vb = u32le(val);
      else if (type === VD.u64) vb = u64le(val);
      else vb = val;
      parts.push(new Uint8Array([type]), u32le(name.length), name, u32le(vb.length), vb);
    });
    parts.push(new Uint8Array([0]));
    return concat(parts);
  }

  function readHeader(b) {
    if (b.length < 12) throw new Error("not-kdbx");
    var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (dv.getUint32(0, true) !== SIG1 || dv.getUint32(4, true) !== SIG2) throw new Error("not-kdbx");
    var minor = dv.getUint16(8, true), major = dv.getUint16(10, true);
    if (major !== 3 && major !== 4) throw new Error("kdbx-version");
    var p = 12, h = { major: major, minor: minor };
    for (;;) {
      if (p >= b.length) throw new Error("bad-header");
      var id = b[p++], size;
      if (major >= 4) { size = dv.getUint32(p, true); p += 4; } else { size = dv.getUint16(p, true); p += 2; }
      if (p + size > b.length) throw new Error("bad-header");
      var d = b.subarray(p, p + size); p += size;
      if (id === 0) break;
      if (id === 2) h.cipher = hexOf(d);
      else if (id === 3) h.compression = new DataView(d.buffer, d.byteOffset, 4).getUint32(0, true);
      else if (id === 4) h.masterSeed = d.slice();
      else if (id === 5) h.transformSeed = d.slice();
      else if (id === 6) h.transformRounds = Number(new DataView(d.buffer, d.byteOffset, 8).getBigUint64(0, true));
      else if (id === 7) h.iv = d.slice();
      else if (id === 8) h.protectedStreamKey = d.slice();
      else if (id === 9) h.streamStartBytes = d.slice();
      else if (id === 10) h.innerStreamId = new DataView(d.buffer, d.byteOffset, 4).getUint32(0, true);
      else if (id === 11) h.kdfParams = readVariantDict(d);
    }
    h.end = p;
    if (major >= 4) {
      var kp = h.kdfParams || {};
      h.kdf = { uuid: kp.$UUID ? hexOf(kp.$UUID) : "", rounds: kp.R, seed: kp.S, salt: kp.S, parallelism: kp.P,
                memory: kp.M, iterations: kp.I, version: kp.V, secret: kp.K, assoc: kp.A };
    } else {
      h.kdf = { uuid: UUID.aesKdf, rounds: h.transformRounds, seed: h.transformSeed };
    }
    if (!h.masterSeed || h.masterSeed.length !== 32 || !h.iv) throw new Error("bad-header");
    return h;
  }

  function decryptPayload(h, key, data) {
    if (h.cipher === UUID.aes) return aesCbc(key, h.iv, data, false).then(null, function () { throw new Error("wrong-key"); });
    if (h.cipher === UUID.chacha) return Promise.resolve(chacha20(key, h.iv, 0).xor(data));
    if (h.cipher === UUID.twofish) return Promise.reject(new Error("twofish"));
    return Promise.reject(new Error("cipher-unknown"));
  }

  // ---------- 5. XML ----------
  // Elements only: { n, a{}, c[], t } (t = the element's own text).
  var ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  function unent(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, function (m, e) {
      if (e[0] === "#") {
        var cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : "";
      }
      return ENT.hasOwnProperty(e) ? ENT[e] : m;
    });
  }
  function parseXml(text) {
    var top = { n: "#doc", a: {}, c: [], t: "" }, stack = [top], i = 0, L = text.length;
    while (i < L) {
      var lt = text.indexOf("<", i);
      if (lt < 0) lt = L;
      if (lt > i) stack[stack.length - 1].t += unent(text.slice(i, lt));
      if (lt >= L) break;
      if (text.startsWith("<!--", lt)) { var ce = text.indexOf("-->", lt + 4); i = ce < 0 ? L : ce + 3; continue; }
      if (text.startsWith("<![CDATA[", lt)) {
        var de = text.indexOf("]]>", lt + 9);
        stack[stack.length - 1].t += text.slice(lt + 9, de < 0 ? L : de);
        i = de < 0 ? L : de + 3; continue;
      }
      if (text[lt + 1] === "?" || text[lt + 1] === "!") { var pe = text.indexOf(">", lt); i = pe < 0 ? L : pe + 1; continue; }
      var gt = text.indexOf(">", lt);
      if (gt < 0) throw new Error("bad-xml");
      var body = text.slice(lt + 1, gt);
      i = gt + 1;
      if (body[0] === "/") {
        if (stack.length < 2) throw new Error("bad-xml");
        stack.pop();
        continue;
      }
      var self = body[body.length - 1] === "/";
      if (self) body = body.slice(0, -1);
      var m = body.match(/^([^\s\/>]+)/);
      if (!m) throw new Error("bad-xml");
      var node = { n: m[1], a: {}, c: [], t: "" };
      body.slice(m[1].length).replace(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, function (x, k, v, d, s) {
        node.a[k] = unent(d !== undefined ? d : s); return "";
      });
      stack[stack.length - 1].c.push(node);
      if (!self) stack.push(node);
      if (stack.length > 256) throw new Error("bad-xml");
    }
    var rootEl = top.c[0];
    if (!rootEl) throw new Error("bad-xml");
    return rootEl;
  }
  function child(n, name) {
    if (!n) return null;
    for (var i = 0; i < n.c.length; i++) if (n.c[i].n === name) return n.c[i];
    return null;
  }
  function children(n, name) { return n ? n.c.filter(function (x) { return x.n === name; }) : []; }
  function textOf(n) { return n ? n.t : ""; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"; })
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
  }

  // Protected values in document order: every element with
  // Protected="True" takes the next bytes of the inner stream.
  function unprotect(node, stream) {
    if (node.a.Protected && /^true$/i.test(node.a.Protected)) {
      var raw = stream.xor(unb64(node.t));
      node.t = node.n === "Value" ? fromUtf8(raw) : "";
      node.protectedValue = true;
    }
    node.c.forEach(function (ch) { unprotect(ch, stream); });
  }

  // ---------- 6. Read ----------
  var EPOCH_OFFSET = 62135596800;   // seconds from 0001-01-01 to 1970-01-01
  function timeOf(n) {
    var s = textOf(n).trim();
    if (!s) return 0;
    if (/^\d{4}-\d\d-\d\dT/.test(s)) { var t = Date.parse(s); return isFinite(t) ? t : 0; }
    try {
      var b = unb64(s);
      if (b.length !== 8) return 0;
      var secs = Number(new DataView(b.buffer).getBigInt64(0, true));
      var ms = (secs - EPOCH_OFFSET) * 1000;
      return ms > 0 && ms < 1e14 ? ms : 0;
    } catch (e) { return 0; }
  }

  var STD = { Title: 1, UserName: 1, Password: 1, URL: 1, Notes: 1, otp: 1 };
  var URL_EXTRA = /^(KP2A_URL(_\d+)?|URL_\d+)$/;
  var TIMEOTP = /^TimeOtp-/;
  var TO_B32 = { "TimeOtp-Secret-Base32": function (v) { return v.replace(/\s+/g, "").toUpperCase(); },
                 "TimeOtp-Secret-Hex": function (v) { var h = fromHex(v); return h ? PmCore.base32Encode(h) : ""; },
                 "TimeOtp-Secret-Base64": function (v) { try { return PmCore.base32Encode(unb64(v)); } catch (e) { return ""; } },
                 "TimeOtp-Secret": function (v) { return PmCore.base32Encode(utf8(v)); } };

  function otpFromStrings(s, title) {
    var otp = s.otp ? s.otp.v.trim() : "";
    if (otp && !/^otpauth:/i.test(otp) && /(^|&)key=/.test(otp)) {
      // KeeOtp plugin: key=BASE32&step=30&size=6&otpHashMode=Sha256
      var q = {};
      otp.split("&").forEach(function (p) { var k = p.indexOf("="); if (k > 0) q[p.slice(0, k).toLowerCase()] = decodeURIComponent(p.slice(k + 1)); });
      var u = "otpauth://totp/" + encodeURIComponent(title || "orOS") + "?secret=" + encodeURIComponent(String(q.key || "").replace(/\s+/g, ""));
      if (q.step) u += "&period=" + encodeURIComponent(q.step);
      if (q.size) u += "&digits=" + encodeURIComponent(q.size);
      if (q.otphashmode) u += "&algorithm=" + encodeURIComponent(q.otphashmode.toUpperCase());
      return u;
    }
    if (otp) return otp;
    for (var k in TO_B32) {
      if (s[k] && s[k].v) {
        var sec = TO_B32[k](s[k].v);
        if (!sec) return "";
        var uri = "otpauth://totp/" + encodeURIComponent(title || "orOS") + "?secret=" + sec;
        if (s["TimeOtp-Length"]) uri += "&digits=" + encodeURIComponent(s["TimeOtp-Length"].v.trim());
        if (s["TimeOtp-Period"]) uri += "&period=" + encodeURIComponent(s["TimeOtp-Period"].v.trim());
        if (s["TimeOtp-Algorithm"]) uri += "&algorithm=" + encodeURIComponent(s["TimeOtp-Algorithm"].v.replace(/^HMAC-/i, "").replace(/-/g, ""));
        return uri;
      }
    }
    return "";
  }

  function readEntry(en, tags, ctx) {
    var s = {}, order = [];
    children(en, "String").forEach(function (st) {
      var k = textOf(child(st, "Key")), v = child(st, "Value");
      if (!k) return;
      s[k] = { v: textOf(v), p: !!(v && v.protectedValue) };
      order.push(k);
    });
    var times = child(en, "Times");
    var m = timeOf(child(times, "LastModificationTime")) || ctx.now;
    var c = timeOf(child(times, "CreationTime")) || m;
    var e = PmCore.blankEntry(ctx.now);
    e.m = m; e.c = c;
    function g(k) { return s[k] ? s[k].v : ""; }
    e.title = g("Title"); e.user = g("UserName"); e.pw = g("Password"); e.notes = g("Notes");
    if (g("URL")) e.urls.push(g("URL"));
    e.totp = otpFromStrings(s, e.title);
    e.tags = tags.slice();
    textOf(child(en, "Tags")).split(/[;,]/).forEach(function (t) { if (t.trim()) e.tags.push(t.trim()); });
    order.forEach(function (k) {
      if (STD[k] || TIMEOTP.test(k)) return;
      if (URL_EXTRA.test(k)) { if (s[k].v) e.urls.push(s[k].v); return; }
      e.fields.push({ h: s[k].p ? 1 : 0, n: k, v: s[k].v });
    });
    ctx.attachments += children(en, "Binary").length;
    var hist = [];
    children(child(en, "History"), "Entry").forEach(function (he) {
      var pw = "";
      children(he, "String").forEach(function (st) { if (textOf(child(st, "Key")) === "Password") pw = textOf(child(st, "Value")); });
      var t = timeOf(child(child(he, "Times"), "LastModificationTime"));
      if (pw && pw !== e.pw) hist.push({ pw: pw, t: t || m });
    });
    hist.sort(function (a, b) { return b.t - a.t; });
    hist.forEach(function (h) { if (!e.hist.some(function (x) { return x.pw === h.pw; })) e.hist.push(h); });
    var n = PmCore.normEntry(e, ctx.now);
    if (n && (n.title || n.user || n.pw || n.notes || n.urls.length || n.fields.length)) ctx.entries.push(n);
    else ctx.skipped++;
  }

  function readGroup(gr, path, ctx, isRoot) {
    var uuid = textOf(child(gr, "UUID")).trim();
    if (ctx.recycle && uuid === ctx.recycle) {
      ctx.recycled += countEntries(gr);
      return;
    }
    var name = textOf(child(gr, "Name")).trim();
    var here = isRoot ? "" : (path ? path + "/" + name : name);
    var tags = here ? [here] : [];
    children(gr, "Entry").forEach(function (en) { readEntry(en, tags, ctx); });
    children(gr, "Group").forEach(function (g) { readGroup(g, here, ctx, false); });
  }
  function countEntries(gr) {
    var n = children(gr, "Entry").length;
    children(gr, "Group").forEach(function (g) { n += countEntries(g); });
    return n;
  }

  // bytes + { password, keyFile } → Promise<{ entries, skipped,
  // recycled, attachments, name, version }>. Errors: not-kdbx,
  // kdbx-version, wrong-key, twofish, kdf-params, bad-file.
  function read(bytes, creds, opts) {
    bytes = u8(bytes);
    var now = (opts && opts.now) || Date.now();
    var h;
    try { h = readHeader(bytes); } catch (e) { return Promise.reject(e); }
    var headerBytes = bytes.subarray(0, h.end);
    return compositeKey(creds && creds.password, creds && creds.keyFile).then(function (comp) {
      return transformKey(h.kdf, comp);
    }).then(function (tk) {
      var seedKey = concat([h.masterSeed, tk]);
      return sha256(seedKey).then(function (encKey) {
        if (h.major >= 4) return readV4(bytes, h, headerBytes, seedKey, encKey);
        return readV3(bytes, h, encKey);
      });
    }).then(function (res) {
      var doc = parseXml(res.xml);
      unprotect(doc, res.stream);
      var meta = child(doc, "Meta"), rootEl = child(doc, "Root");
      var ctx = { entries: [], skipped: 0, recycled: 0, attachments: 0, now: now, recycle: null };
      if (/^true$/i.test(textOf(child(meta, "RecycleBinEnabled")).trim())) {
        var rb = textOf(child(meta, "RecycleBinUUID")).trim();
        if (rb && rb !== "AAAAAAAAAAAAAAAAAAAAAA==") ctx.recycle = rb;
      }
      var top = child(rootEl, "Group");
      if (top) readGroup(top, "", ctx, true);
      return { entries: ctx.entries, skipped: ctx.skipped, recycled: ctx.recycled, attachments: ctx.attachments,
               name: textOf(child(meta, "DatabaseName")), version: h.major + "." + h.minor };
    });
  }

  function innerStream(id, key) {
    if (id === 2) return sha256(key).then(function (k) { return salsa20(k, new Uint8Array([0xE8, 0x30, 0x09, 0x4B, 0x97, 0x20, 0x5D, 0x2A])); });
    if (id === 3) return sha512(key).then(function (k) { return chacha20(k.subarray(0, 32), k.subarray(32, 44), 0); });
    if (id === 0) return Promise.resolve({ xor: function (d) { return d; } });
    return Promise.reject(new Error("bad-file"));
  }

  function readV3(bytes, h, encKey) {
    return decryptPayload(h, encKey, bytes.subarray(h.end)).then(function (plain) {
      if (!h.streamStartBytes || !eq(plain.subarray(0, 32), h.streamStartBytes)) throw new Error("wrong-key");
      var dv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength), p = 32, parts = [], chain = Promise.resolve();
      for (;;) {
        if (p + 40 > plain.length) throw new Error("bad-file");
        var hash = plain.subarray(p + 4, p + 36), size = dv.getInt32(p + 36, true);
        p += 40;
        if (size === 0) break;
        if (size < 0 || p + size > plain.length) throw new Error("bad-file");
        (function (data, hsh) {
          chain = chain.then(function () { return sha256(data); }).then(function (d) {
            if (!eq(d, hsh)) throw new Error("bad-file");
          });
          parts.push(data);
        })(plain.subarray(p, p + size), hash);
        p += size;
      }
      return chain.then(function () {
        var body = concat(parts);
        return h.compression === 1 ? gunzip(body) : body;
      });
    }).then(function (xmlBytes) {
      return innerStream(h.innerStreamId, h.protectedStreamKey || new Uint8Array(0)).then(function (stream) {
        return { xml: fromUtf8(xmlBytes), stream: stream };
      });
    });
  }

  function blockKey(index, base) { return sha512(concat([u64le(index), base])); }

  function readV4(bytes, h, headerBytes, seedKey, encKey) {
    var p = h.end;
    var hash = bytes.subarray(p, p + 32), mac = bytes.subarray(p + 32, p + 64);
    p += 64;
    var base;
    return sha256(headerBytes).then(function (d) {
      if (!eq(d, hash)) throw new Error("bad-file");
      return sha512(concat([seedKey, new Uint8Array([1])]));
    }).then(function (b) {
      base = b;
      return blockKey(BigInt("0xFFFFFFFFFFFFFFFF"), base);
    }).then(function (hk) { return hmac256(hk, headerBytes); }).then(function (m) {
      if (!eq(m, mac)) throw new Error("wrong-key");
      var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts = [], index = 0;
      function next() {
        if (p + 36 > bytes.length) return Promise.reject(new Error("bad-file"));
        var bmac = bytes.subarray(p, p + 32), size = dv.getInt32(p + 32, true);
        if (size < 0 || p + 36 + size > bytes.length) return Promise.reject(new Error("bad-file"));
        var data = bytes.subarray(p + 36, p + 36 + size), i = index;
        p += 36 + size; index++;
        return blockKey(i, base).then(function (k) {
          return hmac256(k, concat([u64le(i), u32le(size), data]));
        }).then(function (m2) {
          if (!eq(m2, bmac)) throw new Error("bad-file");
          if (size === 0) return concat(parts);
          parts.push(data);
          return next();
        });
      }
      return next();
    }).then(function (enc) { return decryptPayload(h, encKey, enc); })
      .then(function (plain) { return h.compression === 1 ? gunzip(plain) : plain; })
      .then(function (inner) {
        var dv = new DataView(inner.buffer, inner.byteOffset, inner.byteLength), q = 0, sid = 0, skey = null;
        for (;;) {
          if (q + 5 > inner.length) throw new Error("bad-file");
          var id = inner[q], size = dv.getInt32(q + 1, true);
          q += 5;
          if (size < 0 || q + size > inner.length) throw new Error("bad-file");
          var d = inner.subarray(q, q + size); q += size;
          if (id === 0) break;
          if (id === 1) sid = new DataView(d.buffer, d.byteOffset, 4).getUint32(0, true);
          else if (id === 2) skey = d.slice();
        }
        return innerStream(sid, skey || new Uint8Array(0)).then(function (stream) {
          return { xml: fromUtf8(inner.subarray(q)), stream: stream };
        });
      });
  }

  // ---------- 7. Write (KDBX 4.0) ----------
  // opts: { kdf: "argon2id" (default) | "aes", memory (bytes),
  //         iterations, parallelism, rounds, cipher "aes" | "chacha",
  //         name, now }
  function timeB64(ms) {
    var b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, BigInt(Math.floor(ms / 1000) + EPOCH_OFFSET), true);
    return b64(b);
  }
  function uuidFor(id) {
    var h = fromHex((id + "6f726f532d706d31").slice(0, 32));
    return b64(h && h.length === 16 ? h : random(16));
  }

  function write(entries, password, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var useArgon = opts.kdf !== "aes", chacha = opts.cipher === "chacha";
    var masterSeed = random(32), iv = random(chacha ? 12 : 16), kdfSalt = random(32), streamKey = random(64);
    var kdfItems = useArgon
      ? [["$UUID", VD.bytes, fromHex(UUID.argon2id)], ["S", VD.bytes, kdfSalt],
         ["P", VD.u32, opts.parallelism || 1], ["M", VD.u64, opts.memory || 64 * 1024 * 1024],
         ["I", VD.u64, opts.iterations || 3], ["V", VD.u32, 0x13]]
      : [["$UUID", VD.bytes, fromHex(UUID.aesKdf)], ["R", VD.u64, opts.rounds || 600000], ["S", VD.bytes, kdfSalt]];
    var kdf = useArgon
      ? { uuid: UUID.argon2id, salt: kdfSalt, parallelism: opts.parallelism || 1, memory: opts.memory || 64 * 1024 * 1024,
          iterations: opts.iterations || 3, version: 0x13 }
      : { uuid: UUID.aesKdf, seed: kdfSalt, rounds: opts.rounds || 600000 };
    function field(id, data) { return concat([new Uint8Array([id]), u32le(data.length), data]); }
    var header = concat([
      u32le(SIG1), u32le(SIG2), new Uint8Array([0, 0, 4, 0]),
      field(2, fromHex(chacha ? UUID.chacha : UUID.aes)),
      field(3, u32le(1)),
      field(4, masterSeed),
      field(7, iv),
      field(11, writeVariantDict(kdfItems)),
      field(0, new Uint8Array([13, 10, 13, 10]))
    ]);
    var stream, seedKey, encKey, base;
    return sha512(streamKey).then(function (k) {
      stream = chacha20(k.subarray(0, 32), k.subarray(32, 44), 0);
      return compositeKey(password, opts.keyFile);
    }).then(function (comp) { return transformKey(kdf, comp); }).then(function (tk) {
      seedKey = concat([masterSeed, tk]);
      return sha256(seedKey);
    }).then(function (k) {
      encKey = k;
      return sha512(concat([seedKey, new Uint8Array([1])]));
    }).then(function (b) {
      base = b;
      var xml = buildXml(entries, stream, opts.name || "orOS Passwords", now);
      var inner = concat([
        new Uint8Array([1]), u32le(4), u32le(3),
        new Uint8Array([2]), u32le(64), streamKey,
        new Uint8Array([0]), u32le(0),
        utf8(xml)
      ]);
      return gzip(inner);
    }).then(function (z) {
      return chacha ? chacha20(encKey, iv, 0).xor(z) : aesCbc(encKey, iv, z, true);
    }).then(function (enc) {
      var BLOCK = 1024 * 1024, chunks = [];
      for (var o = 0; o < enc.length; o += BLOCK) chunks.push(enc.subarray(o, Math.min(enc.length, o + BLOCK)));
      chunks.push(new Uint8Array(0));
      var out = [header], i = 0;
      return sha256(header).then(function (hh) {
        out.push(hh);
        return blockKey(BigInt("0xFFFFFFFFFFFFFFFF"), base);
      }).then(function (hk) { return hmac256(hk, header); }).then(function (hm) {
        out.push(hm);
        function next() {
          if (i >= chunks.length) return concat(out);
          var data = chunks[i], idx = i++;
          return blockKey(idx, base).then(function (k) {
            return hmac256(k, concat([u64le(idx), u32le(data.length), data]));
          }).then(function (m) { out.push(m, u32le(data.length), data); return next(); });
        }
        return next();
      });
    });
  }

  function buildXml(entries, stream, name, now) {
    var out = [];
    function prot(v) { return b64(stream.xor(utf8(v))); }
    function str(k, v, isProt) {
      out.push("<String><Key>" + esc(k) + "</Key>" +
               (isProt ? "<Value Protected=\"True\">" + prot(v) + "</Value>" : "<Value>" + esc(v) + "</Value>") + "</String>");
    }
    function times(c, m) {
      out.push("<Times><CreationTime>" + timeB64(c) + "</CreationTime><LastModificationTime>" + timeB64(m) +
               "</LastModificationTime><LastAccessTime>" + timeB64(m) + "</LastAccessTime><ExpiryTime>" + timeB64(m) +
               "</ExpiryTime><Expires>False</Expires><UsageCount>0</UsageCount><LocationChanged>" + timeB64(m) +
               "</LocationChanged></Times>");
    }
    function totpFields(e) {
      if (!e.totp) return;
      var o = PmCore.parseOtp(e.totp);
      var uri = /^otpauth:/i.test(e.totp) ? e.totp : null;
      if (!o.error) {
        var sec = PmCore.base32Encode(o.secret);
        if (!uri) uri = "otpauth://totp/" + encodeURIComponent(e.title || "orOS") + "?secret=" + sec +
                        "&period=" + o.period + "&digits=" + o.digits + "&algorithm=" + o.algo.replace("-", "");
        str("otp", uri, true);
        str("TimeOtp-Secret-Base32", sec, true);
        if (o.digits !== 6) str("TimeOtp-Length", String(o.digits));
        if (o.period !== 30) str("TimeOtp-Period", String(o.period));
        if (o.algo !== "SHA-1") str("TimeOtp-Algorithm", "HMAC-" + o.algo);
      } else {
        str("otp", e.totp, true);
      }
    }
    function entry(e, pw, m, withHistory) {
      out.push("<Entry><UUID>" + uuidFor(e.id) + "</UUID><IconID>0</IconID>");
      // The first tag is the group (below); the others go in Tags.
      if (e.tags.length > 1) out.push("<Tags>" + esc(e.tags.slice(1).join(";")) + "</Tags>");
      times(e.c, m);
      str("Notes", e.notes);
      str("Password", pw, true);
      str("Title", e.title);
      str("URL", e.urls[0] || "");
      str("UserName", e.user);
      e.urls.slice(1).forEach(function (u, i) { str(i === 0 ? "KP2A_URL" : "KP2A_URL_" + i, u); });
      totpFields(e);
      var used = { Notes: 1, Password: 1, Title: 1, URL: 1, UserName: 1, otp: 1 };
      e.fields.forEach(function (f, i) {
        var k = f.n || "Field";
        while (used[k] || URL_EXTRA.test(k) || TIMEOTP.test(k)) k = (f.n || "Field") + " (" + (++i) + ")";
        used[k] = 1;
        str(k, f.v, !!f.h);
      });
      if (withHistory && e.hist.length) {
        out.push("<History>");
        e.hist.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (h) { entry(e, h.pw, h.t, false); });
        out.push("</History>");
      } else if (withHistory) out.push("<History/>");
      out.push("</Entry>");
    }
    // Groups from the first tag ("Email/Work" = nested groups).
    var tree = { name: name, kids: {}, order: [], entries: [] };
    entries.forEach(function (e) {
      var node = tree;
      (e.tags[0] || "").split("/").filter(Boolean).forEach(function (part) {
        if (!node.kids[part]) { node.kids[part] = { name: part, kids: {}, order: [], entries: [] }; node.order.push(part); }
        node = node.kids[part];
      });
      node.entries.push(e);
    });
    function group(g) {
      out.push("<Group><UUID>" + b64(random(16)) + "</UUID><Name>" + esc(g.name) + "</Name><IconID>" +
               (g === tree ? 49 : 48) + "</IconID>");
      times(now, now);
      out.push("<IsExpanded>True</IsExpanded>");
      g.entries.forEach(function (e) { entry(e, e.pw, e.m, true); });
      g.order.forEach(function (k) { group(g.kids[k]); });
      out.push("</Group>");
    }
    var head = "<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"yes\"?>\n<KeePassFile><Meta><Generator>orOS Passwords</Generator>" +
      "<DatabaseName>" + esc(name) + "</DatabaseName><DatabaseNameChanged>" + timeB64(now) + "</DatabaseNameChanged>" +
      "<MemoryProtection><ProtectTitle>False</ProtectTitle><ProtectUserName>False</ProtectUserName>" +
      "<ProtectPassword>True</ProtectPassword><ProtectURL>False</ProtectURL><ProtectNotes>False</ProtectNotes></MemoryProtection>" +
      "<RecycleBinEnabled>False</RecycleBinEnabled><RecycleBinUUID>AAAAAAAAAAAAAAAAAAAAAA==</RecycleBinUUID>" +
      "<HistoryMaxItems>10</HistoryMaxItems><HistoryMaxSize>6291456</HistoryMaxSize></Meta><Root>";
    out.push(head);
    group(tree);
    out.push("<DeletedObjects/></Root></KeePassFile>");
    return out.join("");
  }

  var Kdbx = {
    version: "1.0.0", UUID: UUID,
    read: read, write: write, setArgon2Loader: setArgon2Loader,
    // exposed for the tests
    chacha20: chacha20, salsa20: salsa20, aesKdf: aesKdf, parseXml: parseXml, keyFileKey: keyFileKey,
    compositeKey: compositeKey, readHeader: readHeader
  };
  if (NODE) module.exports = Kdbx;
  else root.Kdbx = Kdbx;
})(this);
