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
//           POST /v1 { op: "ext", p: "tol", env: "test" | "live", key, reqs: [...] }
//           POST /v1 { op: "ext", p: "mlite" | "mchimp" | "brevo" | "hubspot" | "pdrive" | "stripe", key, reqs: [...] }
//   MailerLite https://connect.mailerlite.com/api<path> (Bearer),
//   Mailchimp https://<dc>.api.mailchimp.com/3.0<path> (dc = the key's
//   suffix, Basic), Brevo https://api.brevo.com/v3<path> (header api-key),
//   HubSpot https://api.hubapi.com<path> (Bearer), Pipedrive
//   https://api.pipedrive.com/api/v2<path> (header x-api-token); both read-only;
//   Stripe https://api.stripe.com/v1<path> (Bearer, restricted key, read-only)
//   req: { m: "GET" | "PUT" | "POST", path, body? (JSON text) }
//   WooCommerce: https://<host><base>/wp-json/wc/v3<path>
//   timologisi.online (Greek e-invoicing provider, fixed hosts):
//     https://provider-dev.timologisi.online/api/v1/Provider<path> (test)
//     https://provider.timologisi.online/api/v1/Provider<path>     (live)
//     header API-KEY; SendInvoices waits for AADE, so a longer timeout
// Answer:   { ok: true, data: { res: [ one per request, same order ] } }
//   { status, body (text ≤ 2 MB) } | { status, err: "too-big" }
//   | { err: "timeout" | "network" | "skipped" (never sent: the call's time ran out first) }
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
// Per platform where it differs from the above.
const LIMITS_BY = {
  tol: { reqBytes: 64 * 1024, timeout: 65000, budget: 70000 },
  // a batch of subscribers (≤ 250 or 50 per request)
  mlite: { reqBytes: 64 * 1024 },
  mchimp: { reqBytes: 64 * 1024 },
  brevo: { reqBytes: 64 * 1024 }
};
function lim(p, k) { return LIMITS_BY[p] && LIMITS_BY[p][k] !== undefined ? LIMITS_BY[p][k] : EXT_LIMITS[k]; }

const NUM = /^[0-9]{1,9}$/, PER = /^([1-9]|[1-9][0-9]|100)$/,
      DT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/,
      WORDS = /^[a-z][a-z,-]{0,80}$/, ORDERBY = /^(date|id|modified|title)$/, ORD = /^(asc|desc)$/;
function q(extra) { return Object.assign({ page: NUM, per_page: PER, orderby: ORDERBY, order: ORD }, extra || {}); }
const STOCK_BODY = { stock_quantity: "int", manage_stock: "bool" };
const VAT_RE = /^[0-9]{9}$/, DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, UID = /^[A-F0-9]{40}$/, MARK = /^[0-9]{1,20}$/,
      SERIES = /^[A-Za-z0-9._-]{1,50}$/, AA = /^[0-9]{1,15}$/, ITYPE = /^[0-9]{1,2}\.[0-9]$/;
const TOL_TYPES = ["1.1", "1.2", "1.3", "2.1", "2.2", "2.3", "5.1", "5.2", "11.1", "11.2", "11.4"];
const TOL_KEYS = ["issuer", "counterpart", "invoiceHeader", "paymentMethods", "invoiceDetails",
                  "taxesTotals", "invoiceSummary", "providerAdditionalInvoiceDetails"];
// Same rule as links/core.js okInvoice: one document, known sections,
// a type orOS issues, ≤ 64 KB.
function okInvoice(v) {
  if (!Array.isArray(v) || v.length !== 1) return false;
  const d = v[0];
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  for (const k of Object.keys(d)) if (TOL_KEYS.indexOf(k) < 0) return false;
  const h = d.invoiceHeader;
  if (!h || typeof h !== "object" || TOL_TYPES.indexOf(h.invoiceType) < 0) return false;
  if (!d.issuer || typeof d.issuer !== "object" || !VAT_RE.test(String(d.issuer.vatNumber))) return false;
  let json;
  try { json = JSON.stringify(v); } catch (e) { return false; }
  return json.length <= 64 * 1024;
}
// Email marketing (wave 3): same rules as links/core.js.
const LIM1000 = /^([1-9][0-9]{0,2}|1000)$/, LIM500 = /^([1-9][0-9]?|[1-4][0-9]{2}|500)$/, LIM50 = /^([1-9]|[1-4][0-9]|50)$/,
      CURSOR = /^[A-Za-z0-9._=-]{1,600}$/, DTZ = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$/,
      ML_ST = /^(active|unsubscribed|unconfirmed|bounced|junk)$/, MC_ST = /^(subscribed|unsubscribed|cleaned|pending)$/,
      MC_LISTS_F = /^lists\.id,lists\.name,lists\.stats\.member_count,total_items$/,
      MC_MEMBERS_F = /^members\.email_address,members\.status,members\.merge_fields,members\.language,total_items$/;
