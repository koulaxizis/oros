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
| `imap.js` | Minimal IMAP4rev1 client (login, LIST, STATUS, EXAMINE/SELECT, UID SEARCH/FETCH/STORE) |
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

Error codes: `origin`, `rate`, `bad-request`, `connect`, `tls`,
`auth`, `timeout`, `closed`, `proto`, `no`, `gone`, `too-big`.

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

Tests: `tests/feeds.test.js` drives `core.js` + `web.js` with a fake
`fetch`.

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
