// ============================================================
// orOS Mail — new-mail notices, device rules, timed sends (v1.2.0)
// Runs in the SHELL window (index.html loads it after
// notifications.js), so a new message in an Inbox shows a notice
// while orOS is open, also with the Mail window closed.
//   - every 3 minutes while online (the browser slows timers in a
//     background tab; notifications.js then uses the system
//     notification when its permission was given), plus on "online"
//     and when the tab comes back; at most one check at a time
//   - per account with a password sealed on THIS device: one relay
//     "list" of the Inbox's 5 newest headers. New = UID above this
//     device's mark and not \Seen. The first check of an account
//     (or a new UIDVALIDITY) only takes the mark: no flood of old mail
//   - one notice per new message (sender, subject), key
//     "n:<acct>:<uidvalidity>:<uid>" so two devices announcing the
//     same message show it once in the synced bell; more than 3 at
//     once → one "N new messages" notice
//   - deep link "mail:msg:<acct>.<uid>" opens that message
//   - per-app toggle "mail" and quiet hours: notifications.js
//   - device rules (rules.js, data.rules): applied here to every new
//     Inbox message (above the mark, read or not) before the notices;
//     with rules the peek is 20 headers. Flags first (one relay "flag"
//     per flag), then one "move" per target folder. A message a rule
//     moved or marked read gets no notice. A failed rule call is
//     retried at the next check only if the message is still new
//     (the mark moves on: no endless retries)
//   - timed sends (outbox.js): an Outbox message whose "Undo send"
//     wait or "Send later" time has passed goes out from here when
//     Mail is closed (Mail sends it itself while open). Each one is
//     CLAIMED first, so it is sent once even with Mail open in a
//     second tab. Sent → removed + a "Sent" notice; a network error
//     frees it for the next check; any other error keeps it in the
//     Outbox with the reason. A check is scheduled for the next due
//     time when that is sooner than 3 minutes
//   - snoozed messages (snooze.js, data.snoozes): with Mail closed, a
//     snooze whose time has come is woken here: its message in the
//     account's Snoozed folder is marked unread and moved back where it
//     came from (the Inbox if that folder is gone), before the Inbox
//     check, which then announces it like new mail. The snooze record
//     is tombstoned by Mail the next time it runs (this file never
//     writes the synced slice); meanwhile the device-local list
//     "oros-mail-snooze-woken" { id: until } keeps it from being woken
//     twice. Mail open → Mail wakes them itself
// Reads: oros-mail-data (accounts, relay), IndexedDB "oros-mail"
// stores "keys" + "creds" (the sealed password, decrypted with the
// device key exactly as mail.js does; the key never leaves
// IndexedDB). The database is opened WITHOUT a version and closed
// after each check, so Mail's own upgrades are never blocked.
// Writes only the device-local marks "oros-mail-notify"
// { acctId: { v: uidvalidity, m: highest uid seen } } and
// "oros-mail-snooze-woken", never synced.
// An auth failure silences that account until its password changes
// on this device. orOS closed = no check (honest limit).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-mail-data";
  var MARKS_KEY = "oros-mail-notify";
  var DB_NAME = "oros-mail";
  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis-25b.workers.dev";   // = mail.js
  var EVERY_MS = 3 * 60 * 1000;
  var BACKOFF_MAX = 30 * 60 * 1000;
  var CALL_TIMEOUT = 45000;
  var PEEK = 5;              // newest Inbox headers per check
  var PEEK_RULES = 20;       // … when the account has rules
  var MAX_EACH = 3;          // more new messages than this → one summary

  // ---------- pure core (tests) ----------
  // res: relay "list" answer; mark: { v, m } | null.
  // → { mark, fresh: [msg], newer: [msg] } (newest first; msg as in
  //   res.msgs; fresh = unread ones, newer = all above the mark)
  function freshMessages(res, mark) {
    var msgs = (res && Array.isArray(res.msgs) ? res.msgs : []).filter(function (x) { return x && x.uid > 0; });
    var top = msgs.reduce(function (a, x) { return Math.max(a, x.uid); }, 0);
    var v = res ? res.uidvalidity : 0;
    if (!mark || mark.v !== v) return { mark: { v: v, m: top }, fresh: [], newer: [] };
    var newer = msgs.filter(function (x) { return x.uid > mark.m; }).sort(function (a, b) { return b.uid - a.uid; });
    var fresh = newer.filter(function (x) { return !(Array.isArray(x.flags) && x.flags.indexOf("\\Seen") >= 0); });
    return { mark: { v: v, m: Math.max(mark.m, top) }, fresh: fresh, newer: newer };
  }

  // ---------- strings ----------
  function el() { return root.orosLang === "el"; }
  function T(key, n) {
    var s = {
      newOne: el() ? "Νέο email" : "New e-mail",
      many: el() ? "{n} νέα email" : "{n} new e-mails",
      nosubj: el() ? "(χωρίς θέμα)" : "(no subject)",
      sent: el() ? "Το email στάλθηκε" : "E-mail sent",
      fail: el() ? "Δεν στάλθηκε ({n})" : "Not sent ({n})"
    }[key];
    return s.replace("{n}", n);
  }

  // ---------- device store ----------
  function loadMarks() {
    try {
      var m = JSON.parse(root.localStorage.getItem(MARKS_KEY) || "null");
      return m && typeof m === "object" ? m : {};
    } catch (e) { return {}; }
  }
  function saveMarks(m) {
    try { root.localStorage.setItem(MARKS_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function readData() {
    try {
      var d = JSON.parse(root.localStorage.getItem(KEY) || "null");
      if (!d || !Array.isArray(d.accounts)) return null;
      return d;
    } catch (e) { return null; }
  }

  function openDb() {
    return new Promise(function (resolve) {
      var idb = null;
      try { idb = root.indexedDB; } catch (e) {}
      if (!idb || typeof idb.open !== "function") { resolve(null); return; }
      var rq;
      try { rq = idb.open(DB_NAME); } catch (e) { resolve(null); return; }
      rq.onupgradeneeded = function () { try { rq.transaction.abort(); } catch (e) {} };   // no database: create nothing
      rq.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); resolve(null); };
      rq.onblocked = function () { resolve(null); };
      rq.onsuccess = function () {
        var d = rq.result;
        d.onversionchange = function () { d.close(); };
        if (!d.objectStoreNames.contains("keys") || !d.objectStoreNames.contains("creds")) { d.close(); resolve(null); return; }
        resolve(d);
      };
    });
  }
  function get(d, store, key) {
    return new Promise(function (resolve) {
      try {
        var r = d.transaction(store, "readonly").objectStore(store).get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  // The password sealed by mail.js (savePass): AES-GCM with the
  // non-extractable device key.
  function password(d, acctId) {
    return Promise.all([get(d, "keys", "device"), get(d, "creds", acctId)]).then(function (r) {
      var key = r[0], rec = r[1];
      if (!key || !rec || !rec.iv || !rec.data) return null;
      return root.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, key, rec.data)
        .then(function (plain) { return new TextDecoder().decode(plain); });
    }).catch(function () { return null; });
  }

  // ---------- mime.js (header decoding) + rules.js, loaded once ----------
  function srcOf(file) {
    try {
      var cs = root.document && root.document.currentScript;
      if (cs && /notify\.js(?=[?#]|$)/.test(cs.src || "")) return cs.src.replace(/notify\.js(?=[?#]|$)/, file);
    } catch (e) {}
    return "mail/" + file;
  }
  var MIME_SRC = srcOf("mime.js"), RULES_SRC = srcOf("rules.js"), OUTBOX_SRC = srcOf("outbox.js"), SNOOZE_SRC = srcOf("snooze.js");
  var loading = {};
  function load(src, name, fn) {
    var X = root[name];
    if (X && typeof X[fn] === "function") return Promise.resolve(X);
    var doc = root.document;
    if (!doc || !doc.head) return Promise.resolve(null);
    if (!loading[name]) {
      loading[name] = new Promise(function (resolve) {
        var s = doc.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = s.onerror = function () { resolve(); };
        doc.head.appendChild(s);
      });
    }
    return loading[name].then(function () {
      var X2 = root[name];
      return X2 && typeof X2[fn] === "function" ? X2 : null;
    });
  }
  function mime() { return load(MIME_SRC, "orosMailMime", "summary"); }
  function rulesLib() { return load(RULES_SRC, "orosMailRules", "plan"); }
  function outboxLib() { return load(OUTBOX_SRC, "orosMailOutbox", "claim"); }
  function snoozeLib() { return load(SNOOZE_SRC, "orosMailSnooze", "plan"); }

  // ---------- relay ----------
  function relay(url, acct, pass, body, ms) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, ms || CALL_TIMEOUT);
    body.acct = { host: acct.imap.host, port: acct.imap.port, sec: acct.imap.sec,
                  user: acct.imap.user || acct.email, pass: pass };
    return fetch(url + "/v1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
    }).then(function (r) { return r.json(); }).then(function (j) {
      clearTimeout(timer);
      if (!j || !j.ok) throw { code: (j && j.error && j.error.code) || "relay" };
      return j.data;
    }, function (e) {
      clearTimeout(timer);
      throw e && e.code ? e : { code: "network" };
    });
  }

  // ---------- the check ----------
  var busy = false, timer = null, wait = EVERY_MS, lastAt = 0;
  var silenced = {};          // acctId → the password that failed

  function emitFor(acct, fresh, uidv, M) {
    var N = root.orosNotifs;
    if (!fresh.length || !N || typeof N.emit !== "function") return;
    if (fresh.length > MAX_EACH) {
      N.emit({ ns: "mail", type: "new", key: "n:" + acct.id + ":" + uidv + ":" + fresh[0].uid + ":all",
               title: T("many", fresh.length), body: acct.email,
               deepLink: "mail:msg:" + acct.id + "." + fresh[0].uid, ttlDays: 3 });
      return;
    }
    fresh.forEach(function (x) {
      var s = null;
      try { s = M ? M.summary(M.b64ToBin(x.hdr || "")) : null; } catch (e) {}
      var from = s && s.from ? (s.from.name || s.from.addr) : "";
      var subj = s ? s.subject : "";
      N.emit({ ns: "mail", type: "new", key: "n:" + acct.id + ":" + uidv + ":" + x.uid,
               title: String(from || T("newOne")).slice(0, 120),
               body: String(subj || T("nosubj")).slice(0, 200),
               deepLink: "mail:msg:" + acct.id + "." + x.uid, ttlDays: 3 });
    });
  }

  // Rules the mail server runs itself (Sieve, set up in Mail's
  // settings) are left to it. Same test as sieve.js runs().
  function serverRuns(acct, r) {
    var sv = acct.sieve;
    if (!sv || sv.on !== true || !Array.isArray(sv.ext)) return false;
    return sv.ext.indexOf(r.act === "move" ? "fileinto" : "imap4flags") >= 0;
  }

  // Runs the rules on `newer`; → the same list without the messages a
  // rule moved or marked read. A failed call leaves those messages in.
  function applyRules(url, acct, pw, rules, newer, M, Rl) {
    if (!Rl || !M || !rules.length || !newer.length) return Promise.resolve({});
    var msgs = newer.map(function (x) {
      var s = null;
      try { s = M.summary(M.b64ToBin(x.hdr || "")); } catch (e) {}
      return { uid: x.uid, flags: x.flags, sum: s || {} };
    });
    var p = Rl.plan(rules, msgs, acct.id);
    var done = {};
    var steps = [];
    ["\\Seen", "\\Flagged"].forEach(function (f) {
      if (p.flags[f].length) steps.push(function () {
        return relay(url, acct, pw, { op: "flag", folder: "INBOX", uids: p.flags[f], add: [f], remove: [] })
          .then(function () { if (f === "\\Seen") p.flags[f].forEach(function (u) { done[u] = 1; }); });
      });
    });
    Object.keys(p.moves).forEach(function (to) {
      steps.push(function () {
        return relay(url, acct, pw, { op: "move", folder: "INBOX", uids: p.moves[to], to: to })
          .then(function () { p.moves[to].forEach(function (u) { done[u] = 1; }); });
      });
    });
    return steps.reduce(function (q, step) {
      return q.then(step).catch(function () {});
    }, Promise.resolve()).then(function () { return done; });
  }

  // ---------- timed sends ----------
  var TAB = "n" + Math.random().toString(36).slice(2, 10);
  var SEND_TIMEOUT = 120000;       // = mail.js: a large message takes longer
  var nextAt = 0;                  // the next due time seen (0: none)
  function allOutbox(d) {
    return new Promise(function (resolve) {
      try {
        var r = d.transaction("outbox", "readonly").objectStore("outbox").getAll();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
  }
  // Mail open in this shell: it sends its own (its timer is exact)
  function mailOpen() {
    try {
      var f = root.document.getElementById("app-frame");
      var w = f && f.contentWindow;
      return !!(w && /\/mail\/(index\.html)?$/.test(w.location.pathname) && w.orosMailOutbox);
    } catch (e) { return false; }
  }
  function notice(key, title, subj) {
    var N = root.orosNotifs;
    if (N && typeof N.emit === "function") {
      N.emit({ ns: "mail", type: "sent", key: key, title: title, body: String(subj || T("nosubj")).slice(0, 200), ttlDays: 1 });
    }
  }
  function sendDue(d, url, accts, OB) {
    if (!OB || !d.objectStoreNames.contains("outbox")) return Promise.resolve();
    return allOutbox(d).then(function (recs) {
      var now = Date.now();
      nextAt = OB.nextDue(recs, now);
      if (mailOpen()) return;
      return recs.filter(function (r) { return OB.isDue(r, now); }).reduce(function (p, r0) {
        return p.then(function () {
          var acct = accts.filter(function (a) { return a.id === r0.job.acct; })[0];
          return OB.claim(d, r0.id, TAB, Date.now()).then(function (rec) {
            if (!rec) return;
            if (!acct || !acct.smtp) return OB.release(d, rec.id, T("fail", acct ? "nosmtp" : "noacct"));
            return password(d, acct.id).then(function (pw) {
              if (!pw) return OB.release(d, rec.id, T("fail", "nopass"));
              var j = rec.job;
              var body = { op: "send", from: j.from, rcpt: j.rcpt, raw: j.raw,
                           smtp: { host: acct.smtp.host, port: acct.smtp.port, sec: acct.smtp.sec,
                                   user: acct.smtp.user || acct.imap.user || acct.email, pass: pw } };
              if (j.sent) body.sent = j.sent;
              return relay(url, acct, pw, body, SEND_TIMEOUT).then(function () {
                return OB.finish(d, rec.id).then(function () {
                  var sd = j.serverDraft;
                  if (sd && sd.uid > 0 && typeof sd.folder === "string") {
                    relay(url, acct, pw, { op: "expunge", folder: sd.folder, uids: [sd.uid] }).catch(function () {});
                  }
                  notice("s:" + rec.id, T("sent"), j.subj);
                });
              }, function (e) {
                if (e.code === "network") return OB.release(d, rec.id, "");
                return OB.release(d, rec.id, T("fail", e.code)).then(function () {
                  notice("f:" + rec.id, T("fail", e.code), j.subj);       // it waits in Mail's Outbox
                });
              });
            });
          }).catch(function () {});
        });
      }, Promise.resolve()).then(function () {
        return allOutbox(d).then(function (recs) { nextAt = OB.nextDue(recs, Date.now()); });
      });
    });
  }

  // ---------- snoozed messages ----------
  var WOKEN_KEY = "oros-mail-snooze-woken";
  var snzAt = 0;                   // the next snooze due (0: none)
  function snoozesOf(data, SN) {
    var tombs = data.tombs || {};
    return (Array.isArray(data.snoozes) ? data.snoozes : []).map(SN.norm)
      .filter(function (r) { return r && !(tombs[r.id] >= r.m); });
  }
  function wakeDue(d, url, accts, data, SN, M) {
    if (!SN || !M) return Promise.resolve();
    var recs = snoozesOf(data, SN), now = Date.now();
    snzAt = SN.next(recs, now);
    if (mailOpen()) return Promise.resolve();
    var woken = {};
    try { woken = JSON.parse(root.localStorage.getItem(WOKEN_KEY) || "{}") || {}; } catch (e) {}
    var live = {};
    recs.forEach(function (r) { live[r.id] = 1; });
    Object.keys(woken).forEach(function (id) { if (!live[id]) delete woken[id]; });
    var due = SN.due(recs, now).filter(function (r) { return woken[r.id] !== r.until; });
    function keep() { try { root.localStorage.setItem(WOKEN_KEY, JSON.stringify(woken)); } catch (e) {} }
    if (!due.length) { keep(); return Promise.resolve(); }
    var left = recs.filter(function (r) { return woken[r.id] !== r.until; });
    return accts.reduce(function (p, acct) {
      if (!SN.due(SN.forAcct(left, acct.id), now).length) return p;
      return p.then(function () {
        return Promise.all([password(d, acct.id), get(d, "folders", acct.id)]).then(function (r) {
          var pw = r[0], fl = r[1] && Array.isArray(r[1].list) ? r[1].list : null;
          if (!pw || !fl) return;
          var f = fl.filter(SN.isFolder)[0];
          if (!f) { SN.due(SN.forAcct(left, acct.id), now).forEach(function (x) { woken[x.id] = x.until; }); return; }
          return relay(url, acct, pw, { op: "list", folder: f.name, limit: 200 }).then(function (res) {
            var msgs = (res.msgs || []).map(function (x) {
              var s = {};
              try { s = M.summary(M.b64ToBin(x.hdr || "")); } catch (e) {}
              return { uid: x.uid, key: SN.keyOf({ mid: s.messageId, date: s.date || M.parseDate(x.date), from: s.from }) };
            });
            var plan = SN.plan(left, acct.id, msgs, now, !res.more);
            plan.gone.forEach(function (x) { woken[x.id] = x.until; });
            if (!plan.wake.length) return;
            var byDest = {};
            plan.wake.forEach(function (w) { (byDest[w.rec.from] = byDest[w.rec.from] || []).push(w); });
            return relay(url, acct, pw, { op: "flag", folder: f.name, uids: plan.wake.map(function (w) { return w.uid; }).slice(0, 500), add: [], remove: ["\\Seen"] })
              .catch(function () {}).then(function () {
                return Object.keys(byDest).reduce(function (q, dest) {
                  return q.then(function () {
                    var ws = byDest[dest], us = ws.map(function (w) { return w.uid; }).slice(0, 500);
                    function ok() { ws.forEach(function (w) { woken[w.rec.id] = w.rec.until; }); }
                    return relay(url, acct, pw, { op: "move", folder: f.name, uids: us, to: dest }).then(ok, function () {
                      if (dest === "INBOX") return;
                      return relay(url, acct, pw, { op: "move", folder: f.name, uids: us, to: "INBOX" }).then(ok, function () {});
                    });
                  });
                }, Promise.resolve());
              });
          }, function () {});
        });
      });
    }, Promise.resolve()).then(keep, keep);
  }

  function check() {
    if (busy) return Promise.resolve();
    function later() { wait = EVERY_MS; schedule(); return Promise.resolve(); }
    if (!root.navigator.onLine) return later();
    var data = readData();
    if (!data || !data.accounts.length) return later();
    var tombs = data.tombs || {};
    var accts = data.accounts.filter(function (a) {
      return a && typeof a.id === "string" && /^[a-z0-9]{6,40}$/.test(a.id) && a.imap && a.imap.host &&
             !(tombs[a.id] >= a.m);
    }).slice(0, 10);
    if (!accts.length) return later();
    var url = (data.relay && typeof data.relay.url === "string" && data.relay.url) || DEFAULT_RELAY;
    busy = true;
    lastAt = Date.now();
    hintAt = 0;
    var failed = false;
    var rules = Array.isArray(data.rules) ? data.rules : [];
    var snoozes = Array.isArray(data.snoozes) && data.snoozes.length;
    return Promise.all([openDb(), mime(), rules.length ? rulesLib() : null, outboxLib(), snoozes ? snoozeLib() : null]).then(function (r) {
      var d = r[0], M = r[1], Rl = r[2], OB = r[3], SN = r[4];
      if (!d) return;
      var marks = loadMarks();
      if (!snoozes) snzAt = 0;
      return sendDue(d, url, accts, OB).catch(function () {}).then(function () {
        return wakeDue(d, url, accts, data, SN, M).catch(function () {});
      }).then(function () {
        return accts.reduce(function (p, acct) {
          return p.then(function () {
            return password(d, acct.id).then(function (pw) {
              if (!pw || silenced[acct.id] === pw) return;
              var mine = rules.filter(function (x) { return x && x.acct === acct.id && x.on !== false && !serverRuns(acct, x); });
              return relay(url, acct, pw, { op: "list", folder: "INBOX", limit: mine.length ? PEEK_RULES : PEEK }).then(function (res) {
                var out = freshMessages(res, marks[acct.id]);
                marks[acct.id] = out.mark;
                saveMarks(marks);
                return applyRules(url, acct, pw, mine, out.newer, M, Rl).then(function (done) {
                  emitFor(acct, out.fresh.filter(function (x) { return !done[x.uid]; }), res.uidvalidity, M);
                });
              }, function (e) {
                if (e.code === "auth") silenced[acct.id] = pw;
                else failed = true;
              });
            });
          });
        }, Promise.resolve());
      }).then(function () {
        // forget marks of removed accounts
        Object.keys(marks).forEach(function (id) {
          if (!accts.some(function (a) { return a.id === id; })) delete marks[id];
        });
        saveMarks(marks);
      }).then(function () { d.close(); }, function () { d.close(); });
    }).catch(function () { failed = true; }).then(function () {
      busy = false;
      wait = failed ? Math.min(BACKOFF_MAX, wait * 2) : EVERY_MS;
      schedule();
    });
  }

  function schedule() {
    clearTimeout(timer);
    var ms = wait;
    // a timed send or a snooze due sooner: check then (not before 15 s)
    if (nextAt > Date.now()) ms = Math.min(ms, Math.max(15000, nextAt - Date.now() + 1000));
    if (snzAt > Date.now()) ms = Math.min(ms, Math.max(15000, snzAt - Date.now() + 1000));
    if (hintAt > Date.now()) ms = Math.min(ms, Math.max(15000, hintAt - Date.now() + 1000));
    timer = setTimeout(check, ms);
  }
  function soon() {
    // tab back / online: check now unless one ran in the last minute
    if (Date.now() - lastAt > 60000) { wait = EVERY_MS; check(); }
  }

  // Mail queued a timed send (or snoozed a message) due at ms: be ready
  // to act should Mail close
  var hintAt = 0;                  // Mail's latest "due at" (until the next check)
  function due(ms) {
    var now = Date.now();
    if (!(ms > 0) || [nextAt, snzAt, hintAt].some(function (x) { return x > now && x <= ms; })) return;
    hintAt = ms;
    if (!busy) schedule();
  }

  var api = { v: 1, freshMessages: freshMessages, check: check, due: due };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  if (root.__orosMailNotify && root.__orosMailNotify.v >= 1) return;
  root.__orosMailNotify = api;
  setTimeout(check, 20000);          // after boot settles (notifications.js ready)
  root.addEventListener("online", soon);
  root.document.addEventListener("visibilitychange", function () {
    if (root.document.visibilityState === "visible") soon();
  });
})(typeof window !== "undefined" ? window : globalThis);