// CRMs (wave 4): fixed property lists, opaque page markers; a Pipedrive
// cursor's "+", "/" and "=" travel as %2B, %2F, %3D (the only escapes
// checkExtReq lets through, and only where a pattern allows them).
const LIM100 = /^([1-9]|[1-9][0-9]|100)$/, AFTER = /^[A-Za-z0-9_-]{1,200}$/,
      PD_CURSOR = /^([A-Za-z0-9._=-]|%2B|%2F|%3D){1,800}$/,
      HS_CO_F = /^name,domain,phone,address,city,zip,country,industry$/,
      HS_CT_F = /^firstname,lastname,email,phone,jobtitle$/,
      HS_DL_F = /^dealname,amount,dealstage,pipeline,closedate,deal_currency_code,closed_lost_reason$/,
      PD_DST = /^(open|won|lost)(,(open|won|lost)){0,2}$/, BOOL = /^(true|false)$/,
      TXN = /^txn_[A-Za-z0-9]{1,250}$/, UNIX = /^[0-9]{9,11}$/;
const EMAIL_RE = /^[^\s@<>"',;:\\\/()\[\]]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,63}$/;
const okEmail = (v) => typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v);
const okName = (v) => typeof v === "string" && v.length <= 120 && !/[\u0000-\u001f\u007f]/.test(v);
function onlyKeys(o, ks) {
  return !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).every((k) => ks.indexOf(k) >= 0);
}
const listOf = (v, min, max, fn) => Array.isArray(v) && v.length >= min && v.length <= max && v.every(fn);
function okMlItem(x) {
  if (!onlyKeys(x, ["method", "path", "body"]) || x.method !== "POST" || x.path !== "api/subscribers") return false;
  const b = x.body;
  if (!onlyKeys(b, ["email", "fields", "groups", "status"]) || !okEmail(b.email)) return false;
  if (b.fields !== undefined && !(onlyKeys(b.fields, ["name"]) && (b.fields.name === undefined || okName(b.fields.name)))) return false;
  if (b.groups !== undefined && !listOf(b.groups, 1, 1, (g) => typeof g === "string" && /^[0-9]{1,20}$/.test(g))) return false;
  return b.status === undefined || b.status === "unsubscribed";
}
function okMcMember(x) {
  if (!onlyKeys(x, ["email_address", "status", "merge_fields", "language"]) || !okEmail(x.email_address)) return false;
  if (x.status !== "subscribed" && x.status !== "unsubscribed") return false;
  if (x.merge_fields !== undefined && !(onlyKeys(x.merge_fields, ["FNAME"]) && (x.merge_fields.FNAME === undefined || okName(x.merge_fields.FNAME)))) return false;
  return x.language === undefined || x.language === "en" || x.language === "el";
}
function okBvRow(x) {
  if (!onlyKeys(x, ["email", "attributes"]) || !okEmail(x.email)) return false;
  return x.attributes === undefined || (onlyKeys(x.attributes, ["FIRSTNAME"]) && (x.attributes.FIRSTNAME === undefined || okName(x.attributes.FIRSTNAME)));
}
const WHOLE = {
  // "subscribed" only for new addresses: never over someone who left
  mcbatch: (b) => Array.isArray(b.members) && !(b.members.some((x) => x.status === "subscribed") && b.update_existing !== false)
};
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
  },
  tol: {
    root: "/api/v1/Provider",
    once: true,
    env: { test: "provider-dev.timologisi.online", live: "provider.timologisi.online" },
    keys: { key: /^[A-Za-z0-9._~+\/=-]{16,200}$/ },
    auth: (b) => ["API-KEY", b.key],
    allow: [
      ["GET", /^\/GetCreditsBalance$/, null, null],
      ["GET", /^\/RequestTransmittedDocs$/, {
        issuerVatNumber: VAT_RE, issuedFrom: DAY, issuedTo: DAY, uid: UID, invoiceMark: MARK,
        series: SERIES, aa: AA, invoiceType: ITYPE, branch: NUM
      }, null],
      ["POST", /^\/SendInvoices$/, null, { invoice: "tolinv" }]
    ]
  },
  mlite: {
    root: "/api",
    host: "connect.mailerlite.com",
    keys: { key: /^[A-Za-z0-9._-]{20,2000}$/ },
    auth: (b) => ["Authorization", "Bearer " + b.key],
    allow: [
      ["GET", /^\/groups$/, { limit: LIM1000, page: NUM }, null],
      ["GET", /^\/groups\/[0-9]{1,20}\/subscribers$/, { "filter[status]": ML_ST, limit: LIM1000, cursor: CURSOR }, null],
      ["POST", /^\/batch$/, null, { requests: "mlbatch" }]
    ]
  },
  mchimp: {
    root: "/3.0",
    // the data centre is the key's suffix ("…-us21")
    hostOf: (b) => { const m = /-([a-z]{2,4}[0-9]{1,3})$/.exec(b.key || ""); return m ? m[1] + ".api.mailchimp.com" : ""; },
    keys: { key: /^[a-f0-9]{32}-[a-z]{2,4}[0-9]{1,3}$/ },
    auth: (b) => ["Authorization", "Basic " + btoa("oros:" + b.key)],
    allow: [
      ["GET", /^\/ping$/, null, null],
      ["GET", /^\/lists$/, { count: LIM1000, offset: NUM, fields: MC_LISTS_F }, null],
      ["GET", /^\/lists\/[a-z0-9]{1,20}\/members$/, { count: LIM1000, offset: NUM, status: MC_ST, since_last_changed: DTZ, fields: MC_MEMBERS_F }, null],
      ["POST", /^\/lists\/[a-z0-9]{1,20}$/, null, { members: "mcmembers", update_existing: "bool" }, "mcbatch"]
    ]
  },
  brevo: {
    root: "/v3",
    host: "api.brevo.com",
    keys: { key: /^xkeysib-[A-Za-z0-9-]{20,200}$/ },
    auth: (b) => ["api-key", b.key],
    allow: [
      ["GET", /^\/account$/, null, null],
      ["GET", /^\/contacts\/lists$/, { limit: LIM50, offset: NUM }, null],
      ["GET", /^\/contacts\/lists\/[0-9]{1,12}\/contacts$/, { limit: LIM500, offset: NUM, modifiedSince: DTZ }, null],
      ["POST", /^\/contacts\/import$/, null, { jsonBody: "bvrows", listIds: "bvlist", updateExistingContacts: "bool", emptyContactsAttributes: "bool" }],
      ["POST", /^\/contacts\/lists\/[0-9]{1,12}\/contacts\/remove$/, null, { emails: "emails" }]
    ]
  },
  // CRMs (wave 4), read-only
  hubspot: {
    root: "",
    host: "api.hubapi.com",
    keys: { key: /^pat-[a-z0-9]{2,6}-[A-Za-z0-9-]{20,120}$/ },
    auth: (b) => ["Authorization", "Bearer " + b.key],
    allow: [
      ["GET", /^\/crm\/v3\/pipelines\/deals$/, null, null],
      ["GET", /^\/crm\/v3\/objects\/companies$/, { limit: LIM100, after: AFTER, properties: HS_CO_F }, null],
      ["GET", /^\/crm\/v3\/objects\/contacts$/, { limit: LIM100, after: AFTER, properties: HS_CT_F, associations: /^companies$/ }, null],
      ["GET", /^\/crm\/v3\/objects\/deals$/, { limit: LIM100, after: AFTER, properties: HS_DL_F, associations: /^companies,contacts$/ }, null]
    ]
  },
  pdrive: {
    root: "/api/v2",
    host: "api.pipedrive.com",
    keys: { key: /^[a-f0-9]{40}$/ },
    auth: (b) => ["x-api-token", b.key],
    allow: [
      ["GET", /^\/stages$/, { limit: LIM500, cursor: PD_CURSOR }, null],
      ["GET", /^\/organizations$/, { limit: LIM500, cursor: PD_CURSOR }, null],
      ["GET", /^\/persons$/, { limit: LIM500, cursor: PD_CURSOR }, null],
      ["GET", /^\/deals$/, { limit: LIM500, cursor: PD_CURSOR, status: PD_DST }, null],
      ["GET", /^\/activities$/, { limit: LIM500, cursor: PD_CURSOR, done: BOOL }, null]
    ]
  },
  // Payments (wave 4B), read-only: a restricted key (rk_) only
  stripe: {
    root: "/v1",
    host: "api.stripe.com",
    keys: { key: /^rk_(live|test)_[A-Za-z0-9]{20,250}$/ },
    auth: (b) => ["Authorization", "Bearer " + b.key],
    allow: [
      ["GET", /^\/balance$/, null, null],
      ["GET", /^\/balance_transactions$/, { limit: LIM100, starting_after: TXN, "created[gte]": UNIX, "created[lt]": UNIX }, null]
    ]
  }
};

