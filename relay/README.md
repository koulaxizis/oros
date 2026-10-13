# orOS mail relay

A web page cannot speak IMAP or SMTP, so the Mail app talks to this
small Cloudflare Worker over HTTPS, and the Worker talks IMAP to the
mail server. It is stateless: each request opens one IMAP session,
runs one operation, logs out and forgets everything. Nothing is stored
and nothing is logged.

```
Mail app (browser) ──HTTPS/JSON──▶ relay (Worker) ──IMAP over TLS──▶ mail server
```

## Files

| File | What it does |
|---|---|
| `worker.js` | Entry point: wires Cloudflare's `connect()` (TCP + TLS) into `core.js` |
| `core.js` | HTTP side: CORS (allowed origins only), request validation, rate limit, the operations |
| `web.js` | The Reader's `web` operation: fetches public feeds and pages (see below) |
| `canva.js` | The Atelier's `canva` operation: Canva Connect sign-in and PowerPoint export (see below) |
| `imap.js` | Minimal IMAP4rev1 client (login, LIST, STATUS, EXAMINE/SELECT, UID SEARCH/FETCH/STORE/MOVE/COPY/EXPUNGE, CREATE, APPEND) |
| `smtp.js` | Minimal SMTP submission client (465 TLS / 587 STARTTLS, AUTH PLAIN or LOGIN) |
| `sieve.js` | Minimal ManageSieve client (RFC 5804; port 4190, STARTTLS required, SASL PLAIN) |
| `papi.js` | Newsletter's provider HTTP APIs (Brevo, Postmark, SendGrid, Mailgun): fixed hosts, an exact allowlist (see below) |
| `ext.js` | Connected services' `ext` operation: a person's own shop (WooCommerce) when the browser can't reach it, timologisi.online (myDATA), the email platforms (MailerLite, Mailchimp, Brevo) the CRMs (HubSpot, Pipedrive, Odoo), Stripe and Invoice Ninja, all read-only; exact allowlist (see below) |
| `newsletter.js` | Newsletter's public sign-up form and one-click unsubscribe, kept in D1 until the list's orOS pulls them (see below) |
| `remote.js` | Studio Remote's meeting rooms: a Durable Object that joins two WebSockets (see below) |
| `wrangler.toml` | Worker name and `ALLOWED_ORIGINS` |

Tests: `tests/mail.test.js` (Node, runs in CI) drives `core.js` +
`imap.js` against a scripted IMAP server.

## Operations

`POST /v1` with JSON `{ op, acct: { host, port, sec, user, pass }, … }`.
Answer: `{ ok: true, data }` or `{ ok: false, error: { code, msg } }`.

