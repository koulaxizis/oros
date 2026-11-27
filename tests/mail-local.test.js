// Mail: mail servers on this computer (MAIL-LOCAL, Proton Mail Bridge).
// mail/local.js runs the relay's IMAP/SMTP code (mail/wire/, copies of
// relay/) over the orOS launcher's WebSocket (oros-portable
// launcher/mailsock.go, tested there with real TLS). Here a fake
// WebSocket speaks the launcher's messages and pipes bytes to a scripted
// IMAP server. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const net = require("net");
const path = require("path");

const root = path.join(__dirname, "..");

test("mail-local: mail/wire/ is byte-identical to relay/ (copy relay/imap.js, smtp.js and sieve.js after changing them)", () => {
  for (const f of ["imap.js", "smtp.js", "sieve.js"]) {
    assert.equal(fs.readFileSync(path.join(root, "mail/wire", f), "utf8"),
                 fs.readFileSync(path.join(root, "relay", f), "utf8"), "mail/wire/" + f + " differs from relay/" + f);
  }
});

// Proton Mail Bridge, scripted: STARTTLS, LOGIN, LIST.
function bridge(log) {
  const srv = net.createServer((sock) => {
    let buf = "";
    const reply = (s) => sock.write(s, "latin1");
    reply("* OK [CAPABILITY IMAP4rev1 STARTTLS] Proton Mail Bridge ready\r\n");
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      for (;;) {
        const e = buf.indexOf("\r\n");
        if (e < 0) return;
        const line = buf.slice(0, e); buf = buf.slice(e + 2);
        const sp = line.indexOf(" "), tag = line.slice(0, sp), cmd = line.slice(sp + 1);
        log.push(cmd.replace(/^LOGIN .*/i, "LOGIN …"));
        if (/^STARTTLS/i.test(cmd)) reply(tag + " OK begin TLS\r\n");
        else if (/^CAPABILITY/i.test(cmd)) reply("* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n" + tag + " OK done\r\n");
        else if (/^LOGIN "chris@proton\.me" "bridge-pass"$/i.test(cmd)) reply(tag + " OK logged in\r\n");
        else if (/^LOGIN /i.test(cmd)) reply(tag + " NO wrong password\r\n");
        else if (/^LIST /i.test(cmd)) reply('* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren \\Sent) "/" "Sent"\r\n' + tag + " OK done\r\n");
        else if (/^LOGOUT/i.test(cmd)) { reply("* BYE bye\r\n" + tag + " OK done\r\n"); sock.end(); }
        else reply(tag + " BAD unknown\r\n");
      }
    });
  });
  return new Promise((res) => srv.listen(0, "127.0.0.1", () => res(srv)));
}

// The launcher, faked: one WebSocket per connection, the launcher's
// control messages, "TLS" without encryption (real TLS is tested in
// oros-portable). cert: what a handshake does ("ok" | "new" | "changed").
function fakeLauncher(port, opts) {
  const seen = [];
  class WS {
    constructor(url) {
      const u = new URL(url);
      seen.push({ path: u.pathname, host: u.searchParams.get("host"), port: u.searchParams.get("port"),
                  mode: u.searchParams.get("mode"), pin: u.searchParams.get("pin") });
      this.readyState = 0;
      this.binaryType = "blob";
      setTimeout(() => {
        if (opts.down) { this.readyState = 3; this._msg(JSON.stringify({ t: "err", code: "connect" })); this.onclose && this.onclose({}); return; }
        this.s = net.connect({ host: "127.0.0.1", port }, () => {
          this.readyState = 1;
          this._msg(JSON.stringify({ t: "open" }));
        });
        this.s.on("data", (d) => this._msg(d.buffer.slice(d.byteOffset, d.byteOffset + d.length)));
        this.s.on("close", () => { this.readyState = 3; this.onclose && this.onclose({}); });
      }, 0);
    }
    _msg(data) { this.onmessage && this.onmessage({ data }); }
    send(d) {
      if (typeof d === "string") {
        assert.deepEqual(JSON.parse(d), { t: "starttls" });
        if (opts.cert === "ok") this._msg(JSON.stringify({ t: "tls", fp: "a".repeat(64) }));
        else { this._msg(JSON.stringify({ t: "err", code: opts.cert === "new" ? "cert-new" : "cert", fp: "b".repeat(64) })); this.close(); }
        return;
      }
      this.s.write(Buffer.from(d));
    }
    close() { if (this.s) this.s.destroy(); }
  }
  return { WS, seen };
}

const body = (pass) => ({ op: "check", acct: { host: "127.0.0.1", port: 1143, sec: "starttls", user: "chris@proton.me", pass } });

test("mail-local: check over the launcher's socket, STARTTLS with the pinned certificate", async () => {
  const L = await import("../mail/local.js");
  const log = [];
  const srv = await bridge(log);
  const { WS, seen } = fakeLauncher(srv.address().port, { cert: "ok" });
  const state = {};
  const data = await L.run(body("bridge-pass"), L.wsConnect(WS, "ws://localhost:47800", "a".repeat(64), state));
  assert.deepEqual(data, { folders: 2 });
  assert.deepEqual(log, ["STARTTLS", "CAPABILITY", "LOGIN …", "LIST \"\" \"*\"", "LOGOUT"]);
  assert.deepEqual(seen[0], { path: "/__oros/mail/sock", host: "127.0.0.1", port: "1143", mode: "starttls", pin: "a".repeat(64) });
  assert.equal(state.cert, undefined);
  srv.close();
});

