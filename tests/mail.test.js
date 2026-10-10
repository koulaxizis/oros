// Mail: the MIME toolkit (mail/mime.js), the synced-slice merge and
// the header cache of mail.js, and the relay (relay/core.js +
// relay/imap.js) against a scripted IMAP server on a local socket.
// Run: node --test tests/
//
// mail.js is a browser IIFE with no exports, so sections 2 and parts
// of 1 and 6 are cut out of the source and evaluated on their own.
// The HTML sanitizer needs a DOM and is checked in a real browser
// (see the PR notes), not here.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Duplex } = require("stream");

const M = require("../mail/mime.js");

const src = fs.readFileSync(path.join(__dirname, "..", "mail/mail.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const A = new Function("M",
  "var DATA_VER = 1, MAX_TOMBS = 200, MAX_IMGOK = 500, KEEP_HEADS = 500, MAX_SIG = 1000;\n" +
  "function t(k) { return k; }\n" +
  block("  function cmpStr(", "  function el(") +
  block("  function lowerAddr(", "\n  // UID sets") +
  block("  // UID sets", "  var UI = {") +
  block("  // ---------- 2. Data model", "  // ---------- 3. Device store") +
  block("  function summarize(", "  function refreshFolder(") +
  "\nreturn { mergeMail, normAccount, normRelayUrl, emptyData, presetFor, folderRole, sortFolders," +
  " folderDepth, compressUids, uidSetHas, applyList };")(M);

const bin = (s) => Buffer.from(s, "utf8").toString("latin1");
const b64 = (s) => Buffer.from(s, "latin1").toString("base64");

// ---------- MIME ----------
test("encoded words: B and Q, ISO-8859-7, a UTF-8 character split across words", () => {
  assert.equal(M.decodeWords("=?ISO-8859-7?B?w+n+8ePv8g==?="), "Γιώργος");
  assert.equal(M.decodeWords("=?iso-8859-7?Q?=C4=EF=EA=E9=EC=DE?= =?iso-8859-7?Q?_=E1=F0=FC?="), "Δοκιμή από");
  const u = Buffer.from("Καλημέρα", "utf8");
  const w1 = u.subarray(0, 5).toString("base64"), w2 = u.subarray(5).toString("base64");
  assert.equal(M.decodeWords("=?UTF-8?B?" + w1 + "?=\r\n =?UTF-8?B?" + w2 + "?="), "Καλημέρα");
  assert.equal(M.decodeWords("Re: =?utf-8?q?caf=C3=A9?= ok"), "Re: café ok");
  assert.equal(M.decodeWords(bin("Ωμό UTF-8 χωρίς κωδικοποίηση")), "Ωμό UTF-8 χωρίς κωδικοποίηση");
});

test("parameters: quoted, RFC 2231 continuations and charset", () => {
  const p = M.parseParams("attachment; filename*0*=utf-8''%CE%A4%CE%B9%CE%BC; filename*1*=%CE%AE.pdf; size=12");
  assert.equal(p.value, "attachment");
  assert.equal(p.params.filename, "Τιμή.pdf");
  const q = M.parseParams('text/plain; charset="ISO-8859-7"; name="a; b.txt"');
  assert.equal(q.params.charset, "ISO-8859-7");
  assert.equal(q.params.name, "a; b.txt");
});

test("addresses: names with commas, quotes, comments, groups", () => {
  const a = M.parseAddresses('"Παπαδόπουλος, Γιάννης" <gp@example.gr>, anna@example.gr (Άννα), Team: x@y.gr, z@y.gr;');
  assert.deepEqual(a, [
    { name: "Παπαδόπουλος, Γιάννης", addr: "gp@example.gr" },
    { name: "Άννα", addr: "anna@example.gr" },
    { name: "", addr: "x@y.gr" },
    { name: "", addr: "z@y.gr" }
  ]);
});

test("dates: RFC 5322 with offset and zone names, IMAP INTERNALDATE, junk", () => {
  assert.equal(M.parseDate("Mon, 05 Oct 2026 10:00:00 +0300"), Date.UTC(2026, 9, 5, 7, 0, 0));
  assert.equal(M.parseDate("5 Oct 26 10:00 GMT"), Date.UTC(2026, 9, 5, 10, 0, 0));
  assert.equal(M.parseDate("06-Oct-2026 23:15:50 +0000"), Date.UTC(2026, 9, 6, 23, 15, 50));
  assert.equal(M.parseDate("yesterday"), 0);
});

test("message tree: alternative + related + attachment + inline invitation", () => {
  const msg = [
    "From: =?utf-8?b?zp3Or866zr/Pgg==?= <nikos@example.gr>",
    "To: chris@example.gr",
    "Subject: Test",
    "Content-Type: multipart/mixed; boundary=\"MIX\"",
    "",
    "preamble",
    "--MIX",
    "Content-Type: multipart/alternative; boundary=ALT",
    "",
    "--ALT",
    "Content-Type: text/plain; charset=iso-8859-7",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "=C3=E5=E9=DC =F3=EF=F5=3D",
    "--ALT",
    "Content-Type: multipart/related; boundary=REL",
    "",
    "--REL",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("<p>Γειά <img src=\"cid:logo@x\"></p>", "utf8").toString("base64"),
    "--REL",
    "Content-Type: image/png",
    "Content-ID: <logo@x>",
    "Content-Disposition: inline; filename=logo.png",
    "Content-Transfer-Encoding: base64",
    "",
    "iVBORw0KGgo=",
    "--REL--",
    "--ALT--",
    "--MIX",
    "Content-Type: text/calendar; method=REQUEST; charset=utf-8",
    "",
    "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261020T090000Z\r\nSUMMARY:Ομάδα\r\nLOCATION:Αθήνα\\, Ερμού 1\r\nEND:VEVENT\r\nEND:VCALENDAR",
    "--MIX",
    "Content-Type: application/pdf; name=\"=?utf-8?q?=CE=A4.pdf?=\"",
    "Content-Disposition: attachment",
    "Content-Transfer-Encoding: base64",
    "",
    "JVBERi0=",
    "--MIX--",
    "epilogue"
  ].join("\r\n");
  const p = M.parseMessage(bin(msg));
  assert.equal(p.text, "Γειά σου=");
  assert.equal(p.html, "<p>Γειά <img src=\"cid:logo@x\"></p>");
  assert.equal(p.cids["logo@x"].type, "image/png");
  assert.equal(p.cids["logo@x"].data.slice(0, 4), "\x89PNG");
  const names = p.attachments.map((a) => a.name);
  assert.deepEqual(names, ["logo.png", "invite.ics", "Τ.pdf"]);
  assert.equal(p.attachments[2].data, "%PDF-");
  const ev = M.parseIcs(p.ics[0])[0];
  assert.equal(ev.summary, "Ομάδα");
  assert.equal(ev.location, "Αθήνα, Ερμού 1");
  assert.deepEqual([ev.dtstart.y, ev.dtstart.mo, ev.dtstart.d, ev.dtstart.h, ev.dtstart.utc], [2026, 10, 20, 9, true]);
  const s = M.summary(bin(msg));
  assert.deepEqual(s.from, { name: "Νίκος", addr: "nikos@example.gr" });
  assert.equal(s.att, true);
});

test("message tree: no headers, broken base64, missing boundary, deep nesting stay safe", () => {
  assert.equal(M.parseMessage("").text, "");
  assert.equal(M.parseMessage("Content-Transfer-Encoding: base64\r\n\r\n%%%").text, "");
  const nb = M.parseMessage("Content-Type: multipart/mixed\r\n\r\nhello");
  assert.equal(nb.text, "hello");
  let deep = "x";
  for (let i = 0; i < 40; i++) deep = "Content-Type: multipart/mixed; boundary=b" + i + "\r\n\r\n--b" + i + "\r\n" + deep + "\r\n--b" + i + "--";
  assert.doesNotThrow(() => M.parseMessage(deep));
});

test("modified UTF-7 folder names and plain-text links", () => {
  assert.equal(M.utf7Decode("&A5EDwAO1A8MDxAOxA7sDvAOtA70DsQ-"), "Απεσταλμένα");
  assert.equal(M.utf7Decode("A&-B"), "A&B");
  const s = M.splitLinks("Δες (https://e.com/x_(y)), www.x.gr. ή a.b@c.gr! javascript:alert(1)");
  assert.deepEqual(s.filter((x) => x.href).map((x) => x.href),
    ["https://e.com/x_(y)", "https://www.x.gr", "mailto:a.b@c.gr"]);
  assert.equal(s.map((x) => x.t).join(""), "Δες (https://e.com/x_(y)), www.x.gr. ή a.b@c.gr! javascript:alert(1)");
});

// ---------- slice merge ----------
const acct = (id, m, extra) => Object.assign({ id, m, name: "", email: id + "@example.gr",
  imap: { host: "mail.example.gr", port: 993, sec: "tls", user: id + "@example.gr" } }, extra || {});

test("merge: symmetric, canonical, idempotent", () => {
  const a = { ver: 1, accounts: [acct("bbbbbbb", 5), acct("aaaaaaa", 9)], relay: { url: "https://r.example.dev", m: 3 },
              imgOk: { "X@Shop.com": 4 }, tombs: {} };
  const b = { ver: 1, accounts: [acct("aaaaaaa", 7, { name: "Old" }), acct("ccccccc", 2)],
              relay: { url: "https://s.example.dev", m: 8 }, imgOk: { "x@shop.com": 6, "b@b.gr": 1 }, tombs: { ddddddd: 3 } };
  const ab = A.mergeMail(a, b), ba = A.mergeMail(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(JSON.stringify(A.mergeMail(ab, ab)), JSON.stringify(ab));
  assert.deepEqual(ab.accounts.map((x) => x.id), ["aaaaaaa", "bbbbbbb", "ccccccc"]);
  assert.equal(ab.accounts[0].m, 9);
  assert.equal(ab.relay.url, "https://s.example.dev");
  assert.deepEqual(ab.imgOk, { "b@b.gr": 1, "x@shop.com": 6 });
  // tie on m: the larger JSON wins on both sides
  const t1 = A.mergeMail({ accounts: [acct("aaaaaaa", 5, { name: "A" })] }, { accounts: [acct("aaaaaaa", 5, { name: "B" })] });
  const t2 = A.mergeMail({ accounts: [acct("aaaaaaa", 5, { name: "B" })] }, { accounts: [acct("aaaaaaa", 5, { name: "A" })] });
  assert.equal(JSON.stringify(t1), JSON.stringify(t2));
});

test("merge: tombstones delete, delete wins ties, a newer edit comes back", () => {
  const live = { accounts: [acct("aaaaaaa", 10)] };
  assert.equal(A.mergeMail(live, { tombs: { aaaaaaa: 10 } }).accounts.length, 0);
  assert.equal(A.mergeMail(live, { tombs: { aaaaaaa: 9 } }).accounts.length, 1);
  assert.equal(A.mergeMail({ accounts: [acct("aaaaaaa", 12)] }, { tombs: { aaaaaaa: 10 } }).accounts.length, 1);
});

test("merge: never carries a password, drops invalid accounts and relay addresses", () => {
  const withPass = acct("aaaaaaa", 1, { pass: "secret", imap: { host: "mail.example.gr", port: 993, user: "u", pass: "x" } });
  const out = A.mergeMail({ accounts: [withPass, acct("bad id!", 1), acct("bbbbbbb", 1, { imap: { host: "localhost", port: 993 } }),
    acct("ccccccc", 1, { imap: { host: "mail.example.gr", port: 25 } })], relay: { url: "javascript:alert(1)", m: 9 } }, null);
  assert.equal(JSON.stringify(out).indexOf("secret"), -1);
  assert.equal(JSON.stringify(out).indexOf("\"pass\""), -1);
  assert.deepEqual(out.accounts.map((x) => x.id), ["aaaaaaa"]);
  assert.equal(out.relay.url, "");
  assert.equal(A.normRelayUrl("https://oros-mail-relay.chris.workers.dev/"), "https://oros-mail-relay.chris.workers.dev");
  assert.equal(A.normRelayUrl("http://evil.example"), null);
  assert.equal(A.normRelayUrl("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
});

test("presets: app-password providers, Outlook flagged, any other domain → mail.<domain>", () => {
  assert.equal(A.presetFor("me@gmail.com").imap, "imap.gmail.com");
  assert.ok(A.presetFor("me@hotmail.com").oauth);
  const p = A.presetFor("chris@pmail.gr");
  assert.equal(p.imap, "mail.pmail.gr");
  assert.equal(p.sp, 465);
  assert.equal(A.presetFor("nope"), null);
});

test("folders: roles from flags or names, order, nesting depth", () => {
  const list = A.sortFolders([
    { name: "INBOX.Archive", delim: ".", flags: [] },
    { name: "Zeta", delim: ".", flags: [] },
    { name: "&A5EDwAO1A8MDxAOxA7sDvAOtA70DsQ-", delim: ".", flags: [] },
    { name: "[Gmail]", delim: "/", flags: ["\\Noselect"] },
    { name: "Stuff", delim: ".", flags: ["\\Trash"] },
    { name: "INBOX", delim: ".", flags: [] }
  ]);
  assert.deepEqual(list.map((f) => f.name), ["INBOX", "&A5EDwAO1A8MDxAOxA7sDvAOtA70DsQ-", "INBOX.Archive", "Stuff", "Zeta"]);
  assert.equal(A.folderRole(list[1]), "sent");
  assert.equal(A.folderDepth({ name: "INBOX.Archive", delim: "." }), 0);
  assert.equal(A.folderDepth({ name: "Work/2026/Q4", delim: "/" }), 2);
});

// ---------- header cache ----------
const hdr = (uid) => ({ uid, flags: [], size: 10, date: "06-Oct-2026 23:15:50 +0000",
  hdr: b64("From: a@b.gr\r\nSubject: m" + uid + "\r\n") });

test("cache: new page, flags refresh, deletions, read marks kept, contiguous run", () => {
  let rec = { uidv: 0, msgs: [], pend: {} };
  rec = A.applyList(rec, { uidvalidity: 7, uids: "1:60", msgs: [56, 57, 58, 59, 60].map(hdr), flags: {} }, false);
  assert.deepEqual(rec.msgs.map((m) => m.uid), [60, 59, 58, 57, 56]);
  assert.equal(rec.more, true);
  assert.equal(rec.msgs[0].subj, "m60");
  // 59 deleted on the server, 58 read elsewhere, 60 read here offline (pending)
  rec.pend = { 60: 1 };
  rec = A.applyList(rec, { uidvalidity: 7, uids: "1:58,60", msgs: [], flags: { 58: ["\\Seen"], 60: [] } }, false);
  assert.deepEqual(rec.msgs.map((m) => m.uid), [60, 58, 57, 56]);
  assert.deepEqual(rec.msgs[1].flags, ["\\Seen"]);
  assert.deepEqual(rec.msgs[0].flags, ["\\Seen"]);
  // a gap: 70 new messages arrived, only the newest page came back
  const page = []; for (let u = 131; u >= 82; u--) page.push(hdr(u));
  rec = A.applyList(rec, { uidvalidity: 7, uids: "1:58,60,61:131", msgs: page, flags: {} }, false);
  assert.equal(rec.msgs[rec.msgs.length - 1].uid, 82);   // older run cut at the gap
  assert.equal(rec.more, true);
  // older page fills in below
  rec = A.applyList(rec, { uidvalidity: 7, uids: "1:58,60,61:131", msgs: [80, 81].map(hdr), flags: {} }, true);
  assert.equal(rec.msgs[rec.msgs.length - 1].uid, 80);
  // UIDVALIDITY change: everything cached is dropped
  rec = A.applyList(rec, { uidvalidity: 8, uids: "1", msgs: [hdr(1)], flags: {} }, false);
  assert.deepEqual(rec.msgs.map((m) => m.uid), [1]);
  assert.equal(rec.more, false);
  assert.equal(A.compressUids([5, 1, 2, 3, 9]), "1:3,5,9");
  assert.deepEqual(Object.keys(A.uidSetHas("1:3,9")).map(Number), [1, 2, 3, 9]);
});

// ---------- relay ----------
// A scripted IMAP server: enough of RFC 3501 for the relay's calls.
function imapServer(mailbox) {
  const srv = net.createServer((sock) => {
    let buf = "", pendingLit = null, selected = null;
    sock.write("* OK [CAPABILITY IMAP4rev1 LITERAL+] test ready\r\n");
    const reply = (s) => sock.write(s, "latin1");
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      for (;;) {
        if (pendingLit) {
          if (buf.length < pendingLit.n) return;
          pendingLit.parts.push(buf.slice(0, pendingLit.n));
          buf = buf.slice(pendingLit.n);
          const e = buf.indexOf("\r\n");
          if (e < 0) return;
          const rest = buf.slice(0, e); buf = buf.slice(e + 2);
          const cont = /\{(\d+)\}$/.exec(rest);
          pendingLit.line += "\u0001" + rest;
          if (cont) { pendingLit.n = +cont[1]; reply("+ go\r\n"); continue; }
          const p = pendingLit; pendingLit = null;
          handle(p.line, p.parts);
          continue;
        }
        const e = buf.indexOf("\r\n");
        if (e < 0) return;
        const line = buf.slice(0, e); buf = buf.slice(e + 2);
        const lit = /\{(\d+)\}$/.exec(line);
        if (lit) { pendingLit = { n: +lit[1], parts: [], line }; reply("+ go\r\n"); continue; }
        handle(line, []);
      }
    });
    function handle(line, lits) {
      const sp = line.indexOf(" ");
      const tag = line.slice(0, sp), cmd = line.slice(sp + 1);
      const ok = (t) => reply(tag + " OK " + (t || "done") + "\r\n");
      if (/^LOGIN /i.test(cmd)) {
        const user = lits.length ? null : (/^LOGIN "((?:[^"\\]|\\.)*)"/i.exec(cmd) || [])[1];
        const pass = lits.length ? Buffer.from(lits[lits.length - 1], "latin1").toString("utf8")
                                 : ((/"((?:[^"\\]|\\.)*)"$/.exec(cmd) || [])[1] || "").replace(/\\(.)/g, "$1");
        if (pass === mailbox.pass && (user === null || user === mailbox.user)) return ok("logged in");
        return reply(tag + " NO [AUTHENTICATIONFAILED] Authentication failed.\r\n");
      }
      if (/^CAPABILITY/i.test(cmd)) { reply("* CAPABILITY IMAP4rev1\r\n"); return ok(); }
      if (/^LIST /i.test(cmd)) {
        Object.keys(mailbox.folders).forEach((n) => reply("* LIST (" + mailbox.folders[n].flags + ") \".\" \"" + n + "\"\r\n"));
        return ok();
      }
      if (/^STATUS /i.test(cmd)) {
        const n = /^STATUS "([^"]*)"/i.exec(cmd)[1], f = mailbox.folders[n];
        reply("* STATUS \"" + n + "\" (MESSAGES " + f.msgs.length + " UNSEEN " + f.msgs.filter((m) => m.flags.indexOf("\\Seen") < 0).length + ")\r\n");
        return ok();
      }
      if (/^(EXAMINE|SELECT) /i.test(cmd)) {
        const n = /^\w+ "([^"]*)"/i.exec(cmd)[1];
        if (!mailbox.folders[n]) return reply(tag + " NO no such mailbox\r\n");
        selected = mailbox.folders[n];
        reply("* " + selected.msgs.length + " EXISTS\r\n* OK [UIDVALIDITY " + selected.uidv + "] ok\r\n");
        return ok("[READ-ONLY] done");
      }
      if (/^UID SEARCH ALL/i.test(cmd)) { reply("* SEARCH " + selected.msgs.map((m) => m.uid).join(" ") + "\r\n"); return ok(); }
      let m;
      if ((m = /^UID FETCH (\S+) \((.*)\)$/i.exec(cmd))) {
        const want = {}; m[1].split(",").forEach((p) => { const r = p.split(":").map(Number); for (let u = r[0]; u <= (r[1] || r[0]); u++) want[u] = 1; });
        selected.msgs.forEach((msg, i) => {
          if (!want[msg.uid]) return;
          const items = ["UID " + msg.uid];
          if (/FLAGS/.test(m[2])) items.push("FLAGS (" + msg.flags.join(" ") + ")");
          if (/RFC822\.SIZE/.test(m[2])) items.push("RFC822.SIZE " + msg.raw.length);
          if (/INTERNALDATE/.test(m[2])) items.push("INTERNALDATE \"06-Oct-2026 23:15:50 +0000\"");
          if (/BODY\.PEEK\[HEADER/.test(m[2])) { const h = msg.raw.split("\r\n\r\n")[0] + "\r\n\r\n"; items.push("BODY[HEADER.FIELDS (FROM SUBJECT)] {" + h.length + "}\r\n" + h); }
          if (/BODY\.PEEK\[\]/.test(m[2])) items.push("BODY[] {" + msg.raw.length + "}\r\n" + msg.raw);
          reply("* " + (i + 1) + " FETCH (" + items.join(" ") + ")\r\n");
        });
        return ok();
      }
      if ((m = /^UID STORE (\S+) \+FLAGS\.SILENT \((.*)\)$/i.exec(cmd))) {
        const uids = m[1].split(",").map(Number);
        selected.msgs.forEach((msg) => { if (uids.indexOf(msg.uid) >= 0 && msg.flags.indexOf(m[2]) < 0) msg.flags.push(m[2]); });
        return ok();
      }
      if (/^LOGOUT/i.test(cmd)) { reply("* BYE bye\r\n"); ok(); sock.end(); return; }
      reply(tag + " BAD unknown\r\n");
    }
  });
  return new Promise((res) => srv.listen(0, "127.0.0.1", () => res(srv)));
}

