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
//           POST /v1 { op: "ext", p: "mlite" | "mchimp" | "brevo" | "hubspot" | "pdrive" | "stripe" | "todoist" | "github" | "raindrop" | "notion" | "ebank", key, reqs: [...] }
//           POST /v1 { op: "ext", p: "trello" | "paypal", key, token, reqs: [...] }
//   MailerLite https://connect.mailerlite.com/api<path> (Bearer),
//   Mailchimp https://<dc>.api.mailchimp.com/3.0<path> (dc = the key's
//   suffix, Basic), Brevo https://api.brevo.com/v3<path> (header api-key),
//   HubSpot https://api.hubapi.com<path> (Bearer), Pipedrive
//   https://api.pipedrive.com/api/v2<path> (header x-api-token); both read-only;
//   Stripe https://api.stripe.com/v1<path> (Bearer, restricted key, read-only)
//   Enable Banking https://api.enablebanking.com<path> (Bearer JWT signed on the
//   person's device with their own application's key, read-only account information)
//   PayPal https://api-m.paypal.com<path> (Bearer token the relay gets for this call
//   from the person's own REST app: key = Client ID, token = Secret; read-only
//   transaction search)
//   Todoist https://api.todoist.com/api/v1<path> (Bearer, read-only: projects, open tasks)
//   Trello https://api.trello.com/1<path> (OAuth header: key + token), GitHub
//   https://api.github.com<path> (Bearer): read-only, a board / a repository's issues /
//   the open issues assigned to the token's owner
//   Raindrop.io https://api.raindrop.io/rest/v1<path> (Bearer, read-only: collections, bookmarks)
//   Notion https://api.notion.com/v1<path> (Bearer, Notion-Version 2022-06-28, read-only:
//   search for pages or databases, a block's children, a database's rows)
//           POST /v1 { op: "ext", p: "ininja", host, base, key, reqs: [...] }
//   Invoice Ninja https://<host><base>/api/v1<path> (X-API-TOKEN), read-only
//           POST /v1 { op: "ext", p: "odoo", host, base, db?, key, reqs: [...] }
//   Odoo https://<host><base>/json/2<path> (Bearer, X-Odoo-Database = db),
//   read-only: search_read with fixed filters and fields (POSTs that read)
//   req: { m: "GET" | "PUT" | "POST", path, body? (JSON text) }
//   WooCommerce only: { m: "GET", path: "/wp-content/uploads/…", img: 1 } = a
//   product picture from the shop's own address, without the keys
//   (Newsletter, when the shop doesn't let a browser read its pictures);
//   ≤ 512 KB, alone in its call (base64 costs relay CPU);
//   answer { status, type, b64 } or { status, err: "type" | "too-big" }
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
  imgOut: 512 * 1024,               // one product picture (bytes, before base64); base64 of 2 MB costs ~25 ms CPU, Free plan has ~10
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
// a quantity (Stock), or a price from a supplier's price list (Stock wave P10)
const PRODUCT_PUT = { stock_quantity: "int", manage_stock: "bool", regular_price: "money" };
// Publishing wave P2: a title becomes a DRAFT product, found again by its SKU.
const SKU = /^[A-Za-z0-9_-]{1,40}$/;
const DRAFT_BODY = {
  name: "text", type: "ptype", status: "draft", sku: "sku", regular_price: "money",
  description: "desc", short_description: "desc", weight: "dec", dimensions: "dims",
  virtual: "bool", manage_stock: "bool"
};
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
      PD_CURSOR = /^([A-Za-z0-9._=-]|%2B|%2F|%3D){1,800}$/, LIM200 = /^([1-9]|[1-9][0-9]|1[0-9]{2}|200)$/, PER50 = /^([1-9]|[1-4][0-9]|50)$/,
      TR_CARD_F = /^name,desc,due,idList,idLabels,closed,pos$/, TR_LIST_F = /^name,closed,pos$/,
      HS_CO_F = /^name,domain,phone,address,city,zip,country,industry$/,
      HS_CT_F = /^firstname,lastname,email,phone,jobtitle$/,
      HS_DL_F = /^dealname,amount,dealstage,pipeline,closedate,deal_currency_code,closed_lost_reason$/,
      PD_DST = /^(open|won|lost)(,(open|won|lost)){0,2}$/, BOOL = /^(true|false)$/,
      TXN = /^txn_[A-Za-z0-9]{1,250}$/, UNIX = /^[0-9]{9,11}$/,
      IN_ACTIVE = /^active$/;
