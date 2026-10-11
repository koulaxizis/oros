// ============================================================
// orOS Mail relay — minimal ManageSieve client (RFC 5804)
// Lets Mail keep its rules and out-of-office reply ON the mail
// server (Sieve, RFC 5228), so they work with orOS closed, on
// servers that offer it (Dovecot / Cyrus based hosts, usually port
// 4190). Gmail, Outlook and Yahoo do not; Mail then keeps running
// the rules on the device.
//
// Same socket contract as imap.js. STARTTLS is required: the
// password never travels in plain text. Login: SASL PLAIN.
// Mail owns ONE script, "orOS"; other scripts are only listed, and
// "off" re-activates the script that was active before (prev).
// ============================================================

import { ImapError, bytesToBin, binToBytes, utf8Bin, tokenize } from "./imap.js";

const CRLF = "\r\n";
export const SIEVE_NAME = "orOS";
export const SIEVE_LIMITS = { scriptBytes: 32 * 1024, timeoutMs: 25000 };   // a request is at most 64 KB

class Conn {
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
  // One line with its literals inlined ("{n}\r\n<n bytes>"), or null.
  take() {
    let pos = 0;
    for (;;) {
      const e = this.buf.indexOf(CRLF, pos);
      if (e < 0) return null;
      const m = /\{(\d+)\+?\}$/.exec(this.buf.slice(pos, e));
      if (!m) {
        const raw = this.buf.slice(0, e);
        this.buf = this.buf.slice(e + 2);
        return raw;
      }
      const need = e + 2 + parseInt(m[1], 10);
      if (this.buf.length < need) return null;
      pos = need;
    }
  }
  async line() {
    for (;;) {
      const raw = this.take();
      if (raw !== null) return raw;
      const r = await this.reader.read();
      if (r.done) throw new ImapError("closed", "connection closed by the server");
      this.buf += bytesToBin(r.value);
      if (this.buf.length > SIEVE_LIMITS.scriptBytes * 2) throw new ImapError("proto", "reply too long");
    }
  }
  // Lines until OK / NO / BYE → { ok, lines: [tokens], text }
  async response() {
    const lines = [];
    for (;;) {
      const raw = await this.line();
      const tok = tokenize(raw);
      const head = String(tok[0] || "").toUpperCase();
      if (head === "OK" || head === "NO" || head === "BYE") {
        // OK [(CODE ...)] ["text"]
        const text = tok.slice(1).filter((x) => typeof x === "string").pop() || "";
        return { ok: head === "OK", bye: head === "BYE", lines, text: fromBin(text).slice(0, 300) };
      }
      lines.push(tok);
    }
  }
  async cmd(text, lit) {
    if (lit !== undefined) await this.write(text + " {" + lit.length + "+}" + CRLF + lit + CRLF);
    else await this.write(text + CRLF);
    const r = await this.response();
    if (r.bye) throw new ImapError("closed", r.text || "the server closed the connection");
    return r;
  }
}

