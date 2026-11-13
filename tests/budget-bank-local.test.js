// Budget's banks in the installed orOS, Portable and USB (BK-LOCAL,
// Chris 2026-11-13): they serve themselves at http://localhost:47800 and
// the relay refused that origin, so every update ended in "(relay)".
// The relay now answers that origin for Enable Banking and PayPal reads
// only (relay/core.js LOCAL_OPS); connecting or renewing a bank stays at
// useoros.online, where the bank's return page is. Nothing leaves Node.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let handle, LOCAL_OPS;
test.before(async () => {
  ({ handle, LOCAL_OPS } = await import("../relay/core.js"));
});

const WEB = "https://useoros.online", LOCAL = "http://localhost:47800";
const ENV = { ALLOWED_ORIGINS: WEB };
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJlbmFibGViYW5raW5nLmNvbSJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ";
let ipN = 0;
async function post(origin, body, fetchFn) {
  const r = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "10.8.0." + (ipN++ % 250) },
    body: JSON.stringify(body) });
  const res = await handle(r, ENV, null, Date.now(), fetchFn);
  return { status: res.status, acao: res.headers.get("Access-Control-Allow-Origin"), body: await res.json() };
}
function fakeBank(calls) {
  return async (u, o) => { calls.push(String(u)); return new Response(JSON.stringify({ name: "app" }), { status: 200, headers: { "Content-Type": "application/json" } }); };
}

test("LOCAL_OPS is Budget's bank reads only", () => {
  assert.deepEqual(LOCAL_OPS, { ext: ["ebank", "paypal"] });
});

test("the installed orOS (localhost:47800) reaches Enable Banking through the relay", async () => {
  const calls = [];
  const r = await post(LOCAL, { op: "ext", p: "ebank", key: JWT, reqs: [{ m: "GET", path: "/application" }] }, fakeBank(calls));
  assert.equal(r.status, 200);
  assert.equal(r.acao, LOCAL, "CORS for the local page, so it can read the answer");
  assert.equal(r.body.ok, true);
  assert.equal(r.body.data.res[0].status, 200);
  assert.deepEqual(calls, ["https://api.enablebanking.com/application"]);
  // useoros.online as before
  const w = await post(WEB, { op: "ext", p: "ebank", key: JWT, reqs: [{ m: "GET", path: "/application" }] }, fakeBank([]));
  assert.equal(w.status, 200);
  assert.equal(w.acao, WEB);
});

test("the preflight answers the local page; other pages get nothing", async () => {
  const pre = async (origin) => handle(new Request("https://relay.example/v1", { method: "OPTIONS", headers: { Origin: origin } }), ENV, null, Date.now());
  const l = await pre(LOCAL);
  assert.equal(l.status, 204);
  assert.equal(l.headers.get("Access-Control-Allow-Origin"), LOCAL);
  for (const o of ["https://evil.example", "http://localhost:3000", "http://127.0.0.1:47800", ""]) {
    const x = await pre(o);
    assert.equal(x.status, 403, o);
    assert.equal(x.headers.get("Access-Control-Allow-Origin"), null, o);
  }
});

test("from the local page every other op and service is refused, before anything is fetched", async () => {
  const calls = [];
  const f = fakeBank(calls);
  for (const b of [
    { op: "ext", p: "stripe", key: "rk_live_" + "x".repeat(24), reqs: [{ m: "GET", path: "/v1/balance" }] },
    { op: "ext", p: "woo", host: "shop.example", base: "", ck: "ck_" + "a".repeat(40), cs: "cs_" + "a".repeat(40), reqs: [{ m: "GET", path: "/products" }] },
    { op: "ext", reqs: [] },
    { op: "web", reqs: [{ url: "https://example.com/" }] },
    { op: "list", acct: { host: "imap.example.com", port: 993, sec: "tls", user: "u", pass: "p" } },
    { op: "toString", p: "ebank" },
    { op: "__proto__", p: "ebank" },
    null
  ]) {
    const r = await post(LOCAL, b, f);
    assert.equal(r.status, 403, JSON.stringify(b));
    assert.equal(r.body.error.code, "origin", JSON.stringify(b));
  }
  assert.equal(calls.length, 0);
  // other pages: refused as before, with no CORS header
  for (const o of ["https://evil.example", "http://127.0.0.1:47800", "http://localhost:47801"]) {
    const r = await post(o, { op: "ext", p: "ebank", key: JWT, reqs: [{ m: "GET", path: "/application" }] }, f);
    assert.equal(r.status, 403, o);
    assert.equal(r.acao, null, o);
  }
  assert.equal(calls.length, 0);
});

test("banklive: reads and the set times run locally; connecting and renewing stay at useoros.online", () => {
  const lv = read("budget/banklive.js");
  assert.match(lv, /function localOrigin\(\) \{\s*try \{ return root\.location\.origin === "http:\/\/localhost:47800"; \}/);
  assert.match(lv, /function canRead\(\) \{ return webOrigin\(\) \|\| localOrigin\(\); \}/);
  assert.match(lv, /function bgRun\(\) \{\s*if \(!canRead\(\) \|\| !canAuto\(\)/);
  assert.match(lv, /function connect\(bank, psu, la\) \{[\s\S]{0,140}if \(!webOrigin\(\)\) \{ A\.showToast\(t\("localConnect"\)\); return; \}/);
  assert.match(lv, /if \(app\(\) && keysHere && webOrigin\(\)\) body\.appendChild\(connSection\(\)\);/);
  assert.match(lv, /if \(localOrigin\(\)\) body\.appendChild\(el\("p", "hint bk-web", t\("localOnly"\)\)\);\s*else if \(!webOrigin\(\)\)/);
  for (const k of ["localOnly", "localConnect", "webOnly"]) {
    assert.equal((lv.match(new RegExp("\\b" + k + ": \"", "g")) || []).length, 2, k + " EN + EL");
  }
  // the help says it, in both languages
  assert.match(read("budget/help.en.txt"), /Installed orOS, Portable and USB\.\*\* Banks and PayPal update there too/);
  assert.match(read("budget/help.el.txt"), /Εγκατεστημένο orOS, Portable και USB\.\*\* Οι τράπεζες και το PayPal ενημερώνονται και εκεί/);
});
