// ============================================================
// orOS relay — WebDAV pass-through (Sync through WebDAV, wave W3)
// Many WebDAV servers (Synology, ownCloud, Nextcloud without the
// WebAppPassword app) send no CORS headers, so a page cannot talk to
// them. A user who opts in sends the same WebDAV request here instead,
// with the server's address in X-Oros-Target; this forwards it and
// streams the answer back. The sync data is end-to-end encrypted; the
// app password passes through on every request and is never logged or
// stored.
//
// Request:  <METHOD> /dav   X-Oros-Target: https://host[:port]/path
//   METHOD = GET HEAD PUT DELETE MKCOL PROPFIND COPY MOVE, or POST to
//   …/index.php/login/v2 and …/index.php/login/v2/poll only (Nextcloud
//   Login Flow v2; answer capped at 64 KB).
// Answer:   the server's status, body and a short list of headers. A
//   redirect is not followed and not answered as a redirect (the
//   browser would follow it itself): 200 with X-Oros-Status (the 3xx)
//   and X-Oros-Location. Relay refusals carry X-Oros-Error with a fixed
//   code: origin, bad-target, port, method, length, too-big, rate,
//   timeout, upstream.
// ============================================================

import { validHost } from "./core.js";

export const DAV_LIMITS = {
  putBytes: 95 * 1024 * 1024,     // under Cloudflare's 100 MB request body
  loginBytes: 64 * 1024,          // a Login Flow v2 answer
  perMinute: 600,                 // requests per client IP (per isolate, best effort)
  loginPerMinute: 10,
  timeout: 60000,                 // ms until the server's headers arrive
  putTimeout: 300000
};

const PORTS = { "": 1, "443": 1, "5006": 1, "8443": 1, "9443": 1 };
const METHODS = { GET: 1, HEAD: 1, PUT: 1, DELETE: 1, MKCOL: 1, PROPFIND: 1, COPY: 1, MOVE: 1, POST: 1 };
const REQ_HEADERS = ["Authorization", "Content-Type", "Content-Length", "Depth", "Destination",
                     "Overwrite", "If-Match", "If-None-Match", "OCS-APIRequest"];
const RES_HEADERS = ["Content-Type", "Content-Length", "ETag", "Last-Modified", "DAV", "OC-ETag", "OC-FileId"];
const LOGIN_RE = /\/index\.php\/login\/v2(\/poll)?$/;

// The checked target, or the refusal code.
export function davTarget(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch (e) { return { err: "bad-target" }; }
  if (u.protocol !== "https:" || u.username || u.password || u.hash) return { err: "bad-target" };
  if (!validHost(u.hostname)) return { err: "bad-target" };   // also IPv4 / IPv6 literals and local names
  if (!PORTS[u.port]) return { err: "port" };
  return { url: u };
}

function corsOf(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Expose-Headers": RES_HEADERS.concat(["X-Oros-Status", "X-Oros-Location", "X-Oros-Error"]).join(", "),
    "Vary": "Origin"
  };
}

function refuse(status, code, origin) {
  const h = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff", "X-Oros-Error": code };
  if (origin) Object.assign(h, corsOf(origin));
  return new Response(code, { status, headers: h });
}

// ---------- rate limit (best effort, per isolate; its own counters) ----------
const hits = new Map();
function limited(ip, now, login) {
  if (!ip) return false;
  const k = (login ? "l|" : "d|") + ip;
  const h = hits.get(k);
  if (!h || now - h.t > 60000) hits.set(k, { t: now, n: 1 });
  else if (++h.n > (login ? DAV_LIMITS.loginPerMinute : DAV_LIMITS.perMinute)) return true;
  if (hits.size > 5000) hits.clear();
  return false;
}

