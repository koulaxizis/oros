// ============================================================
// orOS relay — "ext" operation (Connected services: a person's own
// shop or site, e.g. WooCommerce)
// orOS first calls the shop straight from the browser. Some shops
// can't answer it (no CORS, a firewall, a host that drops the
// Authorization header); then the app sends the same requests here.
// The host is the person's own (checked like a mail server: a public
// DNS name, https, default port), the paths come from an exact
// allowlist per platform (the same list as links/core.js checkReq;
// tests/links.test.js runs one set of cases against both), bodies
// may only carry the listed keys, redirects are not followed. The
// keys are used for this call only: never stored, logged or echoed.
//
// Request:  POST /v1 { op: "ext", p: "woo", host, base, ck, cs, reqs: [...] }   (≤ 10)
//   req: { m: "GET" | "PUT" | "POST", path, body? (JSON text) }
//   WooCommerce: https://<host><base>/wp-json/wc/v3<path>
// Answer:   { ok: true, data: { res: [ one per request, same order ] } }
//   { status, body (text ≤ 2 MB) } | { status, err: "too-big" }
//   | { err: "timeout" | "network" }
// ============================================================

import { validHost } from "./core.js";

export const EXT_LIMITS = {
  reqs: 10,
  reqBytes: 16 * 1024,              // one request body
  bodyOut: 2 * 1024 * 1024,         // one response body (a page of 100 products)
  totalOut: 8 * 1024 * 1024,        // all response bodies of one call
  concurrency: 4,
  timeout: 20000,                   // ms, per request
  budget: 28000                     // ms, the whole call
};

const NUM = /^[0-9]{1,9}$/, PER = /^([1-9]|[1-9][0-9]|100)$/,
      DT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/,
      WORDS = /^[a-z][a-z,-]{0,80}$/, ORDERBY = /^(date|id|modified|title)$/, ORD = /^(asc|desc)$/;
function q(extra) { return Object.assign({ page: NUM, per_page: PER, orderby: ORDERBY, order: ORD }, extra || {}); }
const STOCK_BODY = { stock_quantity: "int", manage_stock: "bool" };
const ORDER_ST = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"];

export const PLATFORMS = {
  woo: {
    root: "/wp-json/wc/v3",
    keys: { ck: /^ck_[a-f0-9]{40}$/, cs: /^cs_[a-f0-9]{40}$/ },
    auth: (b) => ["Authorization", "Basic " + btoa(b.ck + ":" + b.cs)],
    allow: [
      ["GET", /^\/system_status$/, null, null],
      ["GET", /^\/products$/, q({ status: WORDS, type: WORDS, modified_after: DT }), null],
      ["GET", /^\/products\/[0-9]{1,12}$/, null, null],
      ["GET", /^\/products\/[0-9]{1,12}\/variations$/, q(null), null],
      ["PUT", /^\/products\/[0-9]{1,12}$/, null, STOCK_BODY],
      ["PUT", /^\/products\/[0-9]{1,12}\/variations\/[0-9]{1,12}$/, null, STOCK_BODY],
      ["GET", /^\/orders$/, q({ status: WORDS, after: DT, modified_after: DT }), null],
      ["GET", /^\/orders\/[0-9]{1,12}$/, null, null],
      ["PUT", /^\/orders\/[0-9]{1,12}$/, null, { status: "status" }],
      ["POST", /^\/orders\/[0-9]{1,12}\/notes$/, null, { note: "text", customer_note: "bool" }]
    ]
  }
};

const BASE_RE = /^(\/[a-z0-9._~-]{1,60}){0,3}$/i;

function okVal(kind, v) {
  if (kind === "int") return Number.isInteger(v) && v >= -1000000000 && v <= 1000000000;
  if (kind === "bool") return v === true || v === false;
  if (kind === "status") return ORDER_ST.indexOf(v) >= 0;
  if (kind === "text") return typeof v === "string" && v.length > 0 && v.length <= 1000;
  return false;
}

