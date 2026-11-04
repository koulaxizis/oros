// ============================================================
// orOS Automations — incoming webhooks, the device side (wave A5, item 23)
// One box on the relay (relay/hook.js) per device that turns it on in
// Automations. The device keeps, in its own localStorage only (never
// synced): the box id, the read token, the address secret, its P-256
// key pair (JWK) and the auth secret. Every few minutes while orOS is
// open it pulls the waiting items, decrypts them here (RFC 8291
// aes128gcm, the relay's encrypt), hands each to Automations as the
// event "webhook.in" and acks them; it renews the box once a day.
//
//   decrypt(b64, privKey, pubRaw, auth) → Promise<string>   (pure; Node-tested)
//   textOf(json) → the words a rule's {text} gets (≤ 300)
//   window.orosHookIn = { state(), on(), off(), rotate(), url(), pull() }
// ============================================================
(function (root) {
  "use strict";

  var KEY = "oros-automations-hookin";
  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = webpush.js
  var PULL_MS = 3 * 60000, RENEW_MS = 86400000;

  function b64u(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(s) {
    var t = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    var out = new Uint8Array(t.length);
    for (var i = 0; i < t.length; i++) out[i] = t.charCodeAt(i);
    return out;
  }
  function cat() {
    var n = 0, i, o = 0;
    for (i = 0; i < arguments.length; i++) n += arguments[i].length;
    var out = new Uint8Array(n);
    for (i = 0; i < arguments.length; i++) { out.set(arguments[i], o); o += arguments[i].length; }
    return out;
  }
  function utf8(s) { return new TextEncoder().encode(s); }
  function rnd(n) { return b64u(crypto.getRandomValues(new Uint8Array(n))); }
  function hmac(key, data) {
    return crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      .then(function (k) { return crypto.subtle.sign("HMAC", k, data); })
      .then(function (b) { return new Uint8Array(b); });
  }
  function sha256hex(s) {
    return crypto.subtle.digest("SHA-256", utf8(s)).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
    });
  }

  // RFC 8291 receiver: privKey = our ECDH CryptoKey, pubRaw = our public
  // key (65 bytes), auth = 16 bytes.
  function decrypt(b64, privKey, pubRaw, auth) {
    var buf = unb64u(b64);
    var salt = buf.slice(0, 16), idlen = buf[20];
    var asPub = buf.slice(21, 21 + idlen), ct = buf.slice(21 + idlen);
    var prk;
    return crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, [])
      .then(function (asKey) { return crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, privKey, 256); })
      .then(function (bits) { return hmac(auth, new Uint8Array(bits)); })
      .then(function (prkKey) { return hmac(prkKey, cat(utf8("WebPush: info\0"), pubRaw, asPub, new Uint8Array([1]))); })
      .then(function (ikm) { return hmac(salt, ikm); })
      .then(function (p) { prk = p; return hmac(prk, cat(utf8("Content-Encoding: aes128gcm\0"), new Uint8Array([1]))); })
      .then(function (c) {
        var cek = c.slice(0, 16);
        return hmac(prk, cat(utf8("Content-Encoding: nonce\0"), new Uint8Array([1]))).then(function (n) {
          return crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]).then(function (k) {
            return crypto.subtle.decrypt({ name: "AES-GCM", iv: n.slice(0, 12) }, k, ct);
          });
        });
      })
      .then(function (plain) {
        var p = new Uint8Array(plain);
        if (p[p.length - 1] !== 2) throw new Error("record");
        return new TextDecoder().decode(p.subarray(0, p.length - 1));
      });
  }

  // What {text} becomes: a "text" (or "message") field when there is
  // one, else the JSON itself, on one line.
  function textOf(o) {
    var t = o && typeof o === "object" ? (typeof o.text === "string" ? o.text : typeof o.message === "string" ? o.message : "") : "";
    if (!t) { try { t = JSON.stringify(o); } catch (e) { t = ""; } }
    return String(t).replace(/\s+/g, " ").trim().slice(0, 300);
  }

  var api = { decrypt: decrypt, textOf: textOf, sha256hex: sha256hex, RELAY: RELAY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root || !root.document) return;

  // ---------- the device (shell page) ----------
  function read() {
    try { var o = JSON.parse(localStorage.getItem(KEY)); return o && typeof o === "object" && o.id ? o : null; } catch (e) { return null; }
  }
  function write(o) { try { if (o) localStorage.setItem(KEY, JSON.stringify(o)); else localStorage.removeItem(KEY); } catch (e) {} changed(); }
  var subs = [];
  function changed() { subs.forEach(function (f) { try { f(); } catch (e) {} }); }
  function fail(code) { var e = new Error(code); e.code = code; return e; }
  function relay(body) {
    body.op = "hook";
    return fetch(RELAY + "/v1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
                                  credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
      .catch(function () { throw fail("network"); })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (j) {
        if (!j || !j.ok) throw fail(j && j.error && typeof j.error.code === "string" ? j.error.code : "relay");
        return j.data;
      });
  }
  function url(s) { s = s || read(); return s ? RELAY + "/wh/" + s.id + "." + s.sec : ""; }

  function on() {
    var cur = read();
    if (cur) return Promise.resolve(cur);
    var s = { id: rnd(16), tok: rnd(32), sec: rnd(32), auth: rnd(16) }, kp;
    return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]).then(function (k) {
      kp = k;
      return Promise.all([crypto.subtle.exportKey("jwk", k.privateKey), crypto.subtle.exportKey("raw", k.publicKey), sha256hex(s.sec)]);
    }).then(function (r) {
      s.jwk = r[0];
      s.pub = b64u(new Uint8Array(r[1]));
      return relay({ act: "new", id: s.id, tok: s.tok, wh: r[2], key: s.pub, auth: s.auth });
    }).then(function (d) {
      s.exp = d.exp;
      s.renew = Date.now();
      write(s);
      return s;
    });
  }
  function off() {
    var s = read();
    write(null);
    return s ? relay({ act: "del", id: s.id, tok: s.tok }).catch(function () { return null; }) : Promise.resolve(null);
  }
  function rotate() {
    var s = read();
    if (!s) return Promise.reject(fail("off"));
    var sec = rnd(32);
    return sha256hex(sec).then(function (wh) { return relay({ act: "rot", id: s.id, tok: s.tok, wh: wh }); })
      .then(function () { s.sec = sec; write(s); return s; });
  }

  var busy = false;
  function pull() {
    var s = read(), H = root.orosAutomations;
    if (!s || busy || !H || typeof H.signal !== "function") return Promise.resolve(0);
    busy = true;
    var priv, pubRaw = unb64u(s.pub), auth = unb64u(s.auth), n = 0;
    var renew = Date.now() - (s.renew || 0) > RENEW_MS
      ? relay({ act: "renew", id: s.id, tok: s.tok }).then(function (d) { s.exp = d.exp; s.renew = Date.now(); write(s); })
      : Promise.resolve();
    return renew.then(function () {
      return crypto.subtle.importKey("jwk", s.jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    }).then(function (k) {
      priv = k;
      return relay({ act: "pull", id: s.id, tok: s.tok });
    }).then(function (d) {
      var items = d && Array.isArray(d.items) ? d.items : [];
      var done = [];
      return items.reduce(function (p, it) {
        return p.then(function () {
          return decrypt(it.ct, priv, pubRaw, auth).then(function (plain) {
            var o = null;
            try { o = JSON.parse(plain); } catch (e) {}
            H.signal("event", "webhook.in", "hook:" + s.id + ":" + it.i + ":" + it.at, textOf(o));
            n++;
          }, function () { /* unreadable (an older key): acked and dropped */ }).then(function () { done.push(it.i); });
        });
      }, Promise.resolve()).then(function () {
        return done.length ? relay({ act: "ack", id: s.id, tok: s.tok, ids: done }) : null;
      });
    }).then(function () { busy = false; s.err = ""; return n; }, function (e) {
      busy = false;
      if (e && e.code === "gone") { write(null); }   // expired or removed on the relay: off here too
      return 0;
    });
  }

  root.orosHookIn = {
    state: function () { var s = read(); return s ? { on: true, url: url(s), exp: s.exp || 0 } : { on: false, url: "", exp: 0 }; },
    on: function () { return on().then(function (s) { return url(s); }); },
    off: off,
    rotate: function () { return rotate().then(function (s) { return url(s); }); },
    pull: pull,
    onChange: function (f) { if (typeof f === "function") subs.push(f); }
  };
  setTimeout(pull, 20000);
  setInterval(function () { if (!document.hidden) pull(); }, PULL_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) pull(); });
})(typeof window !== "undefined" ? window : globalThis);
