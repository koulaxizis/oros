// ============================================================
// orOS relay — "web" operation (Reader app: feeds + discovery)
// Most sites do not send CORS headers, so a page cannot read their
// feeds. This operation fetches public pages for the Reader and
// hands back the bytes. GET only, public host names only, every
// redirect hop checked again, no cookies, size and time limits.
//
// Request:  POST /v1 { op: "web", reqs: [{ url, etag?, lm? }] }   (≤ 10)
// Answer:   { ok: true, data: { res: [ one per request, same order ] } }
//   { status, url (final), type, etag, lm, retry, body (base64) }
//   or { err: "url" | "host" | "port" | "type" | "too-big" | "timeout" |
//              "redirect" | "network" | "budget" }
// status 304 (not modified) has no body.
// ============================================================

import { validHost } from "./core.js";

export const WEB_LIMITS = {
  reqs: 10,                       // per call
  bytes: 5 * 1024 * 1024,         // one response
  totalBytes: 12 * 1024 * 1024,   // all responses of one call
  redirects: 5,
  timeout: 15000,                 // ms, per request
  subrequests: 45                 // Cloudflare free plan allows 50 per call
};

const PORTS = { "": 1, "80": 1, "443": 1, "8080": 1, "8443": 1 };
const UA = "orOS-Reader/1.0 (+https://useoros.online; feed reader)";
const ACCEPT = "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, application/json;q=0.7, */*;q=0.5";

// "" when the address may be fetched, else the reason.
export function checkUrl(u) {
  let x;
  try { x = new URL(u); } catch (e) { return "url"; }
  if (x.protocol !== "https:" && x.protocol !== "http:") return "url";
  if (x.username || x.password) return "url";
  if (!validHost(x.hostname)) return "host";
  if (!PORTS[x.port]) return "port";
  return "";
}

function headerArg(v, max) { return v === undefined || (typeof v === "string" && v.length <= max && !/[\r\n\0]/.test(v)); }

export function validWeb(b) {
  if (!Array.isArray(b.reqs) || !b.reqs.length || b.reqs.length > WEB_LIMITS.reqs) return "reqs";
  for (const r of b.reqs) {
    if (!r || typeof r !== "object" || typeof r.url !== "string" || r.url.length > 2000) return "url";
    if (!headerArg(r.etag, 300) || !headerArg(r.lm, 100)) return "headers";
  }
  return "";
}

function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
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

// Phase 1 (in parallel): request, follow checked redirects, read the
// headers. Phase 2 (in order): read the bodies against the call's byte
// budget, so the same responses always fit or fail.
async function open(r, fetchFn, budget) {
  let url = r.url;
  const bad = checkUrl(url);
  if (bad) return { res: { err: bad } };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), WEB_LIMITS.timeout);
  const done = (res, resp) => ({ res, resp, ctl, timer });
  for (let hop = 0; hop <= WEB_LIMITS.redirects; hop++) {
    if (budget.sub <= 0) return done({ err: "budget" });
    budget.sub--;
    const headers = { "User-Agent": UA, "Accept": ACCEPT };
    if (hop === 0 && r.etag) headers["If-None-Match"] = r.etag;
    if (hop === 0 && r.lm) headers["If-Modified-Since"] = r.lm;
    let resp;
    try {
      resp = await fetchFn(url, { method: "GET", headers, redirect: "manual", signal: ctl.signal });
    } catch (e) {
      return done({ err: ctl.signal.aborted ? "timeout" : "network" });
    }
    if (resp.status >= 300 && resp.status < 400 && resp.status !== 304) {
      cancel(resp);
      const loc = resp.headers.get("Location");
      if (!loc) return done({ err: "redirect" });
      let next;
      try { next = new URL(loc, url).href; } catch (e) { return done({ err: "redirect" }); }
      const why = checkUrl(next);
      if (why) return done({ err: why });
      url = next;
      continue;
    }
    const out = {
      status: resp.status,
      url,
      type: (resp.headers.get("Content-Type") || "").slice(0, 200),
      etag: (resp.headers.get("ETag") || "").slice(0, 300),
      lm: (resp.headers.get("Last-Modified") || "").slice(0, 100),
      retry: (resp.headers.get("Retry-After") || "").slice(0, 40)
    };
    if (resp.status === 304) { cancel(resp); return done(out); }
    if (/^(image|video|audio|font)\//i.test(out.type)) { cancel(resp); return done({ err: "type" }); }
    if (+resp.headers.get("Content-Length") > WEB_LIMITS.bytes) { cancel(resp); return done({ err: "too-big" }); }
    return done(out, resp);
  }
  return done({ err: "redirect" });
}

function cancel(resp) { try { if (resp.body) resp.body.cancel().catch(() => {}); } catch (e) {} }

async function body(o, budget) {
  try {
    if (!o.resp) return o.res;
    if (budget.bytes <= 0) { cancel(o.resp); return { err: "budget" }; }
    let bytes;
    try { bytes = await readCapped(o.resp, Math.min(WEB_LIMITS.bytes, budget.bytes)); }
    catch (e) { return { err: o.ctl.signal.aborted ? "timeout" : "network" }; }
    if (!bytes) return { err: budget.bytes < WEB_LIMITS.bytes ? "budget" : "too-big" };
    budget.bytes -= bytes.length;
    o.res.body = toB64(bytes);
    return o.res;
  } finally {
    if (o.timer) clearTimeout(o.timer);
  }
}

export async function runWeb(b, fetchFn) {
  const budget = { sub: WEB_LIMITS.subrequests, bytes: WEB_LIMITS.totalBytes };
  const opened = await Promise.all(b.reqs.map((r) => open(r, fetchFn, budget)));
  const res = [];
  for (const o of opened) res.push(await body(o, budget));
  return { res };
}
