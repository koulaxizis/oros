// Mail: rules and out-of-office reply on the server — the Sieve
// script (mail/sieve.js) and the relay's "sieve" op (relay/sieve.js)
// against a scripted ManageSieve server (RFC 5804).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("net");
const { Duplex } = require("stream");
const S = require("../mail/sieve.js");

const ALL = ["fileinto", "imap4flags", "vacation", "date", "relational", "comparator-i;unicode-casemap"];
const rule = (id, field, has, act, to) => ({ id, m: 1, on: true, acct: "acct01", field, has, act, to });

test("sieve: rules become one script; flags first, the first move wins with stop", () => {
  const r = S.build({ ext: ALL, folder: (f) => f.replace("&A6QDsQ-", "δα"), rules: [
    rule("r00001", "from", "news@a.gr, \"offers\"", "move", "INBOX.News"),
    rule("r00002", "subject", "Τιμολόγιο", "star"),
    rule("r00003", "any", "x\\y", "move", "INBOX.&A6QDsQ-"),
    rule("r00004", "to", "list@x.gr", "read"),
    Object.assign(rule("r00005", "from", "off@x.gr", "read"), { on: false })
  ] });
  assert.equal(r.skipped, 0);
  const lines = r.script.split("\r\n");
  assert.equal(lines[2], 'require ["comparator-i;unicode-casemap", "fileinto", "imap4flags"];');
  const body = lines.slice(3).join("\n");
  assert.equal(body, [
    'if header :comparator "i;unicode-casemap" :contains "subject" "Τιμολόγιο" {', '  addflag "\\\\Flagged";', "}",
    'if header :comparator "i;unicode-casemap" :contains ["to", "cc"] "list@x.gr" {', '  addflag "\\\\Seen";', "}",
    'if header :comparator "i;unicode-casemap" :contains "from" ["news@a.gr", "\\"offers\\""] {', '  fileinto "INBOX.News";', "  stop;", "}",
    'if header :comparator "i;unicode-casemap" :contains ["from", "to", "cc", "subject"] "x\\\\y" {', '  fileinto "INBOX.δα";', "  stop;", "}",
    ""
  ].join("\n"));
  assert.ok(!/off@x\.gr/.test(r.script), "a rule that is off is left out");
});

