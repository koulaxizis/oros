// ============================================================
// orOS relay — "papi" operation (Newsletter: provider HTTP APIs)
// Brevo, Postmark, SendGrid and Mailgun don't answer browsers (no
// CORS). This operation forwards a few exact requests to a FIXED base
// address per provider with the provider's own auth header. The key is
// used for this call only: never stored, logged or echoed.
//
// Request:  POST /v1 { op: "papi", prov, key, dom?, reqs: [...] }   (≤ 40)
//   req: { m: "GET" } | { m: "POST", body (JSON text) }
//        | { m: "POST", type: "multipart/form-data", to, mime (base64) }  (Mailgun)
//   with path matching the provider's allowlist exactly.
// Answer:   { ok: true, data: { res: [ one per request, same order ] } }
//   { status, body (text ≤ 256 KB) } | { status, err: "too-big" }
//   | { err: "timeout" | "network" }
// No redirects are followed (a 3xx comes back as its status).
// ============================================================

import { validHost } from "./core.js";
import { validAddr } from "./smtp.js";

export const PAPI_LIMITS = {
  reqs: 40,
  reqBytes: 2 * 1024 * 1024,        // one request body (decoded)
  totalBytes: 4 * 1024 * 1024,      // all request bodies of one call
  bodyOut: 256 * 1024,              // one response body
  totalOut: 2 * 1024 * 1024,        // all response bodies of one call
  concurrency: 6,                   // Workers' open connections per invocation
  timeout: 15000,                   // ms, per request
  budget: 25000                     // ms, the whole call
};

const NUM = /^[0-9]{1,13}$/;
const DATE = /^[0-9T:.Z+-]{1,40}$/;
const WORD = /^[A-Za-z]{1,30}$/;
const SORT = /^(asc|desc)$/;

// Per provider: base, auth header, and the allowed [method, path regex,
// {query parameter: value regex}]. "%DOM%" is the Mailgun domain.
const PROVS = {
  brevo: {
    base: "https://api.brevo.com/v3",
    auth: (k) => ["api-key", k],
    allow: [
      ["POST", /^\/smtp\/email$/, null],
      ["GET", /^\/account$/, null],
      ["GET", /^\/smtp\/statistics\/events$/, { event: /^(hardBounces|softBounces|spam|unsubscribed|blocked|invalid)$/, limit: NUM, offset: NUM,
                                                startDate: DATE, endDate: DATE, sort: SORT }]
    ]
  },
  postmark: {
    base: "https://api.postmarkapp.com",
    auth: (k) => ["X-Postmark-Server-Token", k],
    allow: [
      ["POST", /^\/email$/, null],
      ["POST", /^\/email\/batch$/, null],
      ["GET", /^\/server$/, null],
      ["GET", /^\/bounces$/, { count: NUM, offset: NUM, fromdate: DATE, todate: DATE, type: WORD }]
    ]
  },
  sendgrid: {
    base: "https://api.sendgrid.com/v3",
    auth: (k) => ["Authorization", "Bearer " + k],
    allow: [
      ["POST", /^\/mail\/send$/, null],
      ["GET", /^\/user\/profile$/, null],
      ["GET", /^\/suppression\/(bounces|spam_reports|unsubscribes)$/, { start_time: NUM, end_time: NUM, limit: NUM, offset: NUM }]
    ]
  },
  mailgun: {
    base: "https://api.mailgun.net/v3",
    auth: (k) => ["Authorization", "Basic " + btoa("api:" + k)],
    allow: [
      ["POST", /^\/%DOM%\/messages\.mime$/, null],
      ["GET", /^\/domains\/%DOM%$/, null],
      ["GET", /^\/%DOM%\/(bounces|complaints|unsubscribes)$/, { limit: NUM }]
    ]
  }
};
PROVS["mailgun-eu"] = Object.assign({}, PROVS.mailgun, { base: "https://api.eu.mailgun.net/v3" });

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function b64Len(s) { return Math.floor(s.length * 3 / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0); }

