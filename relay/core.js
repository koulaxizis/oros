// ============================================================
// orOS Mail relay — request handling (HTTP in, IMAP out)
// Stateless: every POST opens one IMAP session, runs one
// operation, logs out and forgets everything. Nothing is stored,
// nothing is logged. See relay/README.md.
//
// Request:  POST /v1  { op, acct:{host,port,sec,user,pass}, ...args }
//           POST /v1  { op: "web", reqs:[...] }  (Reader, see web.js)
//           POST /v1  { op: "canva", act, ... }  (Atelier, see canva.js)
// Response: { ok:true, data } | { ok:false, error:{ code, msg } }
// ============================================================

import { withSession, ImapError } from "./imap.js";
import { validWeb, runWeb } from "./web.js";
import { validCanva, runCanva, canvaFile, CanvaError } from "./canva.js";

export const LIMITS = {
  bodyBytes: 64 * 1024,        // request JSON
  fetchBytes: 20 * 1024 * 1024, // one message source
  perMinute: 60                 // requests per client IP (per isolate, best effort)
};

const PORTS = { 993: "tls", 143: "starttls" };
const OPS = { check: 1, folders: 1, list: 1, fetch: 1, flag: 1, web: 1, canva: 1 };

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

export function validRequest(b, env) {
  if (!b || typeof b !== "object" || !OPS[b.op]) return "op";
  if (b.op === "web") return validWeb(b);   // Reader: public pages, no account
  if (b.op === "canva") return validCanva(b, allowedOrigins(env));   // Atelier: Canva Connect
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
  if (b.op === "flag") {
    if (!folderArg(b.folder)) return "folder";
    if (!Array.isArray(b.uids) || !b.uids.length || b.uids.length > 500 ||
        !b.uids.every((u) => Number.isInteger(u) && u > 0)) return "uids";
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
  if (text.length > LIMITS.bodyBytes) return fail(413, "bad-request", "request too large", okOrigin);
  let b;
  try { b = JSON.parse(text); } catch (e) { return fail(400, "bad-request", "invalid JSON", okOrigin); }
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

  const acct = { host: b.acct.host.trim().toLowerCase(), port: +b.acct.port, sec: b.acct.sec,
                 user: b.acct.user, pass: b.acct.pass };
  try {
    const data = await withSession(connectFn, acct, async (api) => {
      switch (b.op) {
        case "check": return { folders: (await api.folders(false)).length };
        case "folders": return { folders: await api.folders() };
        case "list": return api.list(b.folder, { limit: b.limit, beforeUid: b.beforeUid, known: b.known });
        case "fetch": return api.fetch(b.folder, b.uid, LIMITS.fetchBytes);
        case "flag": return api.flag(b.folder, b.uids, b.add || [], b.remove || []);
      }
      return null;
    });
    return json(200, { ok: true, data }, okOrigin);
  } catch (e) {
    const code = e instanceof ImapError ? e.code : "proto";
    // The server's own text is passed through (it helps the user);
    // credentials never appear in it.
    return fail(200, code, String(e && e.message || code).slice(0, 300), okOrigin);
  }
}
