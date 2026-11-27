// ============================================================
// orOS Mail — mail servers on this computer (MAIL-LOCAL, Bible).
//
// The relay on Cloudflare cannot reach a server that listens only on
// the person's own computer, such as Proton Mail Bridge (IMAP
// 127.0.0.1:1143, SMTP 127.0.0.1:1025, STARTTLS, self-signed
// certificate), and it serves no Mail op to the orOS on the computer
// (http://localhost:47800) at all. So in orOS served by the launcher
// (installed orOS, orOS Portable, orOS USB) every account goes this way:
// the page runs the relay's own IMAP, SMTP and ManageSieve code
// (wire/imap.js, wire/smtp.js, wire/sieve.js: byte-identical copies of
// relay/, tests/mail-local.test.js checks) over the launcher's WebSocket
// /__oros/mail/sock (oros-portable launcher/mailsock.go), which carries
// the bytes and does the TLS: for a server by name against the
// system's roots, for this computer with the certificate the person
// trusted (its SHA-256, "pin", kept on this device only). Nothing goes
// through the relay.
//
// Loaded by mail.js and notify.js with import() only under the launcher
// (or for a Bridge account, to say it needs that computer).
//
//   isLocalHost(h), launcherHere(location)
//   wsConnect(WebSocket, "ws://localhost:47800", pin, state) → connectFn
//   run(body, connectFn) → data, or throws { code, msg }
//     body is what mail.js would send to the relay's /v1.
// ============================================================

import { withSession, ImapError } from "./wire/imap.js";
import { withSmtp } from "./wire/smtp.js";
import { runSieve } from "./wire/sieve.js";

export const SOCK_PATH = "/__oros/mail/sock";
const FETCH_BYTES = 20 * 1024 * 1024;   // one message source, as the relay