| op | Extra fields | Returns |
|---|---|---|
| `check` | | number of folders (login test) |
| `folders` | | `[{ name, delim, flags, total, unseen }]` |
| `list` | `folder`, `limit` (≤200), `beforeUid?`, `known?` (UID set) | `{ uidvalidity, exists, uids, msgs[{ uid, flags, date, size, hdr(base64) }], flags{uid: [...]}, more }` |
| `fetch` | `folder`, `uid` | `{ uid, uidvalidity, size, raw(base64) }` (≤20 MB) |
| `flag` | `folder`, `uids[]`, `add[]`, `remove[]` | `{ uidvalidity }` |
| `move` | `folder`, `uids[]` (1–500), `to` (≠ `folder`) | `{ uidvalidity }` (UID MOVE; else UID COPY + \\Deleted + UID EXPUNGE, or EXPUNGE without UIDPLUS) |
| `expunge` | `folder`, `uids[]` (1–500) | `{ uidvalidity }` (deletes for good) |
| `create` | `folder` | `{ ok }` (an existing folder is fine; also subscribes it) |
| `rename` | `folder` (not INBOX), `to` | `{ ok }` (subfolders follow; subscription moves) |
| `delete` | `folder` (not INBOX) | `{ ok }` (with its messages; servers refuse one with subfolders → `no`) |
| `search` | `folder`, `q` (≤200 chars, ≤6 words), `where?` (`text`\|`from`\|`subject`), `limit?` (≤100) | `{ uidvalidity, uids, total, msgs[...] }` (as `list`; `uids` = last 2000 hits) |
| `draft` | `folder`, `raw` (base64, ≤10 MB), `replace?` (UID), `mid?` (its Message-ID) | `{ uid, uidvalidity, replaced }` (APPEND with \\Draft \\Seen, then erases `replace`; `uid` 0 when the server tells neither APPENDUID nor finds `mid`) |
| `smtpcheck` | `smtp:{ host, port (465\|587), sec, user, pass }` | `{ ok }` (SMTP login test) |
| `send` | `smtp`, `from`, `rcpt[]` (1–50), `raw` (base64 RFC 5322 message, ≤10 MB), `sent?` (folder) | `{ sent, appended, appendErr }` |
| `sieve` | `act` (`check`\|`put`\|`off`), `host?` (ManageSieve host, default the IMAP host; port 4190), `script` (put, ≤32 KB), `prev?` (off) | check: `{ impl, ext[], scripts[{ name, active }], active, ours }`; put: `{ prev }`; off: `{ active }` |