test("sieve: out-of-office reply with dates, and what a smaller server cannot do", () => {
  const away = S.normAway({ on: true, subject: "  Εκτός  γραφείου ", text: "Λείπω.\nΕπιστρέφω τη Δευτέρα \"σίγουρα\".", days: 3,
                            start: "2026-10-20", end: "2026-10-30", m: 5 });
  assert.deepEqual(away, { on: true, subject: "Εκτός γραφείου", text: "Λείπω.\nΕπιστρέφω τη Δευτέρα \"σίγουρα\".", days: 3,
                           start: "2026-10-20", end: "2026-10-30", m: 5 });
  const r = S.build({ ext: ALL, away, rules: [rule("r00001", "from", "a@b.gr", "move", "Junk")] });
  assert.match(r.script, /require \["comparator-i;unicode-casemap", "date", "fileinto", "relational", "vacation"\];/);
  assert.ok(r.script.indexOf('if allof (currentdate :value "ge" "date" "2026-10-20", currentdate :value "le" "date" "2026-10-30") {\r\n' +
    '  vacation :days 3 :subject "Εκτός γραφείου" "Λείπω.\r\nΕπιστρέφω τη Δευτέρα \\"σίγουρα\\".";\r\n}') >= 0);
  assert.ok(r.script.indexOf("vacation") < r.script.indexOf("fileinto \"Junk\""), "the reply comes before a rule can stop");
  assert.equal(r.dates, true);
  // vacation only, no date support, no unicode comparator, no imap4flags
  const small = S.build({ ext: ["fileinto", "vacation"], away, rules: [rule("r00002", "subject", "x", "star")] });
  assert.equal(small.dates, false);
  assert.equal(small.skipped, 1);
  assert.match(small.script, /require "vacation";\r\n# Out of office\r\nvacation :days 3 /);
  assert.ok(!/currentdate|addflag|comparator/.test(small.script));
  // nothing to do
  assert.equal(S.build({ ext: ALL, away: S.normAway({ on: true, text: "" }), rules: [] }).empty, true);
  assert.equal(S.normAway({ on: true, text: "x", days: 99, start: "2026-10-20", end: "2026-10-01" }).days, 1);
  assert.equal(S.normAway({ on: true, text: "x", start: "2026-10-20", end: "2026-10-01" }).end, "");
  assert.equal(S.normAway(null), null);
});

// ---------- relay: a scripted ManageSieve server ----------
function sieveServer(opts) {
  const st = { scripts: Object.assign({}, opts.scripts || {}), active: opts.active || "", log: [] };
  const CAPS = '"IMPLEMENTATION" "Dovecot Pigeonhole"\r\n"SIEVE" "fileinto imap4flags vacation date relational"\r\n"SASL" "PLAIN"\r\n' +
               (opts.noTls ? "" : '"STARTTLS"\r\n') + '"VERSION" "1.0"\r\n';
  const srv = net.createServer((sock) => {
    let buf = "";
    const say = (s) => sock.write(Buffer.from(s, "utf8"));
    say(CAPS + 'OK "ready"\r\n');
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      for (;;) {
        const e = buf.indexOf("\r\n");
        if (e < 0) return;
        let line = buf.slice(0, e);
        const lit = /\{(\d+)\+\}$/.exec(line);
        let data = null;
        if (lit) {
          const n = +lit[1];
          if (buf.length < e + 2 + n + 2) return;
          data = Buffer.from(buf.slice(e + 2, e + 2 + n), "latin1").toString("utf8");
          buf = buf.slice(e + 2 + n + 2);
        } else buf = buf.slice(e + 2);
        line = Buffer.from(line, "latin1").toString("utf8");
        st.log.push(line);
        let m;
        if (line === "STARTTLS") { say('OK "begin TLS"\r\n'); say(CAPS.replace('"STARTTLS"\r\n', "") + "OK\r\n"); }
        else if ((m = /^AUTHENTICATE "PLAIN" "([^"]+)"$/.exec(line))) {
          const p = Buffer.from(m[1], "base64").toString("utf8").split("\0");
          say(p[1] === opts.user && p[2] === opts.pass ? 'OK "Logged in."\r\n' : 'NO "Authentication failed."\r\n');
        } else if (line === "LISTSCRIPTS") {
          say(Object.keys(st.scripts).map((n) => '"' + n + '"' + (n === st.active ? " ACTIVE" : "") + "\r\n").join("") + "OK\r\n");
        } else if ((m = /^GETSCRIPT "([^"]+)"$/.exec(line))) {
          const sc = st.scripts[m[1]];
          if (sc === undefined) say('NO "no such script"\r\n');
          else { const b = Buffer.from(sc, "utf8"); sock.write(Buffer.concat([Buffer.from("{" + b.length + "}\r\n"), b, Buffer.from("\r\nOK\r\n")])); }
        } else if ((m = /^PUTSCRIPT "([^"]+)" \{\d+\+\}$/.exec(line))) {
          if (/syntax-error/.test(data)) say('NO "line 3: error: unknown command"\r\n');
          else { st.scripts[m[1]] = data; say("OK\r\n"); }
        } else if ((m = /^SETACTIVE "([^"]*)"$/.exec(line))) { st.active = m[1]; say("OK\r\n"); }
        else if (line === "LOGOUT") { say('OK "bye"\r\n'); sock.end(); }
        else say('NO "unknown"\r\n');
      }
    });
  });
  return new Promise((res) => srv.listen(0, "127.0.0.1", () => res({ srv, st })));
}
function wrap(s) {
  const w = Duplex.toWeb(s);
  return { readable: w.readable, writable: w.writable, close() { s.destroy(); }, startTls() { return wrap(s); } };
}