export function isLocalHost(h) {
  h = String(h || "").trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

// Is this page served by the orOS launcher (which has the socket)?
export function launcherHere(loc) {
  return !!loc && (loc.hostname === "localhost" || loc.hostname === "127.0.0.1") && loc.port === "47800";
}

// A connectFn for wire/*.js: sockets shaped like Cloudflare's connect()
// ({ readable, writable, startTls(), close() }) over the launcher's
// WebSocket. A certificate the launcher refused lands in state.cert as
// { code: "cert-new" | "cert", fp }.
export function wsConnect(WS, base, pin, state) {
  return function connectFn(host, port, mode) {
    return new Promise(function (resolve, reject) {
      var q = "host=" + encodeURIComponent(host) + "&port=" + encodeURIComponent(String(port)) +
              "&mode=" + encodeURIComponent(mode) + (pin ? "&pin=" + encodeURIComponent(pin) : "");
      var ws;
      try { ws = new WS(base + SOCK_PATH + "?" + q); } catch (e) { reject(new ImapError("connect", "no local socket")); return; }
      ws.binaryType = "arraybuffer";
      var settled = false, cur = null, tlsWait = null, gone = false;

      function side(ready) {
        var ctl;
        var s = {
          readable: new ReadableStream({ start: function (c) { ctl = c; } }),
          writable: new WritableStream({
            write: function (chunk) {
              return ready.then(function () {
                if (gone || ws.readyState !== 1) throw new ImapError("closed", "connection closed");
                ws.send(chunk);
              });
            }
          }),
          startTls: function () {
            var w = {};
            var p = new Promise(function (res, rej) { w.resolve = res; w.reject = rej; });
            p.catch(function () {});
            tlsWait = w;
            ws.send(JSON.stringify({ t: "starttls" }));
            cur = side(p);
            return cur;
          },
          close: function () { gone = true; try { ws.close(); } catch (e) {} },
          _push: function (u8) { try { ctl.enqueue(u8); } catch (e) {} },
          _fail: function (e) { try { ctl.error(e); } catch (x) {} },
          _end: function () { try { ctl.close(); } catch (e) {} }
        };
        return s;
      }
      function fail(err) {
        if (!settled) { settled = true; reject(err); }
        if (tlsWait) { tlsWait.reject(err); tlsWait = null; }
        if (cur) cur._fail(err);
      }
      ws.onmessage = function (ev) {
        if (typeof ev.data !== "string") {
          if (cur) cur._push(new Uint8Array(ev.data));
          return;
        }
        var m = null;
        try { m = JSON.parse(ev.data); } catch (e) {}
        if (!m || typeof m.t !== "string") return;
        if (m.t === "open" || (m.t === "tls" && !settled)) {
          settled = true;
          cur = side(Promise.resolve());
          resolve(cur);
        } else if (m.t === "tls") {
          if (tlsWait) { tlsWait.resolve(); tlsWait = null; }
        } else if (m.t === "err") {
          var code = typeof m.code === "string" ? m.code : "proto";
          if ((code === "cert-new" || code === "cert") && typeof m.fp === "string" && /^[0-9a-f]{64}$/.test(m.fp) && state) {
            state.cert = { code: code, fp: m.fp };
          }
          fail(new ImapError(code === "plain" ? "proto" : (code === "connect" ? "connect" : "tls"), code));
        }
      };
      ws.onerror = function () { /* onclose follows */ };
      ws.onclose = function () {
        gone = true;
        if (!settled) { settled = true; reject(new ImapError("connect", "no connection")); return; }
        if (tlsWait) { tlsWait.reject(new ImapError("tls", "closed")); tlsWait = null; }
        if (cur) cur._end();
      };
    });
  };
}

function b64bin(s) { return atob(s); }

// The relay's mail ops (relay/core.js), run here. Never throws anything
// but { code, msg }.
export async function run(b, connectFn) {
  var acct = { host: b.acct.host, port: +b.acct.port, sec: b.acct.sec, user: b.acct.user, pass: b.acct.pass };
  try {
    if (b.op === "sieve") {
      var sh = b.host || acct.host;
      if (isLocalHost(sh)) throw new ImapError("nosieve", "no server rules on this computer");
      return await runSieve(connectFn, { host: sh, port: 4190, user: acct.user, pass: acct.pass }, b);
    }
    if (b.op === "smtpcheck" || b.op === "send") {
      var smtp = { host: b.smtp.host, port: +b.smtp.port, sec: b.smtp.sec, user: b.smtp.user, pass: b.smtp.pass };
      var bin = b.op === "send" ? b64bin(b.raw) : "";
      await withSmtp(connectFn, smtp, async function (s) {
        if (b.op === "send") await s.send(b.from, b.rcpt, bin);
      });
      if (b.op === "smtpcheck") return { ok: true };
      var appended = false, appendErr = "";
      if (b.sent) {
        try {
          await withSession(connectFn, acct, function (api) { return api.append(b.sent, bin, ["\\Seen"]); }, { timeoutMs: 60000 });
          appended = true;
        } catch (e) { appendErr = String(e && e.message || "append failed").slice(0, 200); }
      }
      return { sent: true, appended: appended, appendErr: appendErr };
    }
    return await withSession(connectFn, acct, async function (api) {
      switch (b.op) {
        case "check": return { folders: (await api.folders(false)).length };
        case "folders": return { folders: await api.folders() };
        case "list": return api.list(b.folder, { limit: b.limit, beforeUid: b.beforeUid, known: b.known });
        case "fetch": return api.fetch(b.folder, b.uid, FETCH_BYTES);
        case "flag": return api.flag(b.folder, b.uids, b.add || [], b.remove || []);
        case "move": return api.move(b.folder, b.uids, b.to);
        case "expunge": return api.expunge(b.folder, b.uids);
        case "create": return api.create(b.folder);
        case "rename": return api.rename(b.folder, b.to);
        case "delete": return api.remove(b.folder);
        case "search": return api.search(b.folder, b.q, b.where, b.limit);
        case "draft": return api.saveDraft(b.folder, b64bin(b.raw), b.replace, b.mid);
      }
      return null;
    }, b.op === "draft" ? { timeoutMs: 60000 } : undefined);
  } catch (e) {
    var code = e instanceof ImapError ? e.code : "proto";
    throw { code: code, msg: String(e && e.message || code).slice(0, 300) };
  }
}