`send` hands the message, built by the browser (`mail/compose.js`), to
the SMTP server, then files a copy in `sent` with IMAP APPEND. Filing
is best effort: a failure there is reported in `appendErr`, never as
"not sent". Its request (and a `draft`'s) may be up to 14 MB, attachments included; every other op stays at 64 KB.

`sieve` keeps the account's rules and out-of-office reply on the mail
server (built by `mail/sieve.js`). Mail owns one script, `orOS`: `put`
uploads and activates it and returns the script that was active before;
`off` re-activates that one (`prev`) only while ours or nothing is
active. The password is sent only after STARTTLS. Gmail, Outlook and
Yahoo have no ManageSieve: `check` then fails with `connect`/`timeout`.

Error codes: `origin`, `rate`, `bad-request`, `connect`, `tls`,
`auth`, `timeout`, `closed`, `proto`, `no`, `gone`, `too-big`, `rcpt` (a recipient refused), `script` (the server refused a Sieve script).

## The `web` operation (Reader app)

Most sites send no CORS headers, so a page cannot read their feeds.
The Reader asks the site directly first and uses this operation only
when that fails.

`POST /v1` with `{ op: "web", reqs: [{ url, etag?, lm? }] }` (up to 10).
Answer: `{ ok: true, data: { res: [...] } }`, one entry per request, in
order: `{ status, url (after redirects), type, etag, lm, retry, body
(base64) }`, or `{ err }` with `url`, `host`, `port`, `type`,
`too-big`, `timeout`, `redirect`, `network` or `budget`. A 304 (not
modified, thanks to `etag` / `lm`) has no body.

- GET only, `http`/`https` only, ports 80, 443, 8080 or 8443 only.
- Public host names only (the same check as for mail servers); every
  redirect hop is checked again, at most 5 hops.
- No cookies, no credentials. Pictures, audio, video and fonts are
  refused (`type`): feeds and pages only.
- 5 MB per response, 12 MB per call, 15 s per request, 45 sub-requests
  per call (Cloudflare's free plan allows 50).

Note: within those checks the `web` op is a generic GET proxy for
public pages, limited like every call to 60 requests per minute per
client IP. It runs on the same Worker as Mail, so both share the
owner's free Workers quota.

Tests: `tests/feeds.test.js` drives `core.js` + `web.js` with a fake
`fetch`.

## The `canva` operation (Atelier app)

Atelier can bring designs over from a Canva account through the
Canva Connect API. Canva only lets a server exchange sign-in codes
(it needs the integration's client secret and sends no CORS
headers), so the relay keeps that secret and passes the user's own
calls through. The user's Canva tokens stay on their device and come
with each call; the relay stores and logs nothing.

`POST /v1` with `{ op: "canva", act, … }`:

| act | Extra fields | Returns |
|---|---|---|
| `config` | | `{ configured, clientId }` |
| `token` | `code`, `verifier` (PKCE), `redirect` (a page of an allowed origin) | `{ access, refresh, expires, scope }` |
| `refresh` | `refresh` | same (Canva refresh tokens work once) |
| `designs` | `token`, `cont?`, `query?` | `{ items[{ id, title, thumb, tw, th, pages, updated, types }], cont }` |
| `export` | `token`, `id` | `{ job, status, urls, err }` (PowerPoint export) |
| `job` | `token`, `job` | same |
| `file` | `url` (https, `*.canva.com` only, every redirect hop checked) | the file's bytes, `application/octet-stream`, ≤60 MB |

Error codes: `canva-off` (no secrets set), `auth` (sign in to Canva
again), `rate`, `canva` (Canva's own message), `too-big`, `url` (a download redirected off Canva), `network`.

Tests: `tests/canva-relay.test.js` drives `core.js` + `canva.js` with a
mocked Canva API.

### Turning it on (once)

1. Canva account with two-step verification (MFA) on.
2. <https://www.canva.com/developers/integrations/connect-api> →
   **Create an integration** (public), any name, e.g. "orOS Atelier".
3. **Scopes:** `design:meta:read` and `design:content:read`.
4. **Authentication › Authorized redirects:**
   `https://useoros.online/atelier/canva-callback.html`
5. **Credentials:** copy the Client ID, click **Generate secret**, copy it.
6. Cloudflare → Workers & Pages → `oros-mail-relay` → Settings →
   Variables and secrets → add two **secrets**: `CANVA_CLIENT_ID` and
   `CANVA_CLIENT_SECRET`. Deploy.

An integration Canva has not reviewed is meant for development by its
owner; whether Canva lets the owner's own account use it day to day
without review was not verified (Canva's docs do not say). Other
people's accounts need the review. Private integrations need a Canva
Enterprise plan.

## The `papi` operation (Newsletter: provider HTTP APIs)

Brevo, Postmark, SendGrid and Mailgun don't answer browsers, so the
relay forwards a few exact requests for Newsletter.

`POST /v1 { op: "papi", prov, key, dom?, reqs: [{ m, path, body? | type: "multipart/form-data", to, mime }] }` (≤ 40)
→ `{ res: [{ status, body } | { status, err: "too-big" } | { err: "timeout" | "network" }] }`

| prov | Base (fixed) | Auth | Allowed |
|---|---|---|---|
| `brevo` | `https://api.brevo.com/v3` | `api-key` | `POST /smtp/email`, `GET /account`, `GET /smtp/statistics/events?event,limit,offset,startDate,endDate,sort` |
| `postmark` | `https://api.postmarkapp.com` | `X-Postmark-Server-Token` | `POST /email`, `POST /email/batch`, `GET /server`, `GET /bounces?count,offset,fromdate,todate,type` |
| `sendgrid` | `https://api.sendgrid.com/v3` | `Bearer` | `POST /mail/send`, `GET /user/profile`, `GET /suppression/(bounces\|spam_reports\|unsubscribes)?start_time,end_time,limit,offset` |
| `mailgun`, `mailgun-eu` | `https://api.mailgun.net/v3`, `https://api.eu.mailgun.net/v3` | Basic `api:<key>` | `POST /<dom>/messages.mime` (multipart: `to`, the MIME message), `GET /domains/<dom>`, `GET /<dom>/(bounces\|complaints\|unsubscribes)?limit` |

Rules:
- Paths must match exactly, and every query value has its own pattern. `%`, `#`, `\`, `@`, `//` and `.`/`..` segments are refused before matching, and the built URL is checked again against the base.
- Only the relay's own headers are sent (auth, `Accept`, `Content-Type` for JSON). JSON bodies pass through untouched.
- Redirects are not followed.
- Up to 2 MB per request and 4 MB per call. 6 requests at a time, 15 s each, and a 25 s budget per call: requests not done in time come back as `timeout` for the app to retry.
- Answers are capped at 256 KB per body and 2 MB per call.
- The key is used for this call only. It never appears in an answer, an error or a log (fetch errors are reported only as `network`).

## The `ext` operation (Connected services: a person's own shop)

orOS calls the shop straight from the browser first. When it can't
(no CORS, a firewall, a host that drops the Authorization header), the
app sends the same requests here. Code: `ext.js`; tests:
`tests/links.test.js` runs one case list against both the app's
`links/core.js checkReq` and `checkExtReq` here.

`POST /v1 { op: "ext", p: "woo", host, base, ck, cs, reqs: [{ m, path, body? }] }` (≤ 10)
→ `{ res: [{ status, body } | { status, err: "too-big" } | { err: "timeout" | "network" }] }`

WooCommerce: `https://<host><base>/wp-json/wc/v3<path>`, Basic auth
`ck:cs` (`ck_` / `cs_` + 40 hex, checked).

| Method | Path | Query / body |
|---|---|---|
| GET | `/system_status` | |
| GET | `/products` | `page, per_page (1-100), orderby, order, status, type, modified_after` |
| GET | `/products/<n>`, `/orders/<n>` | |
| GET | `/products/<n>/variations` | `page, per_page, orderby, order` |
| GET | `/orders` | `page, per_page, orderby, order, status, after, modified_after` |
| PUT | `/products/<n>`, `/products/<n>/variations/<m>` | `{ stock_quantity: int, manage_stock: bool }` only |
| PUT | `/orders/<n>` | `{ status }` (a WooCommerce order status) only |
| POST | `/orders/<n>/notes` | `{ note (≤1000), customer_note: bool }` only |

Rules:
- The host is the person's own, checked like a mail server: a public DNS name, https, default port. `base` is up to 3 plain path segments (a WordPress in a sub-folder).
- `%`, `#`, `\`, `@`, whitespace, `//` and `.`/`..` segments are refused; the built URL is parsed and checked again.
- Redirects are not followed. Writes run one at a time, in order; reads up to 4 at a time.
- 16 KB per request body; answers up to 2 MB each and 8 MB per call; 20 s per request, 28 s per call.
- The keys are used for this call only: never stored, logged or echoed (fetch errors come back only as `network`).

### Email platforms (`p: "mlite" | "mchimp" | "brevo"`, Newsletter)

`POST /v1 { op: "ext", p, key, reqs }`: no `host`, `base` or `env`.
MailerLite `https://connect.mailerlite.com/api<path>` (`Authorization: Bearer`),
Mailchimp `https://<dc>.api.mailchimp.com/3.0<path>` (dc = the key's suffix,
`-us21`; Basic `oros:<key>`; Mailchimp never answers browsers, so orOS
always comes here), Brevo `https://api.brevo.com/v3<path>` (`api-key`).

| Platform | Method | Path | Query / body |
|---|---|---|---|
| MailerLite | GET | `/groups` | `limit (≤1000), page` |
| MailerLite | GET | `/groups/<n>/subscribers` | `filter[status]` (active, unsubscribed, unconfirmed, bounced, junk), `limit, cursor` |
| MailerLite | POST | `/batch` | `{ requests }`: ≤ 50 × `{ method: "POST", path: "api/subscribers", body: { email, fields?: { name }, groups?: [one id], status?: "unsubscribed" } }` |
| Mailchimp | GET | `/ping`, `/lists` | `count, offset, fields` (one fixed value) |
| Mailchimp | GET | `/lists/<id>/members` | `count, offset, status, since_last_changed (…Z), fields` (one fixed value) |
| Mailchimp | POST | `/lists/<id>` | `{ members: ≤ 250 × { email_address, status: subscribed\|unsubscribed, merge_fields?: { FNAME }, language? }, update_existing }`; "subscribed" only with `update_existing: false` |
| Brevo | GET | `/account`, `/contacts/lists` | `limit (≤50), offset` |
| Brevo | GET | `/contacts/lists/<n>/contacts` | `limit (≤500), offset, modifiedSince` |
| Brevo | POST | `/contacts/import` | `{ jsonBody: ≤ 250 × { email, attributes?: { FIRSTNAME } }, listIds: [one], updateExistingContacts, emptyContactsAttributes }` |
| Brevo | POST | `/contacts/lists/<n>/contacts/remove` | `{ emails: ≤ 150 }` |

- 64 KB per request body. Nothing in these bodies can bring back a person who unsubscribed.

### CRMs (`p: "hubspot" | "pdrive"`, CRM, read-only)

`POST /v1 { op: "ext", p, key, reqs }`: no `host`, `base` or `env`.
HubSpot `https://api.hubapi.com<path>` (`Authorization: Bearer`, a private
app's token; HubSpot never answers browsers, so orOS always comes here),
Pipedrive `https://api.pipedrive.com/api/v2<path>` (`x-api-token`). Only GETs.

| Platform | Path | Query |
|---|---|---|
| HubSpot | `/crm/v3/pipelines/deals` | none |
| HubSpot | `/crm/v3/objects/companies` | `limit (≤100), after, properties` (one fixed list) |
| HubSpot | `/crm/v3/objects/contacts` | `limit, after, properties` (one fixed list), `associations=companies` |
| HubSpot | `/crm/v3/objects/deals` | `limit, after, properties` (one fixed list), `associations=companies,contacts` |
| Pipedrive | `/stages`, `/organizations`, `/persons` | `limit (≤500), cursor` |
| Pipedrive | `/deals` | `limit, cursor, status` (open, won, lost) |
| Pipedrive | `/activities` | `limit, cursor, done` (true, false) |

- A Pipedrive cursor is base64: its `+`, `/` and `=` travel as `%2B`, `%2F`,
  `%3D`. Those three are the only escapes `checkExtReq` lets through, and only
  where a query pattern allows them (the cursor); any other `%` is refused.

### Stripe (`p: "stripe"`, Budget, read-only)

`POST /v1 { op: "ext", p: "stripe", key, reqs }`: no `host`, `base` or `env`.
`https://api.stripe.com/v1<path>` (`Authorization: Bearer`). Only a restricted
key (`rk_live_…` / `rk_test_…`) is accepted, never a secret key (`sk_`); orOS
always comes here (a key never talks to Stripe from a browser). Only GETs.

| Path | Query |
|---|---|
| `/balance` | none (the connection check) |
| `/balance_transactions` | `limit (≤100), starting_after (txn_…), created[gte], created[lt]` (unix seconds) |

### Invoice Ninja (`p: "ininja"`, CRM and Budget, read-only)

`POST /v1 { op: "ext", p: "ininja", host, base, key, reqs }`: the person's
own install or `invoicing.co`, so `host` and `base` are checked like
WooCommerce's (public host only). `https://<host><base>/api/v1<path>` with
`X-API-TOKEN: <key>` (32–128 letters and digits) and
`X-Requested-With: XMLHttpRequest`. orOS calls it straight from the browser
first and comes here only when that fails. Only GETs.

| Path | Query |
|---|---|
| `/statics` | none (currency ids → codes) |
| `/clients` | `per_page (≤100), page, status=active` |
| `/payments` | `per_page (≤100), page` |

### Odoo (`p: "odoo"`, CRM, read-only)

`POST /v1 { op: "ext", p: "odoo", host, base, db?, key, reqs }`: the person's
own Odoo (19+, or `<name>.odoo.com`); `host` and `base` checked like
WooCommerce's, `db` (optional, only for Odoo: letters, digits, `._-`) goes
out as `X-Odoo-Database`. `https://<host><base>/json/2<path>` with
`Authorization: Bearer <key>`. Odoo doesn't answer browsers, so orOS comes
here after one direct try. Only `search_read`, as POSTs that read (they may
run side by side), each body exactly one of these (compared as JSON):

| Path | Body |
|---|---|
| `/res.company/search_read` | `fields: ["partner_id"]`, `limit` (1–200) |
| `/res.partner/search_read` | `domain: [["user_ids","=",false]]`, the fixed contact `fields`, `limit` (1–200), `offset`, `order: "id"` |
| `/crm.lead/search_read` | `domain: [["type","=","opportunity"],["active","in",[true,false]]]`, the fixed opportunity `fields`, `limit`, `offset`, `order: "id"` |

### timologisi.online (`p: "tol"`, Invoices → myDATA)

`POST /v1 { op: "ext", p: "tol", env: "test" | "live", key, reqs: [{ m, path, body? }] }`

The host is fixed per `env` (`test` → `provider-dev.timologisi.online`,
`live` → `provider.timologisi.online`), path prefix `/api/v1/Provider`;
`host` / `base` in the body are refused. Auth: header `API-KEY: <key>`
(16-200 chars of `A-Za-z0-9._~+/=-`).

| Method | Path | Query / body |
|---|---|---|
| GET | `/GetCreditsBalance` | |
| GET | `/RequestTransmittedDocs` | `issuerVatNumber, issuedFrom, issuedTo, uid, invoiceMark, series, aa, invoiceType, branch` |
| POST | `/SendInvoices` | `{ invoice: [one document] }` with only the known top-level keys, a known type, a 9-digit issuer ΑΦΜ |

- A SendInvoices travels alone in its call (`reqs` of 1); 64 KB per request body; 65 s per request, 70 s per call (SendInvoices waits for AADE).
- A request never sent because the call's time ran out comes back as `{ err: "skipped" }` (any platform); `timeout` / `network` mean it may have reached the provider.
- The app never retries a SendInvoices: a timeout or network error is reported to the person as "may or may not have arrived" and they look it up first.

## Newsletter: sign-up form and one-click unsubscribe

Needs a D1 database bound as `NL_DB` (`[[d1_databases]]` in
`wrangler.toml`; a binding added only in the dashboard is replaced on
the next deploy). The tables are created on first use. Without the
binding every route below answers 503 (`nostore`) and Newsletter keeps
its e-mail way (subscribe/unsubscribe e-mails read from the Inbox).

Public routes (no Origin check and no CORS: browsers and mail clients
call them; same per-IP rate limit; pages carry no JavaScript, a strict
CSP, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`):

| Route | What it does |
|---|---|
| `POST /nl/s/<k>` | Sign-up form (≤4 KB): `email`, `name?`, `lang?`, honeypot `website`. Stored encrypted for the list (AES-256-GCM, key wrapped with the list's RSA-OAEP-256 public key), then a "check your inbox" page or a 303 to the list's https thank-you page |
| `GET /nl/u/<k>/<tok>` | A page with one button. Never unsubscribes (link scanners open links) |
| `POST /nl/u/<k>/<tok>` | Unsubscribe: RFC 8058 `List-Unsubscribe=One-Click` or the page's button. Stores only the subscriber's random token, once a day |

At most 2,000 rows wait per list; beyond that nothing more is stored.

App operation `POST /v1 { op: "nl", act, k (16 a-z0-9), sec (32 A-Za-z0-9) }`:

| act | Extra fields | Returns |
|---|---|---|
| `reg` | `pub` (RSA-OAEP-256 JWK, 2048-bit), `back` ("" or https ≤300) | `{ ok }`. A new `k` takes this `sec` (only its SHA-256 is kept; at most 5,000 lists); an existing one needs the same `sec` |
| `pull` | `after` (row id) | `{ rows[{ id, kind: "s"\|"u", v, at }], more }` (≤200) |
| `ack` | `upto` (row id) | `{ n }`: deletes the list's rows up to that id |
| `drop` | | `{ ok }`: deletes the list and its rows |

Errors: `nostore` (503), `auth` (403, wrong `sec`), `gone` (404,
unknown `k`), `full`, `bad-request`.

## Studio Remote: meeting rooms (`/rt/`)

Studio's remote control (`studio/remote.js`) lets a tablet or phone
drive Studio on a PC. The two devices find each other here, swap their
WebRTC offer and answer, and then talk directly. When a direct link is
not possible (a VPN, different networks) they keep talking through the
room instead.

`GET /rt/<room>` with `Upgrade: websocket`, where `<room>` is 64
lowercase hex characters (a SHA-256 of the pairing code). Allowed origins and the rate limit apply as for
`/v1`. One Durable Object (`RemoteRoom`, binding `REMOTE`) per room:

- At most two sockets; a third gets 409.
- Text frames up to 16 KB are passed to the other socket as they are.
  Both sides encrypt them (AES-GCM, key from the code with PBKDF2).
  A 6-digit code can be found from a room id by trying all of them, so
  this keeps out casual eyes, not someone who reads room ids; Studio's
  real guard is that the PC must press Allow for each new device and
  then refuses any other. Binary frames close the socket with
  1003, larger ones with 1009, more than 400 frames in 10 s with 1008.
- A bare `ping` frame is answered `pong` by the runtime itself
  (WebSocket auto-response), so keep-alives on a direct link do not wake
  the room.
- The room tells each side `{"sys":"wait"}`, `{"sys":"peer"}` or
  `{"sys":"left"}`.
- Nothing is stored. An alarm closes the room after 120 s without a frame.

Answers: 404 (bad room), 403 (origin), 429 (rate), 426 (not a
WebSocket), 503 (no `REMOTE` binding), 502 (the room could not be reached). Tests: `tests/remote-relay.test.js`.

The Durable Object is declared at the top level of `wrangler.toml`
(binding plus a `new_sqlite_classes` migration, free plan), so the
normal deploy from `main` creates it. The room reads no env and no
secrets, and never logs frames.

## Rules it enforces

- Only pages listed in `ALLOWED_ORIGINS` get an answer (CORS). This
  stops other websites from using it through a visitor's browser; it
  does not stop a script that fakes the header, which is why the
  rest matters.
- Only ports 993 (IMAP over TLS) and 143 (with STARTTLS required).
  Never plain text.
- Only public host names: no IP literals, no `localhost`, `.local`,
  `.internal`, `.lan`, `.home`.
- Request body ≤ 64 KB, folder names without line breaks, UID lists
  bounded, 60 requests per minute per client IP (best effort).
- Credentials travel inside the HTTPS request, are used for the one
  login and are never stored or logged. The Worker sees them in memory
  while the request runs: it must be YOUR Worker.

## Deploy (Cloudflare, free plan)

Either way, the result is an address like
`https://oros-mail-relay.<your-subdomain>.workers.dev`, which goes into
Mail → Settings → Relay address (it syncs to your other devices).

**From GitHub (no command line):** Cloudflare dashboard → Workers &
Pages → Create → Import a repository → pick `koulaxizis/oros`, set
the root directory to `relay`, deploy. Every push to `main` that
changes `relay/` redeploys it.

**From a terminal:**

```sh
cd relay
npx wrangler login
npx wrangler deploy
```

To allow another page (for example a test copy of orOS), edit
`ALLOWED_ORIGINS` in `wrangler.toml` (comma-separated) and deploy
again.

## Local test

```sh
cd relay
npx wrangler dev        # http://127.0.0.1:8787
```

Add `http://localhost:<port>` of your local orOS to `ALLOWED_ORIGINS`
first. Mail accepts `http://127.0.0.1:…` and `http://localhost:…` as a
relay address for this purpose only.
