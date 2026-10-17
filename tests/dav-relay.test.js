// Sync through WebDAV, wave W3: the relay's WebDAV pass-through
// (relay/dav.js through relay/core.js) against a fake upstream that
// records what reached it.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
let handle, D;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  D = await import("../relay/dav.js");
});

const ORIGIN = "https://useoros.online";
const TARGET = "https://cloud.example.com/remote.php/dav/files/u/orOS/orOS-data.json";
const T0 = Date.UTC(2026, 9, 17, 10, 0, 0);
let ipN = 0;

// One call: { method, target, headers, body, ip, origin, upstream(url, init) → Response }.
async function call(o) {
  const seen = [];
  const headers = Object.assign({}, o.headers || {});
  if (o.origin !== null) headers.Origin = o.origin || ORIGIN;
  if (o.target !== null) headers["X-Oros-Target"] = o.target || TARGET;
  headers["CF-Connecting-IP"] = o.ip || ("10.0.0." + (++ipN));
  const req = new Request("https://relay.test/dav", { method: o.method || "GET", headers, body: o.body, duplex: o.duplex });
  const res = await handle(req, {}, null, o.now || T0, async (url, init) => {
    seen.push({ url, init });
    if (o.upstream) return o.upstream(url, init);
    return new Response("hello", { status: 200, headers: { ETag: '"e1"', "Set-Cookie": "s=1", "X-Secret": "x" } });
  });
  return { res, seen };
}

test("a GET reaches the target with only the allowed headers and comes back with only the allowed headers", async () => {
  const { res, seen } = await call({ headers: { Authorization: "Basic dTpw", Cookie: "c=1", Referer: "https://useoros.online/",
    "X-Forwarded-For": "1.2.3.4", "CF-Ray": "abc", Depth: "1" } });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "hello");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, TARGET);
  const h = seen[0].init.headers;
  assert.equal(h.get("Authorization"), "Basic dTpw");
  assert.equal(h.get("Depth"), "1");
  for (const k of ["Cookie", "Origin", "Referer", "X-Forwarded-For", "CF-Ray", "CF-Connecting-IP", "X-Oros-Target"]) {
    assert.equal(h.get(k), null, k + " is not forwarded");
  }
  assert.equal(seen[0].init.redirect, "manual");
  assert.ok(!("credentials" in seen[0].init), "no credentials option (workerd throws)");
  assert.equal(res.headers.get("ETag"), '"e1"');
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.equal(res.headers.get("X-Secret"), null);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(res.headers.get("Access-Control-Expose-Headers"), /ETag/);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
});

test("targets: https only, public names only, no userinfo or hash, a short list of ports", async () => {
  const bad = {
    "http://cloud.example.com/x": "bad-target",
    "https://u:p@cloud.example.com/x": "bad-target",
    "https://cloud.example.com/x#f": "bad-target",
    "https://192.168.1.10/x": "bad-target",
    "https://[::1]/x": "bad-target",
    "https://[2001:db8::1]/x": "bad-target",
    "https://nas.local/x": "bad-target",
    "https://localhost/x": "bad-target",
    "not a url": "bad-target",
    "https://cloud.example.com:22/x": "port",
    "https://cloud.example.com:8080/x": "port"
  };
  for (const [target, code] of Object.entries(bad)) {
    const { res, seen } = await call({ target });
    assert.equal(res.headers.get("X-Oros-Error"), code, target);
    assert.equal(res.status, 400, target);
    assert.equal(seen.length, 0, target);
  }
  for (const port of ["", ":443", ":5006", ":8443", ":9443"]) {
    const { res, seen } = await call({ target: "https://nas.example.com" + port + "/webdav/x" });
    assert.equal(res.status, 200, port);
    assert.equal(seen.length, 1, port);
  }
  const { res } = await call({ target: null });
  assert.equal(res.headers.get("X-Oros-Error"), "bad-target");
});

