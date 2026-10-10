// Mail phase 2: building messages (mail/compose.js) and the relay's
// "send" / "smtpcheck" ops (relay/smtp.js + core.js) against a
// scripted SMTP server, with the copy filed in Sent through a
// scripted IMAP APPEND. Run: node --test tests/
//
// The compose dialog, outbox and reply buttons need a DOM and are
// checked in a real browser (see the PR notes), not here.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("net");
const { Duplex } = require("stream");

const C = require("../mail/compose.js");
const M = require("../mail/mime.js");

// ---------- compose.js ----------
test("compose: address lists parse and round-trip through the edit format", () => {
  const r = C.parseList('Μαρία <maria@example.gr>, "Last, First" <lf@example.com>; plain@x.io\nmailto:m@y.gr, oops, <bad@>');
  assert.deepEqual(r.list.map((p) => p.addr), ["maria@example.gr", "lf@example.com", "plain@x.io", "m@y.gr"]);
  assert.equal(r.list[1].name, "Last, First");
  assert.deepEqual(r.bad, ["oops", "<bad@>"]);
  for (const name of ['A "B', "Last, First", "x\\y", "Όνομα"]) {
    const back = C.parseList(C.fmtInput({ name, addr: "a@b.gr" }) + ", z@q.io").list;
    assert.deepEqual(back, [{ name, addr: "a@b.gr" }, { name: "", addr: "z@q.io" }]);
  }
});

