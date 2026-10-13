// ============================================================
// orOS Connected services — core.js (pure, v1.0.0)
// The accounts orOS keeps for other platforms (a WooCommerce shop
// first; more in later waves) and the rules every app shares. No DOM,
// no storage, no network: the shell side (links/host.js), Settings and
// the node tests all use this file, so they can never disagree.
//
// Data (synced slice "links", key oros-links-data):
//   { ver: 1, accts: [ { id, m, p, name, site, env?, vat?, ks, s, sm, d } … ] }
//   sorted by id (R26). One row per account:
//     id    [a-z0-9]{8,24}, random, made once on the device that adds it
//     m     ms of the last real change (R27)
//     p     platform id ("woo")
//     name  the label the person gave it (≤ 60)
//     site  the address, normalised: "https://host[/path]" (≤ 200);
//           "" for a platform with fixed hosts
//     env   (fixed-host platforms only) "test" | "live": which of the
//           platform's environments (separate accounts and keys)
//     vat   (invoicing providers only) the issuer's 9-digit ΑΦΜ
//   A row of a platform this version doesn't know is dropped by the
//   merge here (an older device keeps living without it; the device
//   that added it keeps it, the union restores it on the next pull).
//     ks    1 = "use these keys on all my devices": the keys travel in
//           s, sealed with the sync passphrase (orosSync.vaultCrypto)
//     s     that sealed copy ("" when ks is off or not sealed yet)
//     sm    when the sealed keys were last changed (ms)
//     d     1 = removed: only id, m, p and d stay (LWW keeps the
//           removal on every device; a newer edit cannot resurrect a
//           removed row because nothing can edit it any more)
//   Keys themselves are NEVER in the slice in clear: each device keeps
//   them sealed in IndexedDB "oros-links" (links/host.js).
//
// Merge: LWW per id by m; equal m → the larger canonical JSON (R5);
// a removed copy wins at equal m. Canonical and idempotent (R26).
//
// Also here: ids for imported records (extId: the same external
// record gets the same orOS id on every device, R16) and the request
// allowlist (checkReq) that the relay's "ext" operation enforces too
// (relay/ext.js keeps its own copy; tests/links.test.js runs the same
// cases against both).
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var ID_RE = /^[a-z0-9]{8,24}$/;
  var NAME_LEN = 60, SITE_LEN = 200, SEAL_LEN = 4000;
  var MAX_ACCTS = 50;
  var VAT_RE = /^[0-9]{9}$/;

  // Platforms. fields: what the Add dialog asks for (keys = secrets).
  //   key re: the exact shape of each secret, so a typo shows before a call
  var PLATFORMS = {
    woo: {
      name: "WooCommerce",
      site: true,
      keys: [
        { k: "ck", re: /^ck_[a-f0-9]{40}$/ },
        { k: "cs", re: /^cs_[a-f0-9]{40}$/ }
      ],
      apps: ["stock"],
      probe: "/products?per_page=1"
    },
    // timologisi.online (Novus Conceptus): a Greek e-invoicing provider.
    // Issues documents and sends them to myDATA (AADE); fixed hosts per
    // environment, one API key (header API-KEY).
    tol: {
      name: "timologisi.online",
      site: false,
      env: { test: "provider-dev.timologisi.online", live: "provider.timologisi.online" },
      root: "/api/v1/Provider",
      vat: true,
      keys: [
        { k: "key", re: /^[A-Za-z0-9._~+\/=-]{16,200}$/ }
      ],
      apps: ["invoices"],
      probe: "/GetCreditsBalance",
      once: true                    // a POST issues a tax document: never sent twice by a fallback
    },
    // Email marketing (wave 3): subscribers and unsubscribes with a
    // Newsletter list. Fixed hosts, one key each.
    mlite: {
      name: "MailerLite",
      site: false,
      host: "connect.mailerlite.com",
      root: "/api",
      keys: [{ k: "key", re: /^[A-Za-z0-9._-]{20,2000}$/ }],
      apps: ["newsletter"],
      probe: "/groups?limit=1"
    },
    // Mailchimp: the host comes from the key's data centre ("…-us21");
    // it does not answer browsers, so it always goes through the relay.
    mchimp: {
      name: "Mailchimp",
      site: false,
      hostOf: function (keys) { var m = /-([a-z]{2,4}[0-9]{1,3})$/.exec(keys && keys.key || ""); return m ? m[1] + ".api.mailchimp.com" : ""; },
      root: "/3.0",
      keys: [{ k: "key", re: /^[a-f0-9]{32}-[a-z]{2,4}[0-9]{1,3}$/ }],
      apps: ["newsletter"],
      probe: "/ping",
      relayOnly: true
    },
    brevo: {
      name: "Brevo",
      site: false,
      host: "api.brevo.com",
      root: "/v3",
      keys: [{ k: "key", re: /^xkeysib-[A-Za-z0-9-]{20,200}$/ }],
      apps: ["newsletter"],
      probe: "/account"
    },
    // CRMs (wave 4): companies, contacts, deals (and Pipedrive's open
    // activities) brought into CRM. Read-only: orOS never writes there.
    // HubSpot does not answer browsers, so it always goes through the relay.
    hubspot: {
      name: "HubSpot",
      site: false,
      host: "api.hubapi.com",
      root: "",
      keys: [{ k: "key", re: /^pat-[a-z0-9]{2,6}-[A-Za-z0-9-]{20,120}$/ }],
      apps: ["crm"],
      probe: "/crm/v3/objects/companies?limit=1",
      relayOnly: true
    },
    pdrive: {
      name: "Pipedrive",
      site: false,
      host: "api.pipedrive.com",
      root: "/api/v2",
      keys: [{ k: "key", re: /^[a-f0-9]{40}$/ }],
      apps: ["crm"],
      probe: "/stages?limit=1"
    }
  };
  var PLATFORM_IDS = Object.keys(PLATFORMS);

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function cleanText(s, max) {
    if (typeof s !== "string") return "";
    return s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }

  // ---------- Addresses ----------
  // Same rule as the relay's validHost: a public DNS name, no IP literal,
  // no local names.
  function validHost(h) {
    if (typeof h !== "string") return false;
    h = h.trim().toLowerCase().replace(/\.$/, "");
    if (h.length < 4 || h.length > 253) return false;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return false;
    if (/^[0-9.]+$/.test(h)) return false;
    if (/\.(local|localhost|internal|lan|home|arpa|test|invalid)$/.test(h)) return false;
    return h !== "localhost";
  }
  var BASE_RE = /^(\/[a-z0-9._~-]{1,60}){0,3}$/i;
  // "shop.example.gr", "https://shop.example.gr/", "example.gr/shop"
  // → "https://shop.example.gr" / "https://example.gr/shop"; null when
  // it is not a public https address (http:// is refused: the keys
  // would travel in clear).
  function normSite(input) {
    var s = typeof input === "string" ? input.trim() : "";
    if (!s || s.length > SITE_LEN) return null;
    if (/^http:\/\//i.test(s)) return null;
    if (!/^https:\/\//i.test(s)) s = "https://" + s;
    var m = /^https:\/\/([^\/?#:@]+)(\/[^?#]*)?$/i.exec(s);
    if (!m) return null;
    var host = m[1].toLowerCase().replace(/\.$/, "");
    if (!validHost(host)) return null;
    var path = (m[2] || "").replace(/\/+$/, "").replace(/\/wp-json(\/.*)?$/i, "");
    if (!BASE_RE.test(path) || /(^|\/)\.\.?(\/|$)/.test(path)) return null;
    return "https://" + host + path;
  }
  function siteParts(site) {
    var n = normSite(site);
    if (!n) return null;
    var rest = n.slice(8), i = rest.indexOf("/");
    return { host: i < 0 ? rest : rest.slice(0, i), base: i < 0 ? "" : rest.slice(i) };
  }

  // ---------- Accounts ----------
  function normAcct(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id)) return null;
    if (!isInt(x.m) || x.m < 0 || !has(PLATFORMS, x.p)) return null;
    if (x.d === 1) return { id: x.id, m: x.m, p: x.p, d: 1 };
    var pl = PLATFORMS[x.p];
    var site = pl.site ? normSite(x.site) : "";
    if (site === null) return null;
    if (pl.env && !(typeof x.env === "string" && has(pl.env, x.env))) return null;
    if (pl.vat && !(typeof x.vat === "string" && VAT_RE.test(x.vat))) return null;
    var name = cleanText(x.name, NAME_LEN) || pl.name;
    var ks = x.ks === 1 ? 1 : 0;
    var s = ks && typeof x.s === "string" && x.s.length <= SEAL_LEN && /^[\x20-\x7e]+$/.test(x.s) ? x.s : "";
    var out = { id: x.id, m: x.m, p: x.p, name: name, site: site };
    if (pl.env) out.env = x.env;                  // only where the platform has them: a WooCommerce
    if (pl.vat) out.vat = x.vat;                  // row keeps the bytes it had before (R26)
    out.ks = ks;
    out.s = s;
    out.sm = s && isInt(x.sm) && x.sm >= 0 ? x.sm : 0;
    out.d = 0;
    return out;
  }
  function canon(v) { return JSON.stringify(v); }
  function wins(x, cur) {
    if (!cur) return true;
    if (x.m !== cur.m) return x.m > cur.m;
    if ((x.d === 1) !== (cur.d === 1)) return x.d === 1;
    return canon(x) > canon(cur);
  }
  function merge(A, B) {
    var best = Object.create(null);
    [A, B].forEach(function (d) {
      var list = d && typeof d === "object" && Array.isArray(d.accts) ? d.accts : [];
      list.forEach(function (raw) {
        var x = normAcct(raw);
        if (x && wins(x, best[x.id])) best[x.id] = x;
      });
    });
    var accts = Object.keys(best).sort(cmpStr).map(function (id) { return best[id]; });
    // the cap counts living accounts; removals always stay
    var alive = 0;
    accts = accts.filter(function (a) { return a.d === 1 || ++alive <= MAX_ACCTS; });
    return { ver: VER, accts: accts };
  }
  function live(data) {
    return ((data && data.accts) || []).filter(function (a) { return a.d !== 1; });
  }
  function find(data, id) {
    var list = (data && data.accts) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // The secrets typed in the Add dialog: trimmed, each checked against
  // its platform's pattern. → { ok, keys, bad: [field] }
  function checkKeys(p, input) {
    var pl = PLATFORMS[p], out = {}, bad = [];
    if (!pl) return { ok: false, keys: null, bad: ["p"] };
    pl.keys.forEach(function (f) {
      var v = input && typeof input[f.k] === "string" ? input[f.k].trim() : "";
      if (!f.re.test(v)) bad.push(f.k);
      else out[f.k] = v;
    });
    return { ok: !bad.length, keys: bad.length ? null : out, bad: bad };
  }

  // ---------- Ids for imported records (R16) ----------
  // 64 bits of FNV-1a over "p|acct|kind|external id" → base36, with a
  // letter in front: 12–15 chars of [a-z0-9]. The same record imported
  // on two devices at once lands on one id, so the merge keeps one copy.
  function fnv(str, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function extId(p, acct, kind, xid) {
    var s = String(p) + "|" + String(acct) + "|" + String(kind) + "|" + String(xid);
    var a = fnv(s, 2166136261), b = fnv(s, 3735928559);
    return "x" + a.toString(36) + b.toString(36);
  }

  // ---------- Request allowlist (mirrored in relay/ext.js) ----------
  // A request: { m: "GET" | "PUT" | "POST", path: "/products?page=2", body?: object }
  // Paths are relative to the platform's API root (WooCommerce:
  // <site>/wp-json/wc/v3). Query values each have a pattern; a body may
  // only carry the listed keys.
  var NUM = /^[0-9]{1,9}$/, PER = /^([1-9]|[1-9][0-9]|100)$/,
      DT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/,
      WORDS = /^[a-z][a-z,-]{0,80}$/, ORDERBY = /^(date|id|modified|title)$/, ORD = /^(asc|desc)$/;
  var DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, UID = /^[A-F0-9]{40}$/, MARK = /^[0-9]{1,20}$/,
      SERIES = /^[A-Za-z0-9._-]{1,50}$/, AA = /^[0-9]{1,15}$/, ITYPE = /^[0-9]{1,2}\.[0-9]$/;
  // The document types orOS issues through an invoicing provider.
  var TOL_TYPES = ["1.1", "1.2", "1.3", "2.1", "2.2", "2.3", "5.1", "5.2", "11.1", "11.2", "11.4"];
  var TOL_KEYS = ["issuer", "counterpart", "invoiceHeader", "paymentMethods", "invoiceDetails",
                  "taxesTotals", "invoiceSummary", "providerAdditionalInvoiceDetails"];
  var TOL_BYTES = 64 * 1024;
  // SendInvoices body: exactly one document, only the sections orOS
  // fills, one of the types above, at most 64 KB.
  function okInvoice(v) {
    if (!Array.isArray(v) || v.length !== 1) return false;
    var d = v[0];
    if (!d || typeof d !== "object" || Array.isArray(d)) return false;
    var ks = Object.keys(d);
    for (var i = 0; i < ks.length; i++) if (TOL_KEYS.indexOf(ks[i]) < 0) return false;
    var h = d.invoiceHeader;
    if (!h || typeof h !== "object" || TOL_TYPES.indexOf(h.invoiceType) < 0) return false;
    if (!d.issuer || typeof d.issuer !== "object" || !VAT_RE.test(String(d.issuer.vatNumber))) return false;
    var json;
    try { json = JSON.stringify(v); } catch (e) { return false; }
    return json.length <= TOL_BYTES;
  }
  // Email marketing (wave 3)
  var LIM1000 = /^([1-9][0-9]{0,2}|1000)$/, LIM500 = /^([1-9][0-9]?|[1-4][0-9]{2}|500)$/, LIM50 = /^([1-9]|[1-4][0-9]|50)$/,
      CURSOR = /^[A-Za-z0-9._=-]{1,600}$/, DTZ = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$/,
      ML_ST = /^(active|unsubscribed|unconfirmed|bounced|junk)$/, MC_ST = /^(subscribed|unsubscribed|cleaned|pending)$/,
      MC_LISTS_F = /^lists\.id,lists\.name,lists\.stats\.member_count,total_items$/,
      MC_MEMBERS_F = /^members\.email_address,members\.status,members\.merge_fields,members\.language,total_items$/;
  // CRMs (wave 4): fixed property lists, opaque page markers. A
  // Pipedrive cursor is base64: "+", "/" and "=" travel as %2B, %2F, %3D
  // (the only escapes checkReq lets through, and only where a pattern
  // below allows them).
  var LIM100 = /^([1-9]|[1-9][0-9]|100)$/, AFTER = /^[A-Za-z0-9_-]{1,200}$/,
      PD_CURSOR = /^([A-Za-z0-9._=-]|%2B|%2F|%3D){1,800}$/,
      HS_CO_F = /^name,domain,phone,address,city,zip,country,industry$/,
      HS_CT_F = /^firstname,lastname,email,phone,jobtitle$/,
      HS_DL_F = /^dealname,amount,dealstage,pipeline,closedate,deal_currency_code,closed_lost_reason$/,
      PD_DST = /^(open|won|lost)(,(open|won|lost)){0,2}$/, BOOL = /^(true|false)$/;
  var EMAIL_RE = /^[^\s@<>"',;:\\\/()\[\]]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,63}$/;
  function okEmail(v) { return typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v); }
  function okName(v) { return typeof v === "string" && v.length <= 120 && !/[\u0000-\u001f\u007f]/.test(v); }
  function onlyKeys(o, ks) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return false;
    var k = Object.keys(o);
    for (var i = 0; i < k.length; i++) if (ks.indexOf(k[i]) < 0) return false;
    return true;
  }
  function listOf(v, min, max, fn) {
    if (!Array.isArray(v) || v.length < min || v.length > max) return false;
    for (var i = 0; i < v.length; i++) if (!fn(v[i])) return false;
    return true;
  }
  // MailerLite batch: only subscriber upserts, never "resubscribe" and
  // never a status other than "unsubscribed" (a new address starts
  // active; one that left can't be brought back from here).
  function okMlItem(x) {
    if (!onlyKeys(x, ["method", "path", "body"]) || x.method !== "POST" || x.path !== "api/subscribers") return false;
    var b = x.body;
    if (!onlyKeys(b, ["email", "fields", "groups", "status"]) || !okEmail(b.email)) return false;
    if (b.fields !== undefined && !(onlyKeys(b.fields, ["name"]) && (b.fields.name === undefined || okName(b.fields.name)))) return false;
    if (b.groups !== undefined && !listOf(b.groups, 1, 1, function (g) { return typeof g === "string" && /^[0-9]{1,20}$/.test(g); })) return false;
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
  // Rules across a whole body (after the per-key checks).
  var WHOLE = {
    // adding someone as "subscribed" must never overwrite a person who
    // already left: only new addresses are added that way
    mcbatch: function (b) {
      return Array.isArray(b.members) && !(b.members.some(function (x) { return x.status === "subscribed"; }) && b.update_existing !== false);
    }
  };
  var LIST_Q = { page: NUM, per_page: PER, orderby: ORDERBY, order: ORD };
  function q(extra) { var o = {}; Object.keys(LIST_Q).forEach(function (k) { o[k] = LIST_Q[k]; }); Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; }); return o; }
  var STOCK_BODY = { stock_quantity: "int", manage_stock: "bool" };
  var ALLOW = {
    woo: [
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
    ],
    tol: [
      ["GET", /^\/GetCreditsBalance$/, null, null],
      ["GET", /^\/RequestTransmittedDocs$/, {
        issuerVatNumber: VAT_RE, issuedFrom: DAY, issuedTo: DAY, uid: UID, invoiceMark: MARK,
        series: SERIES, aa: AA, invoiceType: ITYPE, branch: NUM
      }, null],
      ["POST", /^\/SendInvoices$/, null, { invoice: "tolinv" }]
    ],
    mlite: [
      ["GET", /^\/groups$/, { limit: LIM1000, page: NUM }, null],
      ["GET", /^\/groups\/[0-9]{1,20}\/subscribers$/, { "filter[status]": ML_ST, limit: LIM1000, cursor: CURSOR }, null],
      ["POST", /^\/batch$/, null, { requests: "mlbatch" }]
    ],
    mchimp: [
      ["GET", /^\/ping$/, null, null],
      ["GET", /^\/lists$/, { count: LIM1000, offset: NUM, fields: MC_LISTS_F }, null],
      ["GET", /^\/lists\/[a-z0-9]{1,20}\/members$/, { count: LIM1000, offset: NUM, status: MC_ST, since_last_changed: DTZ, fields: MC_MEMBERS_F }, null],
      ["POST", /^\/lists\/[a-z0-9]{1,20}$/, null, { members: "mcmembers", update_existing: "bool" }, "mcbatch"]
    ],
    brevo: [
      ["GET", /^\/account$/, null, null],
      ["GET", /^\/contacts\/lists$/, { limit: LIM50, offset: NUM }, null],
      ["GET", /^\/contacts\/lists\/[0-9]{1,12}\/contacts$/, { limit: LIM500, offset: NUM, modifiedSince: DTZ }, null],
      ["POST", /^\/contacts\/import$/, null, { jsonBody: "bvrows", listIds: "bvlist", updateExistingContacts: "bool", emptyContactsAttributes: "bool" }],
      ["POST", /^\/contacts\/lists\/[0-9]{1,12}\/contacts\/remove$/, null, { emails: "emails" }]
    ],
    hubspot: [
      ["GET", /^\/crm\/v3\/pipelines\/deals$/, null, null],
      ["GET", /^\/crm\/v3\/objects\/companies$/, { limit: LIM100, after: AFTER, properties: HS_CO_F }, null],
      ["GET", /^\/crm\/v3\/objects\/contacts$/, { limit: LIM100, after: AFTER, properties: HS_CT_F, associations: /^companies$/ }, null],
      ["GET", /^\/crm\/v3\/objects\/deals$/, { limit: LIM100, after: AFTER, properties: HS_DL_F, associations: /^companies,contacts$/ }, null]
    ],
    pdrive: [
      ["GET", /^\/stages$/, { limit: LIM500, cursor: PD_CURSOR }, null],
      ["GET", /^\/organizations$/, { limit: LIM500, cursor: PD_CURSOR }, null],
      ["GET", /^\/persons$/, { limit: LIM500, cursor: PD_CURSOR }, null],
      ["GET", /^\/deals$/, { limit: LIM500, cursor: PD_CURSOR, status: PD_DST }, null],
      ["GET", /^\/activities$/, { limit: LIM500, cursor: PD_CURSOR, done: BOOL }, null]
    ]
  };
  var ORDER_ST = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"];
  function okVal(kind, v) {
    if (kind === "int") return isInt(v) && v >= -1000000000 && v <= 1000000000;
    if (kind === "bool") return v === true || v === false;
    if (kind === "status") return ORDER_ST.indexOf(v) >= 0;
    if (kind === "text") return typeof v === "string" && v.length > 0 && v.length <= 1000;
    if (kind === "tolinv") return okInvoice(v);
    if (kind === "mlbatch") return listOf(v, 1, 50, okMlItem);
    if (kind === "mcmembers") return listOf(v, 1, 250, okMcMember);
    if (kind === "bvrows") return listOf(v, 1, 250, okBvRow);
    if (kind === "bvlist") return listOf(v, 1, 1, function (n) { return isInt(n) && n > 0 && n < 1e12; });
    if (kind === "emails") return listOf(v, 1, 150, okEmail);
    return false;
  }
  // "" when the request may go, else the reason.
  function checkReq(p, r) {
    var rules = ALLOW[p];
    if (!rules) return "p";
    if (!r || typeof r !== "object") return "req";
    if (r.m !== "GET" && r.m !== "PUT" && r.m !== "POST") return "method";
    if (typeof r.path !== "string" || r.path.length > 400 || r.path[0] !== "/") return "path";
    if (/[#\\\s@]|%(?!2B|2F|3D)/.test(r.path) || r.path.indexOf("//") >= 0 || /(^|\/)\.\.?(\/|$|\?)/.test(r.path)) return "path";
    var qi = r.path.indexOf("?");
    var path = qi < 0 ? r.path : r.path.slice(0, qi), query = qi < 0 ? "" : r.path.slice(qi + 1);
    var rule = null;
    for (var i = 0; i < rules.length; i++) if (rules[i][0] === r.m && rules[i][1].test(path)) { rule = rules[i]; break; }
    if (!rule) return "path";
    if (query) {
      if (!rule[2]) return "query";
      var seen = {}, parts = query.split("&");
      for (var j = 0; j < parts.length; j++) {
        var kv = parts[j], e = kv.indexOf("=");
        var k = e < 0 ? kv : kv.slice(0, e), v = e < 0 ? "" : kv.slice(e + 1);
        if (!has(rule[2], k) || seen[k] || !rule[2][k].test(v)) return "query";
        seen[k] = 1;
      }
    }
    if (r.m === "GET") return r.body === undefined ? "" : "body";
    var b = r.body;
    if (!b || typeof b !== "object" || Array.isArray(b)) return "body";
    var keys = Object.keys(b);
    if (!keys.length) return "body";
    for (var n = 0; n < keys.length; n++) {
      if (!has(rule[3], keys[n]) || !okVal(rule[3][keys[n]], b[keys[n]])) return "body";
    }
    if (rule[4] && !WHOLE[rule[4]](b)) return "body";
    return "";
  }
  // Query string from an object, in key order. Values are plain words,
  // numbers and dates (checkReq refuses anything that needs escaping).
  function query(o) {
    var out = [];
    Object.keys(o || {}).forEach(function (k) {
      if (o[k] === undefined || o[k] === null || o[k] === "") return;
      out.push(k + "=" + String(o[k]));
    });
    return out.length ? "?" + out.join("&") : "";
  }
  // The full URL of a request for direct calls from the browser.
  // acct = the account row (or, for WooCommerce, its site string).
  // keys: needed only where the host comes from the key (Mailchimp).
  function apiUrl(p, acct, path, keys) {
    if (p === "woo") return (typeof acct === "string" ? acct : acct.site) + "/wp-json/wc/v3" + path;
    var pl = PLATFORMS[p];
    if (!pl) return null;
    if (pl.env && acct && has(pl.env, acct.env)) return "https://" + pl.env[acct.env] + pl.root + path;
    if (pl.host) return "https://" + pl.host + pl.root + path;
    if (pl.hostOf) { var h = pl.hostOf(keys); return h ? "https://" + h + pl.root + path : null; }
    return null;
  }
  // The auth header of a direct call → [name, value].
  function authHeader(p, keys) {
    if (p === "woo") return ["Authorization", "Basic " + btoa(keys.ck + ":" + keys.cs)];
    if (p === "tol") return ["API-KEY", keys.key];
    if (p === "mlite") return ["Authorization", "Bearer " + keys.key];
    if (p === "mchimp") return ["Authorization", "Basic " + btoa("oros:" + keys.key)];
    if (p === "brevo") return ["api-key", keys.key];
    if (p === "hubspot") return ["Authorization", "Bearer " + keys.key];
    if (p === "pdrive") return ["x-api-token", keys.key];
    return null;
  }

  var api = {
    VER: VER, ID_RE: ID_RE, PLATFORMS: PLATFORMS, PLATFORM_IDS: PLATFORM_IDS, MAX_ACCTS: MAX_ACCTS,
    ORDER_ST: ORDER_ST, NAME_LEN: NAME_LEN, VAT_RE: VAT_RE, TOL_TYPES: TOL_TYPES,
    validHost: validHost, normSite: normSite, siteParts: siteParts,
    normAcct: normAcct, merge: merge, live: live, find: find, checkKeys: checkKeys,
    extId: extId, checkReq: checkReq, query: query, apiUrl: apiUrl, authHeader: authHeader, cleanText: cleanText,
    okEmail: okEmail
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksCore = api;
})(typeof window !== "undefined" ? window : this);
