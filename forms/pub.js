// ============================================================
// orOS Forms — the client of the relay's Forms routes
// (forms/pub.js, window.OrosFormsPub; Node: module.exports).
// Used by the Forms app (publish, pick up), the public page forms/f/
// and Calendar's RSVP page (calendar/rsvp.html). Relay side:
// relay/forms.js; Bible "orOS Forms (FORMS-2)".
//
// The link is  https://useoros.online/forms/f/#<k>.<key>
//   k   16 a-z0-9, the form's name at the relay
//   key 32 random bytes (base64url), never sent anywhere: the page
//       reads it from the #fragment, which browsers do not send.
// def = base64url( iv(12) ‖ AES-256-GCM(key, JSON obj, AAD "orOS-forms|<k>") )
//       obj = { v:1, form, pub } for Forms (pub = the RSA-OAEP-256 public
//       JWK answers are sealed for); Calendar puts its own fields in.
// An answer is sealed in the respondent's browser for obj.pub with the
// same hybrid as relay/newsletter.js seal(): base64(JSON { w, iv, c }),
// so only the owner's device can open it.
// Everything a page shows from obj is text (textContent only).
// ============================================================
(function (root) {
  "use strict";

  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = mail.js, webpush.js
  var SITE = "https://useoros.online/";
  var TIMEOUT = 30000;
  var K_RE = /^[a-z0-9]{16}$/, KEY_RE = /^[A-Za-z0-9_-]{43}$/;
  var cr = (root && root.crypto) || (typeof globalThis !== "undefined" ? globalThis.crypto : null);

  // ---------- bytes ----------
  function bin(u) {
    var s = "";
    for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return s;
  }
  function b64(bytes) { return btoa(bin(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))); }
  function unb64(s) {
    var t = atob(s), u = new Uint8Array(t.length);
    for (var i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
    return u;
  }
  function b64u(bytes) { return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64u(s) { return unb64(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); }
  function rnd(n, abc) {
    var b = cr.getRandomValues(new Uint8Array(n)), out = "";
    for (var i = 0; i < n; i++) out += abc.charAt(b[i] % abc.length);
    return out;
  }
  var LOW = "abcdefghijklmnopqrstuvwxyz0123456789";
  var ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  function aad(k) { return new TextEncoder().encode("orOS-forms|" + k); }

  // ---------- keys and the link ----------
  // A new form's secrets: relay name and secret, the link key and the
  // RSA pair the answers are sealed for (the private half stays with
  // the owner's synced form record).
  function newKeys() {
    return cr.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
                                 true, ["encrypt", "decrypt"]).then(function (kp) {
      return cr.subtle.exportKey("jwk", kp.privateKey);
    }).then(function (priv) {
      return { k: rnd(16, LOW), sec: rnd(32, ALNUM), key: b64u(cr.getRandomValues(new Uint8Array(32))),
               priv: priv, pub: pubOf(priv) };
    });
  }
  function pubOf(priv) { return { kty: "RSA", alg: "RSA-OAEP-256", e: priv.e, n: priv.n }; }
  function link(k, key, site) { return (site || SITE) + "forms/f/#" + k + "." + key; }
  // "#k.key" (or the whole URL) → { k, key } | null
  function parse(s) {
    var m = /#?([a-z0-9]{16})\.([A-Za-z0-9_-]{43})$/.exec(String(s || "").trim());
    return m && K_RE.test(m[1]) && KEY_RE.test(m[2]) ? { k: m[1], key: m[2] } : null;
  }
  function aesKey(key, use) {
    return cr.subtle.importKey("raw", unb64u(key), { name: "AES-GCM" }, false, [use]);
  }
  function encDef(key, k, obj) {
    var iv = cr.getRandomValues(new Uint8Array(12));
    return aesKey(key, "encrypt").then(function (ck) {
      return cr.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: aad(k) }, ck, new TextEncoder().encode(JSON.stringify(obj)));
    }).then(function (c) {
      var all = new Uint8Array(12 + c.byteLength);
      all.set(iv, 0);
      all.set(new Uint8Array(c), 12);
      return b64u(all);
    });
  }
  function decDef(key, k, def) {
    return Promise.resolve().then(function () {
      var all = unb64u(def);
      if (all.length < 29) throw { code: "bad" };
      return aesKey(key, "decrypt").then(function (ck) {
        return cr.subtle.decrypt({ name: "AES-GCM", iv: all.subarray(0, 12), additionalData: aad(k) }, ck, all.subarray(12));
      });
    }).then(function (plain) {
      var o = JSON.parse(new TextDecoder().decode(plain));
      if (!o || typeof o !== "object" || Array.isArray(o)) throw { code: "bad" };
      return o;
    })["catch"](function (e) { throw e && e.code ? e : { code: "bad" }; });
  }

  // ---------- sealed answers (= relay/newsletter.js seal) ----------
  function seal(pub, obj) {
    var aes;
    return cr.subtle.importKey("jwk", { kty: "RSA", alg: "RSA-OAEP-256", e: pub.e, n: pub.n, ext: true },
                               { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]).then(function (rsa) {
      return cr.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]).then(function (k) {
        aes = k;
        var iv = cr.getRandomValues(new Uint8Array(12));
        return cr.subtle.encrypt({ name: "AES-GCM", iv: iv }, k, new TextEncoder().encode(JSON.stringify(obj))).then(function (c) {
          return cr.subtle.exportKey("raw", aes).then(function (raw) {
            return cr.subtle.encrypt({ name: "RSA-OAEP" }, rsa, raw);
          }).then(function (w) { return btoa(JSON.stringify({ w: b64(w), iv: b64(iv), c: b64(c) })); });
        });
      });
    });
  }
  // priv: the private JWK or an imported CryptoKey
  function privKey(priv) {
    if (priv && typeof priv === "object" && priv.kty) {
      return cr.subtle.importKey("jwk", priv, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
    }
    return Promise.resolve(priv);
  }
  function open(priv, v) {
    return privKey(priv).then(function (pk) {
      var o = JSON.parse(atob(v));
      return cr.subtle.decrypt({ name: "RSA-OAEP" }, pk, unb64(o.w)).then(function (raw) {
        return cr.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
      }).then(function (key) {
        return cr.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, key, unb64(o.c));
      }).then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
    });
  }

  // ---------- the relay ----------
  function fetchIt(url, init) {
    var f = (root && root.fetch) || (typeof fetch === "function" ? fetch : null);
    if (!f) return Promise.reject({ code: "network" });
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT) : 0;
    init = Object.assign({ credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" }, init || {});
    if (ctl) init.signal = ctl.signal;
    return f(url, init).then(function (r) {
      return r.json()["catch"](function () { return null; }).then(function (j) { clearTimeout(timer); return { status: r.status, j: j }; });
    }, function () { clearTimeout(timer); throw { code: ctl && ctl.signal.aborted ? "timeout" : "network" }; });
  }
  // The app's op (POST /v1 { op:"frm", ... }) → data, or throws { code }.
  function call(relay, body) {
    return fetchIt((relay || RELAY) + "/v1", { method: "POST", headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify(Object.assign({ op: "frm" }, body)) }).then(function (r) {
      var j = r.j;
      if (!j || typeof j !== "object") throw { code: "relay" };
      if (!j.ok) throw { code: (j.error && j.error.code) || "relay" };
      return j.data;
    });
  }
  // The public page: the form and its state, opened with the link key.
  // → { obj, open, cap?, taken? }; throws { code: gone|bad|busy|off|network|timeout }
  function fetchDef(k, key, relay) {
    if (!K_RE.test(k || "") || !KEY_RE.test(key || "")) return Promise.reject({ code: "bad" });
    return fetchIt((relay || RELAY) + "/fm/" + k, { method: "GET" }).then(function (r) {
      var j = r.j;
      if (!j || typeof j !== "object") throw { code: "off" };
      if (j.e || typeof j.def !== "string") throw { code: j.e === "gone" || r.status === 404 ? "gone" : (j.e || "off") };
      return decDef(key, k, j.def).then(function (obj) {
        var o = { obj: obj, open: j.open === 1 };
        if (typeof j.cap === "number") { o.cap = j.cap; o.taken = j.taken | 0; }
        return o;
      });
    });
  }
  // One answer: payload sealed for pub, then sent. opts { yes, seats, hp }
  // → { ok:true, wait? }; throws { code: closed|gone|busy|full|bad|big|off|network|timeout }
  function send(k, pub, payload, opts, relay) {
    opts = opts || {};
    return seal(pub, payload).then(function (v) {
      var body = { v: v };
      if (opts.hp) body.hp = String(opts.hp).slice(0, 100);
      if (opts.yes === 0 || opts.yes === 1) body.yes = opts.yes;
      if (opts.seats) body.seats = opts.seats;
      // text/plain: a "simple" request, no preflight (the relay reads JSON either way)
      return fetchIt((relay || RELAY) + "/fm/" + k, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) });
    }).then(function (r) {
      var j = r.j;
      if (!j || typeof j !== "object") throw { code: "off" };
      if (j.e) throw { code: j.e };
      return j.wait ? { ok: true, wait: true } : { ok: true };
    });
  }
  function report(k, relay) {
    return fetchIt((relay || RELAY) + "/fm/" + k + "/report", { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: "{}" })
      .then(function () { return true; });
  }

  // ---------- the warning every public page shows ----------
  var STR = {
    en: { "pub.banner": "This form was made by someone who uses orOS, not by orOS. Never enter passwords, PINs or card numbers in a form." },
    el: { "pub.banner": "Αυτή τη φόρμα τη δημιούργησε κάποιος που χρησιμοποιεί το orOS, όχι το orOS. Μη γράφετε ποτέ κωδικούς, PIN ή αριθμούς καρτών σε φόρμα." }
  };
  // German and other pack languages: i18n/<code>/forms.js "pub.banner"
  // (the page loads ../../i18n.js with data-app="forms").
  function bannerText(lang) {
    if (STR[lang]) return STR[lang]["pub.banner"];
    var I = root && root.orosI18n;
    if (I && lang) { var t = I.table(STR, "forms", lang); if (t && t["pub.banner"]) return t["pub.banner"]; }
    return STR.en["pub.banner"];
  }
  function banner(host, lang) {
    if (!host || !root || !root.document) return null;
    var p = root.document.createElement("p");
    p.className = "frm-banner";
    p.setAttribute("role", "note");
    p.textContent = bannerText(lang);
    host.appendChild(p);
    return p;
  }

  var API = { RELAY: RELAY, SITE: SITE, newKeys: newKeys, pubOf: pubOf, link: link, parse: parse,
              encDef: encDef, decDef: decDef, seal: seal, open: open, call: call,
              fetchDef: fetchDef, send: send, report: report, banner: banner, bannerText: bannerText, STR: STR,
              b64u: b64u, unb64u: unb64u };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosFormsPub = API;
})(typeof window !== "undefined" ? window : null);
