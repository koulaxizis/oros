// ============================================================
// orOS Passwords — two-factor codes out to Aegis and 2FAS
// (PmOtpExport, v1.0.0, PW-OTP2)
// Pure logic, no DOM: the app (pmapp.js) and the tests
// (tests/passwords-otp.test.js) load this same file. Works on
// DECRYPTED entries in memory only; it stores and logs nothing.
//   codes(entries)            → [{ issuer, account, secret (base32),
//                                  algo "SHA1|SHA256|SHA512", digits,
//                                  period, uri }] (valid TOTP only,
//                                  sorted, one per secret + account)
//   toAegis(entries, password, deps) → Promise<JSON text>: an Aegis
//       encrypted vault (version 1, db version 2): a random master key
//       seals the list with AES-256-GCM, one password slot seals the
//       master key with scrypt (N 2^15, r 8, p 1) + AES-256-GCM, as
//       Aegis writes it. deps = { scrypt } (import.js) for the KDF.
//   to2fas(entries, now)      → JSON text: a 2FAS backup (.2fas,
//       schema 4) WITHOUT a password; the app asks for a confirmation
//       first, like the plain Bitwarden export.
// Both files are read back by import.js (tests do the round trip).
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module === "object" && module.exports;
  function core() { return NODE ? require("./pmcore.js") : root.PmCore; }
  function subtle() { return globalThis.crypto.subtle; }
  function rnd(n) { var a = new Uint8Array(n); globalThis.crypto.getRandomValues(a); return a; }
  function hex(b) { var s = ""; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16); return s; }
  function b64(b) {
    var s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
  }
  function uuid() {
    var h = hex(rnd(16));
    h = h.slice(0, 12) + "4" + h.slice(13, 16) + "89ab"[parseInt(h[16], 16) & 3] + h.slice(17);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32);
  }
  var ALGO_OUT = { "SHA-1": "SHA1", "SHA-256": "SHA256", "SHA-512": "SHA512" };

  function codes(entries) {
    var PC = core(), seen = {}, out = [];
    (entries || []).forEach(function (e) {
      if (!e || !e.totp) return;
      var o = PC.parseOtp(e.totp);
      if (o.error) return;
      var secret = PC.base32Encode(o.secret);
      var issuer = o.issuer || e.title || "", account = o.account || e.user || "";
      var key = secret + "|" + account.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      var algo = ALGO_OUT[o.algo] || "SHA1";
      var label = encodeURIComponent(issuer) + (issuer ? ":" : "") + encodeURIComponent(account);
      out.push({ issuer: issuer, account: account, secret: secret, algo: algo, digits: o.digits, period: o.period,
                 uri: "otpauth://totp/" + label + "?secret=" + secret + (issuer ? "&issuer=" + encodeURIComponent(issuer) : "") +
                      (algo !== "SHA1" ? "&algorithm=" + algo : "") + (o.digits !== 6 ? "&digits=" + o.digits : "") +
                      (o.period !== 30 ? "&period=" + o.period : "") });
    });
    return out.sort(function (a, b) {
      return (a.issuer || a.account).toLowerCase().localeCompare((b.issuer || b.account).toLowerCase());
    });
  }

  function gcmSeal(key, iv, data) {   // → { ct, tag }
    return subtle().importKey("raw", key, "AES-GCM", false, ["encrypt"]).then(function (k) {
      return subtle().encrypt({ name: "AES-GCM", iv: iv, tagLength: 128 }, k, data);
    }).then(function (b) {
      var all = new Uint8Array(b);
      return { ct: all.slice(0, all.length - 16), tag: all.slice(all.length - 16) };
    });
  }

  var AEGIS_KDF = { n: 32768, r: 8, p: 1 };
  function toAegis(entries, password, deps) {
    var list = codes(entries);
    if (!password) return Promise.reject(new Error("no-key"));
    if (!deps || typeof deps.scrypt !== "function") return Promise.reject(new Error("no-kdf"));
    var db = JSON.stringify({ version: 2, entries: list.map(function (c) {
      return { type: "totp", uuid: uuid(), name: c.account, issuer: c.issuer, group: null, note: "", favorite: false,
               icon: null, info: { secret: c.secret, algo: c.algo, digits: c.digits, period: c.period } };
    }) });
    var mk = rnd(32), salt = rnd(32), kn = rnd(12), dn = rnd(12);
    var pw = new TextEncoder().encode(String(password));
    var plain = new TextEncoder().encode(db);
    db = null;
    return deps.scrypt(pw, salt, AEGIS_KDF.n, AEGIS_KDF.r, AEGIS_KDF.p, 32).then(function (dk) {
      pw.fill(0);
      return gcmSeal(dk, kn, mk).then(function (k) { dk.fill(0); return k; });
    }).then(function (slotKey) {
      return gcmSeal(mk, dn, plain).then(function (sealed) {
        mk.fill(0); plain.fill(0);
        return JSON.stringify({
          version: 1,
          header: {
            slots: [{ type: 1, uuid: uuid(), key: hex(slotKey.ct), key_params: { nonce: hex(kn), tag: hex(slotKey.tag) },
                      n: AEGIS_KDF.n, r: AEGIS_KDF.r, p: AEGIS_KDF.p, salt: hex(salt), repaired: true, is_backup: false }],
            params: { nonce: hex(dn), tag: hex(sealed.tag) }
          },
          db: b64(sealed.ct)
        }, null, 4);
      });
    }, function (e) { pw.fill(0); mk.fill(0); plain.fill(0); throw e; });
  }

  function to2fas(entries, now) {
    now = now || Date.now();
    var list = codes(entries);
    return JSON.stringify({
      services: list.map(function (c, i) {
        var name = c.issuer || c.account || "?";
        return {
          name: name, secret: c.secret, updatedAt: now,
          otp: { label: c.issuer ? c.issuer + ":" + c.account : c.account, account: c.account, issuer: c.issuer,
                 digits: c.digits, period: c.period, algorithm: c.algo, tokenType: "TOTP", source: "Link" },
          order: { position: i },
          icon: { selected: "Label", label: { text: name.slice(0, 2).toUpperCase(), backgroundColor: "Default" },
                  iconCollection: { id: "a5b3fb65-4ec5-43e6-8ec1-49e24ca9e7ad" } }
        };
      }),
      groups: [], updatedAt: now, schemaVersion: 4, appVersionCode: 5000029, appVersionName: "5.0.0", appOrigin: "android"
    });
  }

  var API = { version: "1.0.0", codes: codes, toAegis: toAegis, to2fas: to2fas, AEGIS_KDF: AEGIS_KDF };
  if (NODE) module.exports = API;
  else root.PmOtpExport = API;
})(typeof window !== "undefined" ? window : this);