const BASE_RE = /^(\/[a-z0-9._~-]{1,60}){0,3}$/i;

function okVal(kind, v) {
  if (kind === "int") return Number.isInteger(v) && v >= -1000000000 && v <= 1000000000;
  if (kind === "bool") return v === true || v === false;
  if (kind === "status") return ORDER_ST.indexOf(v) >= 0;
  if (kind === "text") return typeof v === "string" && v.length > 0 && v.length <= 1000;
  if (kind === "tolinv") return okInvoice(v);
  if (kind === "mlbatch") return listOf(v, 1, 50, okMlItem);
  if (kind === "mcmembers") return listOf(v, 1, 250, okMcMember);
  if (kind === "bvrows") return listOf(v, 1, 250, okBvRow);
  if (kind === "bvlist") return listOf(v, 1, 1, (n) => Number.isInteger(n) && n > 0 && n < 1e12);
  if (kind === "emails") return listOf(v, 1, 150, okEmail);
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
  if (/[#\\\s@]|%(?!2B|2F|3D)/.test(r.path) || r.path.indexOf("//") >= 0 || /(^|\/)\.\.?(\/|$|\?)/.test(r.path)) return "path";
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
  if (rule[4] && !WHOLE[rule[4]](b)) return "body";
  return "";
}

export function validExt(b) {
  const pl = PLATFORMS[b.p];
  if (!pl || !Object.prototype.hasOwnProperty.call(PLATFORMS, b.p)) return "p";
  if (pl.env) {
    // fixed hosts: only the environment is chosen
    if (typeof b.env !== "string" || !Object.prototype.hasOwnProperty.call(pl.env, b.env)) return "host";
    if (b.host !== undefined || b.base !== undefined) return "host";
  } else if (pl.host || pl.hostOf) {
    // fixed hosts (or the key's data centre): never one from the caller
    if (b.host !== undefined || b.base !== undefined || b.env !== undefined) return "host";
  } else {
    if (!validHost(b.host)) return "host";
    if (typeof b.base !== "string" || !BASE_RE.test(b.base) || /(^|\/)\.\.?(\/|$)/.test(b.base)) return "base";
  }
  for (const k of Object.keys(pl.keys)) if (typeof b[k] !== "string" || !pl.keys[k].test(b[k])) return "key";
  if (!Array.isArray(b.reqs) || !b.reqs.length || b.reqs.length > EXT_LIMITS.reqs) return "reqs";
  // a write that must happen once (an invoice) travels alone in its call
  if (pl.once && b.reqs.length > 1 && b.reqs.some(r => r && r.m !== "GET")) return "reqs";
  for (const r of b.reqs) {
    if (r && r.body !== undefined) {
      if (typeof r.body !== "string" || r.body.length > lim(b.p, "reqBytes")) return "body";
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
  const pl = PLATFORMS[b.p];
  const fixed = !!(pl.env || pl.host || pl.hostOf);
  const host = pl.env ? pl.env[b.env] : pl.host ? pl.host : pl.hostOf ? pl.hostOf(b) : b.host.toLowerCase();
  if (!host) return null;
  const baseHref = "https://" + host + (fixed ? "" : b.base) + pl.root;
  const u = new URL(baseHref + path);
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password) return null;
  if (u.hostname !== host || u.href !== baseHref + path) return null;
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
    const left = lim(b.p, "budget") - (now() - start);
    // never sent: a code of its own, so a caller knows a write did not happen
    if (left <= 0) { out[i] = { err: "skipped" }; return; }
    const url = target(b, r.path);
    if (!url) { out[i] = { err: "network" }; return; }
    const headers = { Accept: "application/json", "User-Agent": "orOS-Connect/1.0 (+https://useoros.online)" };
    headers[auth[0]] = auth[1];
    let body;
    if (r.body !== undefined) { headers["Content-Type"] = "application/json"; body = r.body; }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(lim(b.p, "timeout"), left));
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