async function readCapped(resp, max) {
  if (!resp.body) return new Uint8Array(0);
  const reader = resp.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch (e) {} return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function handleDav(request, env, okOrigin, ip, now, fetchFn) {
  if (request.method === "OPTIONS") {
    if (!okOrigin) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: Object.assign(corsOf(okOrigin), {
      "Access-Control-Allow-Methods": Object.keys(METHODS).join(", "),
      "Access-Control-Allow-Headers": REQ_HEADERS.filter((h) => h !== "Content-Length").concat(["X-Oros-Target"]).join(", "),
      "Access-Control-Max-Age": "600"
    }) });
  }
  if (!okOrigin) return refuse(403, "origin", "");
  // A stream that breaks (the browser goes away, the server cuts off)
  // is the relay's "upstream", never an exception out of handle().
  try {
    return await forward(request, okOrigin, ip, now, fetchFn);
  } catch (e) {
    return refuse(502, "upstream", okOrigin);
  }
}

async function forward(request, okOrigin, ip, now, fetchFn) {
  const method = request.method;
  if (!METHODS[method]) return refuse(405, "method", okOrigin);
  const t = davTarget(request.headers.get("X-Oros-Target"));
  if (t.err) return refuse(400, t.err, okOrigin);
  const login = method === "POST";
  if (login && !LOGIN_RE.test(t.url.pathname)) return refuse(405, "method", okOrigin);
  if (limited(ip, now, false) || (login && limited(ip, now, true))) return refuse(429, "rate", okOrigin);

  const h = new Headers();
  for (const name of REQ_HEADERS) {
    const v = request.headers.get(name);
    if (v !== null) h.set(name, v);
  }
  const dest = h.get("Destination");
  if (dest !== null) {
    const d = davTarget(dest);
    if (d.err || d.url.origin !== t.url.origin) return refuse(400, "bad-target", okOrigin);
  }
  const init = { method, headers: h, redirect: "manual" };
  if (method === "PUT") {
    const len = request.headers.get("Content-Length");
    if (len === null || !/^\d+$/.test(len)) return refuse(411, "length", okOrigin);
    if (+len > DAV_LIMITS.putBytes) return refuse(413, "too-big", okOrigin);
    init.body = request.body;
    init.duplex = "half";
  } else if (method === "PROPFIND" || method === "POST") {
    const body = await readCapped(request, DAV_LIMITS.loginBytes);
    if (body === null) return refuse(413, "too-big", okOrigin);
    if (body.length) init.body = body;
    h.delete("Content-Length");
  } else {
    h.delete("Content-Length");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), method === "PUT" ? DAV_LIMITS.putTimeout : DAV_LIMITS.timeout);
  init.signal = ctrl.signal;
  let up;
  try {
    up = await (fetchFn || ((u, o) => fetch(u, o)))(t.url.href, init);
  } catch (e) {
    return refuse(ctrl.signal.aborted ? 504 : 502, ctrl.signal.aborted ? "timeout" : "upstream", okOrigin);
  } finally {
    clearTimeout(timer);
  }

  const out = Object.assign(corsOf(okOrigin), { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  if (up.status >= 300 && up.status < 400 && up.status !== 304) {
    out["X-Oros-Status"] = String(up.status);
    let loc = "";
    try { loc = new URL(up.headers.get("Location") || "", t.url).href; } catch (e) {}
    if (loc) out["X-Oros-Location"] = loc;
    if (up.body) { try { await up.body.cancel(); } catch (e) {} }
    return new Response(null, { status: 200, headers: out });
  }
  for (const name of RES_HEADERS) {
    const v = up.headers.get(name);
    if (v !== null) out[name] = v;
  }
  if (login) {
    const body = await readCapped(up, DAV_LIMITS.loginBytes);
    if (body === null) return refuse(502, "too-big", okOrigin);
    delete out["Content-Length"];
    return new Response(body, { status: up.status, headers: out });
  }
  const nobody = method === "HEAD" || [101, 204, 205, 304].indexOf(up.status) >= 0;   // new Response() refuses a body on these
  return new Response(nobody ? null : up.body, { status: up.status, headers: out });
}