// Odoo (wave 4D): same fixed bodies as links/core.js ODOO
const DB_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
const ODOO_J = {
  co_f: JSON.stringify(["partner_id"]),
  pt_dom: JSON.stringify([["user_ids", "=", false]]),
  pt_f: JSON.stringify(["id", "name", "is_company", "parent_id", "type", "email", "phone", "website", "street", "street2", "zip", "city", "country_id", "vat", "function"]),
  ld_dom: JSON.stringify([["type", "=", "opportunity"], ["active", "in", [true, false]]]),
  ld_f: JSON.stringify(["id", "name", "partner_id", "expected_revenue", "probability", "active", "date_deadline", "date_closed", "lost_reason_id", "company_currency"]),
  ord: JSON.stringify("id"),
  // Notion: search lists pages (wave 6D) or databases (wave 6E)
  nt_flt: JSON.stringify({ property: "object", value: "page" }),
  nt_dbf: JSON.stringify({ property: "object", value: "database" })
};
const NT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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
// Enable Banking (Budget BK-2): same shapes as links/core.js
const EB_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const EB_CTY = /^[A-Z]{2}$/, EB_PSU = /^(personal|business)$/, EB_SVC = /^AIS$/, EB_TST = /^(BOOK|PDNG)$/,
      EB_DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, EB_CK = /^([A-Za-z0-9._~-]|%2B|%2F|%3D){1,1000}$/;
const EB_REDIRECTS = ["https://useoros.online/budget/bankback.html"];
// PayPal (Budget BK-3): same shapes as links/core.js
const PP_KEY = /^[A-Za-z0-9_-]{40,128}$/,
      PP_DT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}-0000$/,
      PP_FIELDS = /^(all|transaction_info,payer_info,cart_info)$/, PP_SIZE = /^([1-9]|[1-9][0-9]|[1-4][0-9][0-9]|500)$/,
      PP_YN = /^(Y|N)$/, PP_TOKEN = /^[A-Za-z0-9._~+\/=-]{20,4096}$/, PP_PG = /^([1-9][0-9]{0,2}|1000)$/;
// start_date ≤ end_date, at most 31 days apart (PayPal refuses more)
function ppRange(q) {
  const s = Date.parse(String(q.start_date || "").replace(/-0000$/, "Z")), e = Date.parse(String(q.end_date || "").replace(/-0000$/, "Z"));
  return isFinite(s) && isFinite(e) && s <= e && e - s <= 31 * 86400000;
}
function okEbVal(kind, v) {
  const obj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  if (kind === "ebacc") return obj(v) && Object.keys(v).length === 1 && typeof v.valid_until === "string" &&
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$/.test(v.valid_until);
  if (kind === "ebasp") return obj(v) && Object.keys(v).length === 2 && typeof v.name === "string" && v.name.length > 0 &&
    v.name.length <= 120 && !/[\u0000-\u001f\u007f]/.test(v.name) && typeof v.country === "string" && EB_CTY.test(v.country);
  if (kind === "ebstate") return typeof v === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(v);
  if (kind === "ebredir") return EB_REDIRECTS.indexOf(v) >= 0;
  if (kind === "ebpsu") return typeof v === "string" && EB_PSU.test(v);
  if (kind === "ebcode") return typeof v === "string" && /^[A-Za-z0-9._~-]{1,512}$/.test(v);
  return false;
}
const WHOLE = {
  // "subscribed" only for new addresses: never over someone who left
  mcbatch: (b) => Array.isArray(b.members) && !(b.members.some((x) => x.status === "subscribed") && b.update_existing !== false),
  // Odoo: the fixed filter and fields must be there (without them
  // search_read reads every field of every record)
  odco: (b) => "fields" in b,
  odq: (b) => "domain" in b && "fields" in b && "order" in b,
  // Notion: search only with the "pages" filter
  ntq: (b) => "filter" in b,
  // WooCommerce: a new product only as a draft, always with a name
  wdraft: (b) => b.status === "draft" && "name" in b,
  // Enable Banking: a consent request always names all its parts
  ebauth: (b) => "access" in b && "aspsp" in b && "state" in b && "redirect_url" in b
};
const ORDER_ST = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"];

