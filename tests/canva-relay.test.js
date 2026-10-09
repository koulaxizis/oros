// Atelier: the relay's "canva" operation (relay/canva.js through
// relay/core.js) against a mocked Canva API. Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
let handle, validCanva, fileUrl;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  ({ validCanva, fileUrl } = await import("../relay/canva.js"));
});

const ORIGIN = "https://useoros.online";
const ENV = { ALLOWED_ORIGINS: ORIGIN, CANVA_CLIENT_ID: "OC-abc", CANVA_CLIENT_SECRET: "s3cret" };
function req(body, origin) {
  return new Request("https://relay.example/v1", { method: "POST", headers: { Origin: origin || ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function mock(routes) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    for (const [re, fn] of routes) if (re.test(url)) return fn(url, init);
    return new Response("{}", { status: 404 });
  };
  f.calls = calls;
  return f;
}
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } });
const V = "v".repeat(43);
let ip = 0;
async function run(body, env, f) {
  const r = req(body);
  r.headers.set("CF-Connecting-IP", "10.0.0." + (ip++ % 200));
  const res = await handle(r, env || ENV, null, Date.now(), f);
  return res;
}

test("validation", () => {
  const o = [ORIGIN];
  assert.equal(validCanva({ act: "nope" }, o), "act");
  assert.equal(validCanva({ act: "token", code: "c", verifier: V, redirect: ORIGIN + "/atelier/canva-callback.html" }, o), "");
  assert.equal(validCanva({ act: "token", code: "c", verifier: V, redirect: "https://evil.example/cb" }, o), "redirect");
  assert.equal(validCanva({ act: "token", code: "c", verifier: "short", redirect: ORIGIN + "/cb" }, o), "verifier");
  assert.equal(validCanva({ act: "designs", token: "a\r\nb" }, o), "token");
  assert.equal(validCanva({ act: "export", token: "t", id: "../x" }, o), "id");
  assert.equal(validCanva({ act: "job", token: "t", job: "J1" }, o), "");
  assert.equal(fileUrl("https://export-download.canva.com/a/b.pptx?x=1").hostname, "export-download.canva.com");
  assert.equal(fileUrl("https://canva.com.evil.example/x"), null);
  assert.equal(fileUrl("http://export-download.canva.com/x"), null);
  assert.equal(validCanva({ act: "file", url: "https://169.254.169.254/" }, o), "url");
});

test("config without secrets says not configured, and other acts refuse", async () => {
  const env = { ALLOWED_ORIGINS: ORIGIN };
  let j = await (await run({ op: "canva", act: "config" }, env, mock([]))).json();
  assert.deepEqual(j, { ok: true, data: { configured: false, clientId: "" } });
  j = await (await run({ op: "canva", act: "designs", token: "t" }, env, mock([]))).json();
  assert.equal(j.error.code, "canva-off");
  j = await (await run({ op: "canva", act: "config" }, ENV, mock([]))).json();
  assert.equal(j.data.clientId, "OC-abc");
});

test("token exchange uses Basic auth and form body; secret never returned", async () => {
  const f = mock([[/oauth\/token$/, () => J({ access_token: "AT", refresh_token: "RT", expires_in: 14400, token_type: "Bearer", scope: "design:meta:read" })]]);
  const res = await run({ op: "canva", act: "token", code: "CODE", verifier: V, redirect: ORIGIN + "/atelier/canva-callback.html" }, ENV, f);
  const txt = await res.text();
  assert.ok(!txt.includes("s3cret"));
  const j = JSON.parse(txt);
  assert.deepEqual(j.data, { access: "AT", refresh: "RT", expires: 14400, scope: "design:meta:read" });
  const c = f.calls[0];
  assert.equal(c.init.headers.Authorization, "Basic " + btoa("OC-abc:s3cret"));
  const p = new URLSearchParams(c.init.body);
  assert.equal(p.get("grant_type"), "authorization_code");
  assert.equal(p.get("code_verifier"), V);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("expired token → auth; designs mapped; export + job", async () => {
  let f = mock([[/\/designs/, () => J({ code: "invalid_access_token", message: "x" }, 401)]]);
  let j = await (await run({ op: "canva", act: "designs", token: "T" }, ENV, f)).json();
  assert.equal(j.error.code, "auth");
  f = mock([[/\/designs/, (u) => J({ items: [{ id: "DAF1", title: "Post", page_count: 3, updated_at: 5, thumbnail: { url: "https://document-export.canva.com/t.png", width: 10, height: 20 }, design_types: ["presentation"] }, { id: "bad id!" }], continuation: "C2" })]]);
  j = await (await run({ op: "canva", act: "designs", token: "T", cont: "C1", query: "sale" }, ENV, f)).json();
  assert.equal(j.data.items.length, 1);
  assert.deepEqual(j.data.items[0], { id: "DAF1", title: "Post", thumb: "https://document-export.canva.com/t.png", tw: 10, th: 20, pages: 3, updated: 5, types: ["presentation"] });
  assert.equal(j.data.cont, "C2");
  assert.ok(/continuation=C1/.test(f.calls[0].url) && /query=sale/.test(f.calls[0].url));
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer T");
  f = mock([[/\/exports$/, (u, init) => { assert.deepEqual(JSON.parse(init.body), { design_id: "DAF1", format: { type: "pptx" } }); return J({ job: { id: "E1", status: "in_progress" } }); }],
            [/\/exports\/E1$/, () => J({ job: { id: "E1", status: "success", urls: ["https://export-download.canva.com/x.pptx", "https://evil.example/y"] } })]]);
  j = await (await run({ op: "canva", act: "export", token: "T", id: "DAF1" }, ENV, f)).json();
  assert.deepEqual(j.data, { job: "E1", status: "in_progress", urls: [], err: "" });
  j = await (await run({ op: "canva", act: "job", token: "T", job: "E1" }, ENV, f)).json();
  assert.deepEqual(j.data.urls, ["https://export-download.canva.com/x.pptx"]);
});

test("file streams bytes with CORS, refuses other hosts", async () => {
  const f = mock([[/export-download/, () => new Response(new Uint8Array([80, 75, 3, 4]), { status: 200, headers: { "Content-Length": "4" } })]]);
  const res = await run({ op: "canva", act: "file", url: "https://export-download.canva.com/x.pptx" }, ENV, f);
  assert.equal(res.headers.get("Content-Type"), "application/octet-stream");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [80, 75, 3, 4]);
  assert.equal(res.headers.get("Content-Length"), null);
  const bad = await (await run({ op: "canva", act: "file", url: "https://example.com/x" }, ENV, f)).json();
  assert.equal(bad.ok, false);
});

test("file follows redirects only within *.canva.com", async () => {
  const f = mock([
    [/export-download\.canva\.com\/hop/, (u, init) => { assert.equal(init.redirect, "manual"); return new Response(null, { status: 302, headers: { Location: "https://media.canva.com/final.pptx" } }); }],
    [/media\.canva\.com\/final/, () => new Response(new Uint8Array([1, 2]), { status: 200 })],
    [/export-download\.canva\.com\/open/, () => new Response(null, { status: 302, headers: { Location: "https://evil.example/x" } })]
  ]);
  const ok = await run({ op: "canva", act: "file", url: "https://export-download.canva.com/hop" }, ENV, f);
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [1, 2]);
  const bad = await (await run({ op: "canva", act: "file", url: "https://export-download.canva.com/open" }, ENV, f)).json();
  assert.equal(bad.error.code, "url");
  assert.ok(!f.calls.some((c) => /evil/.test(c.url)));
});
