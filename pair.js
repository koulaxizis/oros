/* ============================================================
   orOS — Add a browser (PAIR-1, LINK-1), v1.1.0
   A new browser gets the cloud sign-in and the sync passphrase from a
   device that is already signed in, in one step, end-to-end encrypted.

   The new browser makes a code (12 characters, Crockford base32, about
   60 bits), shows it as text and as a QR code, and waits in a room on
   the orOS relay (relay/remote.js, /rt/<room>). The room id is a hash
   of the code and the key is derived from the code, so the relay only
   ever passes sealed frames on and stores nothing; a room closes after
   two minutes without traffic, which is the code's lifetime.

   The signed-in device types or scans the code and joins. Both sides
   say hello with a random nonce and show the same four-digit
   confirmation number (a hash of the code and both nonces). The person
   approves on the signed-in device only when the browser in front of
   them shows that number; only then is the bundle (from sync.js
   pairBundle) sent. The new browser adopts it (sync.js pairAdopt) and
   answers ok or no. One bundle per code; then both sides close.

   Every frame is sealed with AES-GCM; the sender's role is the
   additional data, so a frame cannot be reflected back to its sender.

   window.OrosPair = { newCode, normCode, fmtCode, CODE_RE, derive, seal,
     unseal, checkNumber, codeFromText, qrText, browserLabel, wsUrl,
     RELAY, Session }
   new Session({ role: "new"|"old", code, relay?, dev, WebSocket?,
     onState(phase, info), onBundle(bundle) → Promise (new),
     bundle() → Promise<bundle> (old) })
     .start(), .approve() (old), .cancel()
   Phases, new: wait → peer {check, dev} → adopting → done | error {e}
           old: connecting → approve {check, dev} → sending → done | error {e}
   Errors: expired, nocode, left, refused, net, bad, busy.

   Sign-in link (LINK-1, 1.1.0): the same bundle, for a browser that
   signs in later, without the other device at hand. The signed-in
   device seals { t:"oros-signin", v:1, b: bundle, dev, del } as a
   password link of "Send to someone" (share/relay.js, kind q1): the
   pieces wait on the relay for 15 minutes, the link's #fragment holds
   the address and the link key, and the password is an 8-character
   code (Crockford base32, 40 bits) that the sending device shows and
   that never goes into the link. The key that opens the pieces is
   HKDF(link key ‖ PBKDF2-SHA-256(code, salt, 600,000)): the link alone
   or the code alone opens nothing, and the relay sees neither. The
   browser that opens it deletes the pieces at once with the revoke
   secret it found inside (one use); the sender can cancel it too.
     newLinkCode(), normLinkCode(text), fmtLinkCode(code), LINK_MS,
     linkUrl(share, origin), linkFromText(text),
     sendLink(bundle, { R, dev?, origin?, now?, fetch?, relay? })
       → Promise<{ url, code, id, del, exp }>  (throws Error from R.create)
     openLink(share, code, { R, now?, fetch?, relay? })
       → Promise<{ b, dev, id, del, x } | { error }>  gone | pass | bad | net
     linkAlive(id, { fetch?, relay? }) → Promise<true | false | null>
   ============================================================ */
