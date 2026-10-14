// ============================================================
// orOS Mail — OpenPGP keys and crypto (v1.0.0)
// The glue between Mail and OpenPGP.js (vendor/openpgp/, LGPL-3.0,
// kept unmodified as its own file). The library (≈ 400 KB) is loaded
// only when something needs it: making or importing a key, sending
// signed / encrypted mail, opening a signed or encrypted message.
//
// Keys live on THIS device (IndexedDB "oros-mail", store "pgp", key =
// fingerprint), never in the synced slice:
//   { fpr, own, name, emails[], ids[] (key + subkey IDs, hex),
//     created (ms), pub (armored public key),
//     sec? (own keys: the armored private key, LOCKED with the
//     person's passphrase by OpenPGP.js; never stored unlocked) }
// An unlocked private key stays in memory for UNLOCK_MS, then is
// forgotten. Nothing here touches the DOM.
// Strings named *Bin are binary strings (one char = one byte).
// ============================================================
(function (root) {
  "use strict";
  var LIB = "../vendor/openpgp/openpgp.min.js";
  var UNLOCK_MS = 10 * 60 * 1000;
  var MAX_KEYS = 200;
  var MAX_ARMOR = 256 * 1024;

  var store = null;        // { all(), put(k, v), del(k) } (mail.js)
  var keys = [];           // metadata, sorted: own first, then by name / e-mail
  var unlocked = {};       // fpr → { key, at }
  var libP = null;

  function binToU8(s) {
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
    return u;
  }
  function u8ToBin(u) {
    var out = "";
    for (var i = 0; i < u.length; i += 0x8000) out += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return out;
  }
  function lower(s) { return String(s || "").trim().toLowerCase(); }

  function lib() {
    if (root.openpgp && typeof root.openpgp.readKey === "function") return Promise.resolve(root.openpgp);
    if (!libP) {
      libP = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = LIB;
        s.async = true;
        s.onload = function () {
          if (root.openpgp && typeof root.openpgp.readKey === "function") resolve(root.openpgp);
          else reject(new Error("lib"));
        };
        s.onerror = function () { reject(new Error("lib")); };
        document.head.appendChild(s);
      });
      libP.catch(function () { libP = null; });
    }
    return libP;
  }

  function sortKeys() {
    keys.sort(function (a, b) {
      if (a.own !== b.own) return a.own ? -1 : 1;
      var x = lower(a.name || a.emails[0]), y = lower(b.name || b.emails[0]);
      return x < y ? -1 : (x > y ? 1 : (a.fpr < b.fpr ? -1 : 1));
    });
  }
  function normMeta(v) {
    if (!v || typeof v !== "object" || typeof v.fpr !== "string" || !/^[0-9a-f]{32,64}$/.test(v.fpr)) return null;
    if (typeof v.pub !== "string" || v.pub.length > MAX_ARMOR) return null;
    return { fpr: v.fpr, own: v.own === true && typeof v.sec === "string", name: String(v.name || "").slice(0, 120),
             emails: Array.isArray(v.emails) ? v.emails.filter(function (e) { return typeof e === "string"; }).slice(0, 20) : [],
             ids: Array.isArray(v.ids) ? v.ids.filter(function (e) { return typeof e === "string"; }).slice(0, 20) : [],
             created: +v.created || 0, pub: v.pub, sec: v.own === true && typeof v.sec === "string" ? v.sec : undefined };
  }
  function init(st) {
    store = st;
    return store.all().then(function (rows) {
      keys = (rows || []).map(normMeta).filter(Boolean);
      sortKeys();
      return keys;
    }, function () { keys = []; return keys; });
  }
  function list() { return keys.slice(); }
  function byFpr(fpr) { for (var i = 0; i < keys.length; i++) if (keys[i].fpr === fpr) return keys[i]; return null; }
  function forEmail(addr, own) {
    var a = lower(addr);
    return keys.filter(function (k) { return (!own || k.own) && k.emails.indexOf(a) >= 0; });
  }
  function hasOwn(addr) { return forEmail(addr, true).length > 0; }

  // "Name <a@b>" user IDs → { name, emails }
  function idsOf(uids) {
    var name = "", emails = [];
    (uids || []).forEach(function (u) {
      var m = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(String(u || ""));
      var e = m ? m[2] : (/^[^\s<>]+@[^\s<>]+$/.test(String(u || "").trim()) ? String(u).trim() : "");
      if (m && !name) name = m[1].replace(/^"|"$/g, "").trim();
      if (e && emails.indexOf(lower(e)) < 0) emails.push(lower(e));
    });
    return { name: name, emails: emails };
  }
  function metaOf(key, own, secArmored) {
    var u = idsOf(key.getUserIDs());
    return {
      fpr: key.getFingerprint().toLowerCase(), own: !!own, name: u.name, emails: u.emails,
      ids: key.getKeyIDs().map(function (k) { return k.toHex().toLowerCase(); }),
      created: key.getCreationTime().getTime(), pub: key.isPrivate() ? key.toPublic().armor() : key.armor(),
      sec: own ? secArmored : undefined
    };
  }
  function save(meta) {
    var old = byFpr(meta.fpr);
    // a public copy of a key never replaces the private one
    if (old && old.own && !meta.own) { meta.own = true; meta.sec = old.sec; }
    if (!old && keys.length >= MAX_KEYS) return Promise.reject(new Error("full"));
    var rec = {};
    Object.keys(meta).forEach(function (k) { if (meta[k] !== undefined) rec[k] = meta[k]; });
    return store.put(meta.fpr, rec).then(function () {
      keys = keys.filter(function (k) { return k.fpr !== meta.fpr; });
      keys.push(meta);
      sortKeys();
      return { meta: meta, isNew: !old };
    });
  }
  function remove(fpr) {
    delete unlocked[fpr];
    return store.del(fpr).then(function () { keys = keys.filter(function (k) { return k.fpr !== fpr; }); });
  }

  function generate(o) {
    return lib().then(function (P) {
      return P.generateKey({ userIDs: [{ name: o.name || "", email: o.email }], passphrase: o.pass, format: "armored" });
    }).then(function (r) {
      return root.openpgp.readPrivateKey({ armoredKey: r.privateKey }).then(function (k) {
        return save(metaOf(k, true, r.privateKey));
      });
    });
  }

  // text: one or more armored keys (public or private).
  // pass(meta) → Promise<passphrase> is asked for a private key that
  // is not locked yet (it is locked with that passphrase before it is
  // kept). → { added: [meta], updated: [meta] }
  function importText(text, pass) {
    text = String(text || "");
    if (text.length > MAX_ARMOR * 4) return Promise.reject(new Error("big"));
    return lib().then(function (P) {
      var secret = /-----BEGIN PGP PRIVATE KEY BLOCK-----/.test(text);
      var read = secret ? P.readPrivateKeys({ armoredKeys: text }) : P.readKeys({ armoredKeys: text });
      return read.then(function (list) {
        var out = { added: [], updated: [] };
        return list.reduce(function (p, k) {
          return p.then(function () {
            var job;
            if (k.isPrivate()) {
              if (k.isDecrypted()) {
                job = pass(metaOf(k, false)).then(function (pw) {
                  if (!pw) throw new Error("nopass");
                  return P.encryptKey({ privateKey: k, passphrase: pw });
                }).then(function (locked) { return metaOf(locked, true, locked.armor()); });
              } else job = Promise.resolve(metaOf(k, true, k.armor()));
            } else job = Promise.resolve(metaOf(k, false));
            return job.then(save).then(function (r) { (r.isNew ? out.added : out.updated).push(r.meta); });
          });
        }, Promise.resolve()).then(function () { return out; });
      });
    });
  }

  function unlock(meta, passphrase) {
    var c = unlocked[meta.fpr];
    if (c && Date.now() - c.at < UNLOCK_MS) return Promise.resolve(c.key);
    if (!meta.own || !meta.sec) return Promise.reject(new Error("nokey"));
    return lib().then(function (P) {
      return P.readPrivateKey({ armoredKey: meta.sec }).then(function (k) {
        return P.decryptKey({ privateKey: k, passphrase: passphrase });
      });
    }).then(function (k) {
      unlocked[meta.fpr] = { key: k, at: Date.now() };
      return k;
    });
  }
  // the unlocked key when it is still in memory, else null
  function cached(fpr) {
    var c = unlocked[fpr];
    if (c && Date.now() - c.at < UNLOCK_MS) return c.key;
    delete unlocked[fpr];
    return null;
  }
  function forget() { unlocked = {}; }

  function pubKeys(metas) {
    return lib().then(function (P) {
      return Promise.all(metas.map(function (m) { return P.readKey({ armoredKey: m.pub }); }));
    });
  }

  // detached signature over the entity's bytes (binary, RFC 3156 §5)
  // → { armored, micalg: "pgp-sha512" … (the hash it really used) }
  function sign(entityBin, priv) {
    return lib().then(function (P) {
      return P.createMessage({ binary: binToU8(entityBin) }).then(function (msg) {
        return P.sign({ message: msg, signingKeys: priv, detached: true, format: "armored" });
      }).then(function (armored) {
        return P.readSignature({ armoredSignature: armored }).then(function (sig) {
          var alg = "";
          try { alg = P.enums.read(P.enums.hash, sig.packets[0].hashAlgorithm); } catch (e) {}
          return { armored: armored, micalg: alg ? "pgp-" + String(alg).toLowerCase() : "pgp-sha256" };
        });
      });
    });
  }
  // → armored; signed inside too when priv is given (RFC 3156 §6.2)
  function encrypt(entityBin, metas, priv) {
    return pubKeys(metas).then(function (pubs) {
      var P = root.openpgp;
      return P.createMessage({ binary: binToU8(entityBin) }).then(function (msg) {
        var o = { message: msg, encryptionKeys: pubs, format: "armored" };
        if (priv) o.signingKeys = priv;
        return P.encrypt(o);
      });
    });
  }

  // own keys that can open an armored message (by its key IDs)
  function keysFor(armored) {
    return lib().then(function (P) {
      return P.readMessage({ armoredMessage: armored });
    }).then(function (msg) {
      var want = msg.getEncryptionKeyIDs().map(function (k) { return k.toHex().toLowerCase(); });
      return keys.filter(function (k) { return k.own && k.ids.some(function (id) { return want.indexOf(id) >= 0; }); });
    });
  }

  // signatures → { state: "ok" | "bad" | "unknown" | "none", signer, keyId }
  function sigState(sigs) {
    if (!sigs || !sigs.length) return Promise.resolve({ state: "none", signer: null, keyId: "" });
    var s = sigs[0];
    var id = s.keyID && s.keyID.toHex ? s.keyID.toHex().toLowerCase() : "";
    var signer = keys.filter(function (k) { return k.ids.indexOf(id) >= 0; })[0] || null;
    return Promise.resolve(s.verified).then(function (ok) {
      return { state: ok ? "ok" : "bad", signer: signer, keyId: id };
    }, function () {
      return { state: signer ? "bad" : "unknown", signer: signer, keyId: id };
    });
  }
  function verifiers() { return keys.length ? pubKeys(keys) : Promise.resolve([]); }

  // → { bin, sig: sigState }
  function decrypt(armored, privs) {
    return lib().then(function (P) {
      return Promise.all([P.readMessage({ armoredMessage: armored }), verifiers()]).then(function (r) {
        return P.decrypt({ message: r[0], decryptionKeys: privs, verificationKeys: r[1], format: "binary" });
      }).then(function (res) {
        return sigState(res.signatures).then(function (st) { return { bin: u8ToBin(res.data), sig: st }; });
      });
    });
  }
  function verifyDetached(entityBin, sigArmored) {
    return lib().then(function (P) {
      return Promise.all([P.createMessage({ binary: binToU8(entityBin) }), P.readSignature({ armoredSignature: sigArmored }), verifiers()])
        .then(function (r) {
          return P.verify({ message: r[0], signature: r[1], verificationKeys: r[2] });
        }).then(function (res) { return sigState(res.signatures); });
    });
  }
  // inline "BEGIN PGP SIGNED MESSAGE" → { text, sig }
  function verifyClear(armored) {
    return lib().then(function (P) {
      return Promise.all([P.readCleartextMessage({ cleartextMessage: armored }), verifiers()]).then(function (r) {
        return P.verify({ message: r[0], verificationKeys: r[1] }).then(function (res) {
          return sigState(res.signatures).then(function (st) { return { text: r[0].getText(), sig: st }; });
        });
      });
    });
  }

  function short(fpr) { return String(fpr || "").toUpperCase().slice(-16).replace(/(.{4})(?=.)/g, "$1 "); }

  var api = {
    init: init, list: list, byFpr: byFpr, forEmail: forEmail, hasOwn: hasOwn, lib: lib,
    generate: generate, importText: importText, remove: remove, unlock: unlock, cached: cached, forget: forget,
    sign: sign, encrypt: encrypt, keysFor: keysFor, decrypt: decrypt, verifyDetached: verifyDetached,
    verifyClear: verifyClear, short: short, idsOf: idsOf
  };
  root.orosMailPgp = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