test("relay: sieve check / put / off over ManageSieve (STARTTLS, SASL PLAIN)", async () => {
  const core = await import("../relay/core.js");
  const pass = "πάσ\"word";
  const sv = await sieveServer({ user: "chris@pmail.gr", pass, scripts: { roundcube: "keep;", "Φίλτρα": "keep;" }, active: "roundcube" });
  const bare = await sieveServer({ user: "chris@pmail.gr", pass, noTls: true });
  const seen = [];
  const connectFn = (host, port, mode) => new Promise((res, rej) => {
    seen.push(host + ":" + port + ":" + mode);
    const s = net.connect({ host: "127.0.0.1", port: (host === "plain.example.gr" ? bare : sv).srv.address().port }, () => res(wrap(s)));
    s.on("error", rej);
  });
  const acct = { host: "mail.pmail.gr", port: 993, sec: "tls", user: "chris@pmail.gr", pass };
  let ip = 0;
  const post = (body) => core.handle(new Request("https://relay.test/v1", { method: "POST",
    headers: { Origin: "https://useoros.online", "CF-Connecting-IP": "9.9.9." + (++ip) }, body: JSON.stringify(body) }), {}, connectFn)
    .then((r) => r.json());
  try {
    assert.equal((await post({ op: "sieve", acct, act: "nope" })).error.msg, "invalid act");
    assert.equal((await post({ op: "sieve", acct, act: "put", script: "" })).error.msg, "invalid script");
    assert.equal((await post({ op: "sieve", acct, act: "check", host: "localhost" })).error.msg, "invalid sieve-host");
    assert.equal((await post({ op: "sieve", acct, act: "put", script: "x".repeat(33 * 1024) })).error.msg, "invalid script");

    let r = await post({ op: "sieve", acct, act: "check" });
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(r.data, { impl: "Dovecot Pigeonhole", ext: ["fileinto", "imap4flags", "vacation", "date", "relational"],
      scripts: [{ name: "roundcube", active: true }, { name: "Φίλτρα", active: false }], active: "roundcube", ours: null });
    assert.equal(seen[seen.length - 1], "mail.pmail.gr:4190:starttls");
    assert.ok(sv.st.log.indexOf("STARTTLS") >= 0 && sv.st.log.indexOf("STARTTLS") < sv.st.log.findIndex((l) => /^AUTH/.test(l)), "TLS before the password");

    const script = S.build({ ext: r.data.ext, rules: [rule("r00001", "from", "Γιώργος", "move", "INBOX.News")] }).script;
    r = await post({ op: "sieve", acct, act: "put", script });
    assert.deepEqual(r.data, { prev: "roundcube" });
    assert.equal(sv.st.scripts.orOS, script, "UTF-8 script arrives intact");
    assert.equal(sv.st.active, "orOS");
    assert.equal(sv.st.scripts.roundcube, "keep;", "the other script is kept");

    r = await post({ op: "sieve", acct, act: "check", host: "sieve.pmail.gr" });
    assert.equal(r.data.ours, script);
    assert.equal(r.data.active, "orOS");
    assert.equal(seen[seen.length - 1], "sieve.pmail.gr:4190:starttls");

    r = await post({ op: "sieve", acct, act: "put", script: "syntax-error;" });
    assert.equal(r.error.code, "script");
    assert.match(r.error.msg, /unknown command/);

    r = await post({ op: "sieve", acct, act: "off", prev: "roundcube" });
    assert.deepEqual(r.data, { active: "roundcube" });
    assert.equal(sv.st.active, "roundcube");
    r = await post({ op: "sieve", acct, act: "off", prev: "gone" });
    assert.deepEqual(r.data, { active: "roundcube" }, "someone else's active script is left alone");

    r = await post({ op: "sieve", acct: Object.assign({}, acct, { pass: "wrong" }), act: "check" });
    assert.equal(r.error.code, "auth");
    r = await post({ op: "sieve", acct, act: "check", host: "plain.example.gr" });
    assert.equal(r.error.code, "tls", "no STARTTLS → no password sent");
    assert.ok(!bare.st.log.some((l) => /^AUTH/.test(l)));
  } finally {
    sv.srv.close(); bare.srv.close();
  }
});