export const PLATFORMS = {
  woo: {
    root: "/wp-json/wc/v3",
    keys: { ck: /^ck_[a-f0-9]{40}$/, cs: /^cs_[a-f0-9]{40}$/ },
    auth: (b) => ["Authorization", "Basic " + btoa(b.ck + ":" + b.cs)],
    allow: [
      ["GET", /^\/system_status$/, null, null],
      ["GET", /^\/products$/, q({ status: WORDS, type: WORDS, modified_after: DT, sku: SKU }), null],
      ["GET", /^\/products\/[0-9]{1,12}$/, null, null],
      ["GET", /^\/products\/[0-9]{1,12}\/variations$/, q(null), null],
      ["POST", /^\/products$/, null, DRAFT_BODY, "wdraft"],
      ["GET", /^\/settings\/products\/woocommerce_(weight|dimension)_unit$/, null, null],
      ["PUT", /^\/products\/[0-9]{1,12}$/, null, PRODUCT_PUT],
      ["PUT", /^\/products\/[0-9]{1,12}\/variations\/[0-9]{1,12}$/, null, PRODUCT_PUT],
      ["GET", /^\/orders$/, q({ status: WORDS, after: DT, modified_after: DT }), null],
      ["GET", /^\/orders\/[0-9]{1,12}$/, null, null],
      ["PUT", /^\/orders\/[0-9]{1,12}$/, null, { status: "status" }],
      ["POST", /^\/orders\/[0-9]{1,12}\/notes$/, null, { note: "text", customer_note: "bool" }],
      // Newsletter wave E4: the shop's customers become subscribers
      ["GET", /^\/customers$/, q({ role: /^(all|customer)$/ }), null],
      ["GET", /^\/data\/currencies\/current$/, null, null],
      // partner card W6: Revenue Splitter 1.11+ (noxpress), read only
      ["GET", /^\/rs\/balances$/, null, null],
      ["GET", /^\/rs\/report$/, { date_start: DAY, date_end: DAY }, null]
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
  // Bank accounts (Budget BK-2), read-only: Enable Banking with the
  // person's own application. The key is a short-lived JWT signed on the
  // person's device; the private key never comes here.
  ebank: {
    root: "",
    host: "api.enablebanking.com",
    once: true,                     // POST /auth and /sessions travel alone, never retried
    keys: { key: /^[A-Za-z0-9_-]{10,1000}\.[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{10,1400}$/ },
    auth: (b) => ["Authorization", "Bearer " + b.key],
    allow: [
      ["GET", /^\/application$/, null, null],
      ["GET", /^\/aspsps$/, { country: EB_CTY, psu_type: EB_PSU, service: EB_SVC }, null],
      ["POST", /^\/auth$/, null, { access: "ebacc", aspsp: "ebasp", state: "ebstate", redirect_url: "ebredir", psu_type: "ebpsu" }, "ebauth"],
      ["POST", /^\/sessions$/, null, { code: "ebcode" }, null],
      ["GET", new RegExp("^\\/sessions\\/" + EB_UUID + "$"), null, null],
      ["GET", new RegExp("^\\/accounts\\/" + EB_UUID + "\\/balances$"), null, null],
      ["GET", new RegExp("^\\/accounts\\/" + EB_UUID + "\\/transactions$"), { date_from: EB_DAY, date_to: EB_DAY, continuation_key: EB_CK, transaction_status: EB_TST }, null]
    ]
  },
  // PayPal Business (Budget BK-3), read-only: the person's own REST app.
  // PayPal hands a token only for the Client ID + Secret (client
  // credentials), so the relay asks for one at the start of each call and
  // keeps it nowhere; the token can only reach the allowlist below.
  paypal: {
    root: "",
    host: "api-m.paypal.com",
    keys: { key: PP_KEY, token: PP_KEY },
    tokenOf: async (b, fetchFn, signal) => {
      const res = await fetchFn("https://api-m.paypal.com/v1/oauth2/token", {
        method: "POST", redirect: "manual", signal,
        headers: { Authorization: "Basic " + btoa(b.key + ":" + b.token), "Content-Type": "application/x-www-form-urlencoded",
                   Accept: "application/json", "User-Agent": "orOS-Connect/1.0 (+https://useoros.online)" },
        body: "grant_type=client_credentials"
      });
      // never PayPal's error body: only its status and a fixed code
      const text = res.status === 200 ? await readCapped(res, 8192) : null;
      if (text === null) {
        try { if (res.body) await res.body.cancel(); } catch (e) {}
        return res.status >= 400 && res.status < 500 ? { status: res.status, err: "auth" } : { status: res.status === 200 ? 502 : res.status, err: "network" };
      }
      let j = null;
      try { j = JSON.parse(text); } catch (e) {}
      const tok = j && typeof j.access_token === "string" && PP_TOKEN.test(j.access_token) ? j.access_token : "";
      return tok ? { auth: ["Authorization", "Bearer " + tok] } : { status: 502, err: "network" };
    },
    allow: [
      ["GET", /^\/v1\/reporting\/transactions$/, { start_date: PP_DT, end_date: PP_DT, fields: PP_FIELDS, page_size: PP_SIZE, page: PP_PG, balance_affecting_records_only: PP_YN }, null, null, ppRange]
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
  },
  // Invoice Ninja (wave 4C): the person's own install (or invoicing.co),
  // read-only; host checked like WooCommerce's
  ininja: {
    root: "/api/v1",
    keys: { key: /^[A-Za-z0-9]{32,128}$/ },
    auth: (b) => ["X-API-TOKEN", b.key],
    extra: { "X-Requested-With": "XMLHttpRequest" },
    allow: [
      ["GET", /^\/statics$/, null, null],
      ["GET", /^\/clients$/, { per_page: PER, page: NUM, status: IN_ACTIVE }, null],
      ["GET", /^\/payments$/, { per_page: PER, page: NUM }, null]
    ]
  },
  // Odoo (wave 4D): the person's own install (or <name>.odoo.com), JSON-2
  // API; host checked like WooCommerce's. Only search_read, so these
  // POSTs read and may run side by side.
  odoo: {
    root: "/json/2",
    db: true,
    reads: true,
    keys: { key: /^[A-Za-z0-9_-]{20,128}$/ },
    auth: (b) => ["Authorization", "Bearer " + b.key],
    extraOf: (b) => (b.db ? { "X-Odoo-Database": b.db } : {}),
    allow: [
      ["POST", /^\/res\.company\/search_read$/, null, { fields: "=co_f", limit: "olim" }, "odco"],
      ["POST", /^\/res\.partner\/search_read$/, null, { domain: "=pt_dom", fields: "=pt_f", limit: "olim", offset: "ooff", order: "=ord" }, "odq"],
      ["POST", /^\/crm\.lead\/search_read$/, null, { domain: "=ld_dom", fields: "=ld_f", limit: "olim", offset: "ooff", order: "=ord" }, "odq"]
    ]
  },
  // Productivity (wave 6A), read-only: Todoist's projects and open tasks
  todoist: {
    root: "/api/v1",
    host: "api.todoist.com",
    keys: { key: /^[A-Fa-f0-9]{40}$/ },
    auth: (b) => ["Authorization", "Bearer " + b.key],
    allow: [
      ["GET", /^\/projects$/, { limit: LIM200, cursor: PD_CURSOR }, null],
      ["GET", /^\/tasks$/, { limit: LIM200, cursor: PD_CURSOR }, null]
    ]
  },
  // Wave 6B, read-only: Trello boards, GitHub issues → Kanban
  trello: {
    root: "/1",
    host: "api.trello.com",
    keys: { key: /^[A-Fa-f0-9]{32}$/, token: /^[A-Za-z0-9]{64,100}$/ },
    auth: (b) => ["Authorization", 'OAuth oauth_consumer_key="' + b.key + '", oauth_token="' + b.token + '"'],
    allow: [
      ["GET", /^\/members\/me\/boards$/, { filter: /^open$/, fields: /^name$/ }, null],
      ["GET", /^\/boards\/[0-9a-f]{24}$/, { fields: /^name$/, lists: /^open$/, cards: /^open$/, labels: /^all$/, checklists: /^all$/,
        card_fields: TR_CARD_F, list_fields: TR_LIST_F }, null]
    ]
  },
  github: {
    root: "",
    host: "api.github.com",
    keys: { key: /^(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,255})$/ },
    auth: (b) => ["Authorization", "Bearer " + b.key],
    extra: { "X-GitHub-Api-Version": "2022-11-28" },
    allow: [
      ["GET", /^\/user\/repos$/, { per_page: PER, page: NUM, sort: /^updated$/ }, null],
      ["GET", /^\/repos\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/issues$/, { state: /^(open|all)$/, per_page: PER, page: NUM }, null],
      // the open issues assigned to the token's owner, across repositories (wave 6G, To-Do)
      ["GET", /^\/issues$/, { filter: /^assigned$/, state: /^open$/, per_page: PER, page: NUM }, null]
    ]
  },
  // Wave 6C, read-only: Raindrop.io collections and bookmarks → Bookmarks
  raindrop: {
    root: "/rest/v1",
    host: "api.raindrop.io",
    keys: { key: /^[A-Za-z0-9-]{30,80}$/ },
    auth: (b) => ["Authorization", "Bearer " + b.key],
    allow: [
      ["GET", /^\/collections$/, {}, null],
      ["GET", /^\/collections\/childrens$/, {}, null],
      ["GET", /^\/raindrops\/0$/, { perpage: PER50, page: NUM }, null]
    ]
  },
  // Waves 6D/6E, read-only: Notion pages → Notes, databases → Spreadsheet
  // (search and a database query are POSTs that read)
  notion: {
    root: "/v1",
    host: "api.notion.com",
    keys: { key: /^(secret_|ntn_)[A-Za-z0-9]{30,80}$/ },
    auth: (b) => ["Authorization", "Bearer " + b.key],
    extra: { "Notion-Version": "2022-06-28" },
    allow: [
      ["POST", /^\/search$/, null, { filter: "=nt_flt|nt_dbf", page_size: "nlim", start_cursor: "ncur" }, "ntq"],
      ["GET", /^\/blocks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/children$/, { page_size: PER, start_cursor: NT_ID }, null],
      // a database's rows (wave 6E): a POST that reads, no filter or sort
      ["POST", /^\/databases\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/query$/, null, { page_size: "nlim", start_cursor: "ncur" }, null]
    ]
  }
};

const BASE_RE = /^(\/[a-z0-9._~-]{1,60}){0,3}$/i;

function okVal(kind, v) {
  if (kind === "int") return Number.isInteger(v) && v >= -1000000000 && v <= 1000000000;
  if (kind === "bool") return v === true || v === false;
  if (kind === "status") return ORDER_ST.indexOf(v) >= 0;
  if (kind === "text") return typeof v === "string" && v.length > 0 && v.length <= 1000;
  if (kind === "draft") return v === "draft";
  if (kind === "ptype") return v === "simple";
  if (kind === "sku") return typeof v === "string" && SKU.test(v);
  if (kind === "money") return typeof v === "string" && /^[0-9]{1,7}(\.[0-9]{1,2})?$/.test(v);
  if (kind === "dec") return typeof v === "string" && /^[0-9]{1,6}(\.[0-9]{1,3})?$/.test(v);
  if (kind === "desc") return typeof v === "string" && v.length <= 8000;
  if (kind === "dims") return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0 &&
    Object.keys(v).every((k) => (k === "length" || k === "width" || k === "height") && okVal("dec", v[k]));
  if (kind === "tolinv") return okInvoice(v);
  if (kind === "mlbatch") return listOf(v, 1, 50, okMlItem);
  if (kind === "mcmembers") return listOf(v, 1, 250, okMcMember);
  if (kind === "bvrows") return listOf(v, 1, 250, okBvRow);
  if (kind === "bvlist") return listOf(v, 1, 1, (n) => Number.isInteger(n) && n > 0 && n < 1e12);
  if (kind === "emails") return listOf(v, 1, 150, okEmail);
  if (kind === "olim") return Number.isInteger(v) && v >= 1 && v <= 200;
  if (kind === "ooff") return Number.isInteger(v) && v >= 0 && v <= 10000000;
  if (kind === "nlim") return Number.isInteger(v) && v >= 1 && v <= 100;
  if (kind === "ncur") return typeof v === "string" && NT_ID.test(v);
  if (kind.slice(0, 2) === "eb") return okEbVal(kind, v);
  // "=a" or "=a|b": exactly one of the fixed values
  if (kind[0] === "=") return kind.slice(1).split("|").some((k) => Object.prototype.hasOwnProperty.call(ODOO_J, k) && JSON.stringify(v) === ODOO_J[k]);
  return false;
}

// A WooCommerce product picture (Newsletter wave E4, same rule as
// links/core.js checkImg): { m: "GET", path: "/wp-content/uploads/…", img: 1 }
// from the shop's own address, fetched without the keys; the answer is
// the picture itself (base64), only JPEG, PNG, GIF or WebP.
const IMG_PATH = /^\/wp-content\/uploads(\/([A-Za-z0-9_~-]|%[89A-Fa-f][0-9A-Fa-f])([A-Za-z0-9._~-]|%[89A-Fa-f][0-9A-Fa-f]){0,150}){1,6}\.(jpe?g|png|gif|webp)$/i;
const IMG_TYPE = /^image\/(jpeg|png|gif|webp)\s*(;|$)/i;
function checkImg(p, r) {
  if (p !== "woo" || r.img !== 1 || r.m !== "GET" || r.body !== undefined) return "path";
  if (typeof r.path !== "string" || r.path.length > 400 || !IMG_PATH.test(r.path) || /\.\./.test(r.path)) return "path";
  return "";
}

// "" when the request may go, else the reason. body is an object here
// (checkReq in links/core.js takes the same shape).
export function checkExtReq(p, r) {
  const pl = PLATFORMS[p];
  if (!pl || !Object.prototype.hasOwnProperty.call(PLATFORMS, p)) return "p";
  if (!r || typeof r !== "object") return "req";
  if (r.img !== undefined) return checkImg(p, r);
  if (r.m !== "GET" && r.m !== "PUT" && r.m !== "POST") return "method";
  if (typeof r.path !== "string" || r.path.length > 400 || r.path[0] !== "/") return "path";
  if (/[#\\\s@]|%(?!2B|2F|3D)/.test(r.path) || r.path.indexOf("//") >= 0 || /(^|\/)\.\.?(\/|$|\?)/.test(r.path)) return "path";
  const qi = r.path.indexOf("?");
  const path = qi < 0 ? r.path : r.path.slice(0, qi), query = qi < 0 ? "" : r.path.slice(qi + 1);
  const rule = pl.allow.find((a) => a[0] === r.m && a[1].test(path));
  if (!rule) return "path";
  const seen = {};
  if (query) {
    if (!rule[2]) return "query";
    for (const kv of query.split("&")) {
      const i = kv.indexOf("=");
      const k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? "" : kv.slice(i + 1);
      if (!Object.prototype.hasOwnProperty.call(rule[2], k) || Object.prototype.hasOwnProperty.call(seen, k) || !rule[2][k].test(v)) return "query";
      seen[k] = v;
    }
  }
  // a check across the query's values (PayPal: a date range ≤ 31 days)
  if (rule[5] && !rule[5](seen)) return "query";
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
  // a database name only where the platform has one (Odoo)
  if (b.db !== undefined && !(pl.db && typeof b.db === "string" && DB_RE.test(b.db))) return "db";
  for (const k of Object.keys(pl.keys)) if (typeof b[k] !== "string" || !pl.keys[k].test(b[k])) return "key";
  if (!Array.isArray(b.reqs) || !b.reqs.length || b.reqs.length > EXT_LIMITS.reqs) return "reqs";
  // a write that must happen once (an invoice) travels alone in its call
  if (pl.once && b.reqs.length > 1 && b.reqs.some(r => r && r.m !== "GET")) return "reqs";
  // a product picture travels alone in its call (CPU: base64 runs on the relay)
  if (b.reqs.length > 1 && b.reqs.some(r => r && r.img !== undefined)) return "reqs";
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
// img: a picture's path is from the site's address, not the API root.
function target(b, path, img) {
  const pl = PLATFORMS[b.p];
  const fixed = !!(pl.env || pl.host || pl.hostOf);
  const host = pl.env ? pl.env[b.env] : pl.host ? pl.host : pl.hostOf ? pl.hostOf(b) : b.host.toLowerCase();
  if (!host) return null;
  const baseHref = "https://" + host + (fixed ? "" : b.base) + (img ? "" : pl.root);
  const u = new URL(baseHref + path);
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password) return null;
  if (u.hostname !== host || u.href !== baseHref + path) return null;
  return u.href;
}

async function readBytes(res, max) {
  const reader = res.body ? res.body.getReader() : null;
  if (!reader) return new Uint8Array(0);
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
  return all;
}
function b64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
// One product picture: no keys, no cookies, only an image back.
async function oneImg(url, fetchFn, signal, room) {
  const res = await fetchFn(url, { method: "GET", headers: { Accept: "image/webp,image/png,image/jpeg,image/gif", "User-Agent": "orOS-Connect/1.0 (+https://useoros.online)" },
                                   redirect: "manual", signal });
  if (res.status < 200 || res.status > 299) { try { if (res.body) await res.body.cancel(); } catch (e) {} return { status: res.status }; }
  const type = (res.headers.get("Content-Type") || "").trim();
  if (!IMG_TYPE.test(type)) { try { if (res.body) await res.body.cancel(); } catch (e) {} return { status: res.status, err: "type" }; }
  const bytes = room > 0 ? await readBytes(res, room) : null;
  if (!bytes) { try { if (res.body) await res.body.cancel(); } catch (e) {} return { status: res.status, err: "too-big" }; }
  return { status: res.status, type: type.split(";")[0].toLowerCase(), b64: b64(bytes), n: bytes.length };
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
  const start = now();
  let auth;
  if (pl.tokenOf) {
    // a token for this call only (PayPal): no token, no request
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), lim(b.p, "timeout"));
    let tk;
    try { tk = await pl.tokenOf(b, fetchFn, ctl.signal); }
    catch (e) { tk = { err: ctl.signal.aborted ? "timeout" : "network" }; }
    finally { clearTimeout(timer); }
    if (!tk.auth) return { res: b.reqs.map(() => (tk.status ? { status: tk.status, err: tk.err || "network" } : { err: tk.err || "network" })) };
    auth = tk.auth;
  } else auth = pl.auth(b);
  const out = new Array(b.reqs.length);
  let outBytes = 0, next = 0;
  async function one(i) {
    const r = b.reqs[i];
    const left = lim(b.p, "budget") - (now() - start);
    // never sent: a code of its own, so a caller knows a write did not happen
    if (left <= 0) { out[i] = { err: "skipped" }; return; }
    const url = target(b, r.path, r.img === 1);
    if (!url) { out[i] = { err: "network" }; return; }
    if (r.img === 1) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), Math.min(lim(b.p, "timeout"), left));
      const room = Math.max(0, Math.min(EXT_LIMITS.imgOut, Math.floor((EXT_LIMITS.totalOut - outBytes) * 3 / 4)));
      outBytes += room;
      try {
        const x = await oneImg(url, fetchFn, ctl.signal, room);
        outBytes -= room;
        outBytes += x.b64 ? x.b64.length : 0;
        delete x.n;
        out[i] = x;
      } catch (e) {
        outBytes -= room;
        out[i] = { err: ctl.signal.aborted ? "timeout" : "network" };
      } finally {
        clearTimeout(timer);
      }
      return;
    }
    const headers = { Accept: "application/json", "User-Agent": "orOS-Connect/1.0 (+https://useoros.online)" };
    headers[auth[0]] = auth[1];
    const extra = pl.extraOf ? pl.extraOf(b) : pl.extra;
    if (extra) Object.keys(extra).forEach((k) => { headers[k] = extra[k]; });
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
  const writes = !pl.reads && b.reqs.some((r) => r.m !== "GET");
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
