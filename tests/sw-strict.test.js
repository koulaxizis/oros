// Sensitive work in the service worker (sw.js STRICT): in "hard" every
// cross-origin request to a host the page did not allow fails, the
// level survives a worker restart through the "oros-strict" cache, a
// request made before that state is read waits for it, and in "on" a
// relay host only produces one note for the page.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
const BASE = "https://useoros.online/";
const abs = (u) => new URL(typeof u === "string" ? u : u.url, BASE).href;

function fakeCaches(store) {
  function open(name) {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return Promise.resolve({
      match(req) { const k = abs(req); return Promise.resolve(m.has(k) ? m.get(k).clone() : undefined); },
      put(req, res) { m.set(abs(req), res); return Promise.resolve(); },
      delete(req) { return Promise.resolve(m.delete(abs(req))); },
      keys() { return Promise.resolve([...m.keys()].map((u) => ({ url: u }))); }
    });
  }
  return { open, keys: () => Promise.resolve([...store.keys()]), delete: (n) => Promise.resolve(store.delete(n)) };
}

function loadSW(store) {
  const handlers = {};
  const posted = [];
  const fetched = [];
  const self = {
    location: new URL(BASE + "sw.js"),
    registration: { active: null },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve([{ postMessage: (m) => posted.push(m) }])
    },
    skipWaiting() {},
    crypto: globalThis.crypto,
    addEventListener(type, fn) { handlers[type] = fn; }
  };
  const ctx = {
    self, caches: fakeCaches(store), URL, Response, console: { warn() {}, log() {} },
    setTimeout, clearTimeout, Promise,
    fetch(req) { fetched.push(abs(req)); return Promise.resolve(new Response("net")); }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, handlers, posted, fetched };
}

function req(url, method) { return { url: abs(url), method: method || "GET", mode: "cors", destination: "" }; }

function fire(sw, request) {
  const waits = [];
  let answer = null;
  sw.handlers.fetch({ request, respondWith(p) { answer = Promise.resolve(p); }, waitUntil(p) { waits.push(p); } });
  return { answer, settled: () => Promise.all(waits) };
}

async function send(sw, data) {
  const waits = [];
  sw.handlers.message({ data, waitUntil(p) { waits.push(p); } });
  await Promise.all(waits);
}

const ready = (sw) => sw.ctx.strictReady;

test("off: a cross-origin request is left to the browser", async () => {
  const sw = loadSW(new Map());
  await ready(sw);
  const ev = fire(sw, req("https://example.org/x.js"));
  assert.equal(ev.answer, null);
});

test("hard: only the allowed sync hosts pass, any method", async () => {
  const store = new Map();
  const sw = loadSW(store);
  await ready(sw);
  await send(sw, { t: "oros-strict", level: "hard", hosts: ["content.dropboxapi.com", "api.dropboxapi.com"] });
  const bad = fire(sw, req("https://example.org/track", "POST"));
  assert.equal((await bad.answer).type, "error");
  await bad.settled();
  assert.equal(JSON.stringify(sw.posted.at(-1)), JSON.stringify({ t: "oros-strict-blocked", host: "example.org" }));
  const ok = fire(sw, req("https://api.dropboxapi.com/2/files/list_folder", "POST"));
  assert.equal(await (await ok.answer).text(), "net");
  assert.deepEqual(sw.fetched, ["https://api.dropboxapi.com/2/files/list_folder"]);
});

test("hard: map tiles are blocked too", async () => {
  const sw = loadSW(new Map());
  await ready(sw);
  await send(sw, { t: "oros-strict", level: "hard", hosts: [] });
  const ev = fire(sw, req("https://tile.openstreetmap.org/1/0/0.png"));
  assert.equal((await ev.answer).type, "error");
  assert.equal(sw.fetched.length, 0);
});

test("hard survives a worker restart, and a request before the state is read waits for it", async () => {
  const store = new Map();
  const a = loadSW(store);
  await ready(a);
  await send(a, { t: "oros-strict", level: "hard", hosts: ["api.dropboxapi.com"] });
  const b = loadSW(store);
  const ev = fire(b, req("https://example.org/x"));   // fired before strictReady settles
  assert.notEqual(ev.answer, null);
  assert.equal((await ev.answer).type, "error");
  assert.equal(b.fetched.length, 0);
});

test("turning it off clears the stored state", async () => {
  const store = new Map();
  const a = loadSW(store);
  await ready(a);
  await send(a, { t: "oros-strict", level: "hard", hosts: [] });
  await send(a, { t: "oros-strict", level: null });
  const b = loadSW(store);
  await ready(b);
  assert.equal(fire(b, req("https://example.org/x")).answer, null);
});

test("on: a relay host passes and is reported once", async () => {
  const sw = loadSW(new Map());
  await ready(sw);
  await send(sw, { t: "oros-strict", level: "on", relays: ["oros-mail-relay.koulaxizis.workers.dev"] });
  const one = fire(sw, req("https://oros-mail-relay.koulaxizis.workers.dev/mail", "POST"));
  assert.equal(one.answer, null);
  await one.settled();
  await fire(sw, req("https://oros-mail-relay.koulaxizis.workers.dev/mail", "POST")).settled();
  assert.equal(sw.posted.filter((m) => m.t === "oros-strict-relay").length, 1);
});

test("bad hosts in the message are dropped", async () => {
  const sw = loadSW(new Map());
  await ready(sw);
  await send(sw, { t: "oros-strict", level: "hard", hosts: ["ok.example", "bad host/x", 5] });
  assert.deepEqual([...sw.ctx.strictState.hosts], ["ok.example"]);
});
