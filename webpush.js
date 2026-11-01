// ============================================================
// orOS Web Push — notifications with orOS closed (optional)
// Off by default; a device turns it on in Settings › Notifications.
// That device then subscribes to its browser's push service (Google
// FCM in Chrome and on Android, Microsoft WNS in Edge, Mozilla in
// Firefox) and keeps a box on the relay (relay/push.js) up to date
// with the next week of reminders. Every reminder is encrypted here
// (RFC 8291, aes128gcm) with the subscription's own keys: the relay
// and the push service see only an encrypted packet and its time.
//
// Rows: the same reminders, keys and links the shell engines use
// (phone.js reminderRows: Clock alarms and timers, Water, To-Do,
// Habits, Health) plus Calendar reminders (calendarRows). sw.js shows
// them with tag = dedupKey, and not at all while an orOS window is on
// screen (the in-app engine rings then).
//
// Per device, never synced: localStorage "oros-webpush"
//   { on, id, tok, ep, key, at, n, hash, err }
// ============================================================
(function (root) {
  "use strict";

  var PREF_KEY = "oros-webpush";
  var HOURS = 168, MAX_ROWS = 300, TTL_ALARM = 900, TTL_NOTE = 3600;
  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = mail.js; the box lives there
  var RS = 4096;

  /* ---------- bytes ---------- */
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
    var n = 0, i, parts = Array.prototype.slice.call(arguments);
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out;
  }
  function utf8(s) { return new TextEncoder().encode(s); }
  function randomB64u(n) {
    var b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return b64u(b);
  }
  function hmac(key, data) {
    return crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      .then(function (k) { return crypto.subtle.sign("HMAC", k, data); })
      .then(function (b) { return new Uint8Array(b); });
  }

  // RFC 8291 + RFC 8188 (one record). p256dh, auth: the subscription's
  // keys (base64url). opts.salt / opts.keys only for the test vector.
  function encrypt(plain, p256dh, auth, opts) {
    opts = opts || {};
    var ua = unb64u(p256dh), secret = unb64u(auth);
    var salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
    var asPub, ecdh, prk, cek, nonce;
    var keys = opts.keys ? Promise.resolve(opts.keys)
                         : crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    return keys.then(function (kp) {
      return crypto.subtle.exportKey("raw", kp.publicKey).then(function (raw) {
        asPub = new Uint8Array(raw);
        return crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
      }).then(function (uaKey) {
        return crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, kp.privateKey, 256);
      });
    }).then(function (bits) {
      ecdh = new Uint8Array(bits);
      return hmac(secret, ecdh);
    }).then(function (prkKey) {
      return hmac(prkKey, cat(utf8("WebPush: info\0"), ua, asPub, new Uint8Array([1])));
    }).then(function (ikm) {
      return hmac(salt, ikm);
    }).then(function (p) {
      prk = p;
      return hmac(prk, cat(utf8("Content-Encoding: aes128gcm\0"), new Uint8Array([1])));
    }).then(function (c) {
      cek = c.slice(0, 16);
      return hmac(prk, cat(utf8("Content-Encoding: nonce\0"), new Uint8Array([1])));
    }).then(function (n) {
      nonce = n.slice(0, 12);
      return crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
    }).then(function (k) {
      var data = typeof plain === "string" ? utf8(plain) : plain;
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, cat(data, new Uint8Array([2])));
    }).then(function (ct) {
      var head = new Uint8Array(21);
      head.set(salt, 0);
      head[16] = (RS >>> 24) & 255; head[17] = (RS >>> 16) & 255; head[18] = (RS >>> 8) & 255; head[19] = RS & 255;
      head[20] = asPub.length;
      return b64u(cat(head, asPub, new Uint8Array(ct)));
    });
  }

  /* ---------- rows ---------- */
  // Calendar reminders (shell calRemTick rules): events with remindMin
  // > 0, each occurrence's start minus remindMin, dedupKey
  // "calendar:rem:<id>:<ymd>", link "calendar:<id>:<ymd>".
  function calendarRows(data, OCC, now, end, lang) {
    var rows = [];
    if (!data || !Array.isArray(data.events) || !OCC || typeof OCC.instancesBetween !== "function") return rows;
    var I = root && root.orosI18n, loc = I ? I.locale(lang) : (lang === "el" ? "el-GR" : "en-GB");
    // "Reminder" from the shell's table (translations.js), English in node.
    var noTitle = root && typeof root.t === "function" && root.t("rem.title") !== "rem.title" ? root.t("rem.title") : "Reminder";
    function when(ts) {
      var d = new Date(ts);
      return d.toLocaleDateString(loc, { day: "2-digit", month: "short" }) + " · " +
             d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
    }
    function startOf(ev, ymd) {
      if (typeof OCC.startTs === "function") return OCC.startTs(ev, ymd);
      var p = ymd.split("-"), ts = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
      if (ev.start && /^\d{2}:\d{2}$/.test(ev.start)) ts += (+ev.start.slice(0, 2)) * 3600000 + (+ev.start.slice(3)) * 60000;
      return ts;
    }
    function ymd(ms) { var d = new Date(ms); return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate(); }
    data.events.forEach(function (ev) {
      if (!ev || typeof ev !== "object" || typeof ev.id !== "string" || ev.deleted ||
          typeof ev.remindMin !== "number" || !isFinite(ev.remindMin) || ev.remindMin <= 0) return;
      var lead = ev.remindMin * 60000;
      try {
        // occurrences (the shell's key uses inst.occ) that start inside [now, end + lead]
        OCC.instancesBetween(ev, ymd(now - 86400000), ymd(end + lead + 86400000), function (inst) {
          var ts = startOf(ev, inst.occ), rem = ts - lead;
          if (rem > now && rem <= end) rows.push({ id: "calendar:rem:" + ev.id + ":" + inst.occ, at: rem, kind: "note", ns: "calendar",
                                     title: String(ev.title || noTitle).slice(0, 120),
                                     body: when(ts), link: "calendar:" + ev.id + ":" + inst.occ });
          return true;
        });
      } catch (e) {}
    });
    return rows;
  }

  // What the service worker gets (inside the encrypted packet).
  function payload(r) {
    return JSON.stringify({ v: 1, k: r.id, at: r.at, ns: r.ns, kind: r.kind,
                            title: String(r.title || "orOS").slice(0, 120), body: String(r.body || "").slice(0, 240),
                            link: String(r.link || "").slice(0, 200) });
  }
  // The relay's key for a row: opaque, stable for the same reminder.
  function rowKey(tok, id) {
    return crypto.subtle.digest("SHA-256", utf8(tok + "|" + id)).then(function (d) {
      return b64u(new Uint8Array(d)).slice(0, 32);
    });
  }
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  }

  // The synced list of devices that turned the switch on (wave 3), so
  // a change made on any device also refreshes the boxes of the others.
  // { v:1, d: { <box id>: { tok, ep, k1 (p256dh), k2 (auth), n (name),
  //   m (changed at), x (true = turned off) } } }. Newer m wins; a tie
  // goes to the larger JSON, so both sides end up with the same list.
  function cleanList(l) {
    var out = { v: 1, d: {} }, d = l && l.d;
    if (!d || typeof d !== "object") return out;
    Object.keys(d).forEach(function (id) {
      var e = d[id];
      if (!/^[A-Za-z0-9_-]{22}$/.test(id) || !e || typeof e !== "object" || typeof e.m !== "number") return;
      if (e.x) { out.d[id] = { m: e.m, x: true }; return; }
      if (!/^[A-Za-z0-9_-]{43}$/.test(e.tok || "") || typeof e.ep !== "string" || typeof e.k1 !== "string" || typeof e.k2 !== "string") return;
      out.d[id] = { tok: e.tok, ep: e.ep.slice(0, 1200), k1: e.k1.slice(0, 120), k2: e.k2.slice(0, 40),
                    n: String(e.n || "").slice(0, 60), m: e.m };
    });
    return out;
  }
  function mergeLists(a, b) {
    a = cleanList(a); b = cleanList(b);
    var out = { v: 1, d: {} };
    Object.keys(a.d).concat(Object.keys(b.d)).sort().forEach(function (id) {
      var x = a.d[id], y = b.d[id];
      if (!x || !y) { out.d[id] = x || y; return; }
      if (x.m !== y.m) { out.d[id] = x.m > y.m ? x : y; return; }
      out.d[id] = JSON.stringify(x) >= JSON.stringify(y) ? x : y;
    });
    return out;
  }
  function liveDevices(l) {
    l = cleanList(l);
    return Object.keys(l.d).filter(function (id) { return !l.d[id].x; }).map(function (id) {
      return Object.assign({ id: id }, l.d[id]);
    });
  }

  var api = { encrypt: encrypt, calendarRows: calendarRows, payload: payload, rowKey: rowKey,
              mergeLists: mergeLists, cleanList: cleanList, liveDevices: liveDevices,
              b64u: b64u, unb64u: unb64u, HOURS: HOURS, MAX_ROWS: MAX_ROWS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root || !root.document || !root.navigator) return;

  /* ---------- browser ---------- */
  var LIST_KEY = "oros-webpush-devices";
  function readJson(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v && typeof v === "object" ? v : d; }
    catch (e) { return d; }
  }
  function prefs() { return readJson(PREF_KEY, {}); }
  function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} }
  function list() { return cleanList(readJson(LIST_KEY, null)); }
  function saveList(l) {
    try { localStorage.setItem(LIST_KEY, JSON.stringify(cleanList(l))); } catch (e) {}
    try { if (root.orosSync && root.orosSync.markDirty) root.orosSync.markDirty(); } catch (e) {}
  }
  function putDevice(id, entry) {
    var l = list();
    entry.m = Math.max(Date.now(), (l.d[id] && l.d[id].m || 0) + 1);
    l.d[id] = entry;
    saveList(l);
  }
  var listeners = [];
  function emit() { listeners.slice().forEach(function (f) { try { f(); } catch (e) {} }); }

  function relay(body) {
    body.op = "push";
    var json = JSON.stringify(body);
    // keepalive: a schedule sent as orOS closes still gets there
    // (browsers cap keepalive bodies at 64 KB, so only small ones).
    return fetch(RELAY + "/v1", { method: "POST", headers: { "Content-Type": "application/json" },
                                  body: json, keepalive: json.length < 60000 })
      .catch(function () { throw fail("network"); })   // offline, blocked, or the relay refused this origin
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: { code: "proto" } }; }); })
      .then(function (j) {
        if (j && j.ok) return j.data;
        throw fail((j && j.error && j.error.code) || "proto");
      });
  }
  function fail(code) { var e = new Error("push"); e.code = code; return e; }

  function inApp() {
    try { return !!(root.orosPhone && root.orosPhone.available && root.orosPhone.available()); } catch (e) { return false; }
  }
  function supported() {
    return "serviceWorker" in navigator && "PushManager" in root && "Notification" in root && !!(root.crypto && crypto.subtle);
  }
  function subscription() {
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); });
  }
  function deviceName() {
    var ua = navigator.userAgent || "";
    var b = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : "Browser";
    var o = /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS"
          : /Linux/.test(ua) ? "Linux" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac/.test(ua) ? "macOS" : "";
    return o ? b + " · " + o : b;
  }

  function rows(now) {
    var out = [];
    try { if (root.orosPhone && root.orosPhone.reminderRows) out = root.orosPhone.reminderRows(now, HOURS, MAX_ROWS); } catch (e) {}
    try {
      var lang = (document.documentElement.lang || "en").slice(0, 2);
      out = out.concat(calendarRows(readJson("oros-calendar-data", null), root.OrosCalOccur, now, now + HOURS * 3600000, lang));
    } catch (e) {}
    // Respect the notification settings, and leave out what the inbox
    // already showed (synced, so the same on every device).
    var shown = {};
    try {
      var N = root.orosNotifs, sl = N && N.getSlice && N.getSlice();
      (sl && Array.isArray(sl.items) ? sl.items : []).forEach(function (it) { if (it && it.dedupKey) shown[it.dedupKey] = 1; });
      if (N && N.getAppToggle) out = out.filter(function (r) { return N.getAppToggle(r.ns); });
      if (N && N.getSetting && !N.getSetting("enabled", true)) out = [];
    } catch (e) {}
    out = out.filter(function (r) { return !shown[r.id]; });
    out.sort(function (a, b) { return a.at - b.at; });
    return out.slice(0, MAX_ROWS);
  }

  // One device's box: encrypt every row with its keys, replace its schedule.
  function sendTo(dev, rs) {
    return Promise.all(rs.map(function (r) {
      return Promise.all([rowKey(dev.tok, r.id), encrypt(payload(r), dev.k1, dev.k2)]).then(function (x) {
        return { k: x[0], at: r.at, ct: x[1], ttl: r.kind === "alarm" ? TTL_ALARM : TTL_NOTE };
      });
    })).then(function (items) { return relay({ act: "set", id: dev.id, tok: dev.tok, items: items }); });
  }

  var busy = false, lastCheck = 0;
  // Every device on the list gets the schedule when it changed (or once
  // a day, so no box goes idle). At most once a minute unless forced.
  function schedule(force) {
    if (busy || inApp() || !(root.crypto && crypto.subtle)) return Promise.resolve(false);   // any device may refresh the others
    // BOOT-L1: the rows need app cores from the shell's late bundle; a
    // list sent without them would replace the full one at the relay.
    if (root.orosLate && !root.orosLate.done) return Promise.resolve(false);
    var now = Date.now();
    if (!force && now - lastCheck < 60000) return Promise.resolve(false);
    lastCheck = now;
    var p = prefs(), devs = liveDevices(list());
    if (!devs.length) return Promise.resolve(false);
    busy = true;
    var rs = rows(now);
    var hash = fnv(JSON.stringify(rs.map(function (r) { return [r.id, r.at, r.title, r.body, r.link]; })));
    var sent = p.sent && typeof p.sent === "object" ? p.sent : {};
    return checkSelf().then(function () {
      var q0 = prefs().sent;
      sent = q0 && typeof q0 === "object" ? q0 : {};   // checkSelf may have cleared it
      devs = liveDevices(list());
      return devs.reduce(function (chain, dev) {
        return chain.then(function () {
          var last = sent[dev.id];
          if (!force && last && last.h === hash + dev.m && now - last.at < 86400000) return;
          return sendTo(dev, rs).then(function (d) {
            sent[dev.id] = { h: hash + dev.m, at: Date.now(), n: d && d.n || 0 };
            delete sent[dev.id].err;
          }, function (e) {
            var code = e && e.code || "proto";
            if (code === "gone") { putDevice(dev.id, { x: true }); delete sent[dev.id]; return; }
            sent[dev.id] = Object.assign(sent[dev.id] || {}, { err: code });
          });
        });
      }, Promise.resolve());
    }).then(function () {
      var q = prefs(), live = {};
      liveDevices(list()).forEach(function (d) { live[d.id] = 1; });
      Object.keys(sent).forEach(function (id) { if (!live[id]) delete sent[id]; });
      q.sent = sent;
      savePrefs(q); emit();
      return true;
    }).catch(function () { return false; }).then(function (r) { busy = false; return r; });
  }

  // This device: still on the list, still subscribed, same endpoint.
  function checkSelf() {
    var p = prefs();
    if (!p.on || !p.id) return Promise.resolve();
    var mine = list().d[p.id];
    if (!supported()) return Promise.resolve();
    return subscription().then(function (sub) {
      if (!sub || (mine && mine.x)) {          // unsubscribed here, or removed from another device
        savePrefs({ on: false });
        if (!mine || !mine.x) putDevice(p.id, { x: true });
        if (sub) sub.unsubscribe().catch(function () {});
        return;
      }
      var j = sub.toJSON(), k = j.keys || {};
      if (mine && mine.ep === sub.endpoint && mine.k1 === k.p256dh && p.r === RELAY) return;
      // New endpoint, or a new relay (its boxes start empty): sign up again, resend everything.
      return relay({ act: "sub", id: p.id, tok: p.tok, endpoint: sub.endpoint }).then(function () {
        var q = prefs(); q.r = RELAY; q.sent = {}; savePrefs(q);
        putDevice(p.id, { tok: p.tok, ep: sub.endpoint, k1: k.p256dh, k2: k.auth, n: deviceName() });
      });
    }).catch(function () {});
  }

  function enable() {
    if (!supported() || inApp()) return Promise.reject(fail("unsupported"));
    var key;
    return Promise.resolve(Notification.requestPermission()).then(function (perm) {
      if (perm !== "granted") throw fail("denied");
      return relay({ act: "key" });
    }).then(function (d) {
      key = d.key;
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (old) {
        return old ? old.unsubscribe().catch(function () {}) : null;   // one made with another key cannot be reused
      }).then(function () {
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(key) })
          .catch(function () { throw fail("nosubscribe"); });   // no push service here (a private window, a blocked network)
      });
    }).then(function (sub) {
      var id = randomB64u(16), tok = randomB64u(32), k = sub.toJSON().keys || {};
      return relay({ act: "sub", id: id, tok: tok, endpoint: sub.endpoint }).then(function () {
        savePrefs({ on: true, id: id, tok: tok, r: RELAY, sent: {} });
        putDevice(id, { tok: tok, ep: sub.endpoint, k1: k.p256dh, k2: k.auth, n: deviceName() });
        emit();
        return schedule(true);
      });
    });
  }

  // Any device can turn any listed device off; this one also unsubscribes.
  function remove(id) {
    var dev = list().d[id], p = prefs();
    putDevice(id, { x: true });
    var gone = dev && dev.tok ? relay({ act: "del", id: id, tok: dev.tok }).catch(function () {}) : Promise.resolve();
    var unsub = Promise.resolve();
    if (id === p.id) {
      savePrefs({ on: false });
      if (supported()) unsub = subscription().then(function (s) { return s && s.unsubscribe(); }).catch(function () {});
    }
    emit();
    return Promise.all([gone, unsub]);
  }
  function disable() {
    var p = prefs();
    if (p.id) return remove(p.id);
    savePrefs({ on: false }); emit();
    return Promise.resolve();
  }

  function test(title, body) {
    var p = prefs(), dev = p.id && list().d[p.id];
    if (!p.on || !dev || dev.x) return Promise.reject(fail("off"));
    return encrypt(payload({ id: "system:push-test-" + Date.now(), at: Date.now(), ns: "system", kind: "note",
                             title: title, body: body, link: "" }), dev.k1, dev.k2)
      .then(function (ct) { return relay({ act: "test", id: p.id, tok: p.tok, ct: ct }); });
  }

  // Sync: the device list travels with the other slices (merged, never overwritten).
  function registerSlice() {
    if (!root.orosSync || typeof root.orosSync.registerSlice !== "function") { setTimeout(registerSlice, 200); return; }
    root.orosSync.registerSlice("webpush", function () { return list(); }, function (v) {
      try { localStorage.setItem(LIST_KEY, JSON.stringify(cleanList(v))); } catch (e) {}
      lastCheck = 0;
      setTimeout(function () { schedule(false); }, 1000);
      emit();
    }, null, mergeLists);
  }
  registerSlice();

  // A tap on a notification while orOS is open (sw.js posts it here).
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || d.t !== "oros-push-open" || typeof d.link !== "string") return;
      try { if (root.orosNotifs && root.orosNotifs.openLink) root.orosNotifs.openLink(d.link.slice(0, 200)); } catch (x) {}
    });
  }
  // Keep the boxes current: every minute while open, and right away when
  // orOS goes to the background (a timer set a moment ago must get there).
  setInterval(function () { schedule(false); }, 60000);
  document.addEventListener("visibilitychange", function () { if (document.hidden) { lastCheck = 0; schedule(false); } });
  setTimeout(function () { schedule(false); }, 8000);
  root.addEventListener("oros:late-ready", function () { setTimeout(function () { schedule(false); }, 1000); });
  // An app saved something (a Calendar event, an alarm): send soon, not
  // up to a minute later, so closing orOS right after still counts.
  // The apps run in frames, so their writes reach this page as storage events.
  var soon = 0;
  root.addEventListener("storage", function (e) {
    if (!e.key || e.key.indexOf("oros-webpush") === 0) return;
    clearTimeout(soon);
    soon = setTimeout(function again() {
      if (busy) { soon = setTimeout(again, 1500); return; }
      lastCheck = 0; schedule(false);
    }, 1500);
  });

  root.orosPush = {
    calendarRows: calendarRows,   // also used by phone.js (the Android app's own reminders)
    supported: function () { return supported() && !inApp(); },
    enabled: function () { return !!prefs().on; },
    state: function () {
      var p = prefs(), s = p.sent && p.id && p.sent[p.id] || {};
      return { on: !!p.on, at: s.at || 0, n: s.n || 0, err: s.err || "" };
    },
    // Every device with the switch on (this one marked), for Settings.
    devices: function () {
      var p = prefs();
      return liveDevices(list()).map(function (d) { return { id: d.id, name: d.n, self: d.id === p.id }; });
    },
    permission: function () { try { return Notification.permission; } catch (e) { return "default"; } },
    enable: enable, disable: disable, remove: remove, test: test,
    // Household wakes (household/engine.js, relay/house.js): this
    // device's box id, a wake token that can only wake it, and one
    // packet encrypted for this device.
    deviceId: function () { var p = prefs(); return p.on && p.id ? p.id : ""; },
    wakeToken: function () {
      var p = prefs();
      if (!p.on || !p.id) return Promise.reject(fail("off"));
      return relay({ act: "wtok", id: p.id, tok: p.tok }).then(function (d) { return d.wt; });
    },
    dropWake: function (wt) {
      var p = prefs();
      if (!p.on || !p.id) return Promise.resolve();
      return relay({ act: "wdel", id: p.id, tok: p.tok, wt: wt });
    },
    wakePacket: function (k, title, body, link) {
      var p = prefs(), dev = p.id && list().d[p.id];
      if (!p.on || !dev || dev.x) return Promise.reject(fail("off"));
      return encrypt(payload({ id: k, at: Date.now(), ns: "household", kind: "note", title: title, body: body, link: link }), dev.k1, dev.k2);
    },
    refresh: function () { return schedule(true); },
    onChange: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    }
  };
})(typeof window !== "undefined" ? window : null);
