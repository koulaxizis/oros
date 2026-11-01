/* Passwords: the sealed fill lists for autofill on the phone (PW-AF2).
   Built only while the vault is open and only when the person turned
   "Autofill on this phone" on; handed to the orOS Android app through
   the phone bridge (phone.js orosPhone.afSend), which keeps them in
   its own storage and can open them only with its Android Keystore
   keys (android/…/AfVault.java).
   - names: what the app may read without asking (title, user name or
     summary, sites, Android apps, has-a-2FA-code) so it knows what to
     suggest on which screen. Sealed with the "names" key.
   - index: the values to fill, sealed with the "index" key, which
     Android opens only after the fingerprint, face or screen lock.
     The same values as the browser add-on's fill (extension/pmfill.js
     payload): never a card PIN, document numbers, notes, custom
     fields or password history.
   Sealing: a fresh AES-256-GCM key per list, wrapped with RSA-OAEP
   (SHA-1, the digest Android Keystore's OAEP supports for MGF1).
   PW-AF3 also keeps here the rules for a login handed over to be
   saved (from the add-on or the phone): saveItem() cleans it and
   findSave() looks for the entry it belongs to. Nothing is saved
   without the person pressing Save in the editor.
   Pure apart from seal() (WebCrypto); Node-tested in
   tests/passwords-autofill.test.js. Exposes window.PmAfIndex. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PmAfIndex = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "1.1.0";
  var MAX = { title: 120, sub: 120, sites: 20, site: 300, apps: 10 };
  var PKG = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

  function str(v, n) { return typeof v === "string" ? v.slice(0, n || 4096) : ""; }

  function b64(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
  }
  function unb64(s) {
    var bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  /* urls of an entry → { w: web sites, a: Android package names } */
  function sites(urls) {
    var w = [], a = [];
    (Array.isArray(urls) ? urls : []).forEach(function (u) {
      u = str(u, MAX.site).trim();
      if (!u) return;
      var m = u.match(/^androidapp:\/\/([^/?#]+)/i);
      if (m) { if (PKG.test(m[1]) && a.indexOf(m[1]) < 0 && a.length < MAX.apps) a.push(m[1]); return; }
      if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:/i.test(u)) return;
      if (w.indexOf(u) < 0 && w.length < MAX.sites) w.push(u);
    });
    return { w: w, a: a };
  }

  function expParts(K, exp) {
    var p = K.parseExp ? K.parseExp(exp) : null;
    return p ? { mm: (p.m < 10 ? "0" : "") + p.m, yyyy: String(p.y) } : { mm: "", yyyy: "" };
  }

  function person(k, d) {
    var first = d.first || "", last = d.last || "";
    if (k === "address" && d.name && !first) {
      var parts = String(d.name).trim().split(/\s+/);
      last = parts.length > 1 ? parts.pop() : "";
      first = parts.join(" ");
    }
    return { first: first, middle: d.middle || "", last: last,
             full: k === "address" ? (d.name || "") : [first, d.middle, last].filter(Boolean).join(" "),
             email: d.email || "", phone: d.phone || "", company: d.company || "", birth: d.birth || "",
             street: d.street || "", line2: [d.line2, d.floor].filter(Boolean).join(", "), city: d.city || "",
             zip: d.zip || "", region: d.region || "", country: d.country || "" };
  }

  /* entries (the open vault) → { names, index }. K = PmKinds, PC = PmCore. */
  function lists(entries, K, PC) {
    var names = [], index = [];
    (Array.isArray(entries) ? entries : []).forEach(function (e) {
      if (!e || typeof e.id !== "string") return;
      var k = K.kindOf(e), d = K.dataOf(e) || {};
      var title = str(e.title, MAX.title);
      if (k === "login" || k === "otp") {
        var o = null;
        if (e.totp) {
          var p = PC.parseOtp(e.totp);
          if (!p.error) o = { k: b64(p.secret), a: p.algo, d: p.digits, n: p.period };
        }
        var pw = k === "otp" ? "" : str(e.pw);
        if (!e.user && !pw && !o) return;
        var s = sites(e.urls);
        names.push({ i: e.id, k: k, t: title, s: str(e.user, MAX.sub), w: s.w, a: s.a, o: o ? 1 : 0 });
        index.push({ i: e.id, k: k, t: title, u: str(e.user), p: pw, o: o });
      } else if (k === "card") {
        var x = expParts(K, d.exp);
        var c = { name: str(d.holder), num: String(d.num || "").replace(/\D+/g, ""), mm: x.mm, yyyy: x.yyyy, cvv: str(d.cvv) };
        if (!c.num) return;
        names.push({ i: e.id, k: k, t: title, s: str(K.summary(e), MAX.sub), w: [], a: [], o: 0 });
        index.push({ i: e.id, k: k, t: title, c: c });
      } else if (k === "identity" || k === "address") {
        var h = person(k, d);
        names.push({ i: e.id, k: k, t: title, s: str(K.summary(e), MAX.sub), w: [], a: [], o: 0 });
        index.push({ i: e.id, k: k, t: title, h: h });
      }
    });
    return { names: names, index: index };
  }

  function subtle() {
    var c = (typeof crypto !== "undefined" && crypto) || (typeof require === "function" ? require("crypto").webcrypto : null);
    if (!c || !c.subtle) throw new Error("no-crypto");
    return c;
  }

  /* obj → { w, iv, ct } (base64): AES-256-GCM under a fresh key, the
     key wrapped with RSA-OAEP SHA-1 for the app's public key (SPKI). */
  function seal(obj, spkiB64) {
    var c = subtle();
    var data = new TextEncoder().encode(JSON.stringify(obj));
    var iv = c.getRandomValues(new Uint8Array(12));
    var raw = c.getRandomValues(new Uint8Array(32));
    var pub;
    return c.subtle.importKey("spki", unb64(spkiB64), { name: "RSA-OAEP", hash: "SHA-1" }, false, ["encrypt"]).then(function (k) {
      pub = k;
      return c.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
    }).then(function (aes) {
      return Promise.all([c.subtle.encrypt({ name: "RSA-OAEP" }, pub, raw),
                          c.subtle.encrypt({ name: "AES-GCM", iv: iv }, aes, data)]);
    }).then(function (r) {
      raw.fill(0); data.fill(0);
      return { w: b64(new Uint8Array(r[0])), iv: b64(iv), ct: b64(new Uint8Array(r[1])) };
    });
  }

  // ---- PW-AF3: a login to save ----
  function clip(v, n) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
  }
  function bareHost(h) { return String(h || "").toLowerCase().replace(/\.$/, "").replace(/^www\./, ""); }

  /* x: { url (http/https page) | app (Android package), user, pw, title }
     → the same, cleaned, with site (the address saved in the entry) and
     host; or null when there is no password or no valid place. */
  function saveItem(x, LIM) {
    if (!x || typeof x !== "object") return null;
    LIM = LIM || {};
    var pw = typeof x.pw === "string" ? x.pw.slice(0, LIM.pw || 4096) : "";
    if (!pw) return null;
    var user = clip(x.user, LIM.user || 512), title = clip(x.title, LIM.title || 200);
    var site = "", host = "";
    if (typeof x.app === "string" && x.app) {
      if (!PKG.test(x.app) || x.app.length > 255) return null;
      site = "androidapp://" + x.app; host = x.app;
    } else {
      var u;
      try { u = new URL(String(x.url || "")); } catch (e) { return null; }
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      if (!u.hostname) return null;
      site = u.origin; host = bareHost(u.hostname);
    }
    return { site: site, host: host, user: user, pw: pw, title: title || host };
  }

  function entryHosts(e) {
    var out = [];
    (Array.isArray(e.urls) ? e.urls : []).forEach(function (u) {
      u = String(u || "").trim();
      var m = u.match(/^androidapp:\/\/([^/?#]+)/i);
      if (m) { out.push(m[1]); return; }
      if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
      try { var x = new URL(u); if (x.protocol === "https:" || x.protocol === "http:") out.push(bareHost(x.hostname)); } catch (err) {}
    });
    return out;
  }

  /* The login entry for the same place and user name, newest first.
     → { entry, same: password unchanged } or null (a new entry). */
  function findSave(entries, item, K) {
    if (!item) return null;
    var u = item.user.toLowerCase(), best = null;
    (Array.isArray(entries) ? entries : []).forEach(function (e) {
      if (!e || (K && K.kindOf(e) !== "login")) return;
      if (String(e.user || "").trim().toLowerCase() !== u) return;
      if (entryHosts(e).indexOf(item.host) < 0) return;
      if (!best || (e.m || 0) > (best.m || 0)) best = e;
    });
    return best ? { entry: best, same: best.pw === item.pw } : null;
  }

  /* The pair the app stores: names under keys.names, index under keys.idx. */
  function sealBoth(entries, K, PC, keys) {
    var l = lists(entries, K, PC);
    return Promise.all([seal(l.index, keys.idx), seal(l.names, keys.names)]).then(function (r) {
      return { idx: r[0], names: r[1], count: l.names.length };
    });
  }

  return { VERSION: VERSION, lists: lists, sites: sites, seal: seal, sealBoth: sealBoth,
           saveItem: saveItem, findSave: findSave, b64: b64, unb64: unb64 };
});
