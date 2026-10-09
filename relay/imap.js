// ============================================================
// orOS Mail relay — minimal IMAP4rev1 client (RFC 3501)
// Runs inside the Cloudflare Worker (relay/worker.js) and in the
// Node tests. It never touches the network itself: the caller hands
// it a `connectFn(host, port, mode)` that returns a socket shaped
// like Cloudflare's `connect()` result:
//   { readable: ReadableStream<Uint8Array>,
//     writable: WritableStream<Uint8Array>,
//     startTls(): socket,            (mode "starttls" only)
//     close(): Promise|void }
//
// Bytes are handled as "binary strings" (one char = one byte,
// latin1) so literal lengths count bytes. Message sources and header
// blocks leave this module base64-encoded; the browser decodes the
// charsets (mail/mime.js).
// ============================================================

const CRLF = "\r\n";

export class ImapError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

// ---------- bytes <-> binary strings ----------
export function bytesToBin(u8) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return s;
}
export function binToBytes(s) {
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  return u8;
}
export function utf8Bin(str) { return bytesToBin(new TextEncoder().encode(String(str))); }
export function binToB64(s) { return btoa(s); }

// ---------- response tokenizer ----------
// Parses one complete response (literals already inlined as
// "{n}\r\n<n bytes>") into values: string atoms, strings, null
// (NIL), arrays (parenthesized lists).
export function tokenize(raw, start) {
  let i = start || 0;
  const out = [];
  const stack = [out];
  const n = raw.length;
  while (i < n) {
    const c = raw[i];
    if (c === " ") { i++; continue; }
    if (c === "\r" || c === "\n") { i++; continue; }
    if (c === "(") { const l = []; stack[stack.length - 1].push(l); stack.push(l); i++; continue; }
    if (c === ")") { if (stack.length > 1) stack.pop(); i++; continue; }
    if (c === "\"") {
      let s = "";
      i++;
      while (i < n && raw[i] !== "\"") {
        if (raw[i] === "\\" && i + 1 < n) i++;
        s += raw[i++];
      }
      i++;
      stack[stack.length - 1].push(s);
      continue;
    }
    if (c === "{") {
      const close = raw.indexOf("}", i);
      const len = parseInt(raw.slice(i + 1, close), 10);
      let p = close + 1;
      if (raw[p] === "\r") p++;
      if (raw[p] === "\n") p++;
      stack[stack.length - 1].push(raw.substr(p, len));
      i = p + len;
      continue;
    }
    // atom; a "[" opens a section that may contain spaces and parens
    let s = "";
    let depth = 0;
    while (i < n) {
      const d = raw[i];
      if (depth === 0 && (d === " " || d === "(" || d === ")" || d === "\r" || d === "\n")) break;
      if (d === "[") depth++;
      else if (d === "]" && depth > 0) depth--;
      s += d;
      i++;
    }
    stack[stack.length - 1].push(s === "NIL" ? null : s);
  }
  return out;
}

// ---------- sequence sets ----------
export function compressUids(uids) {
  const a = uids.slice().sort((x, y) => x - y);
  const parts = [];
  let i = 0;
  while (i < a.length) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    parts.push(i === j ? String(a[i]) : a[i] + ":" + a[j]);
    i = j + 1;
  }
  return parts.join(",");
}
export function expandUids(set) {
  const out = [];
  String(set || "").split(",").forEach((p) => {
    if (!p) return;
    const m = p.split(":");
    const a = parseInt(m[0], 10), b = m.length > 1 ? parseInt(m[1], 10) : a;
    if (!(a > 0) || !(b > 0)) return;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (hi - lo > 1000000) return;
    for (let k = lo; k <= hi; k++) out.push(k);
  });
  return out;
}