function connectTo(port) {
  return () => new Promise((res, rej) => {
    const s = net.connect({ host: "127.0.0.1", port }, () => {
      const w = Duplex.toWeb(s);
      res({ readable: w.readable, writable: w.writable, close() { s.destroy(); } });
    });
    s.on("error", rej);
  });
}

test("relay: CORS, validation, login with a non-ASCII password, list, fetch, flag", async () => {
  const core = await import("../relay/core.js");
  const raw = (uid, subj) => bin("From: =?utf-8?b?zpzOsc+Bzq/OsQ==?= <m@example.gr>\r\nSubject: " + subj + "\r\n\r\nΣώμα " + uid + "\r\n");
  const box = { user: "chris@pmail.gr", pass: "πάσ\"word\\1", folders: {
    INBOX: { flags: "\\HasNoChildren", uidv: 42, msgs: [1, 2, 3, 5].map((u) => ({ uid: u, flags: u === 1 ? ["\\Seen"] : [], raw: raw(u, "m" + u) })) },
    Sent: { flags: "\\Sent", uidv: 9, msgs: [] }
  } };
  const srv = await imapServer(box);
  const connectFn = connectTo(srv.address().port);
  const acctJ = { host: "mail.pmail.gr", port: 993, sec: "tls", user: box.user, pass: box.pass };
  const post = (body, origin) => core.handle(new Request("https://relay.test/v1", { method: "POST",
    headers: { Origin: origin || "https://useoros.online", "CF-Connecting-IP": "1.2.3.4" }, body: JSON.stringify(body) }), {}, connectFn)
    .then(async (r) => ({ status: r.status, cors: r.headers.get("Access-Control-Allow-Origin"), j: await r.json() }));
  try {
    // origin + preflight
    let r = await post({ op: "check", acct: acctJ }, "https://evil.example");
    assert.equal(r.status, 403);
    assert.equal(r.cors, null);
    const pre = await core.handle(new Request("https://relay.test/v1", { method: "OPTIONS", headers: { Origin: "https://useoros.online" } }), {}, connectFn);
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("Access-Control-Allow-Origin"), "https://useoros.online");
    // validation: no private hosts, no odd ports, no plaintext 143
    for (const bad of [{ host: "localhost" }, { host: "10.0.0.1" }, { host: "printer.local" }, { port: 25 }, { port: 143, sec: "tls" }, { pass: "" }]) {
      r = await post({ op: "check", acct: Object.assign({}, acctJ, bad) });
      assert.equal(r.j.error.code, "bad-request", JSON.stringify(bad));
    }
    r = await post({ op: "fetch", acct: acctJ, folder: "INBOX\r\nA1 LOGOUT", uid: 1 });
    assert.equal(r.j.error.code, "bad-request");
    // login: wrong password → auth
    r = await post({ op: "check", acct: Object.assign({}, acctJ, { pass: "wrong" }) });
    assert.equal(r.j.ok, false);
    assert.equal(r.j.error.code, "auth");
    // folders
    r = await post({ op: "folders", acct: acctJ });
    assert.equal(r.j.ok, true, JSON.stringify(r.j));
    assert.deepEqual(r.j.data.folders.map((f) => [f.name, f.total, f.unseen]), [["INBOX", 4, 3], ["Sent", 0, 0]]);
    // list: newest two, flags of the known ones, the whole UID set
    r = await post({ op: "list", acct: acctJ, folder: "INBOX", limit: 2, known: "1:2" });
    assert.equal(r.j.ok, true, JSON.stringify(r.j));
    const d = r.j.data;
    assert.equal(d.uidvalidity, 42);
    assert.equal(d.uids, "1:3,5");
    assert.deepEqual(d.msgs.map((x) => x.uid), [5, 3]);
    assert.equal(d.more, true);
    assert.deepEqual(d.flags, { 1: ["\\Seen"], 2: [] });
    assert.equal(M.summary(M.b64ToBin(d.msgs[0].hdr)).from.name, "Μαρία");
    r = await post({ op: "list", acct: acctJ, folder: "INBOX", limit: 2, beforeUid: 3 });
    assert.deepEqual(r.j.data.msgs.map((x) => x.uid), [2, 1]);
    assert.equal(r.j.data.more, false);
    // fetch + flag
    r = await post({ op: "fetch", acct: acctJ, folder: "INBOX", uid: 3 });
    assert.equal(M.parseMessage(M.b64ToBin(r.j.data.raw)).text, "Σώμα 3\n");
    r = await post({ op: "fetch", acct: acctJ, folder: "INBOX", uid: 4 });
    assert.equal(r.j.error.code, "gone");
    r = await post({ op: "flag", acct: acctJ, folder: "INBOX", uids: [3], add: ["\\Seen"], remove: [] });
    assert.equal(r.j.ok, true);
    assert.deepEqual(box.folders.INBOX.msgs[2].flags, ["\\Seen"]);
    r = await post({ op: "list", acct: acctJ, folder: "Nope", limit: 2 });
    assert.equal(r.j.error.code, "no");
  } finally {
    srv.close();
  }
});