test("compose: header words are RFC 2047 and never split a character", () => {
  assert.equal(C.encodeWords("Hello there"), "Hello there");
  const long = "Καλημέρα σε όλους από το orOS — δοκιμή θέματος με πολλούς ελληνικούς χαρακτήρες 😀";
  const enc = C.encodeWords(long);
  const words = enc.split(" ");
  assert.ok(words.length > 2);
  words.forEach((w) => {
    assert.match(w, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    assert.ok(w.length <= 75, "encoded word ≤ 75 chars");
  });
  assert.equal(M.decodeWords(enc), long);
  assert.equal(C.fmtAddr({ name: "Doe, John", addr: "j@d.com" }), '"Doe, John" <j@d.com>');
  assert.equal(M.decodeWords(C.fmtAddr({ name: "Χρήστος", addr: "c@pmail.gr" })), "Χρήστος <c@pmail.gr>");
});

test("compose: build() makes a valid plain-text message; Bcc only in the envelope", () => {
  const date = new Date(Date.UTC(2026, 9, 10, 12, 0, 0));
  const ascii = C.build({ from: { name: "Chris", addr: "chris@pmail.gr" }, to: [{ name: "", addr: "a@x.com" }],
    cc: [], bcc: [{ name: "", addr: "hidden@x.com" }], subject: "Hi", text: "line 1\n.dot line\nline 3", date });
  assert.match(ascii.bin, /^Date: \w{3}, \d+ Oct 2026 /);
  assert.match(ascii.bin, /\r\nFrom: Chris <chris@pmail.gr>\r\n/);
  assert.match(ascii.bin, /\r\nContent-Transfer-Encoding: 7bit\r\n/);
  assert.ok(!/hidden@x\.com/.test(ascii.bin), "Bcc is not in the headers");
  assert.deepEqual(ascii.rcpt, ["a@x.com", "hidden@x.com"]);
  assert.match(ascii.messageId, /^<[0-9a-f]{24}\.oros@pmail\.gr>$/);
  assert.ok(ascii.bin.endsWith("line 1\r\n.dot line\r\nline 3\r\n"));
  assert.ok(!/(^|[^\r])\n/.test(ascii.bin), "only CRLF line ends");

  const gr = C.build({ from: { name: "Χρήστος", addr: "chris@pmail.gr" },
    to: [{ name: "", addr: "a@x.com" }, { name: "", addr: "A@X.com" }], cc: [{ name: "Β", addr: "b@x.com" }],
    subject: "Θέμα", text: "Γεια σου!\nΔεύτερη γραμμή", inReplyTo: "<orig@x.com>", references: "<r1@x.com> <orig@x.com>" });
  assert.deepEqual(gr.rcpt, ["a@x.com", "b@x.com"], "recipients de-duplicated");
  const parsed = M.parseMessage(gr.bin);
  assert.equal(parsed.text.replace(/\r?\n$/, ""), "Γεια σου!\nΔεύτερη γραμμή");
  assert.equal(M.decodeWords(parsed.headers.subject[0]), "Θέμα");
  assert.equal(parsed.headers["in-reply-to"][0], "<orig@x.com>");
  assert.equal(parsed.headers.references[0], "<r1@x.com> <orig@x.com>");
  gr.bin.split("\r\n").forEach((l) => assert.ok(l.length <= 998));
});

test("compose: reply, reply all and forward drafts", () => {
  const labels = { wrote: (d, w) => "On D, " + w + " wrote:", fwd: "-- fwd --", from: "From", date: "Date",
                   subject: "Subject", to: "To", fmtDate: () => "D" };
  const msg = { from: { name: "Ann", addr: "ann@x.com" }, to: [{ name: "", addr: "me@pmail.gr" }, { name: "", addr: "bob@x.com" }],
    cc: [{ name: "", addr: "cat@x.com" }, { name: "", addr: "ann@x.com" }], replyTo: [], subject: "Plans",
    messageId: "<m1@x.com>", references: "<m0@x.com>", date: 0, text: "Hello\n> earlier" };
  const r = C.draftFrom(msg, "reply", "ME@pmail.gr", labels);
  assert.deepEqual(r.to.map((p) => p.addr), ["ann@x.com"]);
  assert.deepEqual(r.cc, []);
  assert.equal(r.subject, "Re: Plans");
  assert.equal(r.inReplyTo, "<m1@x.com>");
  assert.equal(r.references, "<m0@x.com> <m1@x.com>");
  assert.equal(r.text, "\n\nOn D, Ann <ann@x.com> wrote:\n> Hello\n>> earlier");
  const all = C.draftFrom(msg, "all", "me@pmail.gr", labels);
  assert.deepEqual(all.cc.map((p) => p.addr), ["bob@x.com", "cat@x.com"], "me and the sender left out of Cc");
  assert.equal(C.draftFrom(Object.assign({}, msg, { subject: "Απ: Plans" }), "reply", "me@pmail.gr", labels).subject, "Απ: Plans");
  const rt = C.draftFrom(Object.assign({}, msg, { replyTo: [{ name: "", addr: "list@x.com" }] }), "reply", "me@pmail.gr", labels);
  assert.deepEqual(rt.to.map((p) => p.addr), ["list@x.com"], "Reply-To wins");
  const f = C.draftFrom(msg, "forward", "me@pmail.gr", labels);
  assert.deepEqual(f.to, []);
  assert.equal(f.subject, "Fwd: Plans");
  assert.equal(f.inReplyTo, "");
  assert.match(f.text, /^\n\n-- fwd --\nFrom: Ann <ann@x.com>\nDate: D\nSubject: Plans\nTo: me@pmail.gr, bob@x.com\n\nHello/);
});

// ---------- relay: scripted servers ----------
function smtpServer(opts) {
  const log = { cmds: [], data: null, rcpt: [], from: null };
  const srv = net.createServer((sock) => {
    let buf = "", inData = false, authStep = 0;
    const say = (s) => sock.write(s + "\r\n", "latin1");
    say("220 smtp.test ESMTP");
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          log.data = buf.slice(0, end + 2);
          buf = buf.slice(end + 5);
          inData = false;
          say(opts.dataReply || "250 2.0.0 queued");
          continue;
        }
        const e = buf.indexOf("\r\n");
        if (e < 0) return;
        const line = buf.slice(0, e); buf = buf.slice(e + 2);
        log.cmds.push(line);
        if (authStep === 1) { authStep = 2; say("334 UGFzc3dvcmQ6"); continue; }
        if (authStep === 2) {
          authStep = 0;
          say(Buffer.from(line, "base64").toString("utf8") === opts.pass ? "235 ok" : "535 5.7.8 bad credentials");
          continue;
        }
        let m;
        if (/^EHLO /i.test(line)) {
          const ext = ["250-smtp.test", "250-SIZE 1000000", "250-SMTPUTF8"];
          if (opts.starttls) ext.push("250-STARTTLS");
          ext.push("250 AUTH " + (opts.mechs || "PLAIN LOGIN"));
          sock.write(ext.join("\r\n") + "\r\n");
        } else if (/^STARTTLS$/i.test(line)) say("220 go ahead");
        else if ((m = /^AUTH PLAIN (\S+)$/i.exec(line))) {
          const p = Buffer.from(m[1], "base64").toString("utf8").split("\0");
          say(p[1] === opts.user && p[2] === opts.pass ? "235 2.7.0 ok" : "535 5.7.8 bad credentials");
        } else if (/^AUTH LOGIN$/i.test(line)) { authStep = 1; say("334 VXNlcm5hbWU6"); }
        else if ((m = /^MAIL FROM:<([^>]*)>/i.exec(line))) { log.from = m[1]; say("250 ok"); }
        else if ((m = /^RCPT TO:<([^>]*)>/i.exec(line))) {
          if (/refuse/.test(m[1])) say("550 5.1.1 no such user");
          else { log.rcpt.push(m[1]); say("250 ok"); }
        } else if (/^DATA$/i.test(line)) { inData = true; say("354 end with ."); }
        else if (/^RSET$/i.test(line)) say("250 ok");
        else if (/^QUIT$/i.test(line)) { say("221 bye"); sock.end(); }
        else say("500 unknown");
      }
    });
  });
  return new Promise((res) => srv.listen(0, "127.0.0.1", () => res({ srv, log })));
}