(function (root) {
  "use strict";

  var VERSION = "1.1.0";
  var NS = "oros-pair/v1";
  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // orOS's own relay on BOTH sides
  var ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";                 // Crockford base32
  var CODE_LEN = 12;
  var CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;
  var NONCE_RE = /^[0-9a-f]{32}$/;
  var KDF_ROUNDS = 200000;
  var MAX_FRAME = 12000;

  var C = root.crypto || (typeof require === "function" ? require("crypto").webcrypto : null);
  var enc = new TextEncoder(), dec = new TextDecoder();

  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function b64(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  // ---------- 1. Codes ----------
  function newCode() {
    var b = C.getRandomValues(new Uint8Array(CODE_LEN)), s = "";
    for (var i = 0; i < CODE_LEN; i++) s += ALPHA[b[i] & 31];
    return s;
  }
  // What a person typed → the code, or "" when it is not one. Spaces,
  // dashes and case do not matter; I and L read as 1, O as 0 (Crockford).
  function normCode(input) {
    var s = String(input == null ? "" : input).toUpperCase().replace(/[\s\-_.·]/g, "")
      .replace(/[IL]/g, "1").replace(/O/g, "0");
    return CODE_RE.test(s) ? s : "";
  }
  function fmtCode(code) { return code.slice(0, 4) + "-" + code.slice(4, 8) + "-" + code.slice(8, 12); }

  // The QR holds an address, so a phone's camera app opens orOS at
  // the pairing screen. A local copy (Portable, USB, localhost) cannot
  // be opened from a phone: the address is then useoros.online.
  function qrText(code, origin) {
    return baseUrl(origin) + "/#pair=" + fmtCode(code);
  }
  // A scanned or pasted text → the code, or "".
  function codeFromText(text) {
    var s = String(text || "").trim();
    var m = /[#&]pair=([0-9A-Za-z\-]{12,20})/.exec(s);
    return normCode(m ? m[1] : s);
  }

  // ---------- 2. Keys and frames ----------
  function derive(code) {
    var S = C.subtle;
    return Promise.all([
      S.digest("SHA-256", enc.encode(NS + "/room/" + code)),
      S.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]).then(function (base) {
        return S.deriveKey({ name: "PBKDF2", salt: enc.encode(NS + "/key"), iterations: KDF_ROUNDS, hash: "SHA-256" },
          base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      })
    ]).then(function (r) { return { room: hex(r[0]), key: r[1] }; });
  }
  function seal(key, from, obj) {
    var iv = C.getRandomValues(new Uint8Array(12));
    return C.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: enc.encode(NS + "/" + from) }, key,
      enc.encode(JSON.stringify(obj))).then(function (ct) {
      var out = new Uint8Array(12 + ct.byteLength);
      out.set(iv, 0); out.set(new Uint8Array(ct), 12);
      return b64(out);
    });
  }
  // null for anything that is not a frame from `from` under this key.
  function unseal(key, from, text) {
    try {
      if (typeof text !== "string" || text.length > MAX_FRAME * 2) return Promise.resolve(null);
      var u8 = unb64(text);
      if (u8.length < 29) return Promise.resolve(null);
      return C.subtle.decrypt({ name: "AES-GCM", iv: u8.subarray(0, 12), additionalData: enc.encode(NS + "/" + from) },
        key, u8.subarray(12)).then(function (pt) {
        var o = JSON.parse(dec.decode(pt));
        return (o && typeof o === "object") ? o : null;
      }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function checkNumber(code, nNew, nOld) {
    return C.subtle.digest("SHA-256", enc.encode(NS + "/check/" + code + "/" + nNew + "/" + nOld)).then(function (h) {
      var b = new Uint8Array(h), n = ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
      return String(n % 10000).padStart(4, "0");
    });
  }
  function wsUrl(relay, room) { return String(relay).replace(/^http(s?):/, "ws$1:").replace(/\/+$/, "") + "/rt/" + room; }

  // "Chrome on Windows" from a user agent; only what the approval
  // screen needs to tell two browsers apart.
  function browserLabel(ua) {
    ua = String(ua || "");
    var b = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" :
      /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Chrome\/|Chromium\//.test(ua) ? "Chrome" :
      /Safari\//.test(ua) ? "Safari" : "Browser";
    var os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" :
      /CrOS/.test(ua) ? "ChromeOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
    return os ? b + " · " + os : b;
  }
  function cleanDev(s) { return String(s || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 60); }

  // ---------- 3. Session ----------
  function Session(o) {
    var self = this;
    var role = o.role === "old" ? "old" : "new", other = role === "new" ? "old" : "new";
    var WS = o.WebSocket || root.WebSocket;
    var code = o.code, relay = o.relay || RELAY;
    var keys = null, ws = null, ended = false, phase = "";
    var myNonce = hex(C.getRandomValues(new Uint8Array(16))), theirNonce = "", saidHi = false, check = "";
    var sendQ = Promise.resolve(), inQ = Promise.resolve();
    this.role = role;
    this.phase = "";

    function set(p, info) {
      if (ended && p !== "done" && p !== "error") return;
      phase = p;
      self.phase = p;
      if (p === "done" || p === "error") ended = true;
      if (o.onState) { try { o.onState(p, info || {}); } catch (e) {} }
      if (ended) close();
    }
    function fail(e) { if (!ended) set("error", { e: e }); }
    function close() { try { if (ws) ws.close(1000, "bye"); } catch (e) {} }
    function send(obj) {
      var w = ws;
      sendQ = sendQ.then(function () { return seal(keys.key, role, obj); }).then(function (txt) {
        if (w && w.readyState === 1) w.send(txt);
      }, function () {});
      return sendQ;
    }
    function hello() {
      if (saidHi) return;
      saidHi = true;
      send({ t: "hi", n: myNonce, dev: cleanDev(o.dev) });
    }
    function onFrame(data) {
      if (typeof data !== "string" || ended) return;
      if (data === "pong") return;
      var sys = null;
      if (data.charAt(0) === "{") { try { sys = JSON.parse(data).sys; } catch (e) {} }
      if (sys) {
        // In order with the sealed frames: a peer's last word ("ok",
        // "no") is read before its "left".
        inQ = inQ.then(function () {
          if (ended) return;
          if (sys === "wait") {
            if (role === "new") set("wait");
            else fail("nocode");               // nobody is waiting with this code
          } else if (sys === "peer") {
            hello();
          } else if (sys === "left") {
            fail("left");
          }
        });
        return;
      }
      inQ = inQ.then(function () { return unseal(keys.key, other, data); }).then(function (m) {
        if (!m || ended) return;
        if (m.t === "hi") {
          if (theirNonce || !NONCE_RE.test(m.n || "")) return;
          theirNonce = m.n;
          hello();
          var nNew = role === "new" ? myNonce : theirNonce, nOld = role === "new" ? theirNonce : myNonce;
          return checkNumber(code, nNew, nOld).then(function (n) {
            check = n;
            set(role === "new" ? "peer" : "approve", { check: n, dev: cleanDev(m.dev) });
          });
        }
        if (role === "new" && m.t === "bundle") {
          if (!check || phase !== "peer") return;
          set("adopting");
          return Promise.resolve().then(function () { return o.onBundle(m.b); }).then(function () {
            return send({ t: "ok" }).then(function () { set("done"); });
          }, function (err) {
            var e = String((err && err.message) || "refused").slice(0, 40);
            return send({ t: "no", e: e }).then(function () { fail("refused"); });
          });
        }
        if (role === "old" && phase === "sending") {
          if (m.t === "ok") set("done");
          else if (m.t === "no") set("error", { e: "refused", why: String(m.e || "").slice(0, 40) });
        }
      });
    }

    this.start = function () {
      if (!CODE_RE.test(code || "")) { fail("bad"); return self; }
      if (typeof WS !== "function") { fail("net"); return self; }
      set(role === "new" ? "opening" : "connecting");
      derive(code).then(function (k) {
        if (ended) return;
        keys = k;
        try { ws = new WS(wsUrl(relay, k.room)); } catch (e) { fail("net"); return; }
        var opened = false;
        ws.onopen = function () { opened = true; };
        ws.onmessage = function (ev) { onFrame(ev && ev.data); };
        ws.onerror = function () {};
        ws.onclose = function () {
          if (ended) return;
          if (!opened) fail(role === "old" ? "busy" : "net");   // old: a full room refuses the upgrade
          else if (phase === "wait" || phase === "opening") fail("expired");
          else fail("left");
        };
      }, function () { fail("net"); });
      return self;
    };
    // Old device: the person approved; send the bundle.
    this.approve = function () {
      if (role !== "old" || phase !== "approve" || ended) return Promise.resolve(false);
      set("sending");
      return Promise.resolve().then(function () { return o.bundle(); }).then(function (b) {
        if (ended) return false;
        return send({ t: "bundle", b: b }).then(function () { return true; });
      }, function (err) {
        fail(String((err && err.message) || "bundle"));
        return false;
      });
    };
    this.cancel = function () {
      if (ended) return;
      ended = true;
      phase = "cancelled";
      self.phase = phase;
      close();
    };
  }

  // ---------- 4. Sign-in link (LINK-1) ----------
  var LINK_LEN = 8;
  var LINK_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
  var LINK_MS = 15 * 60000;
  var LINK_RE = /^q1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\.[1-9]\d{0,2}\.[A-Za-z0-9_-]{22}$/;
  var DEL_RE = /^[A-Za-z0-9_-]{43}$/;
  var LINK_T = "oros-signin";

  function newLinkCode() {
    var b = C.getRandomValues(new Uint8Array(LINK_LEN)), s = "";
    for (var i = 0; i < LINK_LEN; i++) s += ALPHA[b[i] & 31];
    return s;
  }
  function normLinkCode(input) {
    var s = String(input == null ? "" : input).toUpperCase().replace(/[\s\-_.·]/g, "")
      .replace(/[IL]/g, "1").replace(/O/g, "0");
    return LINK_CODE_RE.test(s) ? s : "";
  }
  function fmtLinkCode(code) { return code.slice(0, 4) + "-" + code.slice(4, 8); }
  function baseUrl(origin) {
    var o = String(origin || "");
    var local = !/^https:\/\//.test(o) ||
      /^https:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(o) ||
      /\.(local|lan|internal)(:\d+)?$/.test(o);
    return local ? "https://useoros.online" : o.replace(/\/+$/, "");
  }
  function linkUrl(share, origin) { return baseUrl(origin) + "/#signin=" + share; }
  // A pasted link or the bare part after #signin= → the share code, or "".
  function linkFromText(text) {
    var s = String(text || "").trim();
    var m = /[#&]signin=([A-Za-z0-9_.\-]{1,200})/.exec(s);
    var c = m ? m[1] : s;
    return LINK_RE.test(c) ? c : "";
  }
  function b64u(u8) { return b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

  function sendLink(bundle, o) {
    o = o || {};
    var R = o.R || root.OrosShareRelay;
    if (!R || typeof R.create !== "function") return Promise.reject(new Error("net"));
    if (!bundle || typeof bundle !== "object") return Promise.reject(new Error("bad"));
    var code = newLinkCode(), del = b64u(C.getRandomValues(new Uint8Array(32)));
    var env = { t: LINK_T, v: 1, b: bundle, dev: cleanDev(o.dev), del: del };
    return R.create(env, { ms: LINK_MS, del: del, password: code, now: o.now, fetch: o.fetch, relay: o.relay })
      .then(function (r) {
        return { url: linkUrl(r.code, o.origin), share: r.code, code: code, id: r.id, del: r.del, exp: r.exp };
      });
  }
  function openLink(share, code, o) {
    o = o || {};
    var R = o.R || root.OrosShareRelay;
    var c = linkFromText(share), k = normLinkCode(code);
    if (!c) return Promise.resolve({ error: "bad" });
    if (!k) return Promise.resolve({ error: "pass" });
    if (!R || typeof R.open !== "function") return Promise.resolve({ error: "net" });
    return R.open(c, { password: k, now: o.now, fetch: o.fetch, relay: o.relay }).then(function (r) {
      if (!r || r.error) return { error: (r && r.error) || "bad" };
      var e = r.e;
      if (!e || e.t !== LINK_T || e.v !== 1 || !e.b || typeof e.b !== "object" || !DEL_RE.test(e.del || "")) return { error: "bad" };
      return { b: e.b, dev: cleanDev(e.dev), id: R.parse(c).id, del: e.del, x: r.x };
    }, function () { return { error: "net" }; });
  }
  // Is the link still waiting on the relay? true, false (used, cancelled
  // or expired), or null (could not ask).
  function linkAlive(id, o) {
    o = o || {};
    var f = o.fetch || (typeof fetch === "function" ? function (u, i) { return fetch(u, i); } : null);
    if (!f || !/^[A-Za-z0-9_-]{22}$/.test(id || "")) return Promise.resolve(null);
    var relay = String(o.relay || RELAY).replace(/\/+$/, "");
    return f(relay + "/s/" + id + "/0", { credentials: "omit", cache: "no-store" }).then(function (r) {
      return r.status === 404 ? false : r.ok ? true : null;
    }, function () { return null; });
  }

  var api = {
    VERSION: VERSION, newCode: newCode, normCode: normCode, fmtCode: fmtCode, CODE_RE: CODE_RE,
    derive: derive, seal: seal, unseal: unseal, checkNumber: checkNumber, codeFromText: codeFromText,
    qrText: qrText, browserLabel: browserLabel, wsUrl: wsUrl, RELAY: RELAY, Session: Session,
    LINK_MS: LINK_MS, LINK_CODE_RE: LINK_CODE_RE, newLinkCode: newLinkCode, normLinkCode: normLinkCode,
    fmtLinkCode: fmtLinkCode, linkUrl: linkUrl, linkFromText: linkFromText, sendLink: sendLink,
    openLink: openLink, linkAlive: linkAlive
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosPair = api;
})(typeof window !== "undefined" ? window : globalThis);
