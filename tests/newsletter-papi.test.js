// Newsletter phase 3C: the relay's "papi" operation (relay/papi.js
// through relay/core.js), a fixed-host, allowlisted proxy to provider
// HTTP APIs, against a mocked fetch. Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
let handle, P;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  P = await import("../relay/papi.js");
});

const ORIGIN = "https://useoros.online";
const ENV = { ALLOWED_ORIGINS: ORIGIN };
const KEY = "xkeysib-SECRETSECRET-123";
let ip = 0;
async function call(body, f) {
  const r = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.2.0." + (ip++ % 250) }, body: JSON.stringify(body) });
  const res = await handle(r, ENV, null, Date.now(), f);
  return { status: res.status, json: await res.json() };
}
function mock(fn) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return fn ? fn(url, init) : new Response("{\"ok\":1}", { status: 200 }); };
  f.calls = calls;
  return f;
}
const v = (o) => P.validPapi(Object.assign({ op: "papi", prov: "brevo", key: KEY, reqs: [{ m: "GET", path: "/account" }] }, o));

test("validation: fixed providers, exact paths, whitelisted query values", () => {
  assert.equal(v({}), "");
  assert.equal(v({ prov: "evil" }), "prov");
  assert.equal(v({ prov: "__proto__" }), "prov");
  assert.equal(v({ key: "has space" }), "key");
  assert.equal(v({ key: "a\r\nX-Evil: 1" }), "key");
  const bad = ["/account/../smtp", "/%2e%2e/account", "//evil.com/x", "/account@evil.com", "/account#x", "/acc\\ount", "/./account",
               "/smtp/email?x=1", "/contacts", "/account?limit=1"];
  for (const path of bad) assert.notEqual(v({ reqs: [{ m: "GET", path }] }), "", path);
  assert.equal(v({ reqs: [{ m: "GET", path: "/smtp/statistics/events?event=hardBounces&limit=500&offset=0&startDate=2026-10-01" }] }), "");
  assert.equal(v({ reqs: [{ m: "GET", path: "/smtp/statistics/events?event=hardBounces&event=spam" }] }), "query");
  assert.equal(v({ reqs: [{ m: "GET", path: "/smtp/statistics/events?limit=abc" }] }), "query");
  assert.equal(v({ reqs: [{ m: "POST", path: "/smtp/email", body: "{}" }] }), "");
  assert.equal(v({ reqs: [{ m: "POST", path: "/smtp/email" }] }), "body");
  assert.equal(v({ reqs: [{ m: "DELETE", path: "/account" }] }), "method");
  // Mailgun: its domain only, MIME as multipart
  const mg = (o) => v(Object.assign({ prov: "mailgun", dom: "mg.example.com" }, o));
  assert.equal(mg({ reqs: [{ m: "POST", path: "/mg.example.com/messages.mime", type: "multipart/form-data", to: "a@x.gr", mime: btoa("Subject: x\r\n\r\nhi") }] }), "");
  assert.equal(mg({ reqs: [{ m: "POST", path: "/other.com/messages.mime", type: "multipart/form-data", to: "a@x.gr", mime: "aGk=" }] }), "path");
  assert.equal(mg({ reqs: [{ m: "GET", path: "/mg.example.com/bounces?limit=100" }] }), "");
  assert.equal(mg({ dom: "localhost" }), "dom");
  assert.equal(v({ dom: "mg.example.com" }), "dom");
  assert.equal(v({ reqs: Array.from({ length: 41 }, () => ({ m: "GET", path: "/account" })) }), "reqs");
});

test("size: 4 MB in all per call; the 64 KB rule still holds for other ops", async () => {
  const big = "x".repeat(1.5 * 1024 * 1024);
  assert.equal(v({ reqs: [1, 2].map(() => ({ m: "POST", path: "/smtp/email", body: big })) }), "");
  assert.equal(v({ reqs: [1, 2, 3].map(() => ({ m: "POST", path: "/smtp/email", body: big })) }), "too-big");
  assert.equal(v({ reqs: [{ m: "POST", path: "/smtp/email", body: "x".repeat(2 * 1024 * 1024 + 1) }] }), "body");
  const f = mock();
  const r = await call({ op: "papi", prov: "brevo", key: KEY, reqs: [1, 2].map(() => ({ m: "POST", path: "/smtp/email", body: big })) }, f);
  assert.equal(r.json.ok, true);
  const other = await call({ op: "web", reqs: [{ url: "https://example.com/feed" }], pad: "x".repeat(70 * 1024) }, f);
  assert.equal(other.status, 413);
});

