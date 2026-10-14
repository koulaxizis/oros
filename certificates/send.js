// ============================================================
// orOS Certificates — send.js: email every certificate (v1.0.0)
// One message per person (one recipient, their own PDF attached),
// sent through the orOS mail relay's existing "send" op with an
// account set up in orOS Mail, the same way Newsletter sends:
//   - the account comes from Mail's data (oros-mail-data, read only)
//     and its sealed password from Mail's IndexedDB "oros-mail",
//     opened read-only with no version (never blocks Mail);
//   - the message is built by mail/compose.js (window.orosMailCompose).
// The queue is paced on this device: at least 2 s between messages and
// never more than the per-hour limit the user sets (mail providers
// allow far fewer than the relay). It stops at the first error that
// is not about one address (rate, quota, sign-in, network), so it never
// retries in a loop. A person is marked sent (person.ms, synced) only
// after the relay said ok, so a closed tab resumes without doubles.
// Pure parts (pace, classify, message) run in Node tests.
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis-25b.workers.dev";   // = mail.js
  var SEND_TIMEOUT = 120000, MIN_GAP = 2000;
  var PER_HOUR = { def: 60, min: 5, max: 500 };

  // ms between two messages for a per-hour limit
  function gapFor(perHour) {
    var n = Math.max(PER_HOUR.min, Math.min(PER_HOUR.max, Math.round(+perHour) || PER_HOUR.def));
    return Math.max(MIN_GAP, Math.ceil(3600000 / n));
  }
  // relay error → "skip" (this address only: go on) or "stop" (pause the queue)
  function classify(err) {
    var c = err && err.code;
    if (c === "rcpt" || c === "too-big") return "skip";
    return "stop";
  }
  function isRate(err) {
    var c = err && err.code, m = String(err && err.msg || "");
    return c === "rate" || /\b(rate|quota|limit|too many|421|450|451|452|454)\b/i.test(m);
  }

  // The message for one person → { bin } (mail/compose.js build)
  //   o: { from{name,addr}, to{name,addr}, subject, text, pdf{name,bin} }
  function message(MC, o) {
    return MC.build({
      from: o.from, to: [o.to], subject: o.subject, text: o.text,
      attachments: [{ name: o.pdf.name, type: "application/pdf", bin: o.pdf.bin }]
    });
  }

  var api = { VERSION: VERSION, PER_HOUR: PER_HOUR, MIN_GAP: MIN_GAP, gapFor: gapFor, classify: classify, isRate: isRate, message: message };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.CertSend = api;

  // ---------- browser: Mail's account, password and the relay ----------
  function mailData() {
    try {
      var d = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
      return d && Array.isArray(d.accounts) ? d : null;
    } catch (e) { return null; }
  }
  // accounts that can send (SMTP set), deleted ones left out
  function accounts() {
    var d = mailData();
    if (!d) return [];
    var tombs = d.tombs || {};
    return d.accounts.filter(function (a) {
      return a && typeof a.id === "string" && /^[a-z0-9]{6,40}$/.test(a.id) && a.imap && a.imap.host && a.smtp && a.smtp.host && a.email &&
             !(tombs[a.id] >= a.m);
    }).map(function (a) { return { id: a.id, email: a.email, name: String(a.name || "").trim(), a: a }; });
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
  function relay(body) {
    if (!navigator.onLine) return Promise.reject({ code: "offline" });
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, SEND_TIMEOUT);
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
  // → { acct, smtp } for the relay (the IMAP fields are checked by the
  // relay on every op even when no copy is filed)
  function creds(acc) {
    return mailPass(acc.id).then(function (pw) {
      if (!pw) throw { code: "nopass" };
      var a = acc.a, user = a.imap.user || a.email;
      return { acct: { host: a.imap.host, port: a.imap.port, sec: a.imap.sec, user: user, pass: pw },
               smtp: { host: a.smtp.host, port: a.smtp.port, sec: a.smtp.sec, user: a.smtp.user || user, pass: pw } };
    });
  }
  function send(cr, from, to, bin) {
    return relay({ op: "send", acct: cr.acct, smtp: cr.smtp, from: from, rcpt: [to], raw: root.orosMailCompose.b64(bin) });
  }

  // ---------- the queue ----------
  // q = run({ acc, list: [person], perHour, build(p) → Promise<{to, bin}>,
  //           done(p) (after the relay's ok), failed(p, err), step(i, n) , end(reason, err) })
  // q.stop() pauses after the message in flight.
  function run(o) {
    var stopped = false, i = 0, n = o.list.length, cr = null, timer = null;
    var gap = gapFor(o.perHour);
    function end(reason, err) { if (timer) clearTimeout(timer); o.end(reason, err); }
    function next() {
      if (stopped) return end("paused");
      if (i >= n) return end("done");
      var p = o.list[i], t0 = Date.now();
      o.step(i, n);
      Promise.resolve(cr || creds(o.acc).then(function (c) { cr = c; return c; })).then(function () {
        return o.build(p);
      }).then(function (m) {
        return send(cr, o.acc.email, m.to, m.bin);
      }).then(function () {
        o.done(p);
        i++;
        later(t0);
      }, function (err) {
        if (classify(err) === "skip") { o.failed(p, err); i++; later(t0); return; }
        end("error", err);
      });
    }
    function later(t0) {
      if (stopped) return end("paused");
      if (i >= n) return end("done");
      var wait = Math.max(0, gap - (Date.now() - t0));
      timer = setTimeout(function () { timer = null; next(); }, wait);
    }
    next();
    return {
      stop: function () {
        stopped = true;
        if (timer) { clearTimeout(timer); timer = null; end("paused"); }
      }
    };
  }

  root.CertSend.accounts = accounts;
  root.CertSend.run = run;
})(typeof window !== "undefined" ? window : this);
