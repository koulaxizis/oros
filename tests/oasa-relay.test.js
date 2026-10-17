// OASA Telematics through the relay (relay/oasa.js via relay/core.js,
// op "oasa"): the act/parameter allowlist, the fixed URL, redirects,
// the 64 KB cap, the timeout, non-JSON answers, fixed error codes and
// the short cache. The upstream is a fake fetch; nothing leaves Node.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
let handle, O;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  O = await import("../relay/oasa.js");
});

const ORIGIN = "https://useoros.online";
const ENV = { ALLOWED_ORIGINS: ORIGIN };
let ipN = 0;
async function op(body, fetchFn) {
  const r = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.9.0." + (ipN++ % 250) },
    body: JSON.stringify(Object.assign({ op: "oasa" }, body)) });
  const res = await handle(r, ENV, null, Date.now(), fetchFn);
  return { status: res.status, body: await res.json() };
}
const ARR = [{ route_code: "1989", veh_code: "88084", btime2: "1" }, { route_code: "1989", veh_code: "88017", btime2: "12" }];

test("allowlist: act and stop code", async () => {
  const calls = [];
  const f = async (u) => { calls.push(u); return new Response(JSON.stringify(ARR), { status: 200, headers: { "Content-Type": "text/html" } }); };
  for (const bad of [{ act: "getLines", p1: "061260" }, { act: "toString", p1: "1" }, { act: "getStopArrivals", p1: "06a" },
    { act: "getStopArrivals", p1: "1&act=x" }, { act: "getStopArrivals", p1: 61260 }, { act: "getStopArrivals", p1: "12345678901" },
    { act: "getStopArrivals" }, { act: "getStopArrivals", p1: "" }]) {
    const r = await op(bad, f);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error.code, "bad-request");
  }
  assert.equal(calls.length, 0, "nothing fetched for a refused request");
  const r = await op({ act: "getStopArrivals", p1: "061260", url: "https://evil.example/" }, f);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, data: ARR });
  assert.deepEqual(calls, ["https://telematics.oasa.gr/api/?act=getStopArrivals&p1=061260"], "fixed host, URL built by the relay");
  assert.equal(O.validOasa({ act: "getRoutesForStop", p1: "1" }), "");
  assert.equal(O.validOasa({ act: "getStopNameAndXY", p1: "0123456789" }), "");
});

test("fetch options: GET, no redirects followed, no credentials", async () => {
  let seen;
  await op({ act: "getRoutesForStop", p1: "061260" }, async (u, o) => { seen = o; return new Response("[]", { status: 200 }); });
  assert.equal(seen.method, "GET");
  assert.equal(seen.redirect, "manual");
  assert.ok(seen.signal);
  assert.equal(seen.credentials, undefined);
});

test("null at night, and fixed error codes", async () => {
  let r = await op({ act: "getStopArrivals", p1: "061260" }, async () => new Response("null", { status: 200 }));
  assert.deepEqual(r.body, { ok: true, data: null });
  const cases = [
    [async () => new Response("", { status: 302, headers: { Location: "https://elsewhere.example/" } }), "upstream"],
    [async () => new Response("<html>Server error at /var/www</html>", { status: 500 }), "upstream"],
    [async () => new Response("<html>not json</html>", { status: 200 }), "upstream"],
    [async () => new Response("42", { status: 200 }), "upstream"],
    [async () => { throw new TypeError("connect ECONNREFUSED 1.2.3.4"); }, "upstream"],
    [async () => new Response("[" + "1,".repeat(40000) + "1]", { status: 200 }), "too-big"]
  ];
  for (const [f, code] of cases) {
    r = await op({ act: "getStopArrivals", p1: "061260" }, f);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.deepEqual(r.body.error, { code, msg: code }, "fixed code, no upstream text: " + code);
  }
});

test("timeout after 8 s", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = (u, o) => new Promise((res, rej) => { o.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }); });
  const p = O.runOasa({ act: "getStopArrivals", p1: "1" }, f, null);
  t.mock.timers.tick(O.OASA_LIMITS.timeout - 1);
  let done = false;
  p.then(() => {}, () => {}).finally(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  t.mock.timers.tick(2);
  await assert.rejects(p, (e) => e instanceof O.OasaError && e.code === "timeout");
});

test("15 s cache per URL", async () => {
  const store = new Map();
  const cache = {
    match: async (req) => store.get(req.url) ? store.get(req.url).clone() : undefined,
    put: async (req, res) => { store.set(req.url, res); }
  };
  let n = 0;
  const f = async () => { n++; return new Response(JSON.stringify(ARR), { status: 200 }); };
  const b = { act: "getStopArrivals", p1: "061260" };
  assert.deepEqual(await O.runOasa(b, f, cache), ARR);
  assert.deepEqual(await O.runOasa(b, f, cache), ARR);
  assert.equal(n, 1, "second call served from the cache");
  assert.match(store.get(O.oasaUrl(b)).headers.get("Cache-Control"), /max-age=15/);
  await O.runOasa({ act: "getStopArrivals", p1: "061261" }, f, cache);
  assert.equal(n, 2, "another stop is another entry");
});
