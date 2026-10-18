// Service worker on a bad connection (sw.js, SW-T1/SW-T2): network-
// first requests fall back to the cache after NET_TIMEOUT_MS instead
// of hanging, a late answer still refreshes the cache, and an update
// whose precache cannot reach the network keeps the current release.
// sw.js runs in a vm with small fakes for caches, fetch and self.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const BASE = "https://useoros.online/";

const abs = (u) => new URL(typeof u === "string" ? u : u.url, BASE).href;
const noSearch = (u) => u.split("?")[0];

function fakeCaches() {
  const store = new Map();   // name → Map(url → Response)
  function open(name) {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return Promise.resolve({
      match(req, opts) {
        const key = abs(req);
        if (m.has(key)) return Promise.resolve(m.get(key).clone());
        if (opts && opts.ignoreSearch) {
          for (const [k, v] of m) if (noSearch(k) === noSearch(key)) return Promise.resolve(v.clone());
        }
        return Promise.resolve(undefined);
      },
      put(req, res) { m.set(abs(req), res); return Promise.resolve(); },
      delete(req) { return Promise.resolve(m.delete(abs(req))); },
      keys() { return Promise.resolve([...m.keys()].map((u) => ({ url: u }))); }
    });
  }
  return {
    store,
    open,
    keys() { return Promise.resolve([...store.keys()]); },
    delete(name) { return Promise.resolve(store.delete(name)); },
    match(req, opts) {
      let chain = Promise.resolve(undefined);
      for (const name of store.keys()) {
        chain = chain.then((hit) => hit || open(name).then((c) => c.match(req, opts)));
      }
      return chain;
    }
  };
}