// "" when the request may go out, else the reason (never the key).
function checkReq(p, dom, r) {
  if (!r || typeof r !== "object") return "req";
  if (r.m !== "GET" && r.m !== "POST") return "method";
  if (typeof r.path !== "string" || r.path.length > 500 || r.path[0] !== "/") return "path";
  if (/[%#\\\s@]/.test(r.path) || r.path.indexOf("//") >= 0 || /(^|\/)\.\.?(\/|$|\?)/.test(r.path)) return "path";
  const qi = r.path.indexOf("?");
  const path = qi < 0 ? r.path : r.path.slice(0, qi), query = qi < 0 ? "" : r.path.slice(qi + 1);
  const rule = p.allow.find((a) => a[0] === r.m && new RegExp(a[1].source.replace(/%DOM%/g, esc(dom || "\u0000"))).test(path));
  if (!rule) return "path";
  if (query) {
    if (!rule[2]) return "query";
    const seen = {};
    for (const kv of query.split("&")) {
      const i = kv.indexOf("=");
      const k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? "" : kv.slice(i + 1);
      if (!rule[2][k] || seen[k] || !rule[2][k].test(v)) return "query";
      seen[k] = 1;
    }
  }
  if (r.m === "GET") return r.body === undefined && r.mime === undefined ? "" : "body";
  if (r.type === "multipart/form-data") {
    if (!/messages\.mime$/.test(path)) return "type";
    if (!validAddr(r.to)) return "to";
    if (typeof r.mime !== "string" || !r.mime.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(r.mime) || b64Len(r.mime) > PAPI_LIMITS.reqBytes) return "mime";
    return "";
  }
  if (r.type !== undefined && r.type !== "application/json") return "type";
  if (/messages\.mime$/.test(path)) return "type";
  if (typeof r.body !== "string" || !r.body.length || r.body.length > PAPI_LIMITS.reqBytes) return "body";
  return "";
}

export function validPapi(b) {
  const p = PROVS[b.prov];
  if (!p || !Object.prototype.hasOwnProperty.call(PROVS, b.prov)) return "prov";
  if (typeof b.key !== "string" || !/^[\x21-\x7e]{1,200}$/.test(b.key)) return "key";
  const mg = b.prov === "mailgun" || b.prov === "mailgun-eu";
  if (mg ? !validHost(b.dom) : b.dom !== undefined) return "dom";
  if (!Array.isArray(b.reqs) || !b.reqs.length || b.reqs.length > PAPI_LIMITS.reqs) return "reqs";
  let total = 0;
  for (const r of b.reqs) {
    const bad = checkReq(p, mg ? b.dom.toLowerCase() : "", r);
    if (bad) return bad;
    total += r.mime ? b64Len(r.mime) : (r.body ? r.body.length : 0);
  }
  if (total > PAPI_LIMITS.totalBytes) return "too-big";
  return "";
}

// The address, re-checked after URL parsing (catches any normalisation).
function target(p, path) {
  const base = new URL(p.base);
  const u = new URL(p.base + path);
  if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname) || u.href !== p.base + path) return null;
  return u.href;
}

async function readCapped(res, max) {
  const reader = res.body ? res.body.getReader() : null;
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { try { await reader.cancel(); } catch (e) {} return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return new TextDecoder().decode(all);
}

// fetchFn(url, init) → Response; now() → ms (tests drive both).
export async function runPapi(b, fetchFn, now) {
  now = now || (() => Date.now());
  const p = PROVS[b.prov];
  const auth = p.auth(b.key);
  const start = now();
  const out = new Array(b.reqs.length);
  let outBytes = 0, next = 0;
  async function one(i) {
    const r = b.reqs[i];
    const left = PAPI_LIMITS.budget - (now() - start);
    if (left <= 0) { out[i] = { err: "timeout" }; return; }
    const url = target(p, r.path);
    if (!url) { out[i] = { err: "network" }; return; }
    const headers = { Accept: "application/json" };
    headers[auth[0]] = auth[1];
    let body;
    if (r.m === "POST" && r.type === "multipart/form-data") {
      const bin = atob(r.mime), u8 = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j);
      body = new FormData();
      body.append("to", r.to);
      body.append("message", new Blob([u8], { type: "message/rfc822" }), "message.mime");
    } else if (r.m === "POST") {
      headers["Content-Type"] = "application/json";
      body = r.body;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(PAPI_LIMITS.timeout, left));
    try {
      const res = await fetchFn(url, { method: r.m, headers, body, redirect: "manual", credentials: "omit", cache: "no-store", signal: ctl.signal });
      // reserve room before reading, so parallel reads stay under the total
      const room = Math.max(0, Math.min(PAPI_LIMITS.bodyOut, PAPI_LIMITS.totalOut - outBytes));
      outBytes += room;
      const text = room > 0 ? await readCapped(res, room) : null;
      outBytes -= room;
      if (text === null) { try { if (res.body) await res.body.cancel(); } catch (e) {} out[i] = { status: res.status, err: "too-big" }; return; }
      outBytes += text.length;
      out[i] = { status: res.status, body: text };
    } catch (e) {
      out[i] = { err: ctl.signal.aborted ? "timeout" : "network" };     // never e.message: it may carry the URL
    } finally {
      clearTimeout(timer);
    }
  }
  async function worker() {
    while (next < b.reqs.length) {
      const i = next++;
      await one(i);
    }
  }
  const n = Math.min(PAPI_LIMITS.concurrency, b.reqs.length);
  const ws = [];
  for (let w = 0; w < n; w++) ws.push(worker());
  await Promise.all(ws);
  return { res: out };
}
