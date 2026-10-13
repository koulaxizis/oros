// ============================================================
// orOS Mail relay — request handling (HTTP in, IMAP out)
// Stateless: every POST opens one IMAP session, runs one
// operation, logs out and forgets everything. Nothing is stored,
// nothing is logged. See relay/README.md.
//
// Request:  POST /v1  { op, acct:{host,port,sec,user,pass}, ...args }
//           POST /v1  { op: "web", reqs:[...] }  (Reader, see web.js)
//           POST /v1  { op: "canva", act, ... }  (Atelier, see canva.js)
//           POST /v1  { op: "send", acct, smtp, from, rcpt[], raw, sent? }  (SMTP, see smtp.js)
//           POST /v1  { op: "sieve", acct, act, host?, script?, prev? }  (ManageSieve, see sieve.js)
//           POST /v1  { op: "nl", act, k, sec, ... }  (Newsletter, see newsletter.js)
//           POST /v1  { op: "papi", prov, key, dom?, reqs:[...] }  (Newsletter: provider APIs, see papi.js)
//           POST /v1  { op: "ext", p, host, base, ck, cs, reqs:[...] }  (Connected services: a person's own shop, see ext.js)
//           /nl/...   public sign-up form and one-click unsubscribe (newsletter.js)
// Response: { ok:true, data } | { ok:false, error:{ code, msg } }
// ============================================================

import { withSession, ImapError } from "./imap.js";
import { validWeb, runWeb } from "./web.js";
import { validCanva, runCanva, canvaFile, CanvaError } from "./canva.js";
import { withSmtp, validAddr, SMTP_LIMITS } from "./smtp.js";
import { runSieve, SIEVE_LIMITS } from "./sieve.js";
import { validNl, runNl, handleNl, page as nlPage, NlError } from "./newsletter.js";
import { validPapi, runPapi, PAPI_LIMITS } from "./papi.js";
import { validExt, runExt, EXT_LIMITS } from "./ext.js";
import { handleRemote, ROOM_RE } from "./remote.js";

export const LIMITS = {
  bodyBytes: 64 * 1024,        // request JSON
  sendBytes: 14 * 1024 * 1024 + 64 * 1024,   // request JSON of a "send" / "draft" (carries the message, base64)
  fetchBytes: 20 * 1024 * 1024, // one message source
  perMinute: 60                 // requests per client IP (per isolate, best effort)
};

const PORTS = { 993: "tls", 143: "starttls" };
const SMTP_PORTS = { 465: "tls", 587: "starttls" };
const OPS = { check: 1, folders: 1, list: 1, fetch: 1, flag: 1, web: 1, canva: 1, smtpcheck: 1, send: 1,
              move: 1, expunge: 1, create: 1, rename: 1, delete: 1, search: 1, draft: 1, sieve: 1, nl: 1, papi: 1, ext: 1 };
const SIEVE_PORT = 4190;

// ---------- validation ----------
export function validHost(h) {
  if (typeof h !== "string") return false;
  h = h.trim().toLowerCase().replace(/\.$/, "");
  if (h.length < 4 || h.length > 253) return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return false;
  if (/^[0-9.]+$/.test(h)) return false;                 // IPv4 literal
  if (/\.(local|localhost|internal|lan|home|arpa|test|invalid)$/.test(h)) return false;
  return h !== "localhost";
}

function str(v, max) { return typeof v === "string" && v.length > 0 && v.length <= max; }

export function validAccount(a) {
  if (!a || typeof a !== "object") return "acct";
  if (!validHost(a.host)) return "host";
  const port = +a.port;
  if (!PORTS[port]) return "port";
  if (a.sec !== PORTS[port]) return "sec";
  if (!str(a.user, 320) || !str(a.pass, 512)) return "login";
  return "";
}

function folderArg(f) { return str(f, 1000) && !/[\r\n\0]/.test(f); }

export function validSmtp(s) {
  if (!s || typeof s !== "object") return "smtp";
  if (!validHost(s.host)) return "smtp-host";
  const port = +s.port;
  if (!SMTP_PORTS[port]) return "smtp-port";
  if (s.sec !== SMTP_PORTS[port]) return "smtp-sec";
  if (!str(s.user, 320) || !str(s.pass, 512)) return "smtp-login";
  return "";
}