// fetchImpl(url, init) → Promise<Response>
function loadSW(fetchImpl, opts) {
  const handlers = {};
  const caches = fakeCaches();
  class Req {
    constructor(u, init) {
      this.url = abs(u);
      this.mode = (init && init.mode) || "cors";
      this.destination = (init && init.destination) || "";
      this.method = "GET";
      this.cache = init && init.cache;
    }
  }
  const self = {
    location: new URL(BASE + "sw.js"),
    registration: { active: opts && opts.updating ? {} : null },
    clients: { claim: () => Promise.resolve() },
    skipWaiting() {},
    crypto: globalThis.crypto,
    addEventListener(type, fn) { handlers[type] = fn; }
  };
  const fetchLog = [];
  const ctx = {
    self, caches, URL, Response, Request: Req, console: { warn() {}, log() {} },
    setTimeout, clearTimeout, Promise,
    fetch(req, init) {
      const u = abs(req);
      fetchLog.push(u);
      return fetchImpl(u, init || {});
    }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  ctx.NET_TIMEOUT_MS = 40;   // keep the test fast
  return { ctx, handlers, caches, fetchLog, Req };
}

function fire(sw, request) {
  const waits = [];
  let answer = null;
  sw.handlers.fetch({
    request,
    respondWith(p) { answer = Promise.resolve(p); },
    waitUntil(p) { waits.push(p); }
  });
  return { answer, settled: () => Promise.all(waits) };
}

const never = () => new Promise(() => {});
const delay = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
const html = (s) => new Response(s, { status: 200, headers: { "Content-Type": "text/html" } });

async function seed(sw, name, url, body) {
  const c = await sw.caches.open(name);
  await c.put(url, html(body));
}

test("navigation: a hanging network answers from the cache after the timeout", async () => {
  const sw = loadSW(() => never());
  await seed(sw, sw.ctx.SHELL_CACHE, "./", "cached shell");
  const t0 = Date.now();
  const { answer } = fire(sw, new sw.Req("/", { mode: "navigate", destination: "document" }));
  const res = await answer;
  assert.equal(await res.text(), "cached shell");
  assert.ok(Date.now() - t0 < 1000, "answered quickly");
});

test("navigation: the start URL with a query falls back to the cached index.html", async () => {
  const sw = loadSW(() => never());
  await seed(sw, sw.ctx.SHELL_CACHE, "./index.html", "cached index");
  const { answer } = fire(sw, new sw.Req("/?source=pwa", { mode: "navigate", destination: "document" }));
  assert.equal(await (await answer).text(), "cached index");
});

test("navigation: a fast network wins and is stored", async () => {
  const sw = loadSW(() => Promise.resolve(html("fresh")));
  await seed(sw, sw.ctx.SHELL_CACHE, "./", "cached shell");
  const ev = fire(sw, new sw.Req("/todo/", { mode: "navigate", destination: "iframe" }));
  assert.equal(await (await ev.answer).text(), "fresh");
  await ev.settled();
  const c = await sw.caches.open(sw.ctx.RUNTIME_CACHE);
  assert.equal(await (await c.match(BASE + "todo/")).text(), "fresh");
});

test("navigation: a late answer after the timeout still refreshes the cache", async () => {
  const sw = loadSW(() => delay(120, html("late fresh")));
  await seed(sw, sw.ctx.SHELL_CACHE, "./", "cached shell");
  const ev = fire(sw, new sw.Req("/", { mode: "navigate", destination: "document" }));
  assert.equal(await (await ev.answer).text(), "cached shell");
  await ev.settled();
  const c = await sw.caches.open(sw.ctx.RUNTIME_CACHE);
  assert.equal(await (await c.match(BASE)).text(), "late fresh");
});

test("navigation: with nothing cached it keeps waiting for a slow network", async () => {
  const sw = loadSW(() => delay(120, html("slow but only copy")));
  const ev = fire(sw, new sw.Req("/todo/", { mode: "navigate", destination: "iframe" }));
  assert.equal(await (await ev.answer).text(), "slow but only copy");
});

test("navigation: an app frame never falls back to the shell page", async () => {
  const sw = loadSW(() => Promise.reject(new TypeError("offline")));
  await seed(sw, sw.ctx.SHELL_CACHE, "./index.html", "shell");
  const res = await fire(sw, new sw.Req("/todo/", { mode: "navigate", destination: "iframe" })).answer;
  assert.equal(res.status, 503);
  assert.match(await res.text(), /not been saved for offline use/);
});

test("navigation: one-shot URLs (?code=, ?file-open=) are never stored", async () => {
  for (const q of ["?code=abc", "?file-open=txt", "?share-url=x", "?search=y"]) {
    const sw = loadSW(() => Promise.resolve(html("page")));
    const ev = fire(sw, new sw.Req("/" + q, { mode: "navigate", destination: "document" }));
    await ev.answer;
    await ev.settled();
    const c = await sw.caches.open(sw.ctx.RUNTIME_CACHE);
    assert.equal(await c.match(BASE + q), undefined, q);
  }
});

test("apps.json: a hanging network answers with the cached list", async () => {
  const sw = loadSW(() => never());
  const c = await sw.caches.open(sw.ctx.SHELL_CACHE);
  await c.put("./apps.json", new Response('{"apps":[]}'));
  const res = await fire(sw, new sw.Req("/apps.json")).answer;
  assert.equal(await res.text(), '{"apps":[]}');
});

test("apps.json: offline with no copy is a network error, not a hang", async () => {
  const sw = loadSW(() => Promise.reject(new TypeError("offline")));
  const res = await fire(sw, new sw.Req("/apps.json")).answer;
  assert.equal(res.type, "error");
});

function install(sw) {
  let p;
  sw.handlers.install({ waitUntil(x) { p = x; } });
  return p;
}

test("update install: a network failure keeps the current release, the retry resumes", async () => {
  let down = new Set(["./shell.js", "./sync.js"].map(abs));
  const sw = loadSW((u) => down.has(u)
    ? Promise.reject(new TypeError("Failed to fetch"))
    : Promise.resolve(new Response("x")), { updating: true });
  await assert.rejects(install(sw), /keeping the current release/);
  const n = sw.ctx.PRECACHE_URLS.length;
  assert.equal(sw.fetchLog.length, n);
  // Second attempt: only the two missing files go to the network.
  down = new Set();
  sw.fetchLog.length = 0;
  await install(sw);
  assert.deepEqual(sw.fetchLog.sort(), ["./shell.js", "./sync.js"].map(abs).sort());
  const c = await sw.caches.open(sw.ctx.SHELL_CACHE);
  assert.equal(await c.match(sw.ctx.PARTIAL_MARK), undefined, "marker cleared");
  // A later re-install of the same release refreshes everything again.
  sw.fetchLog.length = 0;
  await install(sw);
  assert.equal(sw.fetchLog.length, n);
});

test("update install: a server error (404) only logs and does not block", async () => {
  const sw = loadSW((u) => u === abs("./shell.js")
    ? Promise.resolve(new Response("", { status: 404 }))
    : Promise.resolve(new Response("x")), { updating: true });
  await install(sw);
});

test("first install stays tolerant of network failures", async () => {
  const sw = loadSW((u) => u === abs("./shell.js")
    ? Promise.reject(new TypeError("Failed to fetch"))
    : Promise.resolve(new Response("x")), { updating: false });
  await install(sw);
});

// SW-U1: a file whose content did not change since the previous
// release is copied from that release's cache, never downloaded again.
const crypto = require("crypto");
const h16 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

async function prevRelease(sw, files) {
  const c = await sw.caches.open("oros-shell-oros-v0.0.1");
  for (const [u, body] of Object.entries(files)) await c.put(u, new Response(body));
}

test("update install: unchanged files come from the previous release, changed ones from the network", async () => {
  const sw = loadSW((u) => Promise.resolve(new Response("net " + u)), { updating: true });
  sw.ctx.PRECACHE_HASH = { "./shell.js": h16("old shell"), "./sync.js": h16("new sync"), "./fs.js": h16("fs") };
  // shell.js unchanged; sync.js changed (old copy hashes differently);
  // fs.js has no old copy; everything else has no hash entry.
  await prevRelease(sw, { "./shell.js": "old shell", "./sync.js": "old sync" });
  await install(sw);
  assert.ok(!sw.fetchLog.includes(abs("./shell.js")), "shell.js not downloaded");
  assert.ok(sw.fetchLog.includes(abs("./sync.js")), "changed sync.js downloaded");
  assert.ok(sw.fetchLog.includes(abs("./fs.js")), "fs.js without an old copy downloaded");
  assert.equal(sw.fetchLog.length, sw.ctx.PRECACHE_URLS.length - 1);
  const c = await sw.caches.open(sw.ctx.SHELL_CACHE);
  assert.equal(await (await c.match("./shell.js")).text(), "old shell");
  assert.equal(await (await c.match("./sync.js")).text(), "net " + abs("./sync.js"));
});

test("update install: no hash table means every file is downloaded, as before", async () => {
  const sw = loadSW(() => Promise.resolve(new Response("x")), { updating: true });
  await prevRelease(sw, { "./shell.js": "old shell" });
  await install(sw);
  assert.equal(sw.fetchLog.length, sw.ctx.PRECACHE_URLS.length);
});

test("update install: at most PRECACHE_POOL downloads at a time", async () => {
  let open = 0, peak = 0;
  const sw = loadSW(() => {
    open++; peak = Math.max(peak, open);
    return delay(1).then(() => { open--; return new Response("x"); });
  }, { updating: true });
  await install(sw);
  assert.equal(sw.fetchLog.length, sw.ctx.PRECACHE_URLS.length);
  assert.ok(peak <= sw.ctx.PRECACHE_POOL, "peak " + peak);
});

test("the network timeout is a few seconds", () => {
  assert.match(SRC, /var NET_TIMEOUT_MS = 3000;/);
});

test("only apps.json is network-first, never a 9-character path like /shell.js", () => {
  const sw = loadSW(() => never());
  assert.equal(sw.ctx.isAppsList("/apps.json"), true);
  assert.equal(sw.ctx.isAppsList("/oros/apps.json"), true);
  for (const p of ["/shell.js", "/vault.js", "/icon.svg", "/", "/x", "/myapps.json", "/apps.json/x"]) {
    assert.equal(sw.ctx.isAppsList(p), false, p);
  }
});

test("a cached /shell.js?v= answers at once even when the network hangs", async () => {
  const sw = loadSW(() => never());
  const c = await sw.caches.open(sw.ctx.SHELL_CACHE);
  await c.put("./shell.js", new Response("shell code"));
  const stamp = sw.ctx.RELEASE;
  const t0 = Date.now();
  const res = await fire(sw, new sw.Req("/shell.js?v=" + stamp, { destination: "script" })).answer;
  assert.equal(await res.text(), "shell code");
  assert.ok(Date.now() - t0 < sw.ctx.NET_TIMEOUT_MS, "no network wait");
});

test("after one timeout the next network-first request answers from the cache at once", async () => {
  const sw = loadSW(() => never());
  sw.ctx.NET_TIMEOUT_MS = 300;
  await seed(sw, sw.ctx.SHELL_CACHE, "./", "cached shell");
  const c = await sw.caches.open(sw.ctx.SHELL_CACHE);
  await c.put("./apps.json", new Response('{"apps":[]}'));
  let t0 = Date.now();
  await fire(sw, new sw.Req("/", { mode: "navigate", destination: "document" })).answer;
  assert.ok(Date.now() - t0 >= 290, "first request waited for the timeout");
  t0 = Date.now();
  const res = await fire(sw, new sw.Req("/apps.json")).answer;
  assert.equal(await res.text(), '{"apps":[]}');
  assert.ok(Date.now() - t0 < 150, "second request did not wait again");
});

test("a quick network answer ends the slow spell", async () => {
  let slow = true;
  const sw = loadSW(() => slow ? never() : Promise.resolve(new Response('{"apps":[1]}')));
  sw.ctx.NET_TIMEOUT_MS = 100;
  const c = await sw.caches.open(sw.ctx.SHELL_CACHE);
  await c.put("./apps.json", new Response('{"apps":[]}'));
  await fire(sw, new sw.Req("/apps.json")).answer;            // times out → slow spell
  assert.ok(sw.ctx.netSlowUntil > Date.now());
  slow = false;
  const ev = fire(sw, new sw.Req("/apps.json"));
  await ev.settled();                                          // network came back quickly
  assert.equal(sw.ctx.netSlowUntil, 0);
  const res = await fire(sw, new sw.Req("/apps.json")).answer;
  assert.equal(await res.text(), '{"apps":[1]}');
});
