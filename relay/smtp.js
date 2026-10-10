// ============================================================
// orOS Mail relay — minimal SMTP submission client (RFC 5321,
// RFC 4954 AUTH, RFC 3207 STARTTLS)
// Same socket contract as imap.js: the caller hands it a
// `connectFn(host, port, mode)`. Port 465 = TLS from the first
// byte, 587 = STARTTLS (required). Never plain text.
//
// The browser builds the whole message (mail/compose.js); the relay
// only checks the envelope, dot-stuffs the data and hands it over.
// ============================================================

import { ImapError, bytesToBin, binToBytes, utf8Bin } from "./imap.js";

const CRLF = "\r\n";

export const SMTP_LIMITS = {
  rcpts: 50,
  messageBytes: 380 * 1024,   // decoded message (base64 in the request)
  timeoutMs: 30000
};

// An envelope address: plain ASCII or UTF-8 local part, no spaces,
// brackets or line breaks. The header display names are the
// browser's business; this is only what goes into MAIL FROM / RCPT TO.
export function validAddr(a) {
  return typeof a === "string" && a.length >= 3 && a.length <= 320 &&
    /^[^\s<>()",;:\\\[\]@]+@[^\s<>()",;:\\\[\]@]+\.[^\s<>()",;:\\\[\]@]+$/.test(a);
}

class Line {
  constructor(sock) { this.attach(sock); this.buf = ""; }
  attach(sock) {
    this.sock = sock;
    this.reader = sock.readable.getReader();
    this.writer = sock.writable.getWriter();
  }
  detach() {
    try { this.reader.releaseLock(); } catch (e) {}
    try { this.writer.releaseLock(); } catch (e) {}
  }
  async write(bin) { await this.writer.write(binToBytes(bin)); }
  // One complete (possibly multi-line) reply: { code, lines[] }.
  async reply() {
    const lines = [];
    for (;;) {
      let e;
      while ((e = this.buf.indexOf(CRLF)) < 0) {
        const r = await this.reader.read();
        if (r.done) throw new ImapError("closed", "connection closed by the server");
        this.buf += bytesToBin(r.value);
        if (this.buf.length > 64 * 1024) throw new ImapError("proto", "reply too long");
      }
      const line = this.buf.slice(0, e);
      this.buf = this.buf.slice(e + 2);
      const m = /^(\d{3})([ -]?)(.*)$/.exec(line);
      if (!m) throw new ImapError("proto", "unexpected reply: " + line.slice(0, 80));
      lines.push(m[3]);
      if (m[2] !== "-") return { code: +m[1], lines, text: lines.join(" ").trim() };
    }
  }
  async cmd(line, expect) {
    await this.write(line + CRLF);
    const r = await this.reply();
    if (expect && expect.indexOf(r.code) < 0) throw smtpError(r);
    return r;
  }
}

function smtpError(r) {
  const text = (r.code + " " + r.text).slice(0, 300);
  if (r.code === 535 || r.code === 534 || r.code === 530) return new ImapError("auth", text);
  if (r.code === 552 || r.code === 523) return new ImapError("too-big", text);
  return new ImapError("no", text);
}

function b64(bin) { return btoa(bin); }

function extensions(lines) {
  const ext = {};
  lines.slice(1).forEach((l) => {
    const p = l.trim().split(/\s+/);
    if (p[0]) ext[p[0].toUpperCase()] = p.slice(1).map((x) => x.toUpperCase());
  });
  return ext;
}

// Lines starting with "." get one more (RFC 5321 4.5.2); the data
// ends with CRLF.CRLF. Bare LF / CR become CRLF.
export function dotStuff(bin) {
  let s = bin.replace(/\r\n|\r|\n/g, CRLF);
  if (!s.endsWith(CRLF)) s += CRLF;
  s = s.replace(/(^|\r\n)\./g, "$1..");
  return s + "." + CRLF;
}

// Connects, authenticates and runs `work(session)`; QUIT afterwards.
// smtp: { host, port, sec, user, pass }
export async function withSmtp(connectFn, smtp, work) {
  const mode = smtp.sec === "starttls" ? "starttls" : "tls";
  let sock;
  try { sock = await connectFn(smtp.host, smtp.port, mode); }
  catch (e) { throw new ImapError("connect", String(e && e.message || e)); }
  const ln = new Line(sock);
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new ImapError("timeout", "the mail server did not answer in time")), SMTP_LIMITS.timeoutMs);
  });
  const job = (async () => {
    const greet = await ln.reply();
    if (greet.code !== 220) throw new ImapError("connect", (greet.code + " " + greet.text).slice(0, 300));
    let ehlo = await ln.cmd("EHLO relay.useoros.online", [250]);
    let ext = extensions(ehlo.lines);
    if (mode === "starttls") {
      if (!ext.STARTTLS) throw new ImapError("tls", "the server does not offer STARTTLS");
      await ln.cmd("STARTTLS", [220]);
      ln.detach();
      if (typeof sock.startTls !== "function") throw new ImapError("tls", "STARTTLS unavailable");
      sock = sock.startTls();
      ln.attach(sock);
      ln.buf = "";
      ehlo = await ln.cmd("EHLO relay.useoros.online", [250]);
      ext = extensions(ehlo.lines);
    }
    const mechs = ext.AUTH || [];
    const user = utf8Bin(smtp.user), pass = utf8Bin(smtp.pass);
    if (mechs.indexOf("PLAIN") >= 0) {
      await ln.cmd("AUTH PLAIN " + b64("\0" + user + "\0" + pass), [235]);
    } else if (mechs.indexOf("LOGIN") >= 0) {
      await ln.cmd("AUTH LOGIN", [334]);
      await ln.cmd(b64(user), [334]);
      await ln.cmd(b64(pass), [235]);
    } else {
      throw new ImapError("auth", "the server offers no password login (AUTH PLAIN / LOGIN)");
    }
    const result = await work({
      ext,
      async send(from, rcpts, bin) {
        const size = ext.SIZE ? " SIZE=" + bin.length : "";
        const utf8 = ext.SMTPUTF8 && /[^\x00-\x7f]/.test(from + rcpts.join("")) ? " SMTPUTF8" : "";
        await ln.cmd("MAIL FROM:<" + utf8Bin(from) + ">" + size + utf8, [250]);
        const refused = [];
        for (const r of rcpts) {
          const res = await ln.cmd("RCPT TO:<" + utf8Bin(r) + ">", null);
          if (res.code !== 250 && res.code !== 251) refused.push(r + ": " + res.code + " " + res.text);
        }
        if (refused.length) {
          try { await ln.cmd("RSET", null); } catch (e) {}
          throw new ImapError("rcpt", ("refused: " + refused.join("; ")).slice(0, 300));
        }
        await ln.cmd("DATA", [354]);
        await ln.write(dotStuff(bin));
        const done = await ln.reply();
        if (done.code !== 250) throw smtpError(done);
        return { ok: true };
      }
    });
    try { await ln.cmd("QUIT", null); } catch (e) {}
    return result;
  })();
  try {
    return await Promise.race([job, timeout]);
  } catch (e) {
    if (e instanceof ImapError) throw e;
    throw new ImapError("proto", String(e && e.message || e));
  } finally {
    clearTimeout(timer);
    job.catch(() => {});
    try { await sock.close(); } catch (e) {}
  }
}