test("Destination must stay on the target's own origin", async () => {
  const ok = await call({ method: "COPY", headers: { Destination: "https://cloud.example.com/remote.php/dav/files/u/orOS/b.json" } });
  assert.equal(ok.res.status, 200);
  assert.equal(ok.seen[0].init.headers.get("Destination"), "https://cloud.example.com/remote.php/dav/files/u/orOS/b.json");
  for (const d of ["https://evil.example.com/x", "https://cloud.example.com:8443/x", "http://cloud.example.com/x", "nope"]) {
    const { res, seen } = await call({ method: "MOVE", headers: { Destination: d } });
    assert.equal(res.headers.get("X-Oros-Error"), "bad-target", d);
    assert.equal(seen.length, 0, d);
  }
});

test("methods: WebDAV ones only; POST only to Nextcloud's Login Flow v2", async () => {
  for (const m of ["PATCH", "LOCK", "PROPPATCH"]) {
    const { res, seen } = await call({ method: m });
    assert.equal(res.status, 405, m);
    assert.equal(res.headers.get("X-Oros-Error"), "method", m);
    assert.equal(seen.length, 0, m);
  }
  const post = await call({ method: "POST", target: "https://cloud.example.com/remote.php/dav/files/u/x" });
  assert.equal(post.res.headers.get("X-Oros-Error"), "method");
  for (const p of ["/index.php/login/v2", "/nextcloud/index.php/login/v2", "/index.php/login/v2/poll"]) {
    const { res, seen } = await call({ method: "POST", target: "https://cloud.example.com" + p,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=abc",
      upstream: () => new Response('{"poll":{}}', { status: 200, headers: { "Content-Type": "application/json" } }) });
    assert.equal(res.status, 200, p);
    assert.equal(await res.text(), '{"poll":{}}', p);
    assert.equal(Buffer.from(seen[0].init.body).toString(), "token=abc", p);
  }
  const huge = await call({ method: "POST", target: "https://cloud.example.com/index.php/login/v2",
    upstream: () => new Response("x".repeat(70 * 1024)) });
  assert.equal(huge.res.headers.get("X-Oros-Error"), "too-big", "a login answer over 64 KB is refused");
});

test("PROPFIND and MKCOL pass with their bodies; redirects are reported, never followed", async () => {
  const xml = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>';
  const pf = await call({ method: "PROPFIND", headers: { Depth: "1", "Content-Type": "application/xml" }, body: xml,
    upstream: () => new Response("<d:multistatus/>", { status: 207, headers: { "Content-Type": "application/xml" } }) });
  assert.equal(pf.res.status, 207);
  assert.equal(Buffer.from(pf.seen[0].init.body).toString(), xml);
  const mk = await call({ method: "MKCOL", upstream: () => new Response(null, { status: 201 }) });
  assert.equal(mk.res.status, 201);

  const r = await call({ upstream: () => new Response(null, { status: 301, headers: { Location: "/remote.php/dav/files/u/" } }) });
  assert.equal(r.seen.length, 1, "only the one request; the redirect is not followed");
  assert.equal(r.res.status, 200);
  assert.equal(r.res.headers.get("Location"), null, "no Location the browser would follow");
  assert.equal(r.res.headers.get("X-Oros-Status"), "301");
  assert.equal(r.res.headers.get("X-Oros-Location"), "https://cloud.example.com/remote.php/dav/files/u/");
});

test("PUT needs a Content-Length of at most 95 MB and streams through", async () => {
  const put = await call({ method: "PUT", headers: { "Content-Length": "3", "If-Match": '"e1"' }, body: Buffer.from("abc"),
    upstream: async (u, init) => {
      assert.equal(init.duplex, "half");
      assert.equal(init.headers.get("If-Match"), '"e1"');
      assert.equal(Buffer.from(await new Response(init.body).arrayBuffer()).toString(), "abc");
      return new Response(null, { status: 412 });
    } });
  assert.equal(put.res.status, 412, "the server's status passes through");
  const noLen = await call({ method: "PUT", body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } }),
    duplex: "half" });
  assert.equal(noLen.res.status, 411);
  assert.equal(noLen.res.headers.get("X-Oros-Error"), "length");
  assert.equal(noLen.seen.length, 0);
  const big = await call({ method: "PUT", headers: { "Content-Length": String(95 * 1024 * 1024 + 1) } });
  assert.equal(big.res.status, 413);
  assert.equal(big.res.headers.get("X-Oros-Error"), "too-big");
  assert.equal(big.seen.length, 0);
});