// base64 of at most `max` decoded bytes
function b64Arg(v, max) {
  return typeof v === "string" && v.length > 0 && v.length <= Math.ceil(max / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(v);
}

export function validRequest(b, env) {
  if (!b || typeof b !== "object" || !OPS[b.op]) return "op";
  if (b.op === "web") return validWeb(b);   // Reader: public pages, no account
  if (b.op === "canva") return validCanva(b, allowedOrigins(env));   // Atelier: Canva Connect
  if (b.op === "nl") return validNl(b);   // Newsletter: sign-ups and unsubscribes waiting in D1
  if (b.op === "papi") return validPapi(b);   // Newsletter: provider HTTP APIs
  if (b.op === "ext") return validExt(b);     // Connected services: a person's own shop
  const bad = validAccount(b.acct);
  if (bad) return bad;
  if (b.op === "list") {
    if (!folderArg(b.folder)) return "folder";
    if (b.beforeUid !== undefined && !(Number.isInteger(b.beforeUid) && b.beforeUid > 0)) return "beforeUid";
    if (b.known !== undefined && !(typeof b.known === "string" && /^[0-9:,]{0,20000}$/.test(b.known))) return "known";
  }
  if (b.op === "fetch") {
    if (!folderArg(b.folder)) return "folder";
    if (!(Number.isInteger(b.uid) && b.uid > 0)) return "uid";
  }
  if (b.op === "smtpcheck" || b.op === "send") {
    const s = validSmtp(b.smtp);
    if (s) return s;
  }
  if (b.op === "send") {
    if (!validAddr(b.from)) return "from";
    if (!Array.isArray(b.rcpt) || !b.rcpt.length || b.rcpt.length > SMTP_LIMITS.rcpts || !b.rcpt.every(validAddr)) return "rcpt";
    if (!b64Arg(b.raw, SMTP_LIMITS.messageBytes)) return "raw";
    if (b.sent !== undefined && !folderArg(b.sent)) return "sent";
  }
  if (b.op === "draft") {
    if (!folderArg(b.folder)) return "folder";
    if (!b64Arg(b.raw, SMTP_LIMITS.messageBytes)) return "raw";
    if (b.replace !== undefined && !(Number.isInteger(b.replace) && b.replace > 0)) return "replace";
    if (b.mid !== undefined && !(typeof b.mid === "string" && /^<[^<>\s"\\]{3,250}>$/.test(b.mid))) return "mid";
  }
  if (b.op === "sieve") {
    if (["check", "put", "off"].indexOf(b.act) < 0) return "act";
    if (b.host !== undefined && !validHost(b.host)) return "sieve-host";
    if (b.act === "put" && !(typeof b.script === "string" && b.script.length > 0 &&
        new TextEncoder().encode(b.script).length <= SIEVE_LIMITS.scriptBytes)) return "script";
    if (b.prev !== undefined && !(typeof b.prev === "string" && b.prev.length <= 200 && !/[\r\n\0]/.test(b.prev))) return "prev";
  }
  if (b.op === "flag" || b.op === "move" || b.op === "expunge") {
    if (!folderArg(b.folder)) return "folder";
    if (!Array.isArray(b.uids) || !b.uids.length || b.uids.length > 500 ||
        !b.uids.every((u) => Number.isInteger(u) && u > 0)) return "uids";
  }
  if (b.op === "move" && (!folderArg(b.to) || b.to === b.folder)) return "to";
  if (b.op === "create" && !folderArg(b.folder)) return "folder";
  if (b.op === "rename" || b.op === "delete") {
    // INBOX can be neither renamed nor deleted (RFC 3501 6.3.4, 6.3.5)
    if (!folderArg(b.folder) || /^inbox$/i.test(b.folder)) return "folder";
  }
  if (b.op === "rename" && (!folderArg(b.to) || b.to === b.folder || /^inbox$/i.test(b.to))) return "to";
  if (b.op === "search") {
    if (!folderArg(b.folder)) return "folder";
    if (!str(b.q, 200) || !b.q.trim() || /[\r\n\0]/.test(b.q)) return "q";
    if (b.where !== undefined && ["text", "from", "subject"].indexOf(b.where) < 0) return "where";
    if (b.limit !== undefined && !(Number.isInteger(b.limit) && b.limit > 0 && b.limit <= 100)) return "limit";
  }
  if (b.op === "flag") {
    const fl = (x) => Array.isArray(x) && x.length <= 10 && x.every((f) => typeof f === "string");
    if (!fl(b.add || []) || !fl(b.remove || [])) return "flags";
  }
  return "";
}

// ---------- CORS ----------
function allowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGINS) || "https://useoros.online";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}
function json(status, body, origin) {
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff" };
  if (origin) Object.assign(h, corsHeaders(origin));
  return new Response(JSON.stringify(body), { status, headers: h });
}
function fail(status, code, msg, origin) {
  return json(status, { ok: false, error: { code, msg: msg || code } }, origin);
}

// ---------- rate limit (best effort, per isolate) ----------
const hits = new Map();
function limited(ip, now) {
  if (!ip) return false;
  const h = hits.get(ip);
  if (!h || now - h.t > 60000) { hits.set(ip, { t: now, n: 1 }); }
  else if (++h.n > LIMITS.perMinute) return true;
  if (hits.size > 5000) hits.clear();
  return false;
}

// ---------- entry ----------
export async function handle(request, env, connectFn, now, fetchFn) {
  const origin = request.headers.get("Origin") || "";
  const okOrigin = allowedOrigins(env).indexOf(origin) >= 0 ? origin : "";
  const url = new URL(request.url);

  // Newsletter's public pages: called by any browser or mail client, so
  // no Origin check and no CORS headers.
  if (url.pathname.startsWith("/nl/")) {
    if (limited(request.headers.get("CF-Connecting-IP") || "", now || Date.now())) return nlPage(429, "en", "busy");
    return handleNl(request, env, url, now || Date.now());
  }

  // Studio Remote's meeting rooms (relay/remote.js): WebSockets from orOS only.
  if (url.pathname.startsWith("/rt/")) {
    const m = ROOM_RE.exec(url.pathname);
    if (!m || request.method !== "GET") return new Response("unknown route", { status: 404 });
    if (!okOrigin) return new Response("origin not allowed", { status: 403 });
    if (limited(request.headers.get("CF-Connecting-IP") || "", now || Date.now())) return new Response("too many requests", { status: 429 });
    return handleRemote(request, env, m[1]);
  }

  if (request.method === "OPTIONS") {
    if (!okOrigin) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(okOrigin) });
  }
  if (url.pathname === "/" && request.method === "GET") {
    return new Response("orOS mail relay\n", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (!okOrigin) return fail(403, "origin", "origin not allowed", "");
  if (url.pathname !== "/v1" || request.method !== "POST") return fail(404, "bad-request", "unknown route", okOrigin);
  if (limited(request.headers.get("CF-Connecting-IP") || "", now || Date.now())) {
    return fail(429, "rate", "too many requests", okOrigin);
  }

  let text;
  try { text = await request.text(); } catch (e) { return fail(400, "bad-request", "unreadable body", okOrigin); }
  if (text.length > LIMITS.sendBytes) return fail(413, "bad-request", "request too large", okOrigin);
  let b;
  try { b = JSON.parse(text); } catch (e) { return fail(400, "bad-request", "invalid JSON", okOrigin); }
  if (text.length > LIMITS.bodyBytes && !(b && (b.op === "send" || b.op === "draft"))) {
    // provider API calls carry message bodies too, up to their own cap
    const cap = b && b.op === "papi" ? PAPI_LIMITS.totalBytes : (b && b.op === "ext" ? EXT_LIMITS.reqs * EXT_LIMITS.reqBytes * 2 : 0);
    if (!(text.length <= cap + LIMITS.bodyBytes)) return fail(413, "bad-request", "request too large", okOrigin);
  }
  const bad = validRequest(b, env);
  if (bad) return fail(400, "bad-request", "invalid " + bad, okOrigin);

  if (b.op === "web") {
    try {
      const data = await runWeb(b, fetchFn || ((u, o) => fetch(u, o)));
      return json(200, { ok: true, data }, okOrigin);
    } catch (e) {
      return fail(200, "proto", String(e && e.message || "proto").slice(0, 300), okOrigin);
    }
  }

  if (b.op === "canva") {
    try {
      if (b.act === "file") return await canvaFile(b, fetchFn || ((u, o) => fetch(u, o)), corsHeaders(okOrigin));
      const data = await runCanva(b, env, fetchFn || ((u, o) => fetch(u, o)));
      return json(200, { ok: true, data }, okOrigin);
    } catch (e) {
      const code = e instanceof CanvaError ? e.code : "proto";
      return fail(200, code, String(e && e.message || code).slice(0, 300), okOrigin);
    }
  }

  if (b.op === "papi") {
    try {
      const data = await runPapi(b, fetchFn || ((u, o) => fetch(u, o)));
      return json(200, { ok: true, data }, okOrigin);
    } catch (e) {
      return fail(200, "proto", "provider call failed", okOrigin);       // never the message: it may carry the key
    }
  }

  if (b.op === "ext") {
    try {
      const data = await runExt(b, fetchFn || ((u, o) => fetch(u, o)));
      return json(200, { ok: true, data }, okOrigin);
    } catch (e) {
      return fail(200, "proto", "shop call failed", okOrigin);           // never the message: it may carry the keys
    }
  }

  if (b.op === "nl") {
    try {
      const data = await runNl(b, env, now || Date.now());
      return json(200, { ok: true, data }, okOrigin);
    } catch (e) {
      if (e instanceof NlError) return fail(e.status, e.code, e.message, okOrigin);
      return fail(200, "proto", String(e && e.message || "proto").slice(0, 300), okOrigin);
    }
  }

  const acct = { host: b.acct.host.trim().toLowerCase(), port: +b.acct.port, sec: b.acct.sec,
                 user: b.acct.user, pass: b.acct.pass };

  if (b.op === "sieve") {
    // Same login as IMAP; the host defaults to the IMAP host, port 4190.
    const srv = { host: (b.host || acct.host).trim().toLowerCase(), port: SIEVE_PORT, user: acct.user, pass: acct.pass };
    try {
      const data = await runSieve(connectFn, srv, b);
      return json(200, { ok: true, data }, okOrigin);
    } catch (e) {
      const code = e instanceof ImapError ? e.code : "proto";
      return fail(200, code, String(e && e.message || code).slice(0, 300), okOrigin);
    }
  }

  if (b.op === "smtpcheck" || b.op === "send") {
    const smtp = { host: b.smtp.host.trim().toLowerCase(), port: +b.smtp.port, sec: b.smtp.sec,
                   user: b.smtp.user, pass: b.smtp.pass };
    let bin = "";
    try {
      if (b.op === "send") bin = atob(b.raw);
      await withSmtp(connectFn, smtp, async (s) => {
        if (b.op === "send") await s.send(b.from, b.rcpt, bin);
      });
    } catch (e) {
      const code = e instanceof ImapError ? e.code : "proto";
      return fail(200, code, String(e && e.message || code).slice(0, 300), okOrigin);
    }
    if (b.op === "smtpcheck") return json(200, { ok: true, data: { ok: true } }, okOrigin);
    // The message is out. Filing a copy in Sent is best effort: a
    // failure there is reported, never turned into "not sent".
    let appended = false, appendErr = "";
    if (b.sent) {
      try {
        await withSession(connectFn, acct, (api) => api.append(b.sent, bin, ["\\Seen"]), { timeoutMs: 60000 });
        appended = true;
      } catch (e) { appendErr = String(e && e.message || "append failed").slice(0, 200); }
    }
    return json(200, { ok: true, data: { sent: true, appended, appendErr } }, okOrigin);
  }

  try {
    const data = await withSession(connectFn, acct, async (api) => {
      switch (b.op) {
        case "check": return { folders: (await api.folders(false)).length };
        case "folders": return { folders: await api.folders() };
        case "list": return api.list(b.folder, { limit: b.limit, beforeUid: b.beforeUid, known: b.known });
        case "fetch": return api.fetch(b.folder, b.uid, LIMITS.fetchBytes);
        case "flag": return api.flag(b.folder, b.uids, b.add || [], b.remove || []);
        case "move": return api.move(b.folder, b.uids, b.to);
        case "expunge": return api.expunge(b.folder, b.uids);
        case "create": return api.create(b.folder);
        case "rename": return api.rename(b.folder, b.to);
        case "delete": return api.remove(b.folder);
        case "search": return api.search(b.folder, b.q, b.where, b.limit);
        case "draft": return api.saveDraft(b.folder, atob(b.raw), b.replace, b.mid);
      }
      return null;
    }, b.op === "draft" ? { timeoutMs: 60000 } : undefined);   // a draft may carry files
    return json(200, { ok: true, data }, okOrigin);
  } catch (e) {
    const code = e instanceof ImapError ? e.code : "proto";
    // The server's own text is passed through (it helps the user);
    // credentials never appear in it.
    return fail(200, code, String(e && e.message || code).slice(0, 300), okOrigin);
  }
}