// "" when the request may go, else the reason. body is an object here
// (checkReq in links/core.js takes the same shape).
export function checkExtReq(p, r) {
  const pl = PLATFORMS[p];
  if (!pl || !Object.prototype.hasOwnProperty.call(PLATFORMS, p)) return "p";
  if (!r || typeof r !== "object") return "req";
  if (r.m !== "GET" && r.m !== "PUT" && r.m !== "POST") return "method";
  if (typeof r.path !== "string" || r.path.length > 400 || r.path[0] !== "/") return "path";
  if (/[#\\\s@%]/.test(r.path) || r.path.indexOf("//") >= 0 || /(^|\/)\.\.?(\/|$|\?)/.test(r.path)) return "path";
  const qi = r.path.indexOf("?");
  const path = qi < 0 ? r.path : r.path.slice(0, qi), query = qi < 0 ? "" : r.path.slice(qi + 1);
  const rule = pl.allow.find((a) => a[0] === r.m && a[1].test(path));
  if (!rule) return "path";
  if (query) {
    if (!rule[2]) return "query";
    const seen = {};
    for (const kv of query.split("&")) {
      const i = kv.indexOf("=");
      const k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? "" : kv.slice(i + 1);
      if (!Object.prototype.hasOwnProperty.call(rule[2], k) || seen[k] || !rule[2][k].test(v)) return "query";
      seen[k] = 1;
    }
  }
  if (r.m === "GET") return r.body === undefined ? "" : "body";
  const b = r.body;
  if (!b || typeof b !== "object" || Array.isArray(b)) return "body";
  const keys = Object.keys(b);
  if (!keys.length) return "body";
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(rule[3], k) || !okVal(rule[3][k], b[k])) return "body";
  }
  return "";
}

export function validExt(b) {
  const pl = PLATFORMS[b.p];
  if (!pl || !Object.prototype.hasOwnProperty.call(PLATFORMS, b.p)) return "p";
  if (!validHost(b.host)) return "host";
  if (typeof b.base !== "string" || !BASE_RE.test(b.base) || /(^|\/)\.\.?(\/|$)/.test(b.base)) return "base";
  for (const k of Object.keys(pl.keys)) if (typeof b[k] !== "string" || !pl.keys[k].test(b[k])) return "key";
  if (!Array.isArray(b.reqs) || !b.reqs.length || b.reqs.length > EXT_LIMITS.reqs) return "reqs";
  for (const r of b.reqs) {
    if (r && r.body !== undefined) {
      if (typeof r.body !== "string" || r.body.length > EXT_LIMITS.reqBytes) return "body";
      let o;
      try { o = JSON.parse(r.body); } catch (e) { return "body"; }
      const bad = checkExtReq(b.p, { m: r.m, path: r.path, body: o });
      if (bad) return bad;
    } else {
      const bad = checkExtReq(b.p, r);
      if (bad) return bad;
    }
  }
  return "";
}

// The address, re-checked after URL parsing (catches any normalisation).
function target(b, path) {
  const baseHref = "https://" + b.host.toLowerCase() + b.base + PLATFORMS[b.p].root;
  const u = new URL(baseHref + path);
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password) return null;
  if (u.hostname !== b.host.toLowerCase() || u.href !== baseHref + path) return null;
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
export async function runExt(b, fetchFn, now) {
  now = now || (() => Date.now());
  const pl = PLATFORMS[b.p];
  const auth = pl.auth(b);
  const start = now();
  const out = new Array(b.reqs.length);
  let outBytes = 0, next = 0;
  async function one(i) {
    const r = b.reqs[i];
    const left = EXT_LIMITS.budget - (now() - start);
    if (left <= 0) { out[i] = { err: "timeout" }; return; }
    const url = target(b, r.path);
    if (!url) { out[i] = { err: "network" }; return; }
    const headers = { Accept: "application/json", "User-Agent": "orOS-Connect/1.0 (+https://useoros.online)" };
    headers[auth[0]] = auth[1];
    let body;
    if (r.body !== undefined) { headers["Content-Type"] = "application/json"; body = r.body; }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(EXT_LIMITS.timeout, left));
    try {
      const res = await fetchFn(url, { method: r.m, headers, body, redirect: "manual", signal: ctl.signal });
      const room = Math.max(0, Math.min(EXT_LIMITS.bodyOut, EXT_LIMITS.totalOut - outBytes));
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
  // writes run one after another, in order; reads may overlap
  const writes = b.reqs.some((r) => r.m !== "GET");
  async function worker() {
    while (next < b.reqs.length) {
      const i = next++;
      await one(i);
    }
  }
  const n = writes ? 1 : Math.min(EXT_LIMITS.concurrency, b.reqs.length);
  const ws = [];
  for (let w = 0; w < n; w++) ws.push(worker());
  await Promise.all(ws);
  return { res: out };
}
