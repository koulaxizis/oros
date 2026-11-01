// ============================================================
// orOS Connected services — shell side (links/host.js, v1.0.0)
// Runs in the SHELL window (index.html loads links/core.js before it).
// One owner for every account orOS keeps with another platform, so no
// app ever asks for, stores or sends keys on its own:
//   - the synced slice "links" (oros-links-data, see links/core.js):
//     accounts without their keys
//   - IndexedDB "oros-links" (device only, never synced, never
//     exported; in the shell's factory-reset list): a non-extractable
//     AES-GCM key (store "keys") and each account's keys sealed with it
//     (store "creds": id → { iv, data, m })
//   - opt-in per account ("Use on all my devices", ks = 1): the keys
//     also travel in the slice, sealed with the sync passphrase
//     (orosSync.vaultCrypto), only while sync is connected and
//     unlocked; a device without them takes them from there
//   - device-local "oros-links-prefs" { mode: { id: "direct" | "query"
//     | "relay" } }: the way that last worked for each account
// Calls (window.orosLinks.call): only requests links/core.js checkReq
// allows. First straight from the browser (WooCommerce answers other
// sites by default); when the browser can't reach it (no CORS, a
// firewall), through the orOS relay's "ext" operation (relay/ext.js),
// which checks the same list and keeps nothing.
// Errors are codes ("offline", "auth", "notfound", "keys", "relay",
// "network", "denied", "server", "bad", "unknown"), never text from
// the other side. "unknown" = a write that must not run twice (an
// invoicing provider's SendInvoices) may or may not have arrived: it is
// never retried another way; the app looks it up before trying again.
// Platforms with fixed hosts (timologisi.online, MailerLite, Mailchimp,
// Brevo) take a key instead of a site; the relay gets the same env or
// key, never a host. Mailchimp doesn't answer browsers: always relay.
// Shopify (Storefront API) answers browsers and the relay doesn't know
// it: never relay. Enable Banking (Budget BK-2): the keys are an
// application id and its private key; every call carries only a JWT
// signed here with a non-extractable copy of that key.
// ============================================================
(function (root) {
  "use strict";
  var L = root.OrosLinksCore;
  if (!L) return;                                 // stale bundle without core.js

  var KEY = "oros-links-data";
  var PREFS_KEY = "oros-links-prefs";
  var DB_NAME = "oros-links";
  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = mail.js
  var TIMEOUT = 30000;
  var TIMEOUT_BY = { tol: 75000 };                // SendInvoices waits for AADE and the PDF
  function timeoutOf(p) { return TIMEOUT_BY[p] || TIMEOUT; }
  var listeners = [];

  // ---------- Slice ----------
  function read() {
    try { return L.merge(JSON.parse(localStorage.getItem(KEY) || "null"), null); }
    catch (e) { return L.merge(null, null); }
  }
  function write(d) {
    try { localStorage.setItem(KEY, JSON.stringify(L.merge(d, null))); return true; }
    catch (e) { return false; }                   // R30: the caller says so
  }
  function changed() {
    listeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  function S() { return root.orosSync || null; }
  function dirty() { var s = S(); if (s && typeof s.markDirty === "function") s.markDirty(); }
  function sliceGet() { return read(); }
  function sliceSet(d) {                          // R6: a pull never marks dirty
    if (!d || typeof d !== "object") return;
    var before = JSON.stringify(read()), next = L.merge(d, null);
    if (JSON.stringify(next) === before) return;
    write(next);
    changed();
    setTimeout(keySync, 0);
  }
  function registerSlice() {
    var s = S();
    if (!s || typeof s.registerSlice !== "function") { setTimeout(registerSlice, 100); return; }
    s.registerSlice("links", sliceGet, sliceSet, null, L.merge);
  }
  // One account row changed: stamp at the mutation site (R27).
  function putAcct(row) {
    var d = read(), list = d.accts.filter(function (a) { return a.id !== row.id; });
    var prev = L.find(d, row.id);
    row.m = Math.max(Date.now(), prev ? prev.m + 1 : 0);
    list.push(row);
    var next = L.merge({ accts: list }, null);
    if (!write(next)) return false;
    dirty();
    changed();
    return true;
  }

  // ---------- Device prefs ----------
  function prefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      return p && typeof p === "object" && p.mode && typeof p.mode === "object" ? p : { mode: {} };
    } catch (e) { return { mode: {} }; }
  }
  function setMode(id, mode) {
    var p = prefs();
    if (p.mode[id] === mode) return;
    if (mode) p.mode[id] = mode; else delete p.mode[id];
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) {}
  }

  // ---------- Sealed keys (IndexedDB) ----------
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        ["keys", "creds"].forEach(function (n) { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { dbp = null; reject(req.error); };
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(store, mode), st = t.objectStore(store), out;
        var r = fn(st);
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { resolve(out); };
        t.onerror = t.onabort = function () { reject(t.error); };
      });
    });
  }
  function devKey() {
    return tx("keys", "readonly", function (st) { return st.get("device"); }).then(function (k) {
      if (k) return k;
      return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
        .then(function (nk) { return tx("keys", "readwrite", function (st) { return st.put(nk, "device"); }).then(function () { return nk; }); });
    });
  }
  function sealLocal(id, keys, m) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return devKey().then(function (k) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, k, new TextEncoder().encode(JSON.stringify(keys)));
    }).then(function (sealed) {
      return tx("creds", "readwrite", function (st) { return st.put({ iv: iv.buffer, data: sealed, m: m }, id); });
    });
  }
  // → { keys, m } or null
  function openLocal(id) {
    return tx("creds", "readonly", function (st) { return st.get(id); }).then(function (rec) {
      if (!rec) return null;
      return devKey().then(function (k) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, k, rec.data);
      }).then(function (buf) {
        return { keys: JSON.parse(new TextDecoder().decode(buf)), m: rec.m || 0 };
      });
    }).catch(function () { return null; });
  }
  function dropLocal(id) {
    return tx("creds", "readwrite", function (st) { return st.delete(id); }).catch(function () {});
  }

  // ---------- Key sync (opt-in per account) ----------
  function sealer() {
    var s = S();
    if (!s || !s.vaultCrypto || typeof s.hasPassphrase !== "function") return null;
    try {
      if (!s.hasPassphrase() || (typeof s.isConnected === "function" && !s.isConnected())) return null;
    } catch (e) { return null; }
    return s.vaultCrypto;
  }
  var ksBusy = null;
  // For each account with ks on: a device that lacks the keys opens
  // the sealed copy; a device whose keys are newer than the sealed copy
  // (or that sees none) seals them. Sealing only when something is new
  // keeps the slice stable (R26: a fresh IV every time would ping-pong).
  function keySync() {
    if (ksBusy) return ksBusy;
    var vc = sealer();
    if (!vc) return Promise.resolve(false);
    var todo = L.live(read()).filter(function (a) { return a.ks === 1; });
    ksBusy = todo.reduce(function (p, a) {
      return p.then(function () {
        return openLocal(a.id).then(function (local) {
          if (a.s && (!local || local.m < a.sm)) {
            return Promise.resolve(vc.decryptJson(a.s)).then(function (o) {
              var chk = o && L.checkKeys(a.p, o.k);
              if (chk && chk.ok) return sealLocal(a.id, chk.keys, a.sm).then(changed);
            }, function () {
              // sealed with another passphrase: a device with keys re-seals
              if (local) return reseal(a, local);
            });
          }
          if (local && (!a.s || local.m > a.sm)) return reseal(a, local);
        });
      }).catch(function () {});
    }, Promise.resolve()).then(function () { ksBusy = null; return true; }, function () { ksBusy = null; return false; });
    return ksBusy;
    function reseal(a, local) {
      return Promise.resolve(vc.encryptJson({ k: local.keys })).then(function (s) {
        var cur = L.find(read(), a.id);
        if (!cur || cur.d === 1 || cur.ks !== 1) return;
        var row = JSON.parse(JSON.stringify(cur));
        row.s = s;
        row.sm = local.m;
        putAcct(row);
      });
    }
  }

  // ---------- Accounts ----------
  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return (r[0].toString(36) + r[1].toString(36) + "00000000").slice(0, 14);
  }
  function pub(a) {
    var o = { id: a.id, p: a.p, name: a.name, site: a.site, ks: a.ks, synced: !!a.s, platform: L.PLATFORMS[a.p].name };
    if (a.env) o.env = a.env;
    if (a.vat) o.vat = a.vat;
    if (a.db) o.db = a.db;
    return o;
  }
  function list(p) {
    return L.live(read()).filter(function (a) { return !p || a.p === p; }).map(pub);
  }
  function get(id) {
    var a = L.find(read(), id);
    return a && a.d !== 1 ? pub(a) : null;
  }
  // add({ p, name, site?, env?, vat?, db?, keys }) → Promise<id>; rejects
  // with a code: "p" | "site" | "env" | "vat" | "db" | "keys" | "full" | "save"
  function add(o) {
    o = o || {};
    var pl = L.PLATFORMS[o.p];
    if (!pl) return Promise.reject(err("p"));
    var site = pl.site ? L.normSite(o.site, o.p) : "";
    if (site === null) return Promise.reject(err("site"));
    var db = pl.db && typeof o.db === "string" ? o.db.trim() : "";
    if (db && !L.DB_RE.test(db)) return Promise.reject(err("db"));
    if (pl.env && !(typeof o.env === "string" && Object.prototype.hasOwnProperty.call(pl.env, o.env))) return Promise.reject(err("env"));
    var vat = pl.vat ? String(o.vat == null ? "" : o.vat).replace(/\s+/g, "").replace(/^EL/i, "") : "";
    if (pl.vat && !L.VAT_RE.test(vat)) return Promise.reject(err("vat"));
    var chk = L.checkKeys(o.p, o.keys);
    if (!chk.ok) return Promise.reject(err("keys", chk.bad));
    if (L.live(read()).length >= L.MAX_ACCTS) return Promise.reject(err("full"));
    var id = newId(), now = Date.now();
    return sealLocal(id, chk.keys, now).then(function () {
      var row = { id: id, m: now, p: o.p, name: L.cleanText(o.name, L.NAME_LEN) || pl.name, site: site };
      if (pl.env) row.env = o.env;
      if (pl.vat) row.vat = vat;
      if (pl.db) row.db = db;
      row.ks = 0; row.s = ""; row.sm = 0; row.d = 0;
      if (!putAcct(row)) { dropLocal(id); throw err("save"); }
      return id;
    });
  }
  function edit(id, fields) {
    var a = L.find(read(), id);
    if (!a || a.d === 1) return false;
    var row = JSON.parse(JSON.stringify(a));
    if (fields && typeof fields.name === "string") row.name = L.cleanText(fields.name, L.NAME_LEN) || row.name;
    if (fields && typeof fields.site === "string") {
      var s = L.normSite(fields.site, a.p);
      if (!s) return false;
      if (s !== row.site) setMode(id, "");
      row.site = s;
    }
    if (JSON.stringify(row) === JSON.stringify(a)) return true;
    return putAcct(row);
  }
  // New keys on this device (they become the newest copy everywhere
  // when key sync is on).
  function setKeys(id, keys) {
    var a = L.find(read(), id);
    if (!a || a.d === 1) return Promise.reject(err("gone"));
    var chk = L.checkKeys(a.p, keys);
    if (!chk.ok) return Promise.reject(err("keys", chk.bad));
    setMode(id, "");
    return sealLocal(id, chk.keys, Date.now()).then(function () { changed(); keySync(); return true; });
  }
  function hasKeys(id) { return openLocal(id).then(function (l) { return !!l; }); }
  function setKeySync(id, on) {
    var a = L.find(read(), id);
    if (!a || a.d === 1) return false;
    var row = JSON.parse(JSON.stringify(a));
    row.ks = on ? 1 : 0;
    if (!on) { row.s = ""; row.sm = 0; }
    if (JSON.stringify(row) === JSON.stringify(a)) return true;
    var ok = putAcct(row);
    if (ok && on) keySync();
    return ok;
  }
  function canKeySync() { return !!sealer(); }
  function remove(id) {
    var a = L.find(read(), id);
    if (!a || a.d === 1) return Promise.resolve(true);
    setMode(id, "");
    return dropLocal(id).then(function () { return putAcct({ id: id, m: a.m, p: a.p, d: 1 }); });
  }

  // ---------- Enable Banking: a JWT signed on this device ----------
  // The application's private key (PEM, PKCS#8 or PKCS#1) is imported
  // once per page as a NON-extractable WebCrypto key; a call carries
  // only a JWT (RS256, 1 hour) signed with it, never the key itself.
  function b64urlBytes(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlText(t) { return b64urlBytes(new TextEncoder().encode(t)); }
  function derLen(n) {
    if (n < 0x80) return [n];
    var out = [];
    while (n > 0) { out.unshift(n & 0xff); n = n >> 8; }
    return [0x80 | out.length].concat(out);
  }
  // PKCS#1 RSAPrivateKey → PKCS#8 PrivateKeyInfo (what WebCrypto imports)
  function pkcs1to8(der) {
    var algo = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
    var oct = [0x04].concat(derLen(der.length));
    var body = [0x02, 0x01, 0x00].concat(algo, oct);
    var total = body.length + der.length;
    var head = [0x30].concat(derLen(total), body);
    var out = new Uint8Array(head.length + der.length);
    out.set(head, 0);
    out.set(der, head.length);
    return out;
  }
  function pemDer(pem) {
    var b = atob(String(pem).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""));
    var u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return /BEGIN RSA PRIVATE KEY/.test(pem) ? pkcs1to8(u) : u;
  }
  var ebKeys = {}, ebTokens = {};
  function ebJwt(id, keys) {
    var now = Math.floor(Date.now() / 1000), c = ebTokens[id];
    if (c && c.app === keys.app && c.exp - 120 > now) return Promise.resolve(c.jwt);
    var kp = ebKeys[id] && ebKeys[id].app === keys.app ? ebKeys[id].key : null;
    var getKey = kp ? Promise.resolve(kp) : crypto.subtle.importKey("pkcs8", pemDer(keys.pem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]).then(function (k) {
        ebKeys[id] = { app: keys.app, key: k };
        return k;
      });
    return getKey.then(function (k) {
      var exp = now + 3600;
      var head = b64urlText(JSON.stringify({ typ: "JWT", alg: "RS256", kid: keys.app }));
      var body = b64urlText(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: exp }));
      return crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, new TextEncoder().encode(head + "." + body)).then(function (sig) {
        var jwt = head + "." + body + "." + b64urlBytes(new Uint8Array(sig));
        ebTokens[id] = { app: keys.app, jwt: jwt, exp: exp };
        return jwt;
      });
    }, function () { throw err("keys"); });
  }
  // The keys a call uses: for Enable Banking the signed JWT only.
  function callKeys(a, keys) {
    if (a.p !== "ebank") return Promise.resolve(keys);
    return ebJwt(a.id, keys).then(function (jwt) { return { jwt: jwt }; });
  }

  // ---------- Calls ----------
  function err(code, extra) { var e = new Error(code); e.code = code; if (extra) e.extra = extra; return e; }
  function relayUrl() {
    var u = "";
    try {
      var m = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
      u = m && m.relay && typeof m.relay.url === "string" ? m.relay.url.trim().replace(/\/+$/, "") : "";
    } catch (e) {}
    return /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w.~-]*)*$/i.test(u) ? u : DEFAULT_RELAY;
  }
  function withTimeout(ms, run) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, ms);
    return run(ctl.signal).then(function (v) { clearTimeout(timer); return v; },
                                function (e) { clearTimeout(timer); throw e; });
  }
  function parse(status, text) {
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    return { status: status, data: data };
  }
  // straight from the browser; how = "direct" (Authorization header) or
  // "query" (keys in the address: for servers that drop the header)
  function direct(a, keys, r, how) {
    var url = L.apiUrl(a.p, a, r.path, keys);
    var headers = { Accept: "application/json" };
    if (a.p === "woo" && how === "query") url += (r.path.indexOf("?") < 0 ? "?" : "&") + "consumer_key=" + keys.ck + "&consumer_secret=" + keys.cs;
    else { var h = L.authHeader(a.p, keys); headers[h[0]] = h[1]; }
    var ex = L.extraHeaders(a.p, a);
    Object.keys(ex).forEach(function (k) { headers[k] = ex[k]; });
    var init = { method: r.m, headers: headers, mode: "cors", credentials: "omit", cache: "no-store",
                 redirect: "error", referrerPolicy: "no-referrer" };
    if (r.body) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(r.body); }
    return withTimeout(timeoutOf(a.p), function (signal) {
      init.signal = signal;
      return fetch(url, init).then(function (res) {
        return res.text().then(function (t) { return parse(res.status, t); });
      });
    });
  }
  function viaRelay(a, keys, reqs) {
    var body = { op: "ext", p: a.p };
    if (a.p === "ebank") body.key = keys.jwt;            // never the private key
    else if (a.p === "tol") { body.env = a.env; body.key = keys.key; }
    else if (a.p !== "woo" && !L.PLATFORMS[a.p].site) {                       // fixed hosts: the relay knows them
      L.PLATFORMS[a.p].keys.forEach(function (f) { body[f.k] = keys[f.k]; });
    }
    else if (a.p !== "woo") {                          // the person's own site, one key
      var sp = L.siteParts(a.site);
      body.host = sp.host; body.base = sp.base; body.key = keys.key;
      if (a.db) body.db = a.db;
    } else {
      var parts = L.siteParts(a.site);
      body.host = parts.host; body.base = parts.base; body.ck = keys.ck; body.cs = keys.cs;
    }
    body.reqs = reqs.map(function (r) { var o = { m: r.m, path: r.path }; if (r.body) o.body = JSON.stringify(r.body); if (r.img === 1) o.img = 1; return o; });
    return withTimeout(timeoutOf(a.p) + 30000, function (signal) {
      return fetch(relayUrl() + "/v1", {
        method: "POST", mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: signal
      }).then(function (res) { return res.json(); });
    }).then(function (j) {
      if (!j || !j.ok || !j.data || !Array.isArray(j.data.res)) throw err("relay");
      return j.data.res.map(function (x) {
        if (x && x.err) return { status: x.status || 0, err: x.err };
        if (x && typeof x.b64 === "string") return { status: x.status, type: String(x.type || ""), b64: x.b64 };   // a product picture
        return parse(x.status, x.body);
      });
    }, function (e) { if (e && e.code) throw e; throw err("relay"); });
  }
  // call(id, reqs) → Promise<[{ status, data } | { status, err }]>, in
  // order. Rejects with a code when nothing could be asked at all.
  function call(id, reqs) {
    var a = L.find(read(), id);
    if (!a || a.d === 1) return Promise.reject(err("gone"));
    reqs = Array.isArray(reqs) ? reqs : [reqs];
    if (!reqs.length || reqs.length > 10) return Promise.reject(err("bad"));
    for (var i = 0; i < reqs.length; i++) if (L.checkReq(a.p, reqs[i])) return Promise.reject(err("denied"));
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.reject(err("offline"));
    var pl = L.PLATFORMS[a.p];
    // Product pictures (WooCommerce, Newsletter wave E4) only come this
    // way when the app could not read them itself: straight to the relay.
    var imgs = reqs.filter(function (r) { return r.img === 1; }).length;
    if (imgs && (imgs !== reqs.length || imgs > 1)) return Promise.reject(err("bad"));   // one picture per call (relay CPU)
    if (imgs) return openLocal(id).then(function (local) { if (!local) throw err("keys"); return viaRelay(a, local.keys, reqs); });
    if (a.p === "ebank") {
      // Enable Banking: the keys become a JWT here, before either way.
      // Its writes (a consent request, a session from the bank's code)
      // travel alone and are never sent a second way after a failure.
      var ebW = reqs.some(function (r) { return r.m !== "GET"; });
      if (ebW && reqs.length > 1) return Promise.reject(err("bad"));
      if (ebW && !prefs().mode[id]) {
        return call(id, [L.probeReq(a.p)]).then(function () {
          if (!prefs().mode[id]) throw err("network");
          return call(id, reqs);
        });
      }
      return openLocal(id).then(function (local) {
        if (!local) throw err("keys");
        return callKeys(a, local.keys);
      }).then(function (k) { return callWith(a, id, pl, reqs, k, ebW); });
    }
    var writes = reqs.some(function (r) { return r.m !== "GET"; });
    // a write that must happen once travels alone (the relay refuses more)
    if (pl.once && writes && reqs.length > 1) return Promise.reject(err("bad"));
    // a new WooCommerce product (Publishing P2) is not idempotent either:
    // never sent a second way after a failure (it may have arrived)
    var once = !!(pl.once && writes) || (a.p === "woo" && reqs.some(function (r) { return r.m === "POST" && r.path === "/products"; }));
    if (once && reqs.length > 1) return Promise.reject(err("bad"));
    // A write that must not happen twice (an invoicing provider issues a
    // tax document) is never retried another way after it was tried:
    // when the way is not known yet, a read finds it first.
    if (once && !prefs().mode[id]) {
      return call(id, [L.probeReq(a.p)]).then(function () {
        if (!prefs().mode[id]) throw err("network");
        return call(id, reqs);
      });
    }
    return openLocal(id).then(function (local) {
      if (!local) throw err("keys");
      return callWith(a, id, pl, reqs, local.keys, once);
    });
  }
  function callWith(a, id, pl, reqs, keys, once) {
    var mode = pl.relayOnly ? "relay" : pl.direct ? "direct" : (prefs().mode[id] || "direct");
    function all(how) {
      return reqs.reduce(function (p, r) {
        return p.then(function (out) { return direct(a, keys, r, how).then(function (x) { out.push(x); return out; }); });
      }, Promise.resolve([]));
    }
    function relay() {
      return viaRelay(a, keys, reqs).then(function (res) { setMode(id, "relay"); return res; });
    }
    if (mode === "relay") {
      if (once) return viaRelay(a, keys, reqs).catch(function (e) { throw err(e && e.code === "relay" ? "unknown" : (e && e.code) || "unknown"); });
      return relay();
    }
    return all(mode).then(function (res) {
      // 401 with the header: some servers drop it; try the address
      if (a.p === "woo" && mode === "direct" && res[0] && res[0].status === 401) {
        return all("query").then(function (r2) {
          if (r2[0] && r2[0].status !== 401) { setMode(id, "query"); return r2; }
          return res;
        }, function () { return res; });
      }
      setMode(id, mode);
      return res;
    }, function (e) {
      if (once) throw err("unknown");            // it may have arrived: the app checks before trying again
      if (e && e.name === "AbortError") throw err("network");
      if (pl.direct) throw err("network");       // a platform the relay doesn't know (Shopify)
      return relay();                            // the browser could not reach it: CORS or firewall
    });
  }
  // A status as one of the codes above ("" = fine).
  function statusCode(x) {
    if (!x) return "network";
    if (x.err) return x.err === "timeout" ? "network" : (x.err === "auth" ? "auth" : "network");
    if (x.status >= 200 && x.status < 300) return "";
    if (x.status === 401 || x.status === 403) return "auth";
    if (x.status === 404) return "notfound";
    if (x.status === 429) return "busy";
    return "server";
  }
  // Is the account reachable with its keys? → Promise<"" | code>
  function test(id) {
    var a = L.find(read(), id);
    if (!a || a.d === 1) return Promise.resolve("gone");
    return call(id, [L.probeReq(a.p)]).then(function (res) {
      return statusCode(res[0]);
    }, function (e) { return (e && e.code) || "network"; });
  }
  function onChange(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }
  function mode(id) { return prefs().mode[id] || ""; }

  root.orosLinks = {
    list: list, get: get, add: add, edit: edit, setKeys: setKeys, hasKeys: hasKeys,
    setKeySync: setKeySync, canKeySync: canKeySync, remove: remove,
    call: call, test: test, statusCode: statusCode, mode: mode, onChange: onChange,
    platforms: function () { return L.PLATFORM_IDS.map(function (p) { return { id: p, name: L.PLATFORMS[p].name, apps: L.PLATFORMS[p].apps.slice(), site: !!L.PLATFORMS[p].site, db: !!L.PLATFORMS[p].db, ownUi: L.PLATFORMS[p].ownUi || "" }; }); }
  };

  registerSlice();
  // keys sealed elsewhere arrive with a pull; also try once after boot
  setTimeout(keySync, 5000);
})(typeof window !== "undefined" ? window : this);
