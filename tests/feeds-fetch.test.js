// Reader: the shared network layer (feeds/fetch.js), end to end
// against the real relay code (relay/core.js + relay/web.js) with a
// fake network. "Direct" sites either answer (CORS ok) or throw like
// a browser does when CORS blocks the read.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const RELAY = "https://relay.example.workers.dev";
const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>Τίτλος</title>' +
  '<item><title>A</title><link>https://site.example.gr/a</link><guid>a</guid></item></channel></rss>';

// The sites the relay can reach (all of them) and the ones a browser
// can read directly (only cors.example.gr).
const SITES = {
  "https://cors.example.gr/feed": { body: RSS, headers: { "Content-Type": "application/rss+xml", ETag: "\"c1\"" } },
  "https://site.example.gr/feed": { body: RSS, headers: { "Content-Type": "text/xml; charset=utf-8", ETag: "\"s1\"" } },
  "https://site.example.gr/old": { redirect: "https://site.example.gr/feed" },
  "https://same.example.gr/feed": { status: 304 },
  "https://site.example.gr/page": { body: "<html><head><link rel=alternate type=application/rss+xml href=/feed></head></html>",
                                    headers: { "Content-Type": "text/html" } }
};
const CORS_OK = { "https://cors.example.gr/feed": 1 };

let core, F, calls;
function siteFetch(url) {
  const r = SITES[url];
  if (!r) throw new TypeError("network");
  if (r.redirect) return new Response(null, { status: 302, headers: { Location: r.redirect } });
  return new Response(r.body === undefined ? null : r.body, { status: r.status || 200, headers: r.headers || {} });
}

test.before(async () => {
  core = await import("../relay/core.js");
  globalThis.localStorage = {
    store: {},
    getItem(k) { return this.store[k] === undefined ? null : this.store[k]; },
    setItem(k, v) { this.store[k] = String(v); }
  };
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    if (url === RELAY + "/v1") {
      const req = new Request(url, { method: "POST", body: init.body,
        headers: { "Content-Type": "application/json", Origin: "https://useoros.online" } });
      return core.handle(req, {}, null, Date.now(), async (u) => siteFetch(u));
    }
    if (!CORS_OK[url]) throw new TypeError("Failed to fetch");
    return siteFetch(url);
  };
  globalThis.orosFeedsCore = require("../feeds/core.js");
  F = require("../feeds/fetch.js");
});
test.beforeEach(() => { calls = []; localStorage.store = {}; });

test("fetch: relay address from options or from Mail's settings", () => {
  assert.equal(F.relayAvailable(), false);
  assert.equal(F.relayUrl({ relay: RELAY + "/" }), RELAY);
  assert.equal(F.relayUrl({ relay: () => RELAY }), RELAY);
  assert.equal(F.relayUrl({ relay: "javascript:alert(1)" }), "");
  localStorage.setItem("oros-mail-data", JSON.stringify({ relay: { url: RELAY } }));
  assert.equal(F.relayAvailable(), true);
  assert.equal(F.relayUrl(), RELAY);
  localStorage.setItem("oros-mail-data", "{broken");
  assert.equal(F.relayAvailable(), false);
});

test("fetchOne: direct when CORS allows, relay otherwise, norelay without one", async () => {
  const a = await F.fetchOne("https://cors.example.gr/feed");
  assert.equal(a.via, "direct");
  assert.equal(a.status, 200);
  assert.match(a.text, /Τίτλος/);
  assert.deepEqual(calls, ["https://cors.example.gr/feed"]);

  await assert.rejects(F.fetchOne("https://site.example.gr/page"), (e) => e.code === "norelay");

  const b = await F.fetchOne("https://site.example.gr/page", { relay: RELAY });
  assert.equal(b.via, "relay");
  assert.equal(b.finalUrl, "https://site.example.gr/page");
  assert.match(b.text, /application\/rss\+xml/);

  calls = [];
  const c = await F.fetchOne("https://site.example.gr/old", { relay: RELAY, via: "relay" });
  assert.deepEqual(calls, [RELAY + "/v1"]);        // no direct try when asked
  assert.equal(c.finalUrl, "https://site.example.gr/feed");

  await assert.rejects(F.fetchOne("https://nowhere.example.gr/", { relay: RELAY }), (e) => e.code === "network");
});

test("fetchFeeds: one answer per request, same order, mixed ways, never rejects", async () => {
  const reqs = [
    { url: "https://site.example.gr/feed", etag: "\"old\"" },
    { url: "https://cors.example.gr/feed" },
    { url: "https://same.example.gr/feed", etag: "\"x\"", via: "relay" },
    { url: "https://nowhere.example.gr/feed" },
    { url: "http://localhost/feed" }
  ];
  const res = await F.fetchFeeds(reqs, { relay: RELAY });
  assert.equal(res.length, 5);
  assert.deepEqual(res.map((r) => r.via), ["relay", "direct", "relay", "relay", "relay"]);
  assert.equal(res[0].status, 200);
  assert.equal(res[0].etag, "\"s1\"");
  assert.equal(Buffer.from(res[0].bytes).toString("utf8"), RSS);
  assert.equal(res[1].status, 200);
  assert.equal(res[2].status, 304);
  assert.equal(res[2].bytes, null);
  assert.equal(res[3].err, "network");
  assert.equal(res[4].err, "host");
  reqs.forEach((q, i) => assert.equal(res[i].url, q.url));
  assert.equal(calls.filter((u) => u === RELAY + "/v1").length, 1);   // one relay call for 4 feeds

  const none = await F.fetchFeeds(reqs.slice(0, 2));
  assert.equal(none[0].err, "norelay");
  assert.equal(none[1].status, 200);
});

test("fetchFeeds: batches of 10 through the relay", async () => {
  const reqs = [];
  for (let i = 0; i < 23; i++) reqs.push({ url: "https://site.example.gr/feed?n=" + i });
  SITES["https://site.example.gr/feed?n=0"] = SITES["https://site.example.gr/feed"];
  const res = await F.fetchFeeds(reqs, { relay: RELAY });
  assert.equal(calls.filter((u) => u === RELAY + "/v1").length, 3);
  assert.equal(res[0].status, 200);
  assert.equal(res[22].err, "network");
  await assert.rejects(F.relay(reqs, { relay: RELAY }), (e) => e.code === "relay");
});