test("upstream failures and timeouts answer a fixed code, never the error's text", async () => {
  const down = await call({ upstream: () => { throw new Error("connect ECONNREFUSED 1.2.3.4:443 secret"); } });
  assert.equal(down.res.status, 502);
  assert.equal(down.res.headers.get("X-Oros-Error"), "upstream");
  assert.equal(await down.res.text(), "upstream");
  const keep = D.DAV_LIMITS.timeout;
  D.DAV_LIMITS.timeout = 30;
  try {
    const slow = await call({ upstream: (u, init) => new Promise((ok, no) => {
      init.signal.addEventListener("abort", () => no(new Error("aborted")));
    }) });
    assert.equal(slow.res.status, 504);
    assert.equal(slow.res.headers.get("X-Oros-Error"), "timeout");
  } finally { D.DAV_LIMITS.timeout = keep; }
  const err = await call({ upstream: () => new Response("Sabre\\DAV\\Exception: internal details", { status: 500 }) });
  assert.equal(err.res.status, 500, "an upstream error passes as its status");
});

test("CORS: OPTIONS answers only for orOS; other origins get 403 and nothing is fetched", async () => {
  const pre = await call({ method: "OPTIONS" });
  assert.equal(pre.res.status, 204);
  assert.match(pre.res.headers.get("Access-Control-Allow-Methods"), /PROPFIND/);
  assert.match(pre.res.headers.get("Access-Control-Allow-Headers"), /X-Oros-Target/);
  assert.match(pre.res.headers.get("Access-Control-Allow-Headers"), /If-Match/);
  assert.equal(pre.seen.length, 0);
  const evil = await call({ method: "OPTIONS", origin: "https://evil.example.com" });
  assert.equal(evil.res.status, 403);
  const none = await call({ method: "OPTIONS", origin: null });
  assert.equal(none.res.status, 403);
  const get = await call({ origin: "https://evil.example.com" });
  assert.equal(get.res.status, 403);
  assert.equal(get.res.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(get.seen.length, 0);
});

test("rate limit: about 600 a minute per address, 10 a minute for the login flow", async () => {
  const ip = "10.9.9.9";
  let last;
  for (let i = 0; i < D.DAV_LIMITS.perMinute; i++) last = await call({ ip });
  assert.equal(last.res.status, 200);
  const over = await call({ ip });
  assert.equal(over.res.status, 429);
  assert.equal(over.res.headers.get("X-Oros-Error"), "rate");
  assert.equal((await call({ ip, now: T0 + 61000 })).res.status, 200, "a minute later it passes again");

  const lip = "10.9.9.8", login = "https://cloud.example.com/index.php/login/v2";
  for (let i = 0; i < D.DAV_LIMITS.loginPerMinute; i++) {
    assert.equal((await call({ ip: lip, method: "POST", target: login })).res.status, 200);
  }
  assert.equal((await call({ ip: lip, method: "POST", target: login })).res.status, 429);
  assert.equal((await call({ ip: lip })).res.status, 200, "WebDAV requests keep their own allowance");
});

test("the relay never writes Authorization anywhere", async () => {
  const logs = [];
  const keep = [console.log, console.error, console.warn, console.info];
  console.log = console.error = console.warn = console.info = (...a) => logs.push(a.join(" "));
  try {
    await call({ headers: { Authorization: "Basic c2VjcmV0" } });
    await call({ headers: { Authorization: "Basic c2VjcmV0" }, upstream: () => { throw new Error("x"); } });
  } finally {
    [console.log, console.error, console.warn, console.info] = keep;
  }
  assert.ok(!logs.some((l) => /c2VjcmV0/.test(l)));
  assert.deepEqual(logs, []);
});