// Just enough IMAP for login + APPEND.
function appendServer(box) {
  const srv = net.createServer((sock) => {
    let buf = "", lit = null;
    const reply = (s) => sock.write(s, "latin1");
    reply("* OK [CAPABILITY IMAP4rev1] ready\r\n");
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      for (;;) {
        if (lit) {
          if (buf.length < lit.n + 2) return;
          const msg = buf.slice(0, lit.n);
          buf = buf.slice(lit.n + 2);
          if (box.folders.indexOf(lit.folder) < 0) reply(lit.tag + " NO [TRYCREATE] no such mailbox\r\n");
          else { box.appended.push({ folder: lit.folder, flags: lit.flags, msg }); reply(lit.tag + " OK APPEND done\r\n"); }
          lit = null;
          continue;
        }
        const e = buf.indexOf("\r\n");
        if (e < 0) return;
        const line = buf.slice(0, e); buf = buf.slice(e + 2);
        const sp = line.indexOf(" "), tag = line.slice(0, sp), cmd = line.slice(sp + 1);
        let m;
        if (/^LOGIN /i.test(cmd)) reply(tag + " OK logged in\r\n");
        else if (/^CAPABILITY/i.test(cmd)) reply("* CAPABILITY IMAP4rev1\r\n" + tag + " OK done\r\n");
        else if ((m = /^APPEND "([^"]*)" \(([^)]*)\) \{(\d+)\}$/i.exec(cmd))) {
          lit = { tag, folder: m[1], flags: m[2], n: +m[3] };
          reply("+ go\r\n");
        } else if (/^LOGOUT/i.test(cmd)) { reply("* BYE bye\r\n" + tag + " OK done\r\n"); sock.end(); }
        else reply(tag + " BAD unknown\r\n");
      }
    });
  });
  return new Promise((res) => srv.listen(0, "127.0.0.1", () => res(srv)));
}

function wrap(s) {
  const w = Duplex.toWeb(s);
  return { readable: w.readable, writable: w.writable, close() { s.destroy(); },
           startTls() { return wrap(s); } };   // the test server stays plain text
}
function router(ports) {
  return (host, port) => new Promise((res, rej) => {
    const s = net.connect({ host: "127.0.0.1", port: ports[port] }, () => res(wrap(s)));
    s.on("error", rej);
  });
}

