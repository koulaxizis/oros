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
| `ext.js` | Connected services' `ext` operation: a person's own shop (WooCommerce) when the browser can't reach it, timologisi.online (myDATA), the email platforms (MailerLite, Mailchimp, Brevo) the CRMs (HubSpot, Pipedrive, Odoo), Stripe, Invoice Ninja, Todoist, Trello, GitHub, Raindrop.io, Notion, Enable Banking and PayPal, all read-only; exact allowlist (see below) |
| `newsletter.js` | Newsletter's public sign-up form and one-click unsubscribe, kept in D1 until the list's orOS pulls them (see below) |
| `crmform.js` | CRM's public contact form (`/crm/f/<k>`) and op `crmf`, kept in the same D1 until the user's CRM picks the messages up (see below) |
| `share.js` | "Send to someone" links with an expiry: op `shr` and `/s/<id>/<i>`, encrypted pieces kept in their own D1 until they expire or are revoked (see below) |
| `oasa.js` | Maps' `oasa` operation: live bus arrivals at Athens stops from OASA Telematics, which sends no CORS headers; fixed host, exact `act` allowlist, digit-only stop codes, 64 KB / 8 s, JSON only, 15 s shared cache (see below) |
| `remote.js` | Studio Remote's meeting rooms: a Durable Object that joins two WebSockets (see below) |
| `push.js` | Notifications with orOS closed (op `push`): one Durable Object per device holding its encrypted reminders, sent by Web Push at their time (see below) |
| `house.js` | Households (`/h/<box>`): one Durable Object per household holding only encrypted shared documents, invites, join requests and key envelopes, with live notices over a WebSocket (see below) |
| `dav.js` | Sync through WebDAV: `/dav` passes one WebDAV request to the user's own server when that server sends no CORS headers (see below) |
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

### Enable Banking (`p: "ebank"`, Budget › Banks, read-only)

`POST /v1 { op: "ext", p: "ebank", key, reqs }`: no `host`, `base` or `env`.
`https://api.enablebanking.com<path>` with `Authorization: Bearer <key>`, where
`key` is a JWT (three base64url parts, length capped) the person's device
signed with their own application's private key; the private key never comes
here. orOS calls Enable Banking straight from the browser first and comes here
only when that fails. **Bank data (accounts, transactions) passes through the
relay in plain form; it is never stored or logged.** The writes (`once`)
travel alone in their call and are never retried another way.

| Method | Path | Query / body |
|---|---|---|
| GET | `/application` | none (the connection check) |
| GET | `/aspsps` | `country` (2 letters), `psu_type` (personal, business), `service` (AIS) |
| POST | `/auth` | exactly `access {valid_until}`, `aspsp {name, country}`, `state`, `redirect_url` (only `https://useoros.online/budget/bankback.html`), `psu_type` |
| POST | `/sessions` | exactly `{code}` |
| GET | `/sessions/<uuid>`, `/accounts/<uuid>/balances` | none |
| GET | `/accounts/<uuid>/transactions` | `date_from`, `date_to` (YYYY-MM-DD), `continuation_key`, `transaction_status` (BOOK, PDNG); each once |

### PayPal (`p: "paypal"`, Budget › Banks, read-only)

`POST /v1 { op: "ext", p: "paypal", key, token, reqs }`: `key` = Client ID,
`token` = Secret of the person's own live REST app (each 40–128 of
`A-Za-z0-9_-`). PayPal gives tokens only for client credentials, so at the
start of each call the relay POSTs `https://api-m.paypal.com/v1/oauth2/token`
(Basic id:secret, `grant_type=client_credentials`, manual redirects, the call's
timeout, answer capped at 8 KB) and keeps only `access_token` (anchored, ≤ 4096)
for that call: one token request per call, no retry. Without a token nothing is
sent and each request answers the token's status with a fixed code (`auth`),
never PayPal's body. The token and the Secret are never returned, logged or
put in an error. **Payment data passes through the relay in plain form; it is
never stored or logged.** Always through the relay.

| Method | Path | Query |
|---|---|---|
| GET | `/v1/reporting/transactions` | `start_date`, `end_date` (`YYYY-MM-DDTHH:MM:SS-0000`, start ≤ end, ≤ 31 days apart), `fields` (`all` or `transaction_info,payer_info,cart_info`), `page_size` (1–500), `page` (1–1000), `balance_affecting_records_only` (Y, N); each once |

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

