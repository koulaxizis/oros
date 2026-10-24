// ============================================================
// orOS Newsletter — the sending engine (browser, no UI)
// Shared by the shell (newsletter/runner.js: sends with the app
// CLOSED, while orOS is open) and the app (only when the shell has
// no runner, e.g. a stale cached shell). Exposed as
// window.OrosNewsletterEngine.
//   - store: the synced slice read from / written to localStorage.
//     Every write MERGES with what is stored (C.mergeNewsletter), so
//     the app, the shell and a second tab never undo each other's
//     work: sent sets are unions, records are last-writer-wins
//   - device state "oros-newsletter-dev" { dev, used, inbox }: this
//     device's id, its daily counters per sending account and when
//     its Inbox was last read (never synced)
//   - Mail accounts and relay: reads oros-mail-data; Mail's sealed
//     passwords from IndexedDB "oros-mail" (opened WITHOUT a version,
//     read-only); provider passwords in IndexedDB "oros-newsletter"
//     (sealed with a non-extractable device key, never synced)
//   - create(env): one message at a time — scheduled issues start
//     when their time comes, confirmation requests first, then the
//     issue being sent; paced by the account's seconds between
//     messages, stopped by its daily limit. Each step holds the Web
//     Lock "oros-newsletter-send" so two windows of this device never
//     send at the same time; between devices the issue lock { dev, at }
//     and the grow-only sent set keep anyone from getting it twice.
//     The Inbox (requests + delivery failures) is read before an
//     issue goes on and every 10 minutes while idle.
// Errors are stored as codes ("auth", "no:<server text>"); the app
// translates them.
// ============================================================
(function (root) {
  "use strict";
  var C = root.OrosNewsletterCore, R = root.OrosNewsletterRender;
  if (!C || !R) return;

  var KEY = C.STORAGE_KEY;
  var DEV_KEY = "oros-newsletter-dev";
  var OLD_PREFS_KEY = "oros-newsletter-prefs";
  var DB_NAME = "oros-newsletter";
  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = mail.js
  var CALL_TIMEOUT = 45000, SEND_TIMEOUT = 120000;
  var INBOX_EVERY = 10 * 60 * 1000;
  var IDLE_EVERY = 5 * 60 * 1000;
  var LOCK_SEND = "oros-newsletter-send", LOCK_INBOX = "oros-newsletter-inbox", LOCK_RSS = "oros-newsletter-rss";
  var LOCK_CLEAN = "oros-newsletter-clean";

  function stamp(prev) { return Math.max(Date.now(), (prev || 0) + 1); }
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function dayKey(ms) {
    var d = new Date(ms || Date.now());
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function replaceIn(arr, rec) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === rec.id) { arr[i] = rec; return; }
    arr.push(rec);
  }

  // ---------- store ----------
  function read() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    return C.parse(raw) || C.empty();
  }
  // → the merged data, or null when the browser storage is full
  function write(d) {
    var cur = null;
    try { cur = C.parse(localStorage.getItem(KEY)); } catch (e) {}
    var out = cur ? C.mergeNewsletter(cur, d) : C.normalize(d);
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) { return null; }
    return out;
  }
  // a changed record into d (stamped)
  function put(d, coll, rec) { rec.m = stamp(rec.m); replaceIn(d[coll], rec); }

  // ---------- device state ----------
  function devState() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(DEV_KEY) || "null"); } catch (e) {}
    if (!v || typeof v !== "object") {
      // phase 1 kept these in the app's prefs
      try { v = JSON.parse(localStorage.getItem(OLD_PREFS_KEY) || "null"); } catch (e) {}
      v = v && typeof v === "object" ? { dev: v.dev, used: v.used, inbox: v.inbox } : {};
    }
    var o = {
      dev: typeof v.dev === "string" && /^[a-z0-9]{6,20}$/.test(v.dev) ? v.dev : C.randomId("d", null).slice(0, 11),
      used: v.used && typeof v.used === "object" ? v.used : {},
      inbox: v.inbox && typeof v.inbox === "object" ? v.inbox : {},
      papi: v.papi && typeof v.papi === "object" ? v.papi : {},      // chan id → last read of its API events (ms)
      cln: v.cln && typeof v.cln === "object" ? v.cln : {}           // list id → day of its last clean-up here
    };
    if (!v.dev) saveDev(o);
    return o;
  }
  function saveDev(o) { try { localStorage.setItem(DEV_KEY, JSON.stringify(o)); } catch (e) {} }
  function countUsed(chanId, n) {
    var o = devState(), k = dayKey();
    var u = o.used[chanId];
    o.used[chanId] = { d: k, n: (u && u.d === k ? u.n : 0) + (n || 1) };
    Object.keys(o.used).forEach(function (id) { if (!o.used[id] || o.used[id].d !== k) delete o.used[id]; });
    saveDev(o);
  }
  function capLeft(ch) { return ch.cap - C.usedToday(devState().used, ch.id, dayKey()); }

  // ---------- Mail accounts ----------
  function mailData() {
    try {
      var d = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
      return d && Array.isArray(d.accounts) ? d : null;
    } catch (e) { return null; }
  }
  function mailAccounts() {
    var d = mailData();
    if (!d) return [];
    var tombs = d.tombs || {};
    return d.accounts.filter(function (a) {
      return a && typeof a.id === "string" && /^[a-z0-9]{6,40}$/.test(a.id) && a.imap && a.imap.host && a.email &&
             !(tombs[a.id] >= a.m);
    });
  }
  function mailAccount(id) {
    var all = mailAccounts();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function relayUrl() {
    var d = mailData();
    var u = d && d.relay && typeof d.relay.url === "string" ? d.relay.url.trim().replace(/\/+$/, "") : "";
    return /^https:\/\/[^\s]+$/.test(u) ? u : DEFAULT_RELAY;
  }
  function idbReq(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); reject(r.error); };
    });
  }
  // Mail's database, opened WITHOUT a version (never blocks Mail's
  // upgrades) and closed after reading. Read-only.
  function mailPass(acctId) {
    return new Promise(function (resolve) {
      var rq;
      try { rq = indexedDB.open("oros-mail"); } catch (e) { resolve(null); return; }
      rq.onupgradeneeded = function () { try { rq.transaction.abort(); } catch (e) {} };
      rq.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); resolve(null); };
      rq.onblocked = function () { resolve(null); };
      rq.onsuccess = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains("keys") || !d.objectStoreNames.contains("creds")) { d.close(); resolve(null); return; }
        var tx = d.transaction(["keys", "creds"], "readonly");
        Promise.all([idbReq(tx.objectStore("keys").get("device")), idbReq(tx.objectStore("creds").get(acctId))]).then(function (r) {
          d.close();
          var key = r[0], rec = r[1];
          if (!key || !rec || !rec.iv || !rec.data) return null;
          return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, key, rec.data)
            .then(function (plain) { return new TextDecoder().decode(plain); });
        }).then(resolve, function () { try { d.close(); } catch (e) {} resolve(null); });
      };
    });
  }

  // ---------- provider passwords (this app's own database) ----------
  var ownDbP = null;
  function ownDb() {
    if (ownDbP) return ownDbP;
    ownDbP = new Promise(function (resolve, reject) {
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains("keys")) d.createObjectStore("keys");
        if (!d.objectStoreNames.contains("creds")) d.createObjectStore("creds");
      };
      rq.onsuccess = function () {
        var d = rq.result;
        d.onversionchange = function () { d.close(); ownDbP = null; };
        resolve(d);
      };
      rq.onerror = function () { ownDbP = null; reject(rq.error); };
    });
    return ownDbP;
  }
  function ownGet(store, key) {
    return ownDb().then(function (d) { return idbReq(d.transaction(store, "readonly").objectStore(store).get(key)); });
  }
  function ownPut(store, key, val) {
    return ownDb().then(function (d) { return idbReq(d.transaction(store, "readwrite").objectStore(store).put(val, key)); });
  }
  function ownDel(store, key) {
    return ownDb().then(function (d) { return idbReq(d.transaction(store, "readwrite").objectStore(store)["delete"](key)); });
  }
  function deviceKey() {
    return ownGet("keys", "device").then(function (k) {
      if (k) return k;
      return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
        .then(function (nk) { return ownPut("keys", "device", nk).then(function () { return nk; }); });
    });
  }
  function savePass(chanId, pass) {
    return deviceKey().then(function (key) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(pass))
        .then(function (sealed) { return ownPut("creds", chanId, { iv: iv.buffer, data: sealed }); });
    });
  }
  function ownPass(chanId) {
    return ownGet("creds", chanId).then(function (rec) {
      if (!rec) return null;
      return deviceKey().then(function (key) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, key, rec.data);
      }).then(function (plain) { return new TextDecoder().decode(plain); });
    })["catch"](function () { return null; });
  }
  function delPass(chanId) { return ownDel("creds", chanId)["catch"](function () {}); }

  // ---------- relay ----------
  function relay(body, ms) {
    if (!navigator.onLine) return Promise.reject({ code: "offline" });
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, ms || CALL_TIMEOUT);
    return fetch(relayUrl() + "/v1", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: ctl.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
    }).then(function (r) {
      return r.json()["catch"](function () { return null; });
    }, function () {
      throw { code: ctl.signal.aborted ? "timeout" : "network" };
    }).then(function (j) {
      clearTimeout(timer);
      if (!j || typeof j !== "object") throw { code: "relay" };
      if (!j.ok) throw { code: (j.error && j.error.code) || "relay", msg: (j.error && j.error.msg) || "" };
      return j.data;
    }, function (e) { clearTimeout(timer); throw e; });
  }
  function imapOf(a, pw) {
    return { host: a.imap.host, port: a.imap.port, sec: a.imap.sec, user: a.imap.user || a.email, pass: pw };
  }
  // → { acct, smtp, hdr } for the relay's "send" / "smtpcheck"
  function sendCreds(ch) {
    if (!ch) return Promise.reject({ code: "nochan" });
    if (ch.kind === "mail") {
      var a = mailAccount(ch.acct);
      if (!a) return Promise.reject({ code: "noacct" });
      if (!a.smtp) return Promise.reject({ code: "nosmtp" });
      return mailPass(a.id).then(function (pw) {
        if (!pw) throw { code: "nopass" };
        var acct = imapOf(a, pw);
        return { acct: acct, smtp: { host: a.smtp.host, port: a.smtp.port, sec: a.smtp.sec, user: a.smtp.user || acct.user, pass: pw } };
      });
    }
    return ownPass(ch.id).then(function (pw) {
      if (!pw) throw { code: "nopass" };
      var p = C.PRESETS[ch.preset] || {};
      // The relay checks an IMAP account on every mail operation even
      // when "send" files no copy (no "sent"): these fields are
      // validated, never used to connect.
      return { acct: { host: ch.host, port: 993, sec: "tls", user: ch.user || "user", pass: pw },
               smtp: { host: ch.host, port: ch.port, sec: ch.sec, user: ch.user, pass: pw },
               hdr: p.hdr || null };
    });
  }
  // → { prov, key, dom? } for the relay's "papi" (the key is device-local, like a password)
  function apiCreds(ch) {
    if (!C.isApi(ch)) return Promise.reject({ code: "nochan" });
    if (/^mailgun/.test(ch.preset) && !ch.dom) return Promise.reject({ code: "nodom" });
    return ownPass(ch.id).then(function (key) {
      if (!key) throw { code: "nopass" };
      var o = { prov: ch.preset, key: key };
      if (ch.dom) o.dom = ch.dom;
      return o;
    });
  }
  function papi(cr, reqs, ms) {
    var b = { op: "papi", prov: cr.prov, key: cr.key, reqs: reqs };
    if (cr.dom) b.dom = cr.dom;
    return relay(b, ms || SEND_TIMEOUT).then(function (r) { return (r && Array.isArray(r.res) ? r.res : []); });
  }
  // "Test login" for an API account → resolves, or rejects { code }
  function apiCheck(ch) {
    return apiCreds(ch).then(function (cr) { return papi(cr, [C.apiCheckReq(ch)], CALL_TIMEOUT); }).then(function (res) {
      var o = C.apiOutcome(ch.preset, res[0]);
      if (o.k === "ok") return true;
      throw o.k === "auth" ? { code: "apikey" } : o.k === "retry" ? { code: "network" } : { code: "no", msg: o.msg };
    });
  }
  function inboxAccount(ch) {
    if (!ch) return null;
    return mailAccount(ch.kind === "mail" ? ch.acct : ch.inbox);
  }
  // An error → the code stored on a paused issue
  function errCode(e) {
    var code = e && typeof e.code === "string" && /^[a-z-]{1,20}$/.test(e.code) ? e.code : "relay";
    var msg = e && e.msg ? String(e.msg).replace(/[\x00-\x1f]+/g, " ").slice(0, 120) : "";
    return code === "no" && msg ? "no:" + msg : code;
  }

  // ---------- pictures (inline in the message) ----------
  var imgData = {};        // path → { bin, type, url (data:) } this window
  function loadImages(x, fs) {
    var paths = C.picsOf(R.blocksOf(x).concat(x.l2 ? R.blocksOf(x.l2) : [])).map(function (q) { return q.f; });
    var todo = paths.filter(function (p, i) { return paths.indexOf(p) === i && !imgData[p]; });
    if (!todo.length) return Promise.resolve(true);
    var S = root.OrosNewsletterSocial;
    // social icons are drawn here (wave E2), a video's picture gets its
    // play mark here (E3); files come from the orOS disk
    var icons = todo.filter(function (p) { return /^icon:/.test(p); });
    var plays = todo.filter(function (p) { return /^play:/.test(p); });
    var files = todo.filter(function (p) { return !/^(icon|play):/.test(p); });
    var drawn = Promise.all(icons.map(function (p) {
      return S ? S.draw(p).then(function (d) { imgData[p] = d; return true; }, function () { return false; }) : Promise.resolve(false);
    }).concat(plays.map(function (p) {
      if (!fs) return Promise.resolve(false);
      return fs.readBlob(p.slice(5)).then(drawPlay).then(function (d) { imgData[p] = d; return true; })["catch"](function () { return false; });
    })));
    if (files.length && !fs) return drawn.then(function () { return false; });
    return Promise.all([drawn].concat(files.map(function (p) {
      return fs.readBlob(p).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
        var u8 = new Uint8Array(buf), bin = "";
        for (var i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        var type = /\.png$/.test(p) ? "image/png" : "image/jpeg";
        imgData[p] = { bin: bin, type: type, url: "data:" + type + ";base64," + btoa(bin) };
        return true;
      })["catch"](function () { return false; });
    }))).then(function (r) { return r[0].every(Boolean) && r.slice(1).every(Boolean); });
  }
  // A picture with a round play mark in the middle → { bin, type, url } (JPEG)
  function drawPlay(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error("img")); };
      im.onload = function () {
        URL.revokeObjectURL(url);
        var w = Math.min(im.naturalWidth || 1, 1200), h = Math.round((im.naturalHeight || 1) * w / (im.naturalWidth || 1));
        var cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        var g = cv.getContext("2d");
        g.drawImage(im, 0, 0, w, h);
        var r = Math.max(18, Math.round(Math.min(w, h) * 0.12)), cx = w / 2, cy = h / 2;
        g.fillStyle = "rgba(0,0,0,0.55)";
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        g.lineWidth = Math.max(2, r * 0.08); g.strokeStyle = "#ffffff"; g.stroke();
        g.fillStyle = "#ffffff";
        g.beginPath(); g.moveTo(cx - r * 0.32, cy - r * 0.45); g.lineTo(cx + r * 0.5, cy); g.lineTo(cx - r * 0.32, cy + r * 0.45); g.closePath(); g.fill();
        cv.toBlob(function (out) {
          if (!out) { reject(new Error("canvas")); return; }
          out.arrayBuffer().then(function (buf) {
            var u8 = new Uint8Array(buf), bin = "";
            for (var i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            resolve({ bin: bin, type: "image/jpeg", url: "data:image/jpeg;base64," + btoa(bin) });
          }, reject);
        }, "image/jpeg", 0.86);
      };
      im.src = url;
    });
  }
  // The calendar files of the event blocks that ask for one (wave E3)
  function filesFor(x, lang, now) {
    var v = x.l2 ? C.contentFor(x, lang) : x, seen = {};
    return R.blocksOf(v).map(function (b, i) {
      if (b.k !== "event" || !b.ics) return null;
      var ics = C.icsOf(b, x.id + "-" + i, now);
      if (!ics) return null;
      var base = C.slug(b.t) || "event", name = base, n = 2;
      while (seen[name]) name = base + "-" + (n++);
      seen[name] = 1;
      return { name: name + ".ics", type: "text/calendar", bin: unescape(encodeURIComponent(ics)) };
    }).filter(Boolean);
  }
  function cidOf(path) { return (/^play:/.test(path) ? "play-" : "") + path.split("/").pop().replace(/[^A-Za-z0-9._-]/g, "") + "@oros"; }   // "icon:x:c:32" → "iconxc32@oros"
  // One message for one subscriber (or a test: opts.test + opts.to) → { bin, … }
  function buildFor(x, l, s, opts) {
    opts = opts || {};
    var M = root.orosMailCompose;
    var lang = opts.lang || C.langOf(s, l);
    var box = l.reply || l.from;
    var tok = s ? C.token(l, s.id) : "nl-test";
    var unsub = s ? R.mailto(box, "unsubscribe " + tok) : "";
    var unsubWeb = s && l.form ? relayUrl() + C.unsubPath(l, s) : "";
    var inline = [];
    var e = R.email({ issue: x, list: l, sub: s, lang: lang, test: !!opts.test, unsub: unsub, unsubWeb: unsubWeb, tok: tok, mailbox: box,
                      img: function (b) {
                        var d = imgData[b.f];
                        if (!d) return "";
                        var cid = cidOf(b.f);
                        if (!inline.some(function (i) { return i.cid === cid; })) inline.push({ cid: cid, type: d.type, bin: d.bin });
                        return "cid:" + cid;
                      } });
    var mo = {
      from: { name: l.fromName, addr: l.from }, to: { name: s ? s.name : "", addr: opts.to || s.email },
      reply: l.reply, subject: e.subject, text: e.text, html: e.html, inline: inline, files: filesFor(x, lang, Date.now()),
      listId: l.id, listName: l.name, unsub: unsub, unsubWeb: unsubWeb, tag: x.id, hdr: opts.hdr
    };
    return opts.raw ? mo : R.message(M, mo);          // raw: the parts, for R.apiReq
  }
  function confirmFor(l, s, hdr, raw) {
    var box = l.reply || l.from, tok = C.token(l, s.id);
    var ce = R.confirmEmail({ list: l, sub: s, lang: C.langOf(s, l), mailbox: box, tok: tok, confirm: R.mailto(box, "confirm " + tok) });
    var mo = { from: { name: l.fromName, addr: l.from }, to: { name: s.name, addr: s.email },
               reply: l.reply, subject: ce.subject, text: ce.text, html: ce.html,
               listId: l.id, listName: l.name, hdr: hdr };
    return raw ? mo : R.message(root.orosMailCompose, mo);
  }
  // "Stay?" (clean-up wave 2): answered like a confirmation request.
  function askFor(l, s, hdr, raw) {
    var box = l.reply || l.from, tok = C.token(l, s.id);
    var ae = R.askEmail({ list: l, sub: s, lang: C.langOf(s, l), mailbox: box, tok: tok, confirm: R.mailto(box, "confirm " + tok) });
    var mo = { from: { name: l.fromName, addr: l.from }, to: { name: s.name, addr: s.email },
               reply: l.reply, subject: ae.subject, text: ae.text, html: ae.html,
               listId: l.id, listName: l.name, hdr: hdr };
    return raw ? mo : R.message(root.orosMailCompose, mo);
  }
  function sendBin(ch, from, to, bin) {
    return sendCreds(ch).then(function (cr) {
      return relay({ op: "send", acct: cr.acct, smtp: cr.smtp, from: from, rcpt: [to], raw: root.orosMailCompose.b64(bin) }, SEND_TIMEOUT);
    });
  }

  // ---------- issue state changes (read, change, merge-write) ----------
  function change(fn) {
    var d = read();
    var r = fn(d);
    if (r === false) return null;
    return write(d);
  }
  function pause(id, err) {
    return change(function (d) {
      var x = C.issue(d, id);
      if (!x || (x.st !== "sending" && x.st !== "paused")) return false;
      var y = copy(x);
      y.st = "paused"; y.lock = null; y.err = err || "";
      put(d, "issues", y);
    });
  }
  function resume(id, dev) {
    return change(function (d) {
      var x = C.issue(d, id);
      if (!x || x.st !== "paused") return false;
      var y = copy(x);
      y.st = "sending"; y.lock = { dev: dev, at: Date.now() }; y.err = "";
      put(d, "issues", y);
    });
  }
  function finish(id) {
    var out = null;
    change(function (d) {
      var x = C.issue(d, id);
      if (!x || (x.st !== "sending" && x.st !== "paused")) return false;
      var y = copy(x), p = C.progress(d, x);
      y.st = "sent"; y.done = Date.now(); y.n = p.sent; y.lock = null; y.err = "";
      put(d, "issues", y);
      out = y;
    });
    return out;
  }

  // ---------- web sign-up form (relay/newsletter.js) ----------
  // Turn on (or update the thank-you page of) a list's form: a new RSA
  // key pair, list key and secret are registered with the relay; they
  // sync with the list. → Promise<form>
  function rnd(n, abc) {
    var b = crypto.getRandomValues(new Uint8Array(n)), out = "";
    for (var i = 0; i < n; i++) out += abc.charAt(b[i] % abc.length);
    return out;
  }
  function formOn(listId, back) {
    var l = C.list(read(), listId);
    if (!l) return Promise.reject({ code: "gone" });
    var dev = devState().dev;
    var made = l.form ? Promise.resolve({ k: l.form.k, sec: l.form.sec, priv: l.form.priv }) :
      crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
                                true, ["encrypt", "decrypt"]).then(function (kp) {
        return crypto.subtle.exportKey("jwk", kp.privateKey).then(function (priv) {
          return { k: rnd(16, "abcdefghijklmnopqrstuvwxyz0123456789"),
                   sec: rnd(32, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"), priv: priv };
        });
      });
    return made.then(function (f) {
      var form = C.normForm({ k: f.k, sec: f.sec, priv: f.priv, back: back || "", dev: (l.form && l.form.dev) || dev, at: Date.now() });
      if (!form) throw { code: "bad-request" };
      return relay({ op: "nl", act: "reg", k: form.k, sec: form.sec, pub: C.formPub(form), back: form.back }).then(function () {
        change(function (d) {
          var cur = C.list(d, listId);
          if (!cur) return false;
          var y = copy(cur); y.form = form;
          put(d, "lists", y);
        });
        return form;
      });
    });
  }
  // Turn the form off: the relay forgets the list and anything waiting.
  function formOff(listId) {
    var l = C.list(read(), listId);
    if (!l || !l.form) return Promise.resolve();
    return relay({ op: "nl", act: "drop", k: l.form.k, sec: l.form.sec })["catch"](function (e) {
      if (!(e && e.code === "gone")) throw e;
    }).then(function () {
      change(function (d) {
        var cur = C.list(d, listId);
        if (!cur || !cur.form) return false;
        var y = copy(cur); y.form = null;
        put(d, "lists", y);
      });
    });
  }
  // This device collects the list's sign-ups from now on.
  function formHere(listId) {
    var dev = devState().dev;
    change(function (d) {
      var cur = C.list(d, listId);
      if (!cur || !cur.form || cur.form.dev === dev) return false;
      var y = copy(cur); y.form.dev = dev;
      put(d, "lists", y);
    });
  }
  function unb64(s) {
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  // One sealed sign-up → { e, n, l, t } (see relay/newsletter.js seal)
  function openSealed(priv, v) {
    var o = JSON.parse(atob(v));
    return crypto.subtle.decrypt({ name: "RSA-OAEP" }, priv, unb64(o.w)).then(function (raw) {
      return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
    }).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, key, unb64(o.c));
    }).then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
  }
  // A sign-up from the web form → a pending subscriber (the engine then
  // sends the confirmation request). Changes d. → true if it applied.
  function applySignup(d, l, o, tally) {
    var email = C.normEmail(o && o.e), now = Date.now();
    if (!email) return false;
    var id = C.subId(l.id, email), cur = C.sub(d, id);
    if (cur) {
      var st = C.status(cur);
      if (st === "on" || st === "pend" || st === "spam") return false;
      var y = copy(cur); y.at = now; y.m = stamp(y.m); y.bnc = 0;
      replaceIn(d.subs, y);
    } else {
      if (C.live(d.subs).length >= C.LIM.subs) return false;
      var tomb = null;
      d.subs.forEach(function (s) { if (s.id === id) tomb = s; });
      replaceIn(d.subs, C.normSub({ id: id, m: stamp(tomb ? tomb.m : 0), list: l.id, email: email, name: C.oneLine(o.n, C.LIM.name),
                                    lang: o.l === "el" || o.l === "en" ? o.l : "", src: "form", basis: "optin", at: now, conf: 0 }));
    }
    tally.s++;
    return true;
  }
  // Sign-ups and one-click unsubscribes waiting at the relay for the
  // lists this device collects: applied on fresh data, then acked.
  function pullForms(tally) {
    var dev = devState().dev;
    var lists = C.live(read().lists).filter(function (l) { return l.form && (!l.form.dev || l.form.dev === dev); });
    if (!lists.length || !navigator.onLine) return Promise.resolve(tally);
    return lists.reduce(function (p, l) {
      return p.then(function () {
        var f = l.form;
        return crypto.subtle.importKey("jwk", f.priv, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]).then(function (priv) {
          var page = function (n) {
            return relay({ op: "nl", act: "pull", k: f.k, sec: f.sec, after: 0 }).then(function (res) {
              var rows = res && Array.isArray(res.rows) ? res.rows : [];
              if (!rows.length) return;
              var opened = [];
              return rows.reduce(function (q, r) {
                return q.then(function () {
                  if (r.kind !== "s") return;
                  return openSealed(priv, r.v).then(function (o) { opened.push(o); }, function () {});
                });
              }, Promise.resolve()).then(function () {
                var d = read(), cur = C.list(d, l.id);
                if (cur) {
                  var toks = C.byToken(d);
                  opened.forEach(function (o) { applySignup(d, cur, o, tally); });
                  rows.forEach(function (r) {
                    if (r.kind !== "u" || typeof r.v !== "string") return;
                    var s = toks["nl-" + r.v];
                    if (s && s.list === l.id) applyRequest(d, { act: "unsub", tok: "nl-" + r.v }, {}, tally);
                  });
                  write(d);
                }
                var upto = rows[rows.length - 1].id;
                return relay({ op: "nl", act: "ack", k: f.k, sec: f.sec, upto: upto }).then(function () {
                  if (res.more && n < 10) return page(n + 1);
                });
              });
            });
          };
          return page(0);
        });
      })["catch"](function (e) { if (!tally.err && !(e && e.code === "nostore")) tally.err = e; });
    }, Promise.resolve()).then(function () { return tally; });
  }

  // ---------- Inbox: requests and delivery failures ----------
  // One request e-mail → changes d (not saved). → true if it applied.
  function applyRequest(d, req, from, tally) {
    var now = Date.now();
    if (req.act === "sub") {
      var l = C.byCode(d)[req.code];
      var email = C.normEmail(from.addr);
      if (!l || !email) return false;
      var id = C.subId(l.id, email), cur = C.sub(d, id);
      if (cur) {
        var st = C.status(cur);
        if (st === "on" || st === "pend") return false;
        var y = copy(cur); y.at = now; y.m = stamp(y.m); y.bnc = 0;
        replaceIn(d.subs, y);
      } else {
        if (C.live(d.subs).length >= C.LIM.subs) return false;
        var tomb = null;
        d.subs.forEach(function (s) { if (s.id === id) tomb = s; });
        replaceIn(d.subs, C.normSub({ id: id, m: stamp(tomb ? tomb.m : 0), list: l.id, email: email,
                                      name: C.oneLine(from.name, C.LIM.name), src: "mail", basis: "optin", at: now, conf: 0 }));
      }
      tally.s++;
      return true;
    }
    var s = C.byToken(d)[req.tok];
    if (!s) return false;
    var st2 = C.status(s), z = copy(s);
    if (req.act === "unsub") {
      if (st2 === "off" || st2 === "bounce" || st2 === "spam") return false;
      z.off = now; z.offSt = "off";
      tally.u++;
    } else if (st2 === "pend") {
      z.conf = now;
      tally.c++;
    } else if (s.ask && (st2 === "on" ? s.ask > C.lastSeen(s) : st2 === "off" && s.off >= s.ask)) {
      // the answer to "Stay?": they stay (also when it came after the
      // 30 days were up and they had been unsubscribed for not answering)
      z.conf = now;
      tally.c++;
      tally.k = (tally.k || 0) + 1;
    } else return false;
    z.m = stamp(z.m);
    replaceIn(d.subs, z);
    return true;
  }
  function markBounce(d, addr, hard) {
    var k = C.emailKey(addr), hit = false, now = Date.now();
    C.live(d.subs).forEach(function (s) {
      if (C.emailKey(s.email) !== k || C.status(s) !== "on") return;
      var z = copy(s);
      z.bnc = Math.min(99, z.bnc + (hard ? C.SOFT_LIMIT : 1));
      if (z.bnc >= C.SOFT_LIMIT) { z.off = now; z.offSt = "bounce"; hit = true; }
      z.m = stamp(z.m);
      replaceIn(d.subs, z);
    });
    return hit;
  }
  // Delivery failure reports about our own messages (they quote our
  // X-Oros-Newsletter or List-Id header) → [{ uid, list: [{addr, hard}] }]
  function findBounces(call, MM) {
    var uids = {}, found = [];
    return ["mailer-daemon", "postmaster"].reduce(function (p, q) {
      return p.then(function () {
        return call({ op: "search", folder: "INBOX", q: q, where: "from", limit: 50 }).then(function (res) {
          (res.msgs || []).forEach(function (m) {
            if (uids[m.uid] || m.size > 2 * 1024 * 1024) return;
            var sm = null;
            try { sm = MM.summary(MM.b64ToBin(m.hdr || "")); } catch (e) {}
            if (!sm || !C.isBounceFrom(sm.from && sm.from.addr, sm.from && sm.from.name)) return;
            uids[m.uid] = 1;
            found.push(m.uid);
          });
        })["catch"](function () {});
      });
    }, Promise.resolve()).then(function () {
      var out = [];
      return found.slice(0, 40).reduce(function (p, uid) {
        return p.then(function () {
          return call({ op: "fetch", folder: "INBOX", uid: uid }).then(function (r) {
            var raw = MM.b64ToBin(r.raw || "");
            if (!/X-Oros-Newsletter:|List-Id:[^\n]*\.newsletter\./i.test(raw)) return;
            out.push({ uid: uid, fails: C.parseDsn(raw) });
          })["catch"](function () {});
        });
      }, Promise.resolve()).then(function () { return out; });
    });
  }
  var inboxBusy = null;
  // Reads subscribe / confirm / unsubscribe e-mails and delivery
  // failure reports in the Inbox of every list's account, applies
  // them, and files them in a "Newsletter" folder.
  // One provider event (C.apiEvents) → changes d (not saved), on the
  // lists sending through chanId. An event older than a subscription
  // (they signed up again later) is left alone.
  function applyApiEvent(d, chanId, ev, tally) {
    var k = C.emailKey(ev.addr), now = Date.now();
    C.live(d.subs).forEach(function (s) {
      if (C.emailKey(s.email) !== k) return;
      var l = C.list(d, s.list);
      if (!l || l.chan !== chanId || (ev.at && ev.at < s.at)) return;
      var st = C.status(s);
      if (st !== "on" && !(st === "pend" && ev.ev !== "bounce")) return;
      var z = copy(s);
      z.off = now; z.offSt = ev.ev;
      if (ev.ev === "bounce") { z.bnc = Math.max(z.bnc, C.SOFT_LIMIT); tally.b++; } else tally.u++;
      z.m = stamp(z.m);
      replaceIn(d.subs, z);
    });
  }
  // Bounces, complaints and unsubscribes kept by the providers of the
  // API accounts this device has a key for.
  function checkApi(tally) {
    var d0 = read(), now = Date.now(), seen = {};
    var chans = C.live(d0.chans).filter(function (ch) {
      if (!C.isApi(ch) || seen[ch.id]) return false;
      seen[ch.id] = 1;
      return C.live(d0.lists).some(function (l) { return l.chan === ch.id; });
    });
    if (!chans.length || !navigator.onLine) return Promise.resolve(tally);
    return chans.reduce(function (p, ch) {
      return p.then(function () {
        var since = (devState().papi[ch.id] || now - 7 * 864e5) - 864e5;     // a day of overlap: events arrive late
        var reqs = C.apiEventReqs(ch, since, now);
        return apiCreds(ch).then(function (cr) {
          return papi(cr, reqs.map(function (r) { return { m: r.m, path: r.path }; }), CALL_TIMEOUT);
        }).then(function (res) {
          var evs = [];
          res.forEach(function (r, i) {
            if (r && r.status === 200 && typeof r.body === "string") evs = evs.concat(C.apiEvents(ch.preset, reqs[i].k, r.body));
          });
          if (evs.length) {
            var d = read();
            evs.forEach(function (ev) { applyApiEvent(d, ch.id, ev, tally); });
            write(d);
          }
          if (res.some(function (r) { return r && (r.status === 401 || r.status === 403); })) throw { code: "apikey" };
          var o = devState();
          o.papi[ch.id] = now;
          saveDev(o);
        });
      })["catch"](function (e) { if (!tally.err && !(e && e.code === "nopass")) tally.err = e; });
    }, Promise.resolve()).then(function () { return tally; });
  }
  // → { u, s, c, b, err (the first error, or null) }
  function checkInbox() {
    if (inboxBusy) return inboxBusy;
    var t0 = { u: 0, s: 0, c: 0, b: 0, err: null };
    var next = function () { return checkApi(t0)["catch"](function () { return t0; }); };
    inboxBusy = pullForms(t0).then(next, next).then(function () { inboxBusy = null; return checkMail(t0); },
                                                       function () { inboxBusy = null; return checkMail(t0); });
    return inboxBusy;
  }
  function checkMail(tally) {
    if (inboxBusy) return inboxBusy;
    var d0 = read(), accts = {};
    C.live(d0.lists).forEach(function (l) {
      var a = inboxAccount(C.chan(d0, l.chan));
      if (a) accts[a.id] = a;
    });
    var ids = Object.keys(accts);
    var MM = root.orosMailMime;
    if (!ids.length || !navigator.onLine || !MM) {
      // still a check (API accounts, forms): the engine waits INBOX_EVERY for the next
      var o0 = devState();
      o0.inbox.at = Date.now();
      saveDev(o0);
      return Promise.resolve(tally);
    }
    var run = function () {
      return ids.reduce(function (p, id) {
        return p.then(function () {
          var a = accts[id];
          return mailPass(a.id).then(function (pw) {
            if (!pw) throw { code: "nopass" };
            var acct = imapOf(a, pw);
            var call = function (body) { body.acct = acct; return relay(body); };
            var handled = [], reqs = [], fails = [];
            return call({ op: "search", folder: "INBOX", q: "nl-", where: "subject", limit: 100 }).then(function (res) {
              (res.msgs || []).forEach(function (m) {
                var sm = null;
                try { sm = MM.summary(MM.b64ToBin(m.hdr || "")); } catch (e) {}
                if (!sm) return;
                var req = C.classify(sm.subject);
                if (!req) return;
                reqs.push({ req: req, from: sm.from || {} });
                handled.push(m.uid);           // an unknown token is filed too (nothing to do)
              });
            }).then(function () {
              return findBounces(call, MM).then(function (r) {
                r.forEach(function (x) { handled.push(x.uid); fails = fails.concat(x.fails); });
              });
            }).then(function () {
              // apply on fresh data, then merge-write
              if (reqs.length || fails.length) {
                var d = read();
                reqs.forEach(function (q) { applyRequest(d, q.req, q.from, tally); });
                fails.forEach(function (f) { if (markBounce(d, f.addr, f.hard)) tally.b++; });
                write(d);
              }
              if (!handled.length) return;
              return call({ op: "create", folder: "Newsletter" })["catch"](function () {}).then(function () {
                return call({ op: "move", folder: "INBOX", uids: handled.slice(0, 500), to: "Newsletter" });
              })["catch"](function () {});
            });
          });
        })["catch"](function (e) { if (!tally.err) tally.err = e; });
      }, Promise.resolve());
    };
    var locked = root.navigator && navigator.locks && typeof navigator.locks.request === "function"
      ? navigator.locks.request(LOCK_INBOX, { ifAvailable: true }, function (lock) { return lock ? run() : null; })
      : run();
    inboxBusy = Promise.resolve(locked).then(function () {
      var o = devState();
      o.inbox.at = Date.now();
      saveDev(o);
      inboxBusy = null;
      return tally;
    }, function () { inboxBusy = null; return tally; });
    return inboxBusy;
  }

  // ---------- RSS to e-mail ----------
  // A feed's articles → a new issue on its list: a draft, or (mode
  // "send") an issue that starts sending when the pre-send check finds
  // nothing to fix (else a draft). `force`: the button "Make one now"
  // (uses the newest articles even when none is new; always a draft).
  // → { rss, issue, sending } or null when there is nothing new.
  function issueFromFeed(rssId, items, force) {
    var out = null, now = Date.now(), dev = devState().dev;
    change(function (d) {
      var r = C.live(d.rss).filter(function (x) { return x.id === rssId; })[0];
      var l = r ? C.list(d, r.list) : null;
      if (!r || !l) return false;
      var picks = C.rssPick(r, items);
      if (!picks.length && force) picks = C.rssPick({ last: 0, max: r.max }, items);
      if (!picks.length) return false;
      var x = C.digestIssue(r, l, picks, C.randomId("i", null));
      var sending = false;
      if (r.mode === "send" && !force) {
        var res = C.preflight(d, x, { chan: C.chan(d, l.chan), aud: C.audience(d, x).length });
        if (!res.some(function (f) { return f.lvl === "err"; })) {
          x.st = "sending"; x.start = now; x.lock = { dev: dev, at: now };
          sending = true;
        }
      }
      put(d, "issues", x);
      var y = copy(r);
      picks.forEach(function (it) { if ((it.date || 0) > y.last) y.last = it.date || 0; });
      if (!y.last) y.last = now;
      put(d, "rss", y);
      out = { rss: y, issue: x, sending: sending };
    });
    return out;
  }
  var RETRY_FEED = { offline: 1, network: 1, timeout: 1, relay: 1, nofeeds: 1 };
  // Every feed due on this device: marked as run first (so a second
  // window or a crash never runs it twice), then fetched one by one.
  // fetchItems(url) → Promise<[Reader item]>. → Promise<[result]>
  function runFeeds(fetchItems) {
    var run = function () {
      var now = Date.now(), dev = devState().dev, due = C.rssDue(read(), now, dev);
      if (!due.length) return Promise.resolve([]);
      change(function (d) {
        due.forEach(function (r) {
          var c = C.live(d.rss).filter(function (x) { return x.id === r.id; })[0];
          if (!c) return;
          var y = copy(c); y.ran = now; if (!y.dev) y.dev = dev;
          put(d, "rss", y);
        });
      });
      var done = [];
      return due.reduce(function (p, r) {
        return p.then(function () { return fetchItems(r.url); }).then(function (items) {
          var res = issueFromFeed(r.id, items, false);
          if (res) done.push(res);
        }, function (e) {
          // no network (or the feed code didn't load): try again on the
          // next round instead of skipping this slot
          if (!RETRY_FEED[e && e.code]) return;
          change(function (d) {
            var c = C.live(d.rss).filter(function (x) { return x.id === r.id; })[0];
            if (!c || c.ran !== now) return false;
            var y = copy(c); y.ran = r.ran;
            put(d, "rss", y);
          });
        });
      }, Promise.resolve()).then(function () { return done; });
    };
    if (root.navigator && navigator.locks && typeof navigator.locks.request === "function") {
      return navigator.locks.request(LOCK_RSS, { ifAvailable: true }, function (lock) { return lock ? run() : []; })
        .then(function (r) { return r || []; }, function () { return []; });
    }
    return run();
  }

  // ---------- list clean-up (inactive subscribers) ----------
  // One device per list cleans it (list.clnDev): the first device that
  // sends the list's issues or confirmation requests takes it (it reads
  // that list's Inbox, so a confirmation that just came in is applied
  // where the deletions happen), or the user picks one in the app.
  function claimClean(listId, dev) {
    return change(function (d) {
      var l = C.list(d, listId);
      if (!l || l.clnDev) return false;
      var y = copy(l); y.clnDev = dev;
      put(d, "lists", y);
    });
  }
  // Once a day per list on its device: those who did not answer "Stay?"
  // in time are unsubscribed (C.askTimeouts), then those the plan names
  // go (C.cleanApply, re-checked on fresh data). More than C.cleanPlan
  // allows in one go waits for the user ({ wait: n }).
  // → Promise<[{ list, pend, gone, off } | { list, wait }]>
  function runClean() {
    var run = function () {
      var now = Date.now(), o = devState(), day = dayKey(now), out = [];
      C.live(read().lists).forEach(function (l0) {
        if (C.cleanOf(l0).dev !== o.dev || o.cln[l0.id] === day) return;
        change(function (d) {
          var l = C.list(d, l0.id);
          if (!l || C.cleanOf(l).dev !== o.dev) return false;
          var off = C.askTimeouts(d, l.id, now);
          var plan = C.cleanPlan(d, l.id, now);
          if (plan.n && !plan.ok) out.push({ list: l, wait: plan.n });
          var n = plan.n && plan.ok ? C.cleanApply(d, plan, now) : { pend: 0, gone: 0 };
          if (!off && !n.pend && !n.gone) return false;
          out.push({ list: l, pend: n.pend, gone: n.gone, off: off });
        });
        o.cln[l0.id] = day;
      });
      saveDev(o);
      return out;
    };
    if (root.navigator && navigator.locks && typeof navigator.locks.request === "function") {
      return navigator.locks.request(LOCK_CLEAN, { ifAvailable: true }, function (lock) { return lock ? run() : []; })
        .then(function (r) { return r || []; }, function () { return []; });
    }
    return Promise.resolve(run());
  }

  // ---------- the engine ----------
  // env: { fs() → orosFS|null, dirty(), onState(state), onChange(),
  //        notify(kind, info) }   kind: "done" {issue} | "paused" {issue, err}
  //                               | "started" {issue} | "inbox" {tally}
  //                               | "invfail" {list, err} | "askfail" {list, err}
  function create(env) {
    var timer = null, busy = false, state = { k: "" }, stopped = false;
    var failedInv = {};       // list id → true: no more invitations in this window after an error
    var failedAsk = {};       // the same for "Stay?" e-mails
    var apiMax = {};          // chan id → a smaller batch after a failed relay call
    function call(name, a) { try { if (env[name]) env[name](a, arguments[2]); } catch (e) {} }
    function setState(s) { state = s; call("onState", s); }
    function changed() { call("dirty"); call("onChange"); }
    function later(ms) { clearTimeout(timer); if (!stopped) timer = setTimeout(step, ms); }
    function kick() { if (!busy) later(50); }

    // the next job: { kind: "inv"|"issue"|"ask"|"cap"|"other"|"paused", … }
    function nextJob(d, dev, now) {
      var lists = C.live(d.lists);
      for (var i = 0; i < lists.length; i++) {
        var l = lists[i], ch = C.chan(d, l.chan);
        if (!ch || capLeft(ch) <= 0) continue;
        var inv = C.invitesDue(d, l.id);
        if (inv.length && !failedInv[l.id]) return { kind: "inv", list: l, chan: ch, sub: inv[0], left: inv.length };
      }
      var mine = C.live(d.issues).filter(function (x) { return C.canSend(x, dev, now); })
        .sort(function (a, b) { return a.start - b.start; });
      for (var j = 0; j < mine.length; j++) {
        var x = mine[j], l2 = C.list(d, x.list), ch2 = l2 ? C.chan(d, l2.chan) : null;
        if (!l2 || !ch2) { pause(x.id, "nochan"); changed(); call("notify", "paused", { issue: x, err: "nochan" }); continue; }
        var p = C.progress(d, x);
        if (!p.next) {
          var y = finish(x.id);
          if (y) { changed(); call("notify", "done", { issue: y }); }
          continue;
        }
        if (capLeft(ch2) <= 0) return { kind: "cap", chan: ch2, issue: x };
        return { kind: "issue", list: l2, chan: ch2, sub: p.next, issue: x, prog: p };
      }
      // "Stay?" e-mails, when no issue of this device waits: only on the
      // list's clean-up device
      for (var a = 0; a < lists.length; a++) {
        var la = lists[a], cha = C.chan(d, la.chan);
        if (!cha || capLeft(cha) <= 0 || failedAsk[la.id] || C.cleanOf(la).dev !== dev) continue;
        var asks = C.asksDue(d, la.id, now);
        if (asks.length) return { kind: "ask", list: la, chan: cha, sub: asks[0], left: asks.length };
      }
      var other = C.live(d.issues).filter(function (x) { return x.st === "sending"; })[0];
      if (other) return { kind: "other", issue: other };
      var paused = C.live(d.issues).filter(function (x) { return x.st === "paused"; })[0];
      if (paused) return { kind: "paused", issue: paused };
      return null;
    }
    // Scheduled issues whose time came start here (lock = this device).
    function startDue(dev, now) {
      var started = [];
      change(function (d) {
        var due = C.schedDue(d, now, dev);
        if (!due.length) return false;
        due.forEach(function (x) {
          var y = copy(x);
          y.st = "sending"; y.start = now; y.when = 0; y.lock = { dev: dev, at: now }; y.err = ""; y.fail = {}; y.n = 0;
          put(d, "issues", y);
          started.push(y);
        });
      });
      if (started.length) {
        changed();
        started.forEach(function (y) { call("notify", "started", { issue: y }); });
      }
    }
    function nextSchedIn(d, now, dev) {
      var t = Infinity;
      C.live(d.issues).forEach(function (x) { if (C.schedMine(x, dev)) t = Math.min(t, x.when - now); });
      return t;
    }
    function hasInbox(d) {
      return C.live(d.lists).some(function (l) { var ch = C.chan(d, l.chan); return !!inboxAccount(ch) || C.isApi(ch); });
    }
    function idle(d, now) {
      var ms = Math.min(IDLE_EVERY, Math.max(1000, nextSchedIn(d, now, devState().dev)));
      if (hasInbox(d) && navigator.onLine) {
        var due = (devState().inbox.at || 0) + INBOX_EVERY - now;
        if (due <= 0) { busy = true; inbox(false).then(function () { busy = false; later(1000); }); return; }
        ms = Math.min(ms, due + 1000);
      }
      later(ms);
    }

    function step() {
      timer = null;
      if (busy || stopped) return;
      var locks = root.navigator && navigator.locks && typeof navigator.locks.request === "function" ? navigator.locks : null;
      if (!locks) { run(); return; }
      busy = true;
      locks.request(LOCK_SEND, { ifAvailable: true }, function (lock) {
        if (!lock) return null;
        busy = false;
        return new Promise(function (resolve) { run(resolve); });
      }).then(function (r) {
        if (r === null) { busy = false; setState({ k: "here" }); later(30000); }   // another window of this device sends
      }, function () { busy = false; later(30000); });
    }
    // One job (inside the lock). `release` ends the lock.
    function run(release) {
      release = release || function () {};
      var now = Date.now(), dev = devState().dev;
      startDue(dev, now);
      var d = read();
      var job = nextJob(d, dev, now);
      if (!job || job.kind === "other" || job.kind === "paused") {
        setState(job ? { k: job.kind, issue: job.issue } : { k: "" });
        release();
        if (job && job.kind === "other") { later(60000); return; }    // the lock may go stale
        idle(d, now);
        return;
      }
      if (job.kind === "cap") {
        setState({ k: "cap", chan: job.chan, issue: job.issue });
        release();
        later(10 * 60000);
        return;
      }
      if (!navigator.onLine) { setState({ k: "offline" }); release(); later(30000); return; }
      // Unsubscribe requests are read before an issue goes on.
      if (job.kind === "issue" && (inboxAccount(job.chan) || C.isApi(job.chan)) && now - (devState().inbox.at || 0) > INBOX_EVERY) {
        busy = true;
        release();
        inbox(false).then(function () { busy = false; later(50); });
        return;
      }
      busy = true;
      if (!job.list.clnDev && claimClean(job.list.id, dev)) changed();
      if (job.kind === "issue") {
        // hold the lock (refreshed at most once a minute: each refresh syncs)
        var x = job.issue;
        if (!x.lock || x.lock.dev !== dev || now - x.lock.at > 60000) {
          change(function (dd) {
            var cur = C.issue(dd, x.id);
            if (!cur || cur.st !== "sending") return false;
            var y = copy(cur);
            y.lock = { dev: dev, at: now };
            put(dd, "issues", y);
          });
          call("dirty");
        }
        setState({ k: "issue", issue: job.issue, prog: job.prog });
      } else setState({ k: job.kind, left: job.left });
      if (C.isApi(job.chan)) { runApi(job, release); return; }
      var l = job.list, ch = job.chan, s = job.sub;
      var p = job.kind === "issue" ? loadImages(job.issue, env.fs ? env.fs() : null) : Promise.resolve(true);
      p.then(function (ok) {
        if (!ok) throw { code: "noImg" };
        return sendCreds(ch);
      }).then(function (cr) {
        // the subscriber may have left meanwhile (Inbox, another device)
        var fresh = read(), cur = C.sub(fresh, s.id);
        if (!cur || (job.kind === "issue" ? C.status(cur) !== "on" : job.kind === "ask" ? C.status(cur) !== "on" || cur.ask > C.lastSeen(cur)
                                                                 : C.status(cur) !== "pend")) throw { code: "skip" };
        if (job.kind === "issue") {
          var xi = C.issue(fresh, job.issue.id);
          if (!xi || xi.st !== "sending" || C.sentSet(fresh, xi.id)[s.id]) throw { code: "skip" };
        }
        var bin = job.kind === "inv" ? confirmFor(l, cur, cr.hdr).bin : job.kind === "ask" ? askFor(l, cur, cr.hdr).bin
                                                                    : buildFor(job.issue, l, cur, { hdr: cr.hdr }).bin;
        return relay({ op: "send", acct: cr.acct, smtp: cr.smtp, from: l.from, rcpt: [cur.email],
                       raw: root.orosMailCompose.b64(bin) }, SEND_TIMEOUT);
      }).then(function () {
        countUsed(ch.id);
        change(function (dd) {
          if (job.kind === "inv" || job.kind === "ask") {
            var cur = C.sub(dd, s.id);
            if (!cur) return false;
            var z = copy(cur); z[job.kind] = Date.now(); put(dd, "subs", z);
          } else dd.sent[job.issue.id] = (dd.sent[job.issue.id] || []).concat([s.id]);
        });
        changed();
        busy = false;
        release();
        later(ch.rate * 1000);
      }, function (e) {
        busy = false;
        release();
        if (e && e.code === "skip") { later(50); return; }
        handleError(job, e);
      });
    }
    // An API account: up to C.API_BATCH messages in one relay call
    // (at most what the daily limit has left). Each answer counts on its
    // own: sent, refused (that address bounces), or left for the next try.
    function runApi(job, release) {
      var l = job.list, ch = job.chan, max = Math.min(apiMax[ch.id] || C.API_BATCH, capLeft(ch));
      var p = job.kind === "issue" ? loadImages(job.issue, env.fs ? env.fs() : null) : Promise.resolve(true);
      var batch = [];
      p.then(function (ok) {
        if (!ok) throw { code: "noImg" };
        return apiCreds(ch);
      }).then(function (cr) {
        // fresh data: subscribers may have left meanwhile
        var fresh = read(), xi = null, subs;
        if (job.kind === "issue") {
          xi = C.issue(fresh, job.issue.id);
          if (!xi || xi.st !== "sending") throw { code: "skip" };
          subs = C.nextSubs(fresh, xi, max).filter(function (s) { return C.status(s) === "on"; });
        } else {
          subs = (job.kind === "ask" ? C.asksDue(fresh, l.id, Date.now()) : C.invitesDue(fresh, l.id)).slice(0, max);
        }
        if (!subs.length) throw { code: "skip" };
        var lf = C.list(fresh, l.id) || l, size = 0;
        for (var i = 0; i < subs.length; i++) {
          var s = subs[i];
          var o = job.kind === "inv" ? confirmFor(lf, s, null, true) : job.kind === "ask" ? askFor(lf, s, null, true)
                                                                     : buildFor(xi, lf, s, { raw: true });
          var rq = R.apiReq(root.orosMailCompose, ch.preset, ch.dom, o);
          var n = JSON.stringify(rq).length;
          if (n > 2 * 1024 * 1024 - 1024) { if (!batch.length) throw { code: "too-big" }; break; }
          if (batch.length && size + n > 1024 * 1024) break;         // about 1 MB a call (relay CPU)
          size += n;
          batch.push({ sub: s, req: rq });
        }
        return papi(cr, batch.map(function (b) { return b.req; }));
      }).then(function (res) {
        delete apiMax[ch.id];
        var sent = [], refused = [], stop = null, retry = false;
        batch.forEach(function (b, i) {
          var o = C.apiOutcome(ch.preset, res[i]);
          if (o.k === "ok") sent.push(b.sub.id);
          else if (o.k === "refused") refused.push(b.sub.id);
          else if (o.k === "retry") retry = true;
          else if (!stop || o.k === "auth") stop = o;
        });
        if (sent.length) countUsed(ch.id, sent.length);
        if (sent.length || refused.length) {
          change(function (dd) {
            var at = Date.now();
            sent.concat(refused).forEach(function (id) {
              var cur = C.sub(dd, id);
              if (!cur) return;
              var z = copy(cur);
              if (refused.indexOf(id) >= 0) { z.off = at; z.offSt = "bounce"; }
              else if (job.kind === "inv" || job.kind === "ask") z[job.kind] = at;
              else return;
              put(dd, "subs", z);
            });
            if (job.kind === "issue") {
              dd.sent[job.issue.id] = (dd.sent[job.issue.id] || []).concat(sent);
              var xi = C.issue(dd, job.issue.id);
              if (xi && refused.length) { var y = copy(xi); refused.forEach(function (id) { y.fail[id] = "refused"; }); put(dd, "issues", y); }
            }
          });
          changed();
        }
        busy = false;
        release();
        if (stop && stop.k === "rate") { setState({ k: "wait" }); later(60000); return; }
        if (stop) {
          handleError(job, stop.k === "auth" ? { code: "apikey" } : { code: "no", msg: stop.msg });
          return;
        }
        if (retry && !sent.length) { setState({ k: "wait" }); later(5 * 60000); return; }
        later(ch.rate * 1000);
      }, function (e) {
        busy = false;
        release();
        if (e && e.code === "skip") { later(50); return; }
        // the whole call failed at the relay (e.g. its CPU limit): try again with half as many
        if (batch.length > 1 && e && (e.code === "relay" || e.code === "timeout")) {
          apiMax[ch.id] = Math.max(1, Math.floor(batch.length / 2));
          later(5000);
          return;
        }
        handleError(job, e);
      });
    }
    function temporary(e) { return /^4\d\d/.test(String(e && e.msg || "")); }
    function handleError(job, e) {
      var code = e && e.code || "relay";
      if (code === "offline" || code === "network" || code === "timeout") { setState({ k: "offline" }); later(30000); return; }
      if (code === "rate") { later(60000); return; }
      if ((code === "no" || code === "rcpt") && temporary(e)) { setState({ k: "wait" }); later(5 * 60000); return; }
      if (code === "rcpt") {
        // a refused address: this one fails, the others go on
        change(function (d) {
          var cur = C.sub(d, job.sub.id);
          if (cur) { var z = copy(cur); z.off = Date.now(); z.offSt = "bounce"; put(d, "subs", z); }
          if (job.kind === "issue") {
            var xi = C.issue(d, job.issue.id);
            if (xi) { var y = copy(xi); y.fail[job.sub.id] = "refused"; put(d, "issues", y); }
          }
        });
        changed();
        later(job.chan.rate * 1000);
        return;
      }
      if (job.kind === "inv" || job.kind === "ask") {
        (job.kind === "inv" ? failedInv : failedAsk)[job.list.id] = true;
        call("notify", job.kind + "fail", { list: job.list, err: errCode(e) });
        later(1000);
        return;
      }
      pause(job.issue.id, errCode(e));
      changed();
      call("notify", "paused", { issue: job.issue, err: errCode(e) });
      later(1000);
    }
    function inbox(loud) {
      return checkInbox().then(function (tally) {
        if (tally.u + tally.s + tally.c + tally.b) changed();
        if (!loud && (tally.s || tally.u || tally.b || tally.k)) call("notify", "inbox", { tally: tally });
        if (tally.s) later(1000);
        return tally;
      });
    }
    later(1500);
    return {
      kick: kick,
      state: function () { return state; },
      checkInbox: function () { return inbox(true); },
      stop: function () { stopped = true; clearTimeout(timer); }
    };
  }

  root.OrosNewsletterEngine = {
    KEY: KEY, DEV_KEY: DEV_KEY, INBOX_EVERY: INBOX_EVERY, LOCK_SEND: LOCK_SEND,
    read: read, write: write, put: put, change: change, stamp: stamp, dayKey: dayKey,
    devState: devState, saveDev: saveDev, capLeft: capLeft, countUsed: countUsed,
    mailAccounts: mailAccounts, mailAccount: mailAccount, inboxAccount: inboxAccount,
    apiCreds: apiCreds, apiCheck: apiCheck, checkApi: checkApi, applyApiEvent: applyApiEvent,
    savePass: savePass, ownPass: ownPass, delPass: delPass, sendCreds: sendCreds, relay: relay, errCode: errCode,
    images: imgData, loadImages: loadImages, filesFor: filesFor, buildFor: buildFor, confirmFor: confirmFor, sendBin: sendBin,
    pause: pause, resume: resume, finish: finish, issueFromFeed: issueFromFeed, runFeeds: runFeeds,
    runClean: runClean, claimClean: claimClean,
    formOn: formOn, formOff: formOff, formHere: formHere, pullForms: pullForms, openSealed: openSealed, relayUrl: relayUrl,
    applyRequest: applyRequest, markBounce: markBounce,
    create: create
  };
})(typeof window !== "undefined" ? window : globalThis);