test("relay: send over SMTP (AUTH PLAIN, dot-stuffing) and file a copy in Sent", async () => {
  const core = await import("../relay/core.js");
  const pass = "πάσ\"word";
  const smtp = await smtpServer({ user: "chris@pmail.gr", pass });
  const smtpTls = await smtpServer({ user: "chris@pmail.gr", pass, starttls: true, mechs: "LOGIN" });
  const box = { folders: ["INBOX", "INBOX.Sent"], appended: [] };
  const imap = await appendServer(box);
  const connectFn = router({ 993: imap.address().port, 465: smtp.srv.address().port, 587: smtpTls.srv.address().port });
  const acct = { host: "mail.pmail.gr", port: 993, sec: "tls", user: "chris@pmail.gr", pass };
  const smtpArg = { host: "mail.pmail.gr", port: 465, sec: "tls", user: "chris@pmail.gr", pass };
  const post = (body) => core.handle(new Request("https://relay.test/v1", { method: "POST",
    headers: { Origin: "https://useoros.online", "CF-Connecting-IP": "5.6.7.8" }, body: JSON.stringify(body) }), {}, connectFn)
    .then(async (r) => ({ status: r.status, j: await r.json() }));
  const msg = C.build({ from: { name: "Χρήστος", addr: "chris@pmail.gr" }, to: [{ name: "", addr: "ann@x.com" }],
    cc: [], bcc: [{ name: "", addr: "bob@x.com" }], subject: "Τεστ", text: "first\n.starts with a dot\nlast" });
  try {
    // validation
    let r = await post({ op: "send", acct, smtp: Object.assign({}, smtpArg, { port: 25 }), from: "chris@pmail.gr", rcpt: ["a@x.com"], raw: "QQ==" });
    assert.equal(r.j.error.msg, "invalid smtp-port");
    r = await post({ op: "send", acct, smtp: Object.assign({}, smtpArg, { sec: "starttls" }), from: "chris@pmail.gr", rcpt: ["a@x.com"], raw: "QQ==" });
    assert.equal(r.j.error.msg, "invalid smtp-sec");
    r = await post({ op: "send", acct, smtp: smtpArg, from: "chris@pmail.gr", rcpt: [], raw: "QQ==" });
    assert.equal(r.j.error.msg, "invalid rcpt");
    r = await post({ op: "send", acct, smtp: smtpArg, from: "chris@pmail.gr", rcpt: ["a@x.com\r\nRSET"], raw: "QQ==" });
    assert.equal(r.j.error.msg, "invalid rcpt");
    r = await post({ op: "send", acct, smtp: smtpArg, from: "chris@pmail.gr", rcpt: ["a@x.com"], raw: "not base64!" });
    assert.equal(r.j.error.msg, "invalid raw");
    // a message above the plain request limit is fine for "send" only
    const big = "A".repeat(100 * 1024);
    r = await post({ op: "check", acct, pad: big });
    assert.equal(r.status, 413);

    // smtpcheck: login only
    r = await post({ op: "smtpcheck", acct, smtp: smtpArg });
    assert.deepEqual(r.j, { ok: true, data: { ok: true } });
    r = await post({ op: "smtpcheck", acct, smtp: Object.assign({}, smtpArg, { pass: "wrong" }) });
    assert.equal(r.j.ok, false);
    assert.equal(r.j.error.code, "auth");

    // send + copy in Sent
    r = await post({ op: "send", acct, smtp: smtpArg, from: "chris@pmail.gr", rcpt: msg.rcpt, raw: C.b64(msg.bin), sent: "INBOX.Sent" });
    assert.deepEqual(r.j, { ok: true, data: { sent: true, appended: true, appendErr: "" } });
    assert.equal(smtp.log.from, "chris@pmail.gr");
    assert.deepEqual(smtp.log.rcpt, ["ann@x.com", "bob@x.com"]);
    assert.ok(smtp.log.cmds.some((c) => /^MAIL FROM:<chris@pmail\.gr> SIZE=\d+$/.test(c)));
    assert.ok(smtp.log.data.indexOf("\r\n..starts with a dot\r\n") >= 0, "dot-stuffed on the wire");
    assert.equal(smtp.log.data.replace(/(^|\r\n)\.\./g, "$1."), msg.bin);
    assert.equal(box.appended.length, 1);
    assert.equal(box.appended[0].folder, "INBOX.Sent");
    assert.equal(box.appended[0].flags, "\\Seen");
    assert.equal(box.appended[0].msg, msg.bin);

    // a Greek body goes as base64 (nothing to stuff); no Sent → no copy
    const gr = C.build({ from: { name: "", addr: "chris@pmail.gr" }, to: [{ name: "", addr: "ann@x.com" }],
      subject: "gr", text: ".Γεια\nok" });
    r = await post({ op: "send", acct, smtp: smtpArg, from: "chris@pmail.gr", rcpt: gr.rcpt, raw: C.b64(gr.bin) });
    assert.deepEqual(r.j.data, { sent: true, appended: false, appendErr: "" });
    assert.equal(M.parseMessage(smtp.log.data).text.replace(/\r?\n$/, ""), ".Γεια\nok");

    // Sent missing: still sent, the copy failure is reported
    r = await post({ op: "send", acct, smtp: smtpArg, from: "chris@pmail.gr", rcpt: ["ann@x.com"], raw: C.b64(msg.bin), sent: "Nope" });
    assert.equal(r.j.data.sent, true);
    assert.equal(r.j.data.appended, false);
    assert.match(r.j.data.appendErr, /no such mailbox/);

    // a refused recipient → error, nothing sent
    const before = smtp.log.data;
    r = await post({ op: "send", acct, smtp: smtpArg, from: "chris@pmail.gr", rcpt: ["ann@x.com", "refuse@x.com"], raw: C.b64(msg.bin) });
    assert.equal(r.j.error.code, "rcpt");
    assert.match(r.j.error.msg, /refuse@x\.com: 550/);
    assert.equal(smtp.log.data, before);

    // 587: STARTTLS required, AUTH LOGIN fallback
    r = await post({ op: "send", acct, smtp: Object.assign({}, smtpArg, { port: 587, sec: "starttls" }),
                     from: "chris@pmail.gr", rcpt: ["ann@x.com"], raw: C.b64(msg.bin) });
    assert.equal(r.j.ok, true, JSON.stringify(r.j));
    assert.ok(smtpTls.log.cmds.indexOf("STARTTLS") >= 0);
    assert.equal(smtpTls.log.cmds.filter((c) => /^EHLO/.test(c)).length, 2, "EHLO again after STARTTLS");
    assert.ok(smtpTls.log.cmds.indexOf("AUTH LOGIN") >= 0);
  } finally {
    smtp.srv.close(); smtpTls.srv.close(); imap.close();
  }
});

test("relay: 587 without STARTTLS on offer is refused (never plain text)", async () => {
  const core = await import("../relay/core.js");
  const smtp = await smtpServer({ user: "u@x.com", pass: "p" });
  const connectFn = router({ 587: smtp.srv.address().port });
  try {
    const r = await core.handle(new Request("https://relay.test/v1", { method: "POST",
      headers: { Origin: "https://useoros.online", "CF-Connecting-IP": "9.9.9.9" },
      body: JSON.stringify({ op: "smtpcheck", acct: { host: "mail.x.com", port: 993, sec: "tls", user: "u@x.com", pass: "p" },
                             smtp: { host: "mail.x.com", port: 587, sec: "starttls", user: "u@x.com", pass: "p" } }) }), {}, connectFn);
    const j = await r.json();
    assert.equal(j.error.code, "tls");
    assert.ok(!smtp.log.cmds.some((c) => /^AUTH/.test(c)), "no password sent");
  } finally { smtp.srv.close(); }
});