test("mail-local: a wrong password is the server's own 'auth' answer", async () => {
  const L = await import("../mail/local.js");
  const srv = await bridge([]);
  const { WS } = fakeLauncher(srv.address().port, { cert: "ok" });
  await assert.rejects(L.run(body("nope"), L.wsConnect(WS, "ws://localhost:47800", "a".repeat(64), {})),
    (e) => e.code === "auth" && /wrong password/.test(e.msg));
  srv.close();
});

test("mail-local: an untrusted or changed certificate comes back with its fingerprint", async () => {
  const L = await import("../mail/local.js");
  for (const [cert, code] of [["new", "cert-new"], ["changed", "cert"]]) {
    const srv = await bridge([]);
    const { WS } = fakeLauncher(srv.address().port, { cert });
    const state = {};
    await assert.rejects(L.run(body("bridge-pass"), L.wsConnect(WS, "ws://localhost:47800", "", state)), (e) => e.code === "tls");
    assert.deepEqual(state.cert, { code, fp: "b".repeat(64) });
    srv.close();
  }
});

test("mail-local: Bridge not running is 'connect'; sieve is not offered", async () => {
  const L = await import("../mail/local.js");
  const { WS } = fakeLauncher(1, { down: true });
  await assert.rejects(L.run(body("x"), L.wsConnect(WS, "ws://localhost:47800", "", {})), (e) => e.code === "connect");
  await assert.rejects(L.run(Object.assign(body("x"), { op: "sieve" }), () => { throw new Error("no"); }), (e) => e.code === "nosieve");
  assert.ok(L.isLocalHost("127.0.0.1") && L.isLocalHost("LOCALHOST") && !L.isLocalHost("127.0.0.2") && !L.isLocalHost("mail.proton.me"));
  assert.ok(L.launcherHere({ hostname: "localhost", port: "47800" }) && !L.launcherHere({ hostname: "useoros.online", port: "" }));
});

// The account rules in mail.js (same loader as tests/mail.test.js).
const src = fs.readFileSync(path.join(root, "mail/mail.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const A = new Function("M", "R", "SV", "SN",
  "var DATA_VER = 1, MAX_TOMBS = 200, MAX_IMGOK = 500, KEEP_HEADS = 500, MAX_SIG = 1000, MAX_SIG_HTML = 60000;\n" +
  "function t(k) { return k; }\n" +
  block("  function cmpStr(", "  function el(") +
  block("  function lowerAddr(", "\n  // UID sets") +
  block("  // UID sets", "  var UI = {") +
  block("  // ---------- 2. Data model", "  // ---------- 3. Device store") +
  "\nreturn { normAccount, presetFor };")(require("../mail/mime.js"), require("../mail/rules.js"), require("../mail/sieve.js"), require("../mail/snooze.js"));

test("mail-local: Proton Mail Bridge accounts (127.0.0.1:1143/1025) and what stays refused", () => {
  const base = { id: "abc123", m: 1, email: "chris@proton.me" };
  const n = A.normAccount(Object.assign({ imap: { host: "localhost", port: 1143 }, smtp: { host: "127.0.0.1", port: 1025 } }, base));
  assert.deepEqual(n.imap, { host: "127.0.0.1", port: 1143, sec: "starttls", user: "chris@proton.me" });
  assert.deepEqual(n.smtp, { host: "127.0.0.1", port: 1025, sec: "starttls", user: "chris@proton.me" });
  assert.equal(A.normAccount(Object.assign({ imap: { host: "mail.x.com", port: 1143 } }, base)), null, "1143 only on this computer");
  assert.equal(A.normAccount(Object.assign({ imap: { host: "127.0.0.2", port: 1143 } }, base)), null);
  assert.equal(A.normAccount(Object.assign({ imap: { host: "127.0.0.1", port: 25 } }, base)), null);
  assert.equal(A.normAccount(Object.assign({ imap: { host: "127.0.0.1", port: 993 } }, base)), null, "this computer only on Bridge's ports");
  const mixed = A.normAccount(Object.assign({ imap: { host: "127.0.0.1", port: 1143 }, smtp: { host: "smtp.x.com", port: 465 } }, base));
  assert.ok(mixed && !mixed.smtp, "both servers on this computer, or neither");
  assert.equal(A.normAccount(Object.assign({ imap: { host: "imap.x.com", port: 993 }, smtp: { host: "127.0.0.1", port: 1025 } }, base)).smtp, undefined);
  const pre = A.presetFor("someone@proton.me");
  assert.ok(pre.bridge && pre.imap === "127.0.0.1" && pre.ip === 1143 && pre.sp === 1025);
  assert.ok(A.presetFor("x@pm.me").bridge && A.presetFor("x@protonmail.com").bridge);
});

test("mail-local: server rules (ManageSieve) go to the server's port 4190 by name", async () => {
  const L = await import("../mail/local.js");
  const seen = [];
  const connectFn = (host, port, mode) => { seen.push([host, port, mode]); return Promise.reject(new Error("refused")); };
  await assert.rejects(L.run({ op: "sieve", act: "check", acct: { host: "mail.example.gr", port: 993, sec: "tls", user: "u", pass: "p" } }, connectFn),
    (e) => e.code === "connect");
  await assert.rejects(L.run({ op: "sieve", act: "check", host: "sieve.example.gr", acct: { host: "mail.example.gr", port: 993, sec: "tls", user: "u", pass: "p" } }, connectFn),
    (e) => e.code === "connect");
  assert.deepEqual(seen, [["mail.example.gr", 4190, "starttls"], ["sieve.example.gr", 4190, "starttls"]]);
});