test("forwarding: fixed host, provider auth, only fixed headers, no redirects", async () => {
  const f = mock((url) => (/account/.test(url) ? new Response("", { status: 302, headers: { Location: "https://evil.example/" } })
                                                : new Response("{\"messageId\":\"1\"}", { status: 201 })));
  const r = await call({ op: "papi", prov: "brevo", key: KEY, reqs: [{ m: "POST", path: "/smtp/email", body: "{\"to\":[]}" }, { m: "GET", path: "/account" }] }, f);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.data.res.map((x) => x.status), [201, 302]);
  assert.equal(f.calls[0].url, "https://api.brevo.com/v3/smtp/email");
  const h = f.calls[0].init.headers;
  assert.deepEqual(Object.keys(h).sort(), ["Accept", "Content-Type", "api-key"]);
  assert.equal(h["api-key"], KEY);
  assert.equal(f.calls[0].init.body, "{\"to\":[]}");                  // passed through, not re-parsed
  assert.equal(f.calls[0].init.redirect, "manual");
  assert.equal(f.calls[0].init.credentials, "omit");
  assert.equal(f.calls.length, 2);                                       // the 302 was not followed
  const auths = {};
  for (const [prov, path, extra] of [["postmark", "/server"], ["sendgrid", "/user/profile"], ["mailgun-eu", "/domains/mg.example.com", { dom: "mg.example.com" }]]) {
    const g = mock();
    await call(Object.assign({ op: "papi", prov, key: KEY, reqs: [{ m: "GET", path }] }, extra || {}), g);
    auths[prov] = [g.calls[0].url, Object.entries(g.calls[0].init.headers).find(([k]) => k !== "Accept")];
  }
  assert.deepEqual(auths.postmark, ["https://api.postmarkapp.com/server", ["X-Postmark-Server-Token", KEY]]);
  assert.deepEqual(auths.sendgrid, ["https://api.sendgrid.com/v3/user/profile", ["Authorization", "Bearer " + KEY]]);
  assert.deepEqual(auths["mailgun-eu"], ["https://api.eu.mailgun.net/v3/domains/mg.example.com", ["Authorization", "Basic " + btoa("api:" + KEY)]]);
});

test("Mailgun MIME goes as multipart built from the base64", async () => {
  const f = mock();
  const mime = "Subject: Γεια\r\n\r\nhi";
  const b64 = Buffer.from(mime, "utf8").toString("base64");
  await call({ op: "papi", prov: "mailgun", dom: "mg.example.com", key: KEY,
               reqs: [{ m: "POST", path: "/mg.example.com/messages.mime", type: "multipart/form-data", to: "a@x.gr", mime: b64 }] }, f);
  const body = f.calls[0].init.body;
  assert.ok(body instanceof FormData);
  assert.equal(body.get("to"), "a@x.gr");
  assert.equal(Buffer.from(await body.get("message").arrayBuffer()).toString("utf8"), mime);
  assert.equal(f.calls[0].init.headers["Content-Type"], undefined);     // fetch sets the boundary
});

test("concurrency stays at 6; the budget turns unstarted items into timeouts", async () => {
  let open = 0, peak = 0;
  const f = async () => { open++; peak = Math.max(peak, open); await new Promise((r) => setTimeout(r, 5)); open--; return new Response("{}"); };
  const r = await P.runPapi({ prov: "brevo", key: KEY, reqs: Array.from({ length: 30 }, () => ({ m: "GET", path: "/account" })) }, f);
  assert.equal(peak, 6);
  assert.ok(r.res.every((x) => x.status === 200));
  // a clock past the budget after the first few requests
  let t = 0;
  const clock = () => t;
  const g = async () => { t += 10000; return new Response("{}"); };
  const s = await P.runPapi({ prov: "brevo", key: KEY, reqs: Array.from({ length: 12 }, () => ({ m: "GET", path: "/account" })) }, g, clock);
  assert.ok(s.res.some((x) => x.err === "timeout"));
  assert.ok(s.res.some((x) => x.status === 200));
  assert.equal(s.res.length, 12);
});

test("response caps: 256 KB per body, 2 MB in all", async () => {
  const f = async (url) => new Response("y".repeat(200 * 1024));
  const r = await P.runPapi({ prov: "brevo", key: KEY, reqs: Array.from({ length: 15 }, () => ({ m: "GET", path: "/account" })) }, f);
  const ok = r.res.filter((x) => typeof x.body === "string").length;
  assert.equal(ok, 10);
  assert.ok(r.res.filter((x) => x.err === "too-big").length === 5);
  const g = async () => new Response("z".repeat(300 * 1024));
  const s = await P.runPapi({ prov: "brevo", key: KEY, reqs: [{ m: "GET", path: "/account" }] }, g);
  assert.deepEqual(s.res[0], { status: 200, err: "too-big" });
});

test("the key never appears in any answer or error", async () => {
  const outs = [];
  outs.push(await call({ op: "papi", prov: "brevo", key: KEY, reqs: [{ m: "GET", path: "/account" }] },
                       async (url) => { throw new Error("fetch failed for " + url + " with api-key " + KEY); }));
  outs.push(await call({ op: "papi", prov: "brevo", key: KEY, reqs: [{ m: "GET", path: "/nope" }] }, mock()));
  outs.push(await call({ op: "papi", prov: "mailgun", dom: "mg.example.com", key: KEY, reqs: [{ m: "GET", path: "/domains/mg.example.com" }] },
                       async () => { throw new TypeError("bad " + btoa("api:" + KEY)); }));
  for (const o of outs) {
    const s = JSON.stringify(o);
    assert.doesNotMatch(s, /SECRETSECRET/);
    assert.ok(s.indexOf(btoa("api:" + KEY)) < 0);
  }
  assert.deepEqual(outs[0].json.data.res[0], { err: "network" });
  assert.equal(outs[1].json.error.code, "bad-request");
});

test("op papi stays origin-gated", async () => {
  const f = mock();
  const r = new Request("https://relay.example/v1", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify({ op: "papi", prov: "brevo", key: KEY, reqs: [{ m: "GET", path: "/account" }] }) });
  const res = await handle(r, ENV, null, Date.now(), f);
  assert.equal(res.status, 403);
  assert.equal(f.calls.length, 0);
});