### Todoist (`p: "todoist"`, To-Do, read-only)

`POST /v1 { op: "ext", p: "todoist", key, reqs }`: no `host`, `base` or `env`.
`https://api.todoist.com/api/v1<path>` (`Authorization: Bearer`, a personal
API token: 40 hex digits). orOS calls Todoist straight from the browser first
and comes here only when that fails. Only GETs.

| Path | Query |
|---|---|
| `/projects` | `limit (≤200), cursor` |
| `/tasks` | `limit (≤200), cursor` (open tasks only: Todoist's list of tasks) |

- The cursor travels like Pipedrive's (`%2B`, `%2F`, `%3D` only).

### Trello (`p: "trello"`, Kanban, read-only)

`POST /v1 { op: "ext", p: "trello", key, token, reqs }`: no `host`, `base` or `env`.
`https://api.trello.com/1<path>` with `Authorization: OAuth oauth_consumer_key="<key>", oauth_token="<token>"`
(API key: 32 hex digits; token: 64-100 letters and digits). Both are needed
and neither goes in the query (`key=` / `token=` in a path is refused).
Direct first, here only when the browser can't reach Trello. Only GETs.

| Path | Query |
|---|---|
| `/members/me/boards` | `filter=open&fields=name` |
| `/boards/<24 hex>` | `fields=name&lists=open&cards=open&labels=all&checklists=all&card_fields=name,desc,due,idList,idLabels,closed,pos&list_fields=name,closed,pos` (exactly these) |

### GitHub (`p: "github"`, Kanban and To-Do, read-only)

`POST /v1 { op: "ext", p: "github", key, reqs }`: no `host`, `base` or `env`.
`https://api.github.com<path>` with `Authorization: Bearer <token>`,
`X-GitHub-Api-Version: 2022-11-28` and the relay's `User-Agent` (GitHub
refuses calls without one). The token is a personal access token
(`github_pat_…` fine-grained, or classic `ghp_…`). Direct first, here only
when the browser can't reach GitHub. Only GETs.