// ---------- quoting ----------
// Returns [text, literals]: printable ASCII is quoted; anything else
// (8-bit, CR/LF) goes as a literal so passwords of any shape work.
// Folder names travel as the binary strings the server sent (`bin`).
function arg(value, bin) {
  bin = bin ? String(value) : utf8Bin(value);
  if (/^[\x20-\x7e]*$/.test(bin)) {
    return { text: "\"" + bin.replace(/[\\"]/g, "\\$&") + "\"", lit: null };
  }
  return { text: "{" + bin.length + "}", lit: bin };
}

// ---------- connection ----------
class Conn {
  constructor(sock) {
    this.attach(sock);
    this.buf = "";
    this.tagN = 0;
  }
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
  async fill() {
    const r = await this.reader.read();
    if (r.done) throw new ImapError("closed", "connection closed by the server");
    this.buf += bytesToBin(r.value);
  }
  // One complete response (with inlined literals), or null when the
  // buffer is not complete yet.
  take() {
    let pos = 0;
    for (;;) {
      const e = this.buf.indexOf(CRLF, pos);
      if (e < 0) return null;
      const line = this.buf.slice(pos, e);
      const m = /\{(\d+)\+?\}$/.exec(line);
      if (!m) {
        const raw = this.buf.slice(0, e + 2);
        this.buf = this.buf.slice(e + 2);
        return raw;
      }
      const need = e + 2 + parseInt(m[1], 10);
      if (this.buf.length < need) return null;
      pos = need;
    }
  }
  async next() {
    for (;;) {
      const raw = this.take();
      if (raw !== null) return raw;
      await this.fill();
    }
  }
  // Sends a command, answering "+" continuations with the literals,
  // and collects untagged responses until the tagged completion.
  async run(parts, opts) {
    const tag = "A" + (++this.tagN);
    const segs = [];
    let cur = tag + " ";
    parts.forEach((p) => {
      if (typeof p === "string") { cur += p; return; }
      cur += p.text;
      if (p.lit !== null) { segs.push(cur); segs.push(p.lit); cur = ""; }
    });
    segs.push(cur);
    // segs: [line-ending-with-{n}, literal, line..., literal, tail]
    await this.write(segs[0] + CRLF);
    let si = 1;
    const untagged = [];
    for (;;) {
      const raw = await this.next();
      if (raw[0] === "+") {
        if (si >= segs.length) throw new ImapError("proto", "unexpected continuation");
        const lit = segs[si++];
        const rest = segs[si++] || "";
        await this.write(lit + rest + CRLF);
        continue;
      }
      if (raw.startsWith(tag + " ")) {
        const body = raw.slice(tag.length + 1).replace(/\r\n$/, "");
        const sp = body.indexOf(" ");
        const status = (sp < 0 ? body : body.slice(0, sp)).toUpperCase();
        const text = sp < 0 ? "" : body.slice(sp + 1);
        if (status !== "OK" && !(opts && opts.allowNo)) {
          throw new ImapError(status === "NO" ? "no" : "bad", text);
        }
        return { status, text, untagged };
      }
      if (raw[0] === "*") {
        untagged.push(raw);
        if (/^\* BYE/i.test(raw) && !(opts && opts.bye)) {
          throw new ImapError("closed", raw.slice(6).trim());
        }
      }
    }
  }
}

// Untagged helpers
function parseUntagged(raw) {
  // "* <rest>" → tokens of the rest; status responses keep the text.
  const head = /^\* (OK|NO|BAD|BYE|PREAUTH)\b ?(.*)\r\n$/is.exec(raw);
  if (head) return { kind: head[1].toUpperCase(), text: head[2] };
  return { kind: "data", tok: tokenize(raw, 2) };
}

// ---------- session ----------
// Opens a connection, authenticates, runs `work(api)`, logs out.
export async function withSession(connectFn, acct, work, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 25000;
  const mode = acct.sec === "starttls" ? "starttls" : "tls";
  let sock;
  try {
    sock = await connectFn(acct.host, acct.port, mode);
  } catch (e) {
    throw new ImapError("connect", String(e && e.message || e));
  }
  const conn = new Conn(sock);
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new ImapError("timeout", "the mail server did not answer in time")), timeoutMs);
  });
  const job = (async () => {
    const greet = await conn.next();
    if (/^\* BYE/i.test(greet)) throw new ImapError("connect", greet.slice(6).trim());
    let caps = capsFrom(greet);
    if (mode === "starttls") {
      if (!caps) caps = await capability(conn);
      if (caps.indexOf("STARTTLS") < 0) throw new ImapError("tls", "the server does not offer STARTTLS");
      await conn.run(["STARTTLS"]);
      conn.detach();
      if (typeof sock.startTls !== "function") throw new ImapError("tls", "STARTTLS unavailable");
      sock = sock.startTls();
      conn.attach(sock);
      conn.buf = "";
      caps = null;
    }
    if (!/^\* PREAUTH/i.test(greet)) {
      if (!caps) caps = await capability(conn);
      if (caps.indexOf("LOGINDISABLED") >= 0) throw new ImapError("auth", "the server refuses plain login");
      try {
        await conn.run(["LOGIN ", arg(acct.user), " ", arg(acct.pass)]);
      } catch (e) {
        if (e.code === "no" || e.code === "bad") throw new ImapError("auth", e.message);
        throw e;
      }
    }
    const api = makeApi(conn);
    const result = await work(api);
    try { await conn.run(["LOGOUT"], { bye: true, allowNo: true }); } catch (e) {}
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

function capsFrom(greet) {
  const m = /\[CAPABILITY ([^\]]*)\]/i.exec(greet);
  return m ? m[1].toUpperCase().split(" ") : null;
}
async function capability(conn) {
  const r = await conn.run(["CAPABILITY"]);
  let caps = [];
  r.untagged.forEach((u) => {
    const m = /^\* CAPABILITY (.*)\r\n$/i.exec(u);
    if (m) caps = m[1].toUpperCase().split(" ");
  });
  return caps;
}

// ---------- operations ----------
const HDR_FIELDS = "FROM TO CC REPLY-TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES CONTENT-TYPE";

function makeApi(conn) {
  async function select(folder, write) {
    const r = await conn.run([write ? "SELECT " : "EXAMINE ", arg(folder, true)]);
    const info = { exists: 0, uidvalidity: 0, uidnext: 0 };
    r.untagged.forEach((u) => {
      let m = /^\* (\d+) EXISTS/i.exec(u);
      if (m) info.exists = +m[1];
      m = /\[UIDVALIDITY (\d+)\]/i.exec(u);
      if (m) info.uidvalidity = +m[1];
      m = /\[UIDNEXT (\d+)\]/i.exec(u);
      if (m) info.uidnext = +m[1];
    });
    return info;
  }

  function fetchItems(untagged) {
    const out = [];
    untagged.forEach((u) => {
      if (!/^\* \d+ FETCH /i.test(u)) return;
      const tok = tokenize(u, 2);
      const list = tok[2];
      if (!Array.isArray(list)) return;
      const item = {};
      for (let k = 0; k + 1 < list.length; k += 2) {
        const key = String(list[k]).toUpperCase();
        item[key.replace(/\.PEEK/, "")] = list[k + 1];
      }
      out.push(item);
    });
    return out;
  }

  return {
    // counts = false: the LIST alone (login test).
    async folders(counts) {
      const r = await conn.run(["LIST \"\" \"*\""]);
      const out = [];
      r.untagged.forEach((u) => {
        const p = parseUntagged(u);
        if (p.kind !== "data" || String(p.tok[0]).toUpperCase() !== "LIST") return;
        const flags = Array.isArray(p.tok[1]) ? p.tok[1].map(String) : [];
        const name = p.tok[3];
        if (typeof name !== "string") return;
        out.push({ name, delim: p.tok[2] || "", flags });
      });
      if (counts === false) return out;
      // Unseen / total counts (selectable folders only, capped)
      const sel = out.filter((f) => !f.flags.some((x) => /^\\Noselect$/i.test(x) || /^\\NonExistent$/i.test(x)));
      for (const f of sel.slice(0, 60)) {
        try {
          const s = await conn.run(["STATUS ", arg(f.name, true), " (MESSAGES UNSEEN)"], { allowNo: true });
          s.untagged.forEach((u) => {
            const m = /MESSAGES (\d+)/i.exec(u), n = /UNSEEN (\d+)/i.exec(u);
            if (m) f.total = +m[1];
            if (n) f.unseen = +n[1];
          });
        } catch (e) { if (e.code !== "no") throw e; }
      }
      return out;
    },

    // Newest `limit` messages (or the `limit` before `beforeUid`):
    // flags, date, size and a header block; plus the folder's whole
    // UID set (the client prunes what is gone) and fresh flags for
    // the UIDs it already caches (`known`).
    async list(folder, opts) {
      const limit = Math.max(1, Math.min(200, opts.limit || 50));
      const info = await select(folder, false);
      let all = [];
      if (info.exists > 0) {
        const s = await conn.run(["UID SEARCH ALL"]);
        s.untagged.forEach((u) => {
          const m = /^\* SEARCH ?(.*)\r\n$/i.exec(u);
          if (m && m[1]) m[1].trim().split(/\s+/).forEach((x) => { const v = +x; if (v > 0) all.push(v); });
        });
      }
      all.sort((a, b) => a - b);
      const pool = opts.beforeUid ? all.filter((u) => u < opts.beforeUid) : all;
      const want = pool.slice(-limit);
      const msgs = [];
      if (want.length) {
        const r = await conn.run(["UID FETCH " + compressUids(want) +
          " (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (" + HDR_FIELDS + ")])"]);
        fetchItems(r.untagged).forEach((it) => {
          const uid = +it.UID;
          if (!(uid > 0)) return;
          let hdr = "";
          Object.keys(it).forEach((k) => { if (k.indexOf("BODY[HEADER") === 0) hdr = it[k] || ""; });
          msgs.push({
            uid,
            flags: Array.isArray(it.FLAGS) ? it.FLAGS.map(String) : [],
            date: it.INTERNALDATE || "",
            size: +it["RFC822.SIZE"] || 0,
            hdr: binToB64(hdr)
          });
        });
      }
      const flags = {};
      const allSet = {};
      all.forEach((u) => { allSet[u] = 1; });
      const known = expandUids(opts.known || "").filter((u) => allSet[u] && want.indexOf(u) < 0).slice(0, 2000);
      if (known.length) {
        const r = await conn.run(["UID FETCH " + compressUids(known) + " (UID FLAGS)"]);
        fetchItems(r.untagged).forEach((it) => {
          if (+it.UID > 0) flags[+it.UID] = Array.isArray(it.FLAGS) ? it.FLAGS.map(String) : [];
        });
      }
      msgs.sort((a, b) => b.uid - a.uid);
      return {
        uidvalidity: info.uidvalidity, exists: info.exists,
        uids: compressUids(all), msgs, flags,
        more: pool.length > want.length
      };
    },

    async fetch(folder, uid, maxBytes) {
      const info = await select(folder, false);
      const r1 = await conn.run(["UID FETCH " + uid + " (UID RFC822.SIZE FLAGS)"]);
      const meta = fetchItems(r1.untagged).filter((it) => +it.UID === uid)[0];
      if (!meta) throw new ImapError("gone", "the message no longer exists");
      const size = +meta["RFC822.SIZE"] || 0;
      if (size > maxBytes) throw new ImapError("too-big", "message larger than " + maxBytes + " bytes");
      const r2 = await conn.run(["UID FETCH " + uid + " (UID BODY.PEEK[])"]);
      const it = fetchItems(r2.untagged).filter((x) => +x.UID === uid)[0];
      const src = it && typeof it["BODY[]"] === "string" ? it["BODY[]"] : null;
      if (src === null) throw new ImapError("gone", "the message no longer exists");
      return { uid, uidvalidity: info.uidvalidity, size, raw: binToB64(src) };
    },

    async flag(folder, uids, add, remove) {
      const info = await select(folder, true);
      const set = compressUids(uids);
      const ok = (f) => /^\\?[A-Za-z$][A-Za-z0-9$_-]{0,40}$/.test(f);
      const a = add.filter(ok), r = remove.filter(ok);
      if (a.length) await conn.run(["UID STORE " + set + " +FLAGS.SILENT (" + a.join(" ") + ")"]);
      if (r.length) await conn.run(["UID STORE " + set + " -FLAGS.SILENT (" + r.join(" ") + ")"]);
      return { uidvalidity: info.uidvalidity };
    }
  };
}

