// ============================================================
// orOS Connected services — core.js (pure, v1.0.0)
// The accounts orOS keeps for other platforms (a WooCommerce shop
// first; more in later waves, up to Todoist for To-Do in wave 6A) and the rules every app shares. No DOM,
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
//     db    (Odoo only) the database name, "" when the address has one
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
  // SEAL_LEN: an Enable Banking private key (PEM, up to 4096 bits) sealed
  // with the sync passphrase is ~6 KB; an older device drops a longer
  // copy only for itself (equal m: the larger canonical JSON wins back).
  var NAME_LEN = 60, SITE_LEN = 200, SEAL_LEN = 9000;
  var MAX_ACCTS = 50;
  var VAT_RE = /^[0-9]{9}$/;
  var DB_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

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
      apps: ["stock", "newsletter", "publish"],
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
    },
    // Payments (wave 4B): Stripe's balance history into Budget. A
    // restricted key (rk_) only, read-only; always through the relay
    // (a secret key never talks to Stripe from a browser).
    stripe: {
      name: "Stripe",
      site: false,
      host: "api.stripe.com",
      root: "/v1",
      keys: [{ k: "key", re: /^rk_(live|test)_[A-Za-z0-9]{20,250}$/ }],
      apps: ["budget"],
      probe: "/balance",
      relayOnly: true
    },
    // Bank accounts (Budget BK-2): Enable Banking, an open-banking (PSD2)
    // provider, with the person's OWN application in restricted mode
    // (free, reads only the accounts they linked themselves). The keys
    // are the application id and its private key (PEM); a call carries
    // only a JWT signed from them on this device (links/host.js), so the
    // private key never leaves the device (the relay gets the JWT).
    // Read-only account information, never payments. Added from
    // Budget › Banks (ownUi: not in the Settings add form).
    ebank: {
      name: "Enable Banking",
      site: false,
      host: "api.enablebanking.com",
      root: "",
      keys: [
        { k: "app", re: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/ },
        { k: "pem", re: /^-----BEGIN (RSA )?PRIVATE KEY-----[A-Za-z0-9+\/=\s]{200,6000}-----END (RSA )?PRIVATE KEY-----$/ }
      ],
      apps: ["budget"],
      probe: "/application",
      once: true,                   // a consent request / session: never sent twice by a fallback
      ownUi: "budget"
    },
    // PayPal Business (Budget BK-3): the person's OWN REST app on
    // developer.paypal.com (Client ID + Secret, live), with only the
    // "Transaction search" feature needed. orOS reads the transactions;
    // the relay exchanges the two keys for a token on each call (PayPal
    // gives no token to a browser page), so always through the relay.
    paypal: {
      name: "PayPal",
      site: false,
      host: "api-m.paypal.com",
      root: "",
      keys: [{ k: "key", re: /^[A-Za-z0-9_-]{40,128}$/ }, { k: "token", re: /^[A-Za-z0-9_-]{40,128}$/ }],
      apps: ["budget"],
      // the last day (a fixed path would fall outside PayPal's 3 years)
      probe: function (now) {
        return { m: "GET", path: "/v1/reporting/transactions?start_date=" + ppStamp(now - 86400000) + "&end_date=" + ppStamp(now - 60000) + "&page_size=1&page=1" };
      },
      relayOnly: true
    },
    // Invoice Ninja (wave 4C): the person's own install or invoicing.co.
    // Clients into CRM, payments into Budget. Read-only.
    ininja: {
      name: "Invoice Ninja",
      site: true,
      root: "/api/v1",
      keys: [{ k: "key", re: /^[A-Za-z0-9]{32,128}$/ }],
      apps: ["crm", "budget"],
      probe: "/clients?per_page=1"
    },
    // Odoo (wave 4D): the person's own install or <name>.odoo.com,
    // Odoo 19's JSON-2 API (POST /json/2/<model>/<method>, Bearer API
    // key, X-Odoo-Database when the server has several databases).
    // Contacts and opportunities into CRM. Read-only: only search_read,
    // with fixed fields and filters.
    odoo: {
      name: "Odoo",
      site: true,
      db: true,
      root: "/json/2",
      keys: [{ k: "key", re: /^[A-Za-z0-9_-]{20,128}$/ }],
      apps: ["crm"],
      probe: { m: "POST", path: "/res.company/search_read", body: { fields: ["partner_id"], limit: 1 } }
    },
    // Productivity (wave 6A): Todoist's projects and open tasks into
    // To-Do (API v1, Bearer personal token). Read-only.
    todoist: {
      name: "Todoist",
      site: false,
      host: "api.todoist.com",
      root: "/api/v1",
      keys: [{ k: "key", re: /^[A-Fa-f0-9]{40}$/ }],
      apps: ["todo"],
      probe: "/projects?limit=1"
    },
    // Wave 6B: boards into Kanban, read-only. Trello: an API key and a
    // token (header Authorization: OAuth …); GitHub: a personal access
    // token, a repository's issues.
    trello: {
      name: "Trello",
      site: false,
      host: "api.trello.com",
      root: "/1",
      keys: [{ k: "key", re: /^[A-Fa-f0-9]{32}$/ }, { k: "token", re: /^[A-Za-z0-9]{64,100}$/ }],
      apps: ["kanban"],
      probe: "/members/me/boards?filter=open&fields=name"
    },
    github: {
      name: "GitHub",
      site: false,
      host: "api.github.com",
      root: "",
      keys: [{ k: "key", re: /^(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,255})$/ }],
      apps: ["kanban", "todo"],
      probe: "/user/repos?per_page=1"
    },
    // Wave 6C: Raindrop.io collections and bookmarks into Bookmarks
    // (REST v1, Bearer test token of the user's own app). Read-only.
    raindrop: {
      name: "Raindrop.io",
      site: false,
      host: "api.raindrop.io",
      root: "/rest/v1",
      keys: [{ k: "key", re: /^[A-Za-z0-9-]{30,80}$/ }],
      apps: ["bookmarks"],
      probe: "/collections"
    },
    // Wave 6D: Notion pages into Notes, wave 6E: databases into
    // Spreadsheet (API 2022-06-28, Bearer token of the user's own
    // internal integration; only what is shared with it). Notion does
    // not answer browsers: always through the relay.
    notion: {
      name: "Notion",
      site: false,
      host: "api.notion.com",
      root: "/v1",
      keys: [{ k: "key", re: /^(secret_|ntn_)[A-Za-z0-9]{30,80}$/ }],
      apps: ["notes", "spreadsheet", "kanban"],
      probe: { m: "POST", path: "/search", body: { filter: { property: "object", value: "page" }, page_size: 1 } },
      relayOnly: true
    },
    // Newsletter wave E4: products from a Shopify shop through its
    // Storefront API (GraphQL, the public Storefront access token the
    // shop owner makes in a Headless or custom app). Read-only by
    // nature, answers browsers: never through the relay (it doesn't
    // know Shopify). Fixed queries only (SHOPIFY_Q).
    shopify: {
      name: "Shopify",
      site: true,
      root: "/api/2025-10",
      keys: [{ k: "key", re: /^[a-f0-9]{32}$/ }],
      apps: ["newsletter"],
      probe: { m: "POST", path: "/graphql.json", body: { query: "{shop{name}}" } },
      direct: true
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
  // p: the platform, for its own app paths ("/odoo", "/web" for Odoo)
  function normSite(input, p) {
    var s = typeof input === "string" ? input.trim() : "";
    if (!s || s.length > SITE_LEN) return null;
    if (/^http:\/\//i.test(s)) return null;
    if (!/^https:\/\//i.test(s)) s = "https://" + s;
    var m = /^https:\/\/([^\/?#:@]+)(\/[^?#]*)?$/i.exec(s);
    if (!m) return null;
    var host = m[1].toLowerCase().replace(/\.$/, "");
    if (!validHost(host)) return null;
    var path = (m[2] || "").replace(/\/+$/, "").replace(/\/wp-json(\/.*)?$/i, "").replace(/\/api\/v1$/i, "").replace(/\/json\/2$/i, "");
    if (p === "odoo") path = path.replace(/\/(odoo|web)(\/.*)?$/i, "");
    if (p === "shopify") path = "";               // the Storefront API is at the shop's root
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
    var site = pl.site ? normSite(x.site, x.p) : "";
    if (site === null) return null;
    if (pl.env && !(typeof x.env === "string" && has(pl.env, x.env))) return null;
    if (pl.vat && !(typeof x.vat === "string" && VAT_RE.test(x.vat))) return null;
    var name = cleanText(x.name, NAME_LEN) || pl.name;
    var ks = x.ks === 1 ? 1 : 0;
    var s = ks && typeof x.s === "string" && x.s.length <= SEAL_LEN && /^[\x20-\x7e]+$/.test(x.s) ? x.s : "";
    var out = { id: x.id, m: x.m, p: x.p, name: name, site: site };
    if (pl.env) out.env = x.env;                  // only where the platform has them: a WooCommerce
    if (pl.vat) out.vat = x.vat;                  // row keeps the bytes it had before (R26)
    if (pl.db) out.db = typeof x.db === "string" && DB_RE.test(x.db) ? x.db : "";
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
      PD_DST = /^(open|won|lost)(,(open|won|lost)){0,2}$/, BOOL = /^(true|false)$/,
      TXN = /^txn_[A-Za-z0-9]{1,250}$/, UNIX = /^[0-9]{9,11}$/,
      IN_ACTIVE = /^active$/;
  // Todoist (wave 6A): opaque page cursors (base64; "+", "/", "=" escaped)
  var LIM200 = /^([1-9]|[1-9][0-9]|1[0-9]{2}|200)$/, PER50 = /^([1-9]|[1-4][0-9]|50)$/;
  // Notion (wave 6D): ids and page cursors are UUIDs
  var NT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  // Trello and GitHub (wave 6B): fixed field lists
  var TR_CARD_F = /^name,desc,due,idList,idLabels,closed,pos$/, TR_LIST_F = /^name,closed,pos$/;
  // Odoo (wave 4D): JSON-2 search_read bodies. The filters and field
  // lists are fixed: a body must carry exactly these (compared as JSON).
  var ODOO = {
    co_f: ["partner_id"],
    pt_dom: [["user_ids", "=", false]],
    pt_f: ["id", "name", "is_company", "parent_id", "type", "email", "phone", "website", "street", "street2", "zip", "city", "country_id", "vat", "function"],
    ld_dom: [["type", "=", "opportunity"], ["active", "in", [true, false]]],
    ld_f: ["id", "name", "partner_id", "expected_revenue", "probability", "active", "date_deadline", "date_closed", "lost_reason_id", "company_currency"],
    ord: "id",
    // Notion: search lists pages (wave 6D) or databases (wave 6E)
    nt_flt: { property: "object", value: "page" },
    nt_dbf: { property: "object", value: "database" }
  };
  // Shopify Storefront (Newsletter wave E4): the only queries orOS
  // sends, compared as text like the Odoo bodies above.
  var SF_PRODUCT = "id title handle onlineStoreUrl description availableForSale featuredImage{url altText width height} " +
    "priceRange{minVariantPrice{amount currencyCode}} compareAtPriceRange{minVariantPrice{amount currencyCode}} collections(first:5){nodes{title}}";
  var SHOPIFY_Q = {
    shop: "{shop{name}}",
    products: "query P($first:Int!,$after:String,$query:String){products(first:$first,after:$after,query:$query,sortKey:UPDATED_AT,reverse:true)" +
      "{pageInfo{hasNextPage endCursor} nodes{" + SF_PRODUCT + "}}}",
    nodes: "query N($ids:[ID!]!){nodes(ids:$ids){... on Product{" + SF_PRODUCT + "}}}"
  };
  Object.keys(SHOPIFY_Q).forEach(function (k) { ODOO["sf_" + k] = SHOPIFY_Q[k]; });
  var ODOO_J = {};
  Object.keys(ODOO).forEach(function (k) { ODOO_J[k] = JSON.stringify(ODOO[k]); });
  // Storefront variables: a page size, a page marker, a search, ids
  var SF_CUR = /^[A-Za-z0-9+\/=_:.-]{1,400}$/, SF_GID = /^gid:\/\/shopify\/Product\/[0-9]{1,20}$/;
  function okSfVars(v) {
    if (!onlyKeys(v, ["first", "after", "query", "ids"])) return false;
    if (v.first !== undefined && !(isInt(v.first) && v.first >= 1 && v.first <= 50)) return false;
    if (v.after !== undefined && v.after !== null && !(typeof v.after === "string" && SF_CUR.test(v.after))) return false;
    if (v.query !== undefined && v.query !== null && !(typeof v.query === "string" && v.query.length <= 100 && !/[\u0000-\u001f\u007f]/.test(v.query))) return false;
    return v.ids === undefined || listOf(v.ids, 1, 20, function (x) { return typeof x === "string" && SF_GID.test(x); });
  }
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
    },
    // Odoo: the fixed filter and fields must be there (without them
    // search_read reads every field of every record)
    odco: function (b) { return has(b, "fields"); },
    odq: function (b) { return has(b, "domain") && has(b, "fields") && has(b, "order"); },
    // Notion: search only with the "pages" filter
    ntq: function (b) { return has(b, "filter"); },
    // WooCommerce: a new product only as a draft, always with a name
    wdraft: function (b) { return b.status === "draft" && has(b, "name"); },
    // Enable Banking: a consent request always names all its parts
    ebauth: function (b) { return has(b, "access") && has(b, "aspsp") && has(b, "state") && has(b, "redirect_url"); },
    // Shopify: a query is always there; products with a page size,
    // nodes with ids, the shop name with nothing
    sfq: function (b) {
      var v = b.variables || {};
      if (b.query === SHOPIFY_Q.products) return has(v, "first") && !has(v, "ids");
      if (b.query === SHOPIFY_Q.nodes) return has(v, "ids") && Object.keys(v).length === 1;
      return !has(b, "variables");
    }
  };
  var LIST_Q = { page: NUM, per_page: PER, orderby: ORDERBY, order: ORD };
  function q(extra) { var o = {}; Object.keys(LIST_Q).forEach(function (k) { o[k] = LIST_Q[k]; }); Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; }); return o; }
  // a quantity (Stock), or a price from a supplier's price list (Stock wave P10)
  var PRODUCT_PUT = { stock_quantity: "int", manage_stock: "bool", regular_price: "money" };
  // Publishing wave P2: a title becomes a DRAFT product (the person
  // publishes it in the shop); found again by its SKU (the ISBN).
  var SKU = /^[A-Za-z0-9_-]{1,40}$/;
  var DRAFT_BODY = {
    name: "text", type: "ptype", status: "draft", sku: "sku", regular_price: "money",
    description: "desc", short_description: "desc", weight: "dec", dimensions: "dims",
    virtual: "bool", manage_stock: "bool"
  };
  // Enable Banking (Budget BK-2): the shapes its requests may take
  var EB_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  var EB_SES = new RegExp("^\\/sessions\\/" + EB_UUID + "$"),
      EB_BAL = new RegExp("^\\/accounts\\/" + EB_UUID + "\\/balances$"),
      EB_TX = new RegExp("^\\/accounts\\/" + EB_UUID + "\\/transactions$");
  var EB_CTY = /^[A-Z]{2}$/, EB_PSU = /^(personal|business)$/, EB_SVC = /^AIS$/, EB_TST = /^(BOOK|PDNG)$/,
      EB_DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, EB_CK = /^([A-Za-z0-9._~-]|%2B|%2F|%3D){1,1000}$/;
  // The only addresses a bank may send the person back to.
  var EB_REDIRECTS = ["https://useoros.online/budget/bankback.html"];
  // PayPal (Budget BK-3): Transaction Search, ≤ 31 days per request
  var PP_DT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}-0000$/,
      PP_FIELDS = /^(all|transaction_info,payer_info,cart_info)$/, PP_SIZE = /^([1-9]|[1-9][0-9]|[1-4][0-9][0-9]|500)$/,
      PP_YN = /^(Y|N)$/, PP_PG = /^([1-9][0-9]{0,2}|1000)$/;
  // start_date ≤ end_date, at most 31 days apart (PayPal refuses more)
  function ppRange(q) {
    var s = Date.parse(String(q.start_date || "").replace(/-0000$/, "Z")), e = Date.parse(String(q.end_date || "").replace(/-0000$/, "Z"));
    return isFinite(s) && isFinite(e) && s <= e && e - s <= 31 * 86400000;
  }
  function ppStamp(ms) { return new Date(ms).toISOString().slice(0, 19) + "-0000"; }
  function okEbVal(kind, v) {
    if (kind === "ebacc") return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 &&
      typeof v.valid_until === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$/.test(v.valid_until);
    if (kind === "ebasp") return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 2 &&
      typeof v.name === "string" && v.name.length > 0 && v.name.length <= 120 && !/[\u0000-\u001f\u007f]/.test(v.name) &&
      typeof v.country === "string" && EB_CTY.test(v.country);
    if (kind === "ebstate") return typeof v === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(v);
    if (kind === "ebredir") return EB_REDIRECTS.indexOf(v) >= 0;
    if (kind === "ebpsu") return typeof v === "string" && EB_PSU.test(v);
    if (kind === "ebcode") return typeof v === "string" && /^[A-Za-z0-9._~-]{1,512}$/.test(v);
    return false;
  }
  var ALLOW = {
    woo: [
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
    ],
    stripe: [
      ["GET", /^\/balance$/, null, null],
      ["GET", /^\/balance_transactions$/, { limit: LIM100, starting_after: TXN, "created[gte]": UNIX, "created[lt]": UNIX }, null]
    ],
    // PayPal (Budget BK-3): read-only transaction search
    paypal: [
      ["GET", /^\/v1\/reporting\/transactions$/, { start_date: PP_DT, end_date: PP_DT, fields: PP_FIELDS, page_size: PP_SIZE, page: PP_PG, balance_affecting_records_only: PP_YN }, null, null, ppRange]
    ],
    // Enable Banking (Budget BK-2): read-only account information
    ebank: [
      ["GET", /^\/application$/, null, null],
      ["GET", /^\/aspsps$/, { country: EB_CTY, psu_type: EB_PSU, service: EB_SVC }, null],
      ["POST", /^\/auth$/, null, { access: "ebacc", aspsp: "ebasp", state: "ebstate", redirect_url: "ebredir", psu_type: "ebpsu" }, "ebauth"],
      ["POST", /^\/sessions$/, null, { code: "ebcode" }, null],
      ["GET", EB_SES, null, null],
      ["GET", EB_BAL, null, null],
      ["GET", EB_TX, { date_from: EB_DAY, date_to: EB_DAY, continuation_key: EB_CK, transaction_status: EB_TST }, null]
    ],
    ininja: [
      ["GET", /^\/statics$/, null, null],
      ["GET", /^\/clients$/, { per_page: PER, page: NUM, status: IN_ACTIVE }, null],
      ["GET", /^\/payments$/, { per_page: PER, page: NUM }, null]
    ],
    odoo: [
      ["POST", /^\/res\.company\/search_read$/, null, { fields: "=co_f", limit: "olim" }, "odco"],
      ["POST", /^\/res\.partner\/search_read$/, null, { domain: "=pt_dom", fields: "=pt_f", limit: "olim", offset: "ooff", order: "=ord" }, "odq"],
      ["POST", /^\/crm\.lead\/search_read$/, null, { domain: "=ld_dom", fields: "=ld_f", limit: "olim", offset: "ooff", order: "=ord" }, "odq"]
    ],
    todoist: [
      ["GET", /^\/projects$/, { limit: LIM200, cursor: PD_CURSOR }, null],
      ["GET", /^\/tasks$/, { limit: LIM200, cursor: PD_CURSOR }, null]
    ],
    trello: [
      ["GET", /^\/members\/me\/boards$/, { filter: /^open$/, fields: /^name$/ }, null],
      ["GET", /^\/boards\/[0-9a-f]{24}$/, { fields: /^name$/, lists: /^open$/, cards: /^open$/, labels: /^all$/, checklists: /^all$/,
        card_fields: TR_CARD_F, list_fields: TR_LIST_F }, null]
    ],
    github: [
      ["GET", /^\/user\/repos$/, { per_page: PER, page: NUM, sort: /^updated$/ }, null],
      ["GET", /^\/repos\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/issues$/, { state: /^(open|all)$/, per_page: PER, page: NUM }, null],
      // the open issues assigned to the token's owner, across repositories (wave 6G, To-Do)
      ["GET", /^\/issues$/, { filter: /^assigned$/, state: /^open$/, per_page: PER, page: NUM }, null]
    ],
    raindrop: [
      ["GET", /^\/collections$/, {}, null],
      ["GET", /^\/collections\/childrens$/, {}, null],
      ["GET", /^\/raindrops\/0$/, { perpage: PER50, page: NUM }, null]
    ],
    shopify: [
      ["POST", /^\/graphql\.json$/, null, { query: "=sf_shop|sf_products|sf_nodes", variables: "sfvars" }, "sfq"]
    ],
    notion: [
      ["POST", /^\/search$/, null, { filter: "=nt_flt|nt_dbf", page_size: "nlim", start_cursor: "ncur" }, "ntq"],
      ["GET", /^\/blocks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/children$/, { page_size: PER, start_cursor: NT_ID }, null],
      // a database's rows (wave 6E): a POST that reads, no filter or sort
      ["POST", /^\/databases\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/query$/, null, { page_size: "nlim", start_cursor: "ncur" }, null]
    ]
  };
  var ORDER_ST = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"];
  function okVal(kind, v) {
    if (kind === "int") return isInt(v) && v >= -1000000000 && v <= 1000000000;
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
      Object.keys(v).every(function (k) { return (k === "length" || k === "width" || k === "height") && okVal("dec", v[k]); });
    if (kind === "tolinv") return okInvoice(v);
    if (kind === "mlbatch") return listOf(v, 1, 50, okMlItem);
    if (kind === "mcmembers") return listOf(v, 1, 250, okMcMember);
    if (kind === "bvrows") return listOf(v, 1, 250, okBvRow);
    if (kind === "bvlist") return listOf(v, 1, 1, function (n) { return isInt(n) && n > 0 && n < 1e12; });
    if (kind === "emails") return listOf(v, 1, 150, okEmail);
    if (kind === "olim") return isInt(v) && v >= 1 && v <= 200;
    if (kind === "ooff") return isInt(v) && v >= 0 && v <= 10000000;
    if (kind === "nlim") return isInt(v) && v >= 1 && v <= 100;
    if (kind === "ncur") return typeof v === "string" && NT_ID.test(v);
    if (kind === "sfvars") return okSfVars(v);
    if (kind.slice(0, 2) === "eb") return okEbVal(kind, v);
    // "=a" or "=a|b": exactly one of the fixed values
    if (kind[0] === "=") return kind.slice(1).split("|").some(function (k) { return has(ODOO_J, k) && JSON.stringify(v) === ODOO_J[k]; });
    return false;
  }
  // A product picture of a WooCommerce shop (Newsletter wave E4):
  // { m: "GET", path: "/wp-content/uploads/…/x.jpg", img: 1 }, the path
  // from the site's address (not the API root), no query, no body, no
  // keys sent with it. Used only through the relay, when the shop
  // doesn't let a browser read its pictures.
  var IMG_PATH = /^\/wp-content\/uploads(\/([A-Za-z0-9_~-]|%[89A-Fa-f][0-9A-Fa-f])([A-Za-z0-9._~-]|%[89A-Fa-f][0-9A-Fa-f]){0,150}){1,6}\.(jpe?g|png|gif|webp)$/i;
  function checkImg(p, r) {
    if (p !== "woo" || r.img !== 1 || r.m !== "GET" || r.body !== undefined) return "path";
    if (typeof r.path !== "string" || r.path.length > 400 || !IMG_PATH.test(r.path) || /\.\./.test(r.path)) return "path";
    return "";
  }
  // "" when the request may go, else the reason.
  function checkReq(p, r) {
    var rules = ALLOW[p];
    if (!rules) return "p";
    if (!r || typeof r !== "object") return "req";
    if (r.img !== undefined) return checkImg(p, r);
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
        if (!has(rule[2], k) || has(seen, k) || !rule[2][k].test(v)) return "query";
        seen[k] = v;
      }
    }
    // a check across the query's values (PayPal: a date range ≤ 31 days)
    if (rule[5] && !rule[5](seen || {})) return "query";
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
    if (pl.site) { var s = typeof acct === "string" ? acct : acct && acct.site; return s ? s + pl.root + path : null; }
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
    if (p === "stripe") return ["Authorization", "Bearer " + keys.key];
    if (p === "ininja") return ["X-API-TOKEN", keys.key];
    if (p === "odoo") return ["Authorization", "Bearer " + keys.key];
    if (p === "todoist") return ["Authorization", "Bearer " + keys.key];
    if (p === "trello") return ["Authorization", 'OAuth oauth_consumer_key="' + keys.key + '", oauth_token="' + keys.token + '"'];
    if (p === "github") return ["Authorization", "Bearer " + keys.key];
    if (p === "raindrop") return ["Authorization", "Bearer " + keys.key];
    if (p === "notion") return ["Authorization", "Bearer " + keys.key];
    if (p === "shopify") return ["X-Shopify-Storefront-Access-Token", keys.key];
    if (p === "ebank") return ["Authorization", "Bearer " + keys.jwt];   // signed on the device (links/host.js)
    return null;
  }
  // Headers a platform needs besides the key (no secrets here).
  function extraHeaders(p, acct) {
    if (p === "ininja") return { "X-Requested-With": "XMLHttpRequest" };
    if (p === "odoo" && acct && acct.db) return { "X-Odoo-Database": acct.db };
    return {};
  }
  // The connection check's request (a GET path, or a whole request).
  function probeReq(p) {
    var pr = PLATFORMS[p] && PLATFORMS[p].probe;
    if (typeof pr === "string") return { m: "GET", path: pr };
    if (typeof pr === "function") return pr(Date.now());
    return pr ? JSON.parse(JSON.stringify(pr)) : null;
  }

  var api = {
    EB_REDIRECTS: EB_REDIRECTS,
    ppStamp: ppStamp,
    VER: VER, ID_RE: ID_RE, PLATFORMS: PLATFORMS, PLATFORM_IDS: PLATFORM_IDS, MAX_ACCTS: MAX_ACCTS,
    ORDER_ST: ORDER_ST, NAME_LEN: NAME_LEN, VAT_RE: VAT_RE, DB_RE: DB_RE, TOL_TYPES: TOL_TYPES, ODOO: ODOO,
    validHost: validHost, normSite: normSite, siteParts: siteParts,
    normAcct: normAcct, merge: merge, live: live, find: find, checkKeys: checkKeys,
    extId: extId, checkReq: checkReq, SHOPIFY_Q: SHOPIFY_Q, query: query, apiUrl: apiUrl, authHeader: authHeader, extraHeaders: extraHeaders, probeReq: probeReq, cleanText: cleanText,
    okEmail: okEmail
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksCore = api;
})(typeof window !== "undefined" ? window : this);
