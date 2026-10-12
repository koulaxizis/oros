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
  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis-25b.workers.dev";   // = mail.js
  var CALL_TIMEOUT = 45000, SEND_TIMEOUT = 120000;
  var INBOX_EVERY = 10 * 60 * 1000;
  var IDLE_EVERY = 5 * 60 * 1000;
  var LOCK_SEND = "oros-newsletter-send", LOCK_INBOX = "oros-newsletter-inbox";

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
      inbox: v.inbox && typeof v.inbox === "object" ? v.inbox : {}
    };
    if (!v.dev) saveDev(o);
    return o;
  }
  function saveDev(o) { try { localStorage.setItem(DEV_KEY, JSON.stringify(o)); } catch (e) {} }
  function countUsed(chanId) {
    var o = devState(), k = dayKey();
    var u = o.used[chanId];
    o.used[chanId] = { d: k, n: (u && u.d === k ? u.n : 0) + 1 };
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
    var paths = R.blocksOf(x).concat(x.l2 ? R.blocksOf(x.l2) : [])
      .filter(function (b) { return b.k === "img" && b.f; }).map(function (b) { return b.f; });
    var todo = paths.filter(function (p, i) { return paths.indexOf(p) === i && !imgData[p]; });
    if (!todo.length) return Promise.resolve(true);
    if (!fs) return Promise.resolve(false);
    return Promise.all(todo.map(function (p) {
      return fs.readBlob(p).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
        var u8 = new Uint8Array(buf), bin = "";
        for (var i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        var type = /\.png$/.test(p) ? "image/png" : "image/jpeg";
        imgData[p] = { bin: bin, type: type, url: "data:" + type + ";base64," + btoa(bin) };
        return true;
      })["catch"](function () { return false; });
    })).then(function (r) { return r.every(Boolean); });
  }
  function cidOf(path) { return path.split("/").pop().replace(/[^A-Za-z0-9._-]/g, "") + "@oros"; }
  // One message for one subscriber (or a test: opts.test + opts.to) → { bin, … }
  function buildFor(x, l, s, opts) {
    opts = opts || {};
    var M = root.orosMailCompose;
    var lang = opts.lang || C.langOf(s, l);
    var box = l.reply || l.from;
    var tok = s ? C.token(l, s.id) : "nl-test";
    var unsub = s ? R.mailto(box, "unsubscribe " + tok) : "";
    var inline = [];
    var e = R.email({ issue: x, list: l, sub: s, lang: lang, test: !!opts.test, unsub: unsub, tok: tok, mailbox: box,
                      img: function (b) {
                        var d = imgData[b.f];
                        if (!d) return "";
                        var cid = cidOf(b.f);
                        if (!inline.some(function (i) { return i.cid === cid; })) inline.push({ cid: cid, type: d.type, bin: d.bin });
                        return "cid:" + cid;
                      } });
    return R.message(M, {
      from: { name: l.fromName, addr: l.from }, to: { name: s ? s.name : "", addr: opts.to || s.email },
      reply: l.reply, subject: e.subject, text: e.text, html: e.html, inline: inline,
      listId: l.id, listName: l.name, unsub: unsub, tag: x.id, hdr: opts.hdr
    });
  }
  function confirmFor(l, s, hdr) {
    var box = l.reply || l.from, tok = C.token(l, s.id);
    var ce = R.confirmEmail({ list: l, sub: s, lang: C.langOf(s, l), mailbox: box, tok: tok, confirm: R.mailto(box, "confirm " + tok) });
    return R.message(root.orosMailCompose, { from: { name: l.fromName, addr: l.from }, to: { name: s.name, addr: s.email },
                                             reply: l.reply, subject: ce.subject, text: ce.text, html: ce.html,
                                             listId: l.id, listName: l.name, hdr: hdr });
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
    } else {
      if (st2 !== "pend") return false;
      z.conf = now;
      tally.c++;
    }
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
  // → { u, s, c, b, err (the first error, or null) }
  function checkInbox() {
    if (inboxBusy) return inboxBusy;
    var d0 = read(), accts = {};
    C.live(d0.lists).forEach(function (l) {
      var a = inboxAccount(C.chan(d0, l.chan));
      if (a) accts[a.id] = a;
    });
    var ids = Object.keys(accts);
    var tally = { u: 0, s: 0, c: 0, b: 0, err: null };
    var MM = root.orosMailMime;
    if (!ids.length || !navigator.onLine || !MM) return Promise.resolve(tally);
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

  // ---------- the engine ----------
  // env: { fs() → orosFS|null, dirty(), onState(state), onChange(),
  //        notify(kind, info) }   kind: "done" {issue} | "paused" {issue, err}
  //                               | "started" {issue} | "inbox" {tally}
  //                               | "invfail" {list, err}
  function create(env) {
    var timer = null, busy = false, state = { k: "" }, stopped = false;
    var failedInv = {};       // list id → true: no more invitations in this window after an error
    function call(name, a) { try { if (env[name]) env[name](a, arguments[2]); } catch (e) {} }
    function setState(s) { state = s; call("onState", s); }
    function changed() { call("dirty"); call("onChange"); }
    function later(ms) { clearTimeout(timer); if (!stopped) timer = setTimeout(step, ms); }
    function kick() { if (!busy) later(50); }

    // the next job: { kind: "inv"|"issue"|"cap"|"other"|"paused", … }
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
        var due = C.schedDue(d, now);
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
    function nextSchedIn(d, now) {
      var t = Infinity;
      C.live(d.issues).forEach(function (x) { if (x.st === "sched") t = Math.min(t, x.when - now); });
      return t;
    }
    function hasInbox(d) {
      return C.live(d.lists).some(function (l) { return !!inboxAccount(C.chan(d, l.chan)); });
    }
    function idle(d, now) {
      var ms = Math.min(IDLE_EVERY, Math.max(1000, nextSchedIn(d, now)));
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
      if (job.kind === "issue" && inboxAccount(job.chan) && now - (devState().inbox.at || 0) > INBOX_EVERY) {
        busy = true;
        release();
        inbox(false).then(function () { busy = false; later(50); });
        return;
      }
      busy = true;
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
      } else setState({ k: "inv", left: job.left });
      var l = job.list, ch = job.chan, s = job.sub;
      var p = job.kind === "issue" ? loadImages(job.issue, env.fs ? env.fs() : null) : Promise.resolve(true);
      p.then(function (ok) {
        if (!ok) throw { code: "noImg" };
        return sendCreds(ch);
      }).then(function (cr) {
        // the subscriber may have left meanwhile (Inbox, another device)
        var fresh = read(), cur = C.sub(fresh, s.id);
        if (!cur || (job.kind === "issue" ? C.status(cur) !== "on" : C.status(cur) !== "pend")) throw { code: "skip" };
        if (job.kind === "issue") {
          var xi = C.issue(fresh, job.issue.id);
          if (!xi || xi.st !== "sending" || C.sentSet(fresh, xi.id)[s.id]) throw { code: "skip" };
        }
        var bin = job.kind === "inv" ? confirmFor(l, cur, cr.hdr).bin : buildFor(job.issue, l, cur, { hdr: cr.hdr }).bin;
        return relay({ op: "send", acct: cr.acct, smtp: cr.smtp, from: l.from, rcpt: [cur.email],
                       raw: root.orosMailCompose.b64(bin) }, SEND_TIMEOUT);
      }).then(function () {
        countUsed(ch.id);
        change(function (dd) {
          if (job.kind === "inv") {
            var cur = C.sub(dd, s.id);
            if (!cur) return false;
            var z = copy(cur); z.inv = Date.now(); put(dd, "subs", z);
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
      if (job.kind === "inv") {
        failedInv[job.list.id] = true;
        call("notify", "invfail", { list: job.list, err: errCode(e) });
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
        if (!loud && (tally.s || tally.u || tally.b)) call("notify", "inbox", { tally: tally });
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
    savePass: savePass, ownPass: ownPass, delPass: delPass, sendCreds: sendCreds, relay: relay, errCode: errCode,
    images: imgData, loadImages: loadImages, buildFor: buildFor, confirmFor: confirmFor, sendBin: sendBin,
    pause: pause, resume: resume, finish: finish,
    applyRequest: applyRequest, markBounce: markBounce,
    create: create
  };
})(typeof window !== "undefined" ? window : globalThis);