| Path | Query |
|---|---|
| `/user/repos` | `per_page (≤100), page, sort=updated` |
| `/repos/<owner>/<repo>/issues` | `state=open\|all, per_page (≤100), page` |
| `/issues` | `filter=assigned, state=open, per_page (≤100), page` (the open issues assigned to the token's owner) |

- `<owner>/<repo>` are GitHub's name characters only; `.` and `..` as a part are refused.

### Raindrop.io (`p: "raindrop"`, Bookmarks, read-only)

`POST /v1 { op: "ext", p: "raindrop", key, reqs }`: no `host`, `base` or `env`.
`https://api.raindrop.io/rest/v1<path>` (`Authorization: Bearer`, the test
token of the user's own Raindrop app: 30-80 letters, digits and dashes).
Direct first, here only when the browser can't reach Raindrop. Only GETs.

| Path | Query |
|---|---|
| `/collections` | none |
| `/collections/childrens` | none |
| `/raindrops/0` | `perpage (≤50), page` (collection 0 = every bookmark outside the trash) |

### Notion (`p: "notion"`, Notes and Spreadsheet, read-only)

`POST /v1 { op: "ext", p: "notion", key, reqs }`: no `host`, `base` or `env`.
`https://api.notion.com/v1<path>` with `Authorization: Bearer <secret>` (an
internal integration's secret: `ntn_…` or `secret_…`) and
`Notion-Version: 2022-06-28`. Notion doesn't answer browsers, so orOS always
comes here, up to 5 requests a call with a pause between calls. Read-only:
the integration sees only the pages and databases its owner shared with it.

| Request | Allowed |
|---|---|
| `POST /search` | body exactly `filter: {"property":"object","value":"page"}` or `{"property":"object","value":"database"}` (required), `page_size` (1-100), `start_cursor` (a UUID); nothing else |
| `GET /blocks/<uuid>/children` | `page_size (≤100), start_cursor` (a UUID) |
| `POST /databases/<uuid>/query` | body only `page_size` (1-100) and `start_cursor` (a UUID): no filter, no sort |

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

## CRM: web form (`/crm/f/`)

A contact form the user pastes into their own website. Same D1 binding
`NL_DB` as Newsletter (no new binding), its own tables `crm_form`
(k, pub, SHA-256 of sec, back, at, day, n) and `crm_q` (id, k, v, at),
created on first use. It reuses Newsletter's helpers (seal, secret
check, e-mail check, honeypot, page). Without the binding the form
answers 503 "not available" and the op 503 `nostore`; any D1 failure is
also a 503, never an exception.

| Route | What it does |
|---|---|
| `POST /crm/f/<k>` | Contact form (≤20 KB, `application/x-www-form-urlencoded`): `email` (required, ≤200, Newsletter's check), `name?`, `phone?`, `company?` (≤200, one line), `message?` (≤2000, line breaks kept), `lang?` (en/el), honeypot `website`. Control characters are stripped. Sealed for the form (AES-256-GCM, key wrapped with the form's RSA-OAEP-256 public key); in clear only the form key and the time. Answer: a fixed thank-you page (EN/EL) or a 303 to the form's registered https `back` (never taken from the request). Nothing the visitor sent is echoed |

No Origin check and no CORS, like `/nl/`; the same per-IP rate limit.
At most 500 messages wait per form and 100 are stored per form per
UTC day (`crm_form.day`, `n`); beyond either the visitor still gets the
thank-you page and nothing is stored. Messages older than 30 days are
deleted on every form POST and every op call, picked up or not.
Payloads are never logged.

App operation `POST /v1 { op: "crmf", act, k (16 a-z0-9), sec (32 A-Za-z0-9) }`:

| act | Extra fields | Returns |
|---|---|---|
| `reg` | `pub` (RSA-OAEP-256 JWK, 2048-bit), `back` ("" or https ≤300) | `{ ok }`. A new `k` takes this `sec` (at most 5,000 forms); an existing one needs the same `sec` |
| `pull` | `after` (row id) | `{ rows[{ id, v, at }], more }` (≤100) |
| `ack` | `upto` (row id) | `{ n }`: deletes the form's rows up to that id |
| `drop` | | `{ ok }`: deletes the form and its rows |

Errors: `nostore` (503: no binding or a D1 failure), `auth` (403),
`gone` (404), `full`, `bad-request`. Tests: `tests/crm-form-relay.test.js`.

## Send to someone: links with an expiry (`/s/`, op `shr`)

For items too big for a link, or when the sender wants an expiry and a
way to take the link back. The sender's browser encrypts the item
(AES-256-GCM, a random key that lives only in the link's `#fragment`)
and splits it into pieces of at most 256 KiB. The relay only stores
the pieces and never sees a key.

In clear: the id (16 random bytes, base64url), the expiry, the
declared size, the number of pieces, the time, SHA-256 of the upload
token and SHA-256 of the sender's revoke secret. Nothing else, and no
IP in the database.

| Call | What |
|---|---|
| `POST /v1 {op:"shr", act:"new", id, delh, exp, n, size}` | Reserves the item. `delh` = SHA-256 hex of the revoke secret, `exp` ≤ now + 30 days, `n` 1–200, `size` ≤ 25 MB. Answers `{tok}` (32 random bytes, valid for one hour, kept only as SHA-256) |
| `PUT /s/<id>/<i>` | One piece, `Authorization: Bearer <tok>`, only from `ALLOWED_ORIGINS`. `0 ≤ i < n`, each piece once (409), the total never above `size` (413) |
| `POST /v1 {op:"shr", act:"fin", id, tok}` | Needs all `n` pieces and exactly `size` bytes; then the item can be read. Answers `{exp}` |
| `GET /s/<id>/<i>` | One piece, `application/octet-stream`, `nosniff`, `Content-Disposition: attachment`, `Content-Security-Policy: sandbox`, `Cache-Control: no-store`; CORS only for `ALLOWED_ORIGINS`. The same 404 for missing, expired, revoked and not finished |
| `POST /v1 {op:"shr", act:"del", id, del}` | Revoke: deletes everything when SHA-256(`del`) matches. Always `{ok:true}` |

Limits: 25 MB per item, 400 MB in all (declared sizes, counted at
`new`; answer 507 `full`), 20 items and 100 MB per client IP per day,
300 PUT and 600 GET per client IP per minute (separate from `/v1`).
Expired items and uploads unfinished after an hour are deleted by the
hourly cron (`scheduled()` → `purgeShares`, in batches) and on every
`new`. The relay cannot check what it stores (that is the point); the
short expiry, the caps and the attachment/sandbox headers keep it from
being a general file host.

Turning it on (once): a D1 database `oros-share` (Workers & Pages → D1
→ Create), bound as `SHR_DB` in `wrangler.toml` (done for the orOS
relay). The tables are created on first use. Without the binding the op and `/s/` answer
503 `nostore`.

Tests: `tests/share-relay.test.js` (an in-memory D1 that knows exactly
the statements in `SHR_SQL`).

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

## Households (`/h/`)

The Household app (`household/`, engine `household/engine.js` in the
shell) lets people who live together share documents, such as To-Do
lists, each from their own orOS. The relay keeps a household's box; it
never sees a key or a readable byte. Contract: OROS_BIBLE.md, BR-HH.

One Durable Object (`HouseBox`, binding `HOUSE`, SQLite) per household,
addressed `/h/<box>` where `<box>` is 22 base64url characters made on
a device. Allowed origins apply, with a per-IP limit of 240 requests a
minute and 10 new boxes a day.

- **Who may do what.** The box keeps sha256 of the write token
  (`HMAC-SHA256(K, "oros-household/write")`, sent as a Bearer token)
  and of the last 20 tokens, and sha256 of the admin token (header
  `X-HH-Admin`). An invite secret (`Authorization: Invite …`) may only
  file a join request or read its own answer.
- **Documents** (`GET/PUT/DELETE /h/<box>/d/<id>`): opaque bytes, at
  most 300 KB each, 64 per box and 5 MB in all. Every write names the
  revision it read (`If-Match`); a stale one gets 412 with the current
  revision, so a device merges and tries again.
- **Invites and joins:** at most 5 open invites (≤ 30 days, ≤ 20 uses)
  and 10 waiting requests (kept 7 days, 4 KB each); answers ≤ 8 KB.
- **Keys:** `rot` (admin) swaps the write token for a new key epoch and
  leaves one sealed envelope per member (at most 12).
- **Live notices:** `GET /h/<box>/ws` with the subprotocols `hh1` and
  `w.<token>`, at most 40 sockets. The hibernating socket only says what
  changed (`{k, r}`, `{q:1}`, `{e}`, `{x:1}`); the devices then fetch.
- **Wakes with orOS closed** (optional, per device): `POST /h/<box>/p`
  `{ pid, wt, ct }` (current write token) keeps a device's push box id,
  a wake token issued by that push box (`wtok`, it can only `wake`) and
  one packet the device encrypted for itself ("something changed in …");
  `DELETE /h/<box>/p/<pid>` removes it. At most 24 rows, never returned
  by any request, all cleared by a `rot`. A document PUT or DELETE marks
  every other row due (the writer names itself with `X-HH-Dev: <pid>`);
  two minutes later the box's alarm calls each due device's `PushBox`
  (stub to stub, no outbound fetch from the house box) with
  `{ act: "wake", wt, ct }`, at most once per device per 15 minutes; a
  `gone` answer deletes the row, a failed call is not retried. The same
  alarm keeps the idle deadline, each with its own time.
- **Budget and clean-up:** 120 writes a minute per box; an alarm wipes
  a box nobody has opened for 180 days. Nothing is logged.

Answers: 400 (bad request), 403 (origin), 404 (no box, nothing there,
or a wrong token: a wrong token looks exactly like a missing box), 409
(box exists), 410 (join request refused), 412 (stale revision or key
epoch), 413 (too big or full), 426 (not a WebSocket), 428 (a write
without the revision it read), 429 (rate or too many invites, requests,
sockets), 503 (no `HOUSE` binding). Tests: `tests/house-relay.test.js`
and, with the real engine, `tests/household-engine.test.js`.

Like the other Durable Objects, `HouseBox` is declared at the top level
of `wrangler.toml` (binding plus a `new_sqlite_classes` migration
`house-v1`, free plan), so the normal deploy from `main` creates it.

## Notifications with orOS closed (op `push`)

Optional, off by default: a device turns it on in Settings ›
Notifications. That device then has a box here, one SQLite Durable
Object (`PushBox`, binding `PUSH`) named by a random id the page made.
The box holds the device's push endpoint and its next reminders.

The page encrypts every reminder itself (RFC 8291, aes128gcm, with the
subscription's own keys) before it is sent. A box therefore keeps only an
opaque key, a time, a TTL and a packet it cannot read. At that time its
alarm signs a VAPID token (RFC 8292, ES256) and POSTs the packet to the
push service: Google FCM for Chrome and Android, Microsoft WNS for Edge,
Mozilla for Firefox. The service wakes the device's service worker.
These services see the endpoint, the time and the size, never the
content. No cron job and no D1 are involved: each box sets one alarm,
for its next reminder.

| act | Fields | Returns |
|---|---|---|
| `key` | | `{ key }`, the VAPID public key for `pushManager.subscribe` |
| `sub` | `id`, `tok`, `endpoint` | `{ ok }` (creates the box, or changes the endpoint of the same `tok`) |
| `set` | `id`, `tok`, `items[{ k, at, ct, ttl? }]` | `{ n }`. The whole schedule, replaced in one transaction. |
| `test` | `id`, `tok`, `ct` | `{ sent }` (one packet now) |
| `del` | `id`, `tok` | `{ ok }` (the box is erased) |
| `wtok` | `id`, `tok` | `{ wt }`, a wake token for a household box (at most 6 per box; kept as SHA-256) |
| `wdel` | `id`, `tok`, `wt` | `{ ok }` (that wake token no longer works) |

`wake` is not on the public route: only a household box sends it, stub
to stub, with a wake token this box issued and the device's own packet.
It is sent at once with `Urgency: normal` and TTL 900, at most once per
15 minutes per box, and never moves the box's idle deadline.

Rules:
- `id` is exactly 22 base64url characters and `tok` exactly 43, both
  from the page's `crypto.getRandomValues`. The box keeps only the
  SHA-256 of `tok` and compares it in constant time. A wrong `tok` and a
  missing box get the same answer, `gone`.
- The endpoint is parsed with `URL`. It must be https, with no port, no
  user or password and no fragment, and its path must match
  `^/[A-Za-z0-9._~:/%-]+$` (≤ 1 KB). The host must be one of
  `fcm.googleapis.com`, `updates.push.services.mozilla.com`,
  `web.push.apple.com`, or end in `.push.services.mozilla.com`,
  `.notify.windows.com` or `.push.apple.com`. The endpoint is checked at
  `sub` and again before every send. Redirects are never followed
  (`redirect: "manual"`).
- Limits: 300 reminders, each packet ≤ 4096 base64url characters
  (about 3 KB). `at` is at most 8 days ahead and `ttl` 60–3600 s
  (default 900). `sub` is allowed 5 times per IP per day, `test` once
  per box per 30 s and `set` 60 times per box per hour.
- The push request carries `TTL` and `Urgency: high`, and a VAPID JWT
  with `aud` = the endpoint's origin and `exp` 12 h ahead, cached in the
  box's memory.
- What the push service answers:
  - 2xx: sent.
  - 404 or 410: the subscription is dead and the box deletes itself.
  - 429 or 5xx: tried again in 30 s, then in 2 min, then dropped.
  - Anything else (413, other 4xx, a redirect): that reminder is dropped.
- A reminder more than 10 minutes late when the alarm runs (the relay
  was down) is dropped, never rung late. The device's own engine shows
  missed items the next time orOS opens.
- A box with no `set` for 30 days deletes itself (`deleteAll` +
  `deleteAlarm`).
- Errors are fixed codes (`nopush`, `gone`, `rate`, `bad-request`,
  `nostore`). They never carry an exception's text or the push service's
  body. Nothing is logged.

Secrets (Cloudflare dashboard → the Worker → Settings → Variables and
Secrets, type *Secret*):
- `VAPID_PRIVATE`: the P-256 key pair as a JWK, `{"kty":"EC","crv":"P-256","d":…,"x":…,"y":…}`.
- `VAPID_SUBJECT`: `mailto:` + an address the push services can write to.

Without them every `push` request answers 503 `nopush`, and Settings
shows the switch as unavailable.

## Sync through WebDAV: pass-through (`/dav`)

Optional, off by default: the user turns it on in Settings › Sync when
their WebDAV server (Synology, ownCloud, Nextcloud without the
WebAppPassword app) sends no CORS headers. orOS then sends the same
WebDAV request to `/dav`, with the server's full address in the header
`X-Oros-Target`, and gets the server's answer back. The sync data is
end-to-end encrypted before it leaves the browser; the app password in
`Authorization` passes through on every request and is never logged or
stored.

- Target: `https` only, no user name or `#`, a public host name (the
  same `validHost` check, so no IP literals and no local names), port
  443, 5006 (Synology), 8443 or 9443. Workers reach any port on a host
  that is not behind Cloudflare's proxy (`allow_custom_ports`, on since
  compatibility date 2024-09-02); a server behind the proxy only on the
  proxy's own ports.
- Methods `GET HEAD PUT DELETE MKCOL PROPFIND REPORT COPY MOVE`; `POST` only to
  a path ending in `/index.php/login/v2` or `/index.php/login/v2/poll`
  (Nextcloud Login Flow v2, answer capped at 64 KB, 10 a minute per IP).
- Request headers: exactly `Authorization, Content-Type, Content-Length,
  Depth, Destination, Overwrite, If-Match, If-None-Match,
  OCS-APIRequest, Prefer, Brief`; everything else (cookies, `Origin`, `Referer`,
  `CF-*`, `X-Forwarded-*`) is dropped. `Destination` must be on the
  target's own origin.
- Answer headers: only `Content-Type, Content-Length, ETag,
  Last-Modified, DAV, OC-ETag, OC-FileId`, plus `nosniff` and
  `Cache-Control: no-store`; never `Set-Cookie`.
- `PUT` needs `Content-Length` and at most 95 MB (Cloudflare takes
  100 MB); the body streams through, nothing is buffered. Bigger Vault
  files go to Nextcloud in 10 MB pieces (chunked upload) anyway.
- Redirects are not followed and not answered as redirects (the browser
  would follow one itself): `200` with `X-Oros-Status` and
  `X-Oros-Location`.
- Relay refusals: status + `X-Oros-Error` with a fixed code (`origin`,
  `bad-target`, `port`, `method`, `length`, `too-big`, `rate`,
  `timeout`, `upstream`), never an error's text. The server's own
  errors pass through as their status.
- Its own rate limit: about 600 requests a minute per IP (a sync round
  lists folders one by one), timeout 60 s until the server answers
  (`PUT` 5 min).

CalDAV / CardDAV (since 2026-10-31): Calendar, Contacts and To-Do sync
with the user's own CalDAV / CardDAV server (Nextcloud, Radicale,
Baïkal, mailbox.org, Fastmail, iCloud) goes through the same `/dav`,
also only when the user turns it on. It adds the method `REPORT`
(sync-collection, calendar-multiget, addressbook-multiget; body capped
at 64 KB like `PROPFIND`) and the request headers `Prefer` and `Brief`.
This data is **not** end-to-end encrypted: events, contacts and tasks
pass through in plain form, and like everything else here they are
never logged or stored.

Tests: `tests/dav-relay.test.js`.

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

## Maps: live bus arrivals in Athens (op `oasa`)

`POST /v1 { op: "oasa", act, p1 }` with `act` one of `getStopArrivals`,
`getRoutesForStop`, `getStopNameAndXY` and `p1` an OASA stop code
(`^\d{1,10}$`). The relay builds `https://telematics.oasa.gr/api/?act=<act>&p1=<p1>`
itself, GETs it without cookies and without following redirects
(a 3xx is an error), with an 8 s timeout, reads at most 64 KB and
returns the parsed JSON (`null` when no bus is coming). Errors are
fixed codes: `upstream`, `timeout`, `too-big`, `bad-request`; the
upstream text is never passed on and nothing is logged. Answers sit
in `caches.default` for 15 s per URL. OASA answers requests from
Greece only, so this works when the request reaches Cloudflare's
Athens location (a US location times out; checked 2026-10-17). Code:
`oasa.js`; tests: `tests/oasa-relay.test.js`.
