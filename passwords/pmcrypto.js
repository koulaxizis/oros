// ============================================================
// orOS Passwords — vault crypto + sync slice (PmVault, v2.0.0)
// Pure logic over WebCrypto, no DOM: the app (pmapp.js) and the
// tests (tests/passwords-vault.test.js) load this same file.
// The security design is in OROS_BIBLE.md, Part IV, PASSWORDS v2.
//   1. Bytes: base64, hex, utf-8, random, canonical JSON
//   2. KDF: Argon2id (vendored hash-wasm, MIT) or PBKDF2-SHA-256
//   3. Keys: KEK -> wrapped vault key VK -> HKDF -> EK + IK
//   4. Vault life: create, unlock, recovery key, password change
//   5. Blobs: seal a snapshot (random IV) or a merge (derived IV)
//   6. Slice: normalise + the pure sync merge (no keys needed)
// Never logs, stores or returns a secret it was not asked for.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module === "object" && module.exports;
  var subtle = (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) || null;
  function cryptoObj() { return (typeof globalThis !== "undefined" && globalThis.crypto) || null; }

  var V = 1;
  var KDF_ARGON = { alg: "argon2id", m: 65536, t: 3, p: 1 };   // KiB, passes, lanes
  var PBKDF2_ITER = 600000;
  var BOUNDS = { mMin: 8192, mMax: 1048576, tMin: 1, tMax: 20, pMin: 1, pMax: 8,
                 iMin: 600000, iMax: 5000000 };
  var SUP_MAX = 64;          // superseded ids kept per blob
  var BLOB_MAX = 64;         // blobs kept per vault (more = a broken peer)
  var CT_MAX = 16 * 1024 * 1024;

  // ---------- 1. Bytes ----------
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function b64(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var out = "", i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    var r = bytes.length - i;
    if (r === 1) { var a = bytes[i] << 16; out += B64[a >> 18] + B64[(a >> 12) & 63] + "=="; }
    else if (r === 2) { var b = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64[b >> 18] + B64[(b >> 12) & 63] + B64[(b >> 6) & 63] + "="; }
    return out;
  }
  var B64REV = null;
  function unb64(s) {
    if (typeof s !== "string") throw new Error("bad-b64");
    s = s.replace(/[\s]/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!B64REV) { B64REV = {}; for (var k = 0; k < 64; k++) B64REV[B64[k]] = k; }
    s = s.replace(/=+$/, "");
    if (s.length % 4 === 1) throw new Error("bad-b64");
    var out = new Uint8Array(Math.floor(s.length * 3 / 4)), o = 0, buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      var v = B64REV[s[i]];
      if (v === undefined) throw new Error("bad-b64");
      buf = (buf << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; }
    }
    return out.subarray(0, o);
  }
  function hex(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return s;
  }
  function utf8(s) { return new TextEncoder().encode(s); }
  function fromUtf8(b) { return new TextDecoder("utf-8", { fatal: true }).decode(b); }
  function random(n) { var a = new Uint8Array(n); cryptoObj().getRandomValues(a); return a; }
  function wipe(a) { if (a && a.fill) a.fill(0); }
  function concat() {
    var len = 0, i;
    for (i = 0; i < arguments.length; i++) len += arguments[i].length;
    var out = new Uint8Array(len), o = 0;
    for (i = 0; i < arguments.length; i++) { out.set(arguments[i], o); o += arguments[i].length; }
    return out;
  }

  // Stable JSON: object keys sorted at every level (two devices write
  // the same bytes for the same data, and equality is a string test).
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
  }
  function sorted(obj) {
    var out = {};
    Object.keys(obj).sort().forEach(function (k) { out[k] = obj[k]; });
    return out;
  }

  // ---------- 2. KDF ----------
  var argonImpl = null;      // { argon2id(opts) } from hash-wasm
  function setArgon2(impl) { argonImpl = impl || null; }
  function hasWasm() { return typeof WebAssembly === "object" && WebAssembly && typeof WebAssembly.instantiate === "function"; }
  // Browser: the vendored file is loaded on first use (its UMD wrapper
  // sets window.hashwasm). No element of the page may have the id
  // "exports", "module" or "define" (the wrapper would use it).
  var argonLoading = null;
  function loadArgon2(src) {
    if (argonImpl) return Promise.resolve(argonImpl);
    if (NODE) {
      try { argonImpl = require("../vendor/hash-wasm/argon2.umd.min.js"); return Promise.resolve(argonImpl); }
      catch (e) { return Promise.reject(new Error("no-argon2")); }
    }
    if (root.hashwasm && root.hashwasm.argon2id) { argonImpl = root.hashwasm; return Promise.resolve(argonImpl); }
    if (!hasWasm()) return Promise.reject(new Error("no-wasm"));
    if (argonLoading) return argonLoading;
    argonLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src || "../vendor/hash-wasm/argon2.umd.min.js";
      s.onload = function () {
        if (root.hashwasm && root.hashwasm.argon2id) { argonImpl = root.hashwasm; resolve(argonImpl); }
        else { argonLoading = null; reject(new Error("no-argon2")); }
      };
      s.onerror = function () { argonLoading = null; reject(new Error("no-argon2")); };
      document.head.appendChild(s);
    });
    return argonLoading;
  }

  function intIn(v, lo, hi) { return typeof v === "number" && Math.floor(v) === v && v >= lo && v <= hi; }
  // A header's KDF settings, or null when they are out of bounds.
  function normKdf(k) {
    if (!k || typeof k !== "object" || typeof k.salt !== "string") return null;
    var salt;
    try { salt = unb64(k.salt); } catch (e) { return null; }
    if (salt.length < 16 || salt.length > 64) return null;
    if (k.alg === "argon2id" && intIn(k.m, BOUNDS.mMin, BOUNDS.mMax) && intIn(k.t, BOUNDS.tMin, BOUNDS.tMax) &&
        intIn(k.p, BOUNDS.pMin, BOUNDS.pMax)) return { alg: "argon2id", m: k.m, p: k.p, salt: k.salt, t: k.t };
    if (k.alg === "pbkdf2-sha256" && intIn(k.i, BOUNDS.iMin, BOUNDS.iMax)) return { alg: "pbkdf2-sha256", i: k.i, salt: k.salt };
    return null;
  }

  function normPassword(pw) { return utf8(String(pw).normalize("NFC")); }

  // 32 bytes from the master password. The caller wipes them.
  function kdfBytes(kdf, password) {
    var k = normKdf(kdf);
    if (!k) return Promise.reject(new Error("bad-kdf"));
    var salt = unb64(k.salt), pw = normPassword(password);
    if (k.alg === "argon2id") {
      return loadArgon2().then(function (impl) {
        return impl.argon2id({ password: pw, salt: salt, parallelism: k.p, iterations: k.t,
                               memorySize: k.m, hashLength: 32, outputType: "binary" });
      }).then(function (out) { wipe(pw); return new Uint8Array(out); },
              function (e) { wipe(pw); throw e; });
    }
    return subtle.importKey("raw", pw, "PBKDF2", false, ["deriveBits"]).then(function (key) {
      wipe(pw);
      return subtle.deriveBits({ name: "PBKDF2", salt: salt, iterations: k.i, hash: "SHA-256" }, key, 256);
    }).then(function (bits) { return new Uint8Array(bits); });
  }

  // KDF settings for a new vault: Argon2id when WebAssembly works,
  // else PBKDF2. `opts.kdf` (tests) overrides.
  function newKdf(opts) {
    var salt = b64(random(16));
    if (opts && opts.kdf) {
      var k = {}; Object.keys(opts.kdf).forEach(function (n) { k[n] = opts.kdf[n]; });
      k.salt = salt;
      return Promise.resolve(k);
    }
    return loadArgon2().then(function () {
      return { alg: "argon2id", m: KDF_ARGON.m, p: KDF_ARGON.p, salt: salt, t: KDF_ARGON.t };
    }, function () {
      return { alg: "pbkdf2-sha256", i: PBKDF2_ITER, salt: salt };
    });
  }

  // ---------- 3. Keys ----------
  function aesKey(raw, usages) { return subtle.importKey("raw", raw, { name: "AES-GCM" }, false, usages); }
  function gcmEncrypt(key, iv, plain, aad) {
    return subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: utf8(aad), tagLength: 128 }, key, plain)
      .then(function (ct) { return new Uint8Array(ct); });
  }
  function gcmDecrypt(key, iv, ct, aad) {
    return subtle.decrypt({ name: "AES-GCM", iv: iv, additionalData: utf8(aad), tagLength: 128 }, key, ct)
      .then(function (p) { return new Uint8Array(p); });
  }
  function hkdf(raw, salt, info, alg, usages) {
    return subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]).then(function (base) {
      return subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: utf8(salt), info: utf8(info) }, base, alg, false, usages);
    });
  }
  function aadPw(kid) { return "oros-pm/1/pw/" + kid; }
  function aadRk(kid) { return "oros-pm/1/rk/" + kid; }

  // Wrap / unwrap VK with the master password.
  function wrapWithPassword(vk, kid, kdf, password) {
    return kdfBytes(kdf, password).then(function (kb) {
      return aesKey(kb, ["encrypt"]).then(function (kek) {
        wipe(kb);
        var iv = random(12);
        return gcmEncrypt(kek, iv, vk, aadPw(kid)).then(function (ct) { return { ct: b64(ct), iv: b64(iv) }; });
      });
    });
  }
  function rkKek(rkBytes, kid, usage) {
    return hkdf(rkBytes, kid, "oros-pm/1/rk", { name: "AES-GCM", length: 256 }, [usage]);
  }
  function wrapWithRecovery(vk, kid, rkBytes) {
    return rkKek(rkBytes, kid, "encrypt").then(function (kek) {
      var iv = random(12);
      return gcmEncrypt(kek, iv, vk, aadRk(kid)).then(function (ct) { return { ct: b64(ct), iv: b64(iv) }; });
    });
  }

  // Recovery key: 16 random bytes as 26 Crockford base32 characters,
  // shown in groups of 4 (the last group has 2).
  var CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  function rkEncode(bytes) {
    var out = "", buf = 0, bits = 0;
    for (var i = 0; i < bytes.length; i++) {
      buf = (buf << 8) | bytes[i]; bits += 8;
      while (bits >= 5) { bits -= 5; out += CROCK[(buf >> bits) & 31]; }
      buf &= (1 << bits) - 1;
    }
    if (bits > 0) out += CROCK[(buf << (5 - bits)) & 31];
    return out.match(/.{1,4}/g).join("-");
  }
  function rkDecode(s) {
    var c = String(s || "").toUpperCase().replace(/[\s-]/g, "").replace(/[OI L]/g, function (x) {
      return x === "O" ? "0" : "1";
    });
    if (c.length !== 26) return null;
    var out = new Uint8Array(16), o = 0, buf = 0, bits = 0;
    for (var i = 0; i < c.length; i++) {
      var v = CROCK.indexOf(c[i]);
      if (v < 0) return null;
      buf = (buf << 5) | v; bits += 5;
      if (bits >= 8) { bits -= 8; if (o < 16) out[o++] = (buf >> bits) & 255; }
      buf &= (1 << bits) - 1;
    }
    return o === 16 ? out : null;
  }

  // VK (32 raw bytes) from a vault header; the caller wipes them.
  function openVK(vault, kid, cred) {
    if (!vault) return Promise.reject(new Error("no-vault"));
    if (cred && cred.recovery != null) {
      var rk = rkDecode(cred.recovery);
      if (!rk || !vault.rk) return Promise.reject(new Error("wrong-recovery"));
      return rkKek(rk, kid, "decrypt").then(function (kek) {
        wipe(rk);
        return gcmDecrypt(kek, unb64(vault.rk.iv), unb64(vault.rk.ct), aadRk(kid));
      }).then(null, function () { throw new Error("wrong-recovery"); });
    }
    var kdf = normKdf(vault.kdf);
    if (!kdf) return Promise.reject(new Error("bad-kdf"));
    if (!cred || typeof cred.password !== "string" || !cred.password) return Promise.reject(new Error("wrong-password"));
    return kdfBytes(kdf, cred.password).then(function (kb) {
      return aesKey(kb, ["decrypt"]).then(function (kek) {
        wipe(kb);
        return gcmDecrypt(kek, unb64(vault.pw.iv), unb64(vault.pw.ct), aadPw(kid))
          .then(null, function () { throw new Error("wrong-password"); });
      });
    });
  }

  // Session = the two working keys of one open vault. VK is wiped.
  function sessionFromVK(vk, kid) {
    if (!(vk instanceof Uint8Array) || vk.length !== 32) return Promise.reject(new Error("bad-key"));
    return Promise.all([
      hkdf(vk, kid, "oros-pm/1/enc", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
      hkdf(vk, kid, "oros-pm/1/iv", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"])
    ]).then(function (k) {
      wipe(vk);
      return { kid: kid, ek: k[0], ik: k[1] };
    }, function (e) { wipe(vk); throw e; });
  }

  // ---------- 4. Vault life ----------
  function newKid() { return hex(random(12)); }

  // A new vault: { kid, vault (header + no blob), session, recovery }.
  function create(password, opts) {
    if (typeof password !== "string" || !password) return Promise.reject(new Error("no-password"));
    var kid = newKid(), vk = random(32), rk = random(16), now = (opts && opts.now) || Date.now();
    var recovery = rkEncode(rk);
    return newKdf(opts).then(function (kdf) {
      return Promise.all([wrapWithPassword(vk, kid, kdf, password), wrapWithRecovery(vk, kid, rk)])
        .then(function (w) {
          wipe(rk);
          var vault = { blobs: {}, c: now, kdf: kdf, kt: now, pw: w[0], rk: w[1] };
          return sessionFromVK(vk, kid).then(function (session) {
            return { kid: kid, vault: vault, session: session, recovery: recovery };
          });
        });
    }).then(null, function (e) { wipe(vk); wipe(rk); throw e; });
  }

  function unlock(vault, kid, password) {
    return openVK(vault, kid, { password: password }).then(function (vk) { return sessionFromVK(vk, kid); });
  }

  function headerCopy(vault) {
    return { blobs: {}, c: vault.c, kdf: vault.kdf, kt: vault.kt, pw: vault.pw, rk: vault.rk };
  }

  // New master password (the current one, or the recovery key, opens
  // VK first). Returns { vault: header with no blobs, session }; the
  // caller merges it into the stored slice (larger kt wins).
  function rewrap(vault, kid, cred, newPassword, opts) {
    var now = (opts && opts.now) || Date.now();
    if (typeof newPassword !== "string" || !newPassword) return Promise.reject(new Error("no-password"));
    return openVK(vault, kid, cred).then(function (vk) {
      return newKdf(opts).then(function (kdf) {
        return wrapWithPassword(vk, kid, kdf, newPassword).then(function (pw) {
          var h = headerCopy(vault);
          h.kdf = kdf; h.pw = pw; h.kt = Math.max(now, (vault.kt || 0) + 1);
          return sessionFromVK(vk, kid).then(function (session) { return { vault: h, session: session }; });
        });
      }).then(null, function (e) { wipe(vk); throw e; });
    });
  }

  // A new recovery key (the master password opens VK first).
  function newRecovery(vault, kid, password, opts) {
    var now = (opts && opts.now) || Date.now();
    return openVK(vault, kid, { password: password }).then(function (vk) {
      var rk = random(16), recovery = rkEncode(rk);
      return wrapWithRecovery(vk, kid, rk).then(function (w) {
        wipe(vk); wipe(rk);
        var h = headerCopy(vault);
        h.rk = w; h.kt = Math.max(now, (vault.kt || 0) + 1);
        return { vault: h, recovery: recovery };
      }, function (e) { wipe(vk); wipe(rk); throw e; });
    });
  }

  // ---------- 5. Blobs ----------
  function blobAad(kid, id, t, sup) { return "oros-pm/1|" + kid + "|" + id + "|" + t + "|" + sup.join(","); }

  function supOf(vault, ids) {
    var all = {};
    ids.forEach(function (id) {
      all[id] = 1;
      var b = vault.blobs[id];
      if (b && b.sup) b.sup.forEach(function (s) { all[s] = 1; });
    });
    var direct = ids.slice().sort();
    var older = Object.keys(all).filter(function (s) { return direct.indexOf(s) < 0; }).sort();
    return direct.concat(older.slice(Math.max(0, older.length - Math.max(0, SUP_MAX - direct.length)))).sort();
  }

  // Seal a full snapshot as a new blob superseding every blob the vault
  // holds now. Returns { id, blob } (the caller merges it in).
  function seal(session, vault, snapshot, opts) {
    var now = (opts && opts.now) || Date.now();
    var id = "s" + hex(random(16));
    // opts.ids: the blobs this snapshot really contains (the app leaves
    // out a blob it could not open, so that one is never dropped).
    var sup = supOf(vault, (opts && opts.ids) || Object.keys(vault.blobs || {}));
    var iv = random(12);
    return gcmEncrypt(session.ek, iv, utf8(canon(snapshot)), blobAad(session.kid, id, now, sup))
      .then(function (ct) { return { id: id, blob: { ct: b64(ct), iv: b64(iv), sup: sup, t: now } }; });
  }

  // The merge of exactly these blobs: id, IV and t follow from the ids,
  // so two devices merging the same blobs write the same bytes.
  function mergeId(ids) {
    return subtle.digest("SHA-256", utf8(ids.slice().sort().join(","))).then(function (d) {
      return "x" + hex(new Uint8Array(d)).slice(0, 32);
    });
  }
  function sealMerge(session, vault, ids, snapshot) {
    var sup = supOf(vault, ids);
    var t = 0;
    ids.forEach(function (id) { var b = vault.blobs[id]; if (b && b.t > t) t = b.t; });
    return mergeId(ids).then(function (id) {
      return subtle.sign("HMAC", session.ik, utf8("oros-pm/1/iv|" + id)).then(function (mac) {
        var iv = new Uint8Array(mac).slice(0, 12);
        return gcmEncrypt(session.ek, iv, utf8(canon(snapshot)), blobAad(session.kid, id, t, sup))
          .then(function (ct) { return { id: id, blob: { ct: b64(ct), iv: b64(iv), sup: sup, t: t } }; });
      });
    });
  }

  function openBlob(session, id, blob) {
    return gcmDecrypt(session.ek, unb64(blob.iv), unb64(blob.ct), blobAad(session.kid, id, blob.t, blob.sup))
      .then(function (p) { return JSON.parse(fromUtf8(p)); })
      .then(null, function () { throw new Error("bad-blob"); });
  }

  // ---------- 6. Slice ----------
  function isB64(s, max) { return typeof s === "string" && s.length > 0 && s.length <= max && /^[A-Za-z0-9+/]+=*$/.test(s); }
  function okWrap(w) { return w && typeof w === "object" && isB64(w.iv, 24) && isB64(w.ct, 200); }
  function okTime(n) { return typeof n === "number" && isFinite(n) && n >= 0 && n < 1e14; }
  var ID_RE = /^[sx][0-9a-f]{32}$/, KID_RE = /^[0-9a-f]{24}$/;

  function normBlob(b) {
    if (!b || typeof b !== "object" || !okTime(b.t) || !isB64(b.iv, 24) || !isB64(b.ct, CT_MAX)) return null;
    var sup = Array.isArray(b.sup) ? b.sup.filter(function (s) { return typeof s === "string" && ID_RE.test(s); }) : [];
    sup = sup.filter(function (s, i) { return sup.indexOf(s) === i; }).sort().slice(0, SUP_MAX);
    if (Array.isArray(b.sup) && sup.length !== b.sup.length) return null;   // the AAD would not match anyway
    return { ct: b.ct, iv: b.iv, sup: sup, t: b.t };
  }
  // KDF settings this version cannot use (a newer orOS, other bounds)
  // are kept as they are, so this device never drops such a vault; it
  // just cannot open it (openVK: "bad-kdf").
  function opaqueKdf(k) {
    if (!k || typeof k !== "object" || typeof k.alg !== "string" || Object.keys(k).length > 12) return null;
    var out = {};
    var ok = Object.keys(k).sort().every(function (n) {
      var x = k[n];
      if (typeof x === "number" ? !isFinite(x) : !(typeof x === "string" && x.length <= 200)) return false;
      out[n] = x;
      return true;
    });
    return ok ? out : null;
  }
  function normVault(v) {
    if (!v || typeof v !== "object" || !okTime(v.c) || !okTime(v.kt)) return null;
    var kdf = normKdf(v.kdf) || opaqueKdf(v.kdf);
    if (!kdf || !okWrap(v.pw)) return null;
    var out = { blobs: {}, c: v.c, kdf: kdf, kt: v.kt, pw: { ct: v.pw.ct, iv: v.pw.iv },
                rk: okWrap(v.rk) ? { ct: v.rk.ct, iv: v.rk.iv } : null };
    var blobs = v.blobs && typeof v.blobs === "object" ? v.blobs : {};
    Object.keys(blobs).sort().forEach(function (id) {
      if (!ID_RE.test(id)) return;
      var b = normBlob(blobs[id]);
      if (b) out.blobs[id] = b;
    });
    return out;
  }
  function empty() { return { gone: {}, v: V, vaults: {} }; }
  // A slice written by a NEWER format (v > 1) is kept whole and never
  // rewritten here: the app says "update orOS" instead of wiping it.
  function isFuture(raw) { return !!raw && typeof raw === "object" && typeof raw.v === "number" && raw.v > V; }
  function normSlice(raw) {
    var out = empty();
    if (isFuture(raw)) return JSON.parse(JSON.stringify(raw));
    if (!raw || typeof raw !== "object" || raw.v !== V) return out;
    var gone = raw.gone && typeof raw.gone === "object" ? raw.gone : {};
    Object.keys(gone).sort().forEach(function (k) { if (KID_RE.test(k) && okTime(gone[k])) out.gone[k] = gone[k]; });
    var vaults = raw.vaults && typeof raw.vaults === "object" ? raw.vaults : {};
    Object.keys(vaults).sort().forEach(function (k) {
      if (!KID_RE.test(k) || out.gone[k] !== undefined) return;
      var v = normVault(vaults[k]);
      if (v) out.vaults[k] = v;
    });
    return out;
  }

  // Drop every blob another blob of the same vault supersedes.
  function prune(blobs) {
    var dead = {};
    Object.keys(blobs).forEach(function (id) { blobs[id].sup.forEach(function (s) { if (s !== id) dead[s] = 1; }); });
    var out = {}, ids = Object.keys(blobs).filter(function (id) { return !dead[id]; }).sort();
    // A peer that never merges must not grow the slice for ever: keep
    // the newest BLOB_MAX (by t, then id).
    if (ids.length > BLOB_MAX) {
      ids = ids.slice().sort(function (a, b) { return (blobs[b].t - blobs[a].t) || (a < b ? 1 : -1); })
        .slice(0, BLOB_MAX).sort();
    }
    ids.forEach(function (id) { out[id] = blobs[id]; });
    return out;
  }

  function headerKey(v) { return canon({ kdf: v.kdf, kt: v.kt, pw: v.pw, rk: v.rk }); }

  function mergeVault(a, b) {
    var h = a;
    if (b.kt > a.kt || (b.kt === a.kt && headerKey(b) > headerKey(a))) h = b;
    var blobs = {};
    [a.blobs, b.blobs].forEach(function (src) {
      Object.keys(src).forEach(function (id) {
        if (!blobs[id] || canon(src[id]) > canon(blobs[id])) blobs[id] = src[id];
      });
    });
    return { blobs: sorted(prune(blobs)), c: Math.min(a.c, b.c), kdf: h.kdf, kt: h.kt, pw: h.pw, rk: h.rk };
  }

  // The sync merge: pure, deterministic, symmetric, no keys.
  function mergeSlice(x, y) {
    if (isFuture(x) || isFuture(y)) {
      var fx = isFuture(x) ? x : null, fy = isFuture(y) ? y : null;
      var pick = !fy ? fx : !fx ? fy : (fx.v !== fy.v ? (fx.v > fy.v ? fx : fy) : (canon(fx) >= canon(fy) ? fx : fy));
      return JSON.parse(JSON.stringify(pick));
    }
    var a = normSlice(x), b = normSlice(y), out = empty();
    var gone = {};
    [a.gone, b.gone].forEach(function (g) { Object.keys(g).forEach(function (k) { gone[k] = Math.max(gone[k] || 0, g[k]); }); });
    out.gone = sorted(gone);
    var kids = {};
    Object.keys(a.vaults).concat(Object.keys(b.vaults)).forEach(function (k) { kids[k] = 1; });
    Object.keys(kids).sort().forEach(function (k) {
      if (gone[k] !== undefined) return;
      var va = a.vaults[k], vb = b.vaults[k];
      out.vaults[k] = va && vb ? mergeVault(va, vb) : (va || vb);
      out.vaults[k].blobs = sorted(prune(out.vaults[k].blobs));
    });
    return out;
  }

  // The vault this device shows: the oldest, then the smaller kid.
  function primaryKid(slice) {
    var ks = Object.keys(slice.vaults || {});
    ks.sort(function (p, q) { return (slice.vaults[p].c - slice.vaults[q].c) || (p < q ? -1 : 1); });
    return ks[0] || null;
  }

  // Put a header and/or one new blob of vault `kid` into a slice.
  function withVault(slice, kid, vault, blobId, blob) {
    var v = { blobs: {}, c: vault.c, kdf: vault.kdf, kt: vault.kt, pw: vault.pw, rk: vault.rk };
    if (blobId) v.blobs[blobId] = blob;
    var part = { gone: {}, v: V, vaults: {} };
    part.vaults[kid] = v;
    return mergeSlice(slice, part);
  }
  function withGone(slice, kid, now) {
    var part = { gone: {}, v: V, vaults: {} };
    part.gone[kid] = now || Date.now();
    return mergeSlice(slice, part);
  }

  var PmVault = {
    version: "2.0.0", V: V, KDF_ARGON: KDF_ARGON, PBKDF2_ITER: PBKDF2_ITER, BOUNDS: BOUNDS,
    b64: b64, unb64: unb64, hex: hex, utf8: utf8, canon: canon, random: random, concat: concat, wipe: wipe,
    setArgon2: setArgon2, loadArgon2: loadArgon2, hasWasm: hasWasm, normKdf: normKdf, kdfBytes: kdfBytes,
    rkEncode: rkEncode, rkDecode: rkDecode,
    create: create, unlock: unlock, openVK: openVK, sessionFromVK: sessionFromVK,
    rewrap: rewrap, newRecovery: newRecovery,
    seal: seal, sealMerge: sealMerge, mergeId: mergeId, openBlob: openBlob,
    empty: empty, normSlice: normSlice, isFuture: isFuture, mergeSlice: mergeSlice, primaryKid: primaryKid,
    withVault: withVault, withGone: withGone
  };

  if (NODE) module.exports = PmVault;
  else root.PmVault = PmVault;
})(this);