function fromBin(s) { return new TextDecoder().decode(binToBytes(String(s))); }
function q(s) { return "\"" + String(s).replace(/[\\"]/g, "\\$&") + "\""; }

// Capability lines: "NAME" ["value"] → { NAME: "value" }
export function capsOf(lines) {
  const out = {};
  lines.forEach((t) => { if (typeof t[0] === "string") out[t[0].toUpperCase()] = typeof t[1] === "string" ? t[1] : ""; });
  return out;
}

// srv: { host, port, user, pass }. work(api) → result. LOGOUT afterwards.
export async function withSieve(connectFn, srv, work) {
  let sock;
  try { sock = await connectFn(srv.host, srv.port, "starttls"); }
  catch (e) { throw new ImapError("connect", String(e && e.message || e)); }
  const c = new Conn(sock);
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new ImapError("timeout", "the server did not answer in time")), SIEVE_LIMITS.timeoutMs);
  });
  const job = (async () => {
    let greet = await c.response();
    if (!greet.ok) throw new ImapError("connect", greet.text || "refused");
    let caps = capsOf(greet.lines);
    if (caps.STARTTLS === undefined) throw new ImapError("tls", "the server does not offer STARTTLS");
    const st = await c.cmd("STARTTLS");
    if (!st.ok) throw new ImapError("tls", st.text || "STARTTLS refused");
    c.detach();
    if (typeof sock.startTls !== "function") throw new ImapError("tls", "STARTTLS unavailable");
    sock = sock.startTls();
    c.attach(sock);
    c.buf = "";
    // RFC 5804 2.2: the server sends its capabilities again after TLS
    greet = await c.response();
    if (greet.ok && greet.lines.length) caps = capsOf(greet.lines);
    else caps = capsOf((await c.cmd("CAPABILITY")).lines);
    const sasl = String(caps.SASL || "").toUpperCase().split(/\s+/);
    if (sasl.indexOf("PLAIN") < 0) throw new ImapError("auth", "the server offers no password login (SASL PLAIN)");
    const auth = await c.cmd("AUTHENTICATE \"PLAIN\" " + q(btoa("\0" + utf8Bin(srv.user) + "\0" + utf8Bin(srv.pass))));
    if (!auth.ok) throw new ImapError("auth", auth.text || "login refused");
    const api = {
      caps,
      extensions: String(caps.SIEVE || "").toLowerCase().split(/\s+/).filter(Boolean),
      async list() {
        const r = await c.cmd("LISTSCRIPTS");
        if (!r.ok) throw new ImapError("no", r.text);
        return r.lines.filter((t) => typeof t[0] === "string").map((t) => ({
          name: fromBin(t[0]), active: String(t[1] || "").toUpperCase() === "ACTIVE" }));
      },
      async get(name) {
        const r = await c.cmd("GETSCRIPT " + q(utf8Bin(name)));
        if (!r.ok) return null;
        const t = r.lines[0];
        return t && typeof t[0] === "string" ? fromBin(t[0]) : "";
      },
      async put(name, script) {
        const r = await c.cmd("PUTSCRIPT " + q(utf8Bin(name)), utf8Bin(script));
        if (!r.ok) throw new ImapError("script", r.text || "the server refused the script");
      },
      async activate(name) {
        const r = await c.cmd("SETACTIVE " + q(utf8Bin(name)));
        if (!r.ok) throw new ImapError("no", r.text);
      }
    };
    const result = await work(api);
    try { await c.cmd("LOGOUT"); } catch (e) {}
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

// The three things Mail asks for (op "sieve"):
//   act "check" → { impl, ext[], vacation, scripts[{name, active}], ours: script|null, active }
//   act "put"   → uploads b.script as "orOS" and activates it → { prev }
//                 (prev: the script that was active before, if another)
//   act "off"   → activates b.prev when it still exists, else none → { active }
export async function runSieve(connectFn, srv, b) {
  return withSieve(connectFn, srv, async (api) => {
    const scripts = await api.list();
    const active = (scripts.filter((s) => s.active)[0] || {}).name || "";
    if (b.act === "check") {
      const has = scripts.some((s) => s.name === SIEVE_NAME);
      return { impl: String(api.caps.IMPLEMENTATION || "").slice(0, 100), ext: api.extensions.slice(0, 80),
               scripts: scripts.slice(0, 50), active, ours: has ? await api.get(SIEVE_NAME) : null };
    }
    if (b.act === "put") {
      await api.put(SIEVE_NAME, b.script);
      if (active !== SIEVE_NAME) await api.activate(SIEVE_NAME);
      return { prev: active && active !== SIEVE_NAME ? active : "" };
    }
    // off
    const back = b.prev && scripts.some((s) => s.name === b.prev) ? b.prev : "";
    if (active === SIEVE_NAME || !active) await api.activate(back);
    return { active: active === SIEVE_NAME || !active ? back : active };
  });
}