test("relay: IMAP tokenizer handles literals, NIL, nested lists and bracketed sections", async () => {
  const { tokenize, expandUids, compressUids } = await import("../relay/imap.js");
  const t = tokenize('* 3 FETCH (UID 7 FLAGS (\\Seen $Junk) BODY[HEADER.FIELDS (FROM TO)] {5}\r\nab\r\nc X NIL "q\\"s")\r\n', 2);
  assert.equal(t[0], "3");
  const l = t[2];
  assert.deepEqual(l.slice(0, 4), ["UID", "7", "FLAGS", ["\\Seen", "$Junk"]]);
  assert.equal(l[4], "BODY[HEADER.FIELDS (FROM TO)]");
  assert.equal(l[5], "ab\r\nc");
  assert.deepEqual(l.slice(6), ["X", null, 'q"s']);
  assert.deepEqual(expandUids("1:3,9,8:7"), [1, 2, 3, 9, 7, 8]);
  assert.equal(compressUids([9, 1, 2, 3]), "1:3,9");
});

test("data: the signature is kept, cleaned and capped; merge stays symmetric", () => {
  const base = { id: "sigacct1", m: 5, email: "c@pmail.gr", imap: { host: "mail.pmail.gr", port: 993 } };
  const n = A.normAccount(Object.assign({ sig: "Χρήστος\r\norOS\u0007  \n\n" }, base));
  assert.equal(n.sig, "Χρήστος\norOS");
  assert.equal(A.normAccount(Object.assign({ sig: "x".repeat(5000) }, base)).sig.length, 1000);
  assert.ok(!("sig" in A.normAccount(Object.assign({ sig: "   " }, base))));
  assert.ok(!("sig" in A.normAccount(Object.assign({ sig: 42 }, base))));
  const a = { accounts: [Object.assign({ sig: "old" }, base)] };
  const b = { accounts: [Object.assign({}, base, { m: 6, sig: "new" })] };
  assert.equal(JSON.stringify(A.mergeMail(a, b)), JSON.stringify(A.mergeMail(b, a)));
  assert.equal(A.mergeMail(a, b).accounts[0].sig, "new");
});
