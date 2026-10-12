// The Newsletter engine in a sandbox, shared by the Newsletter tests:
// a fake relay, fake IndexedDB (Mail's sealed password) and virtual
// timers. Not a test file itself.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

// A tiny IndexedDB: enough for Mail's password store and our own.
function fakeIDB() {
  const dbs = {};
  const req = (fn) => {
    const r = {};
    setImmediate(() => { try { r.result = fn(); r.onsuccess && r.onsuccess({}); } catch (e) { r.error = e; r.onerror && r.onerror({}); } });
    return r;
  };
  function db(name) {
    const stores = dbs[name].stores;
    return {
      objectStoreNames: { contains: (s) => !!stores[s] },
      createObjectStore: (s) => { stores[s] = new Map(); },
      close() {},
      transaction() {
        return { objectStore: (s) => ({
          get: (k) => req(() => stores[s].get(k)),
          put: (v, k) => req(() => { stores[s].set(k, v); }),
          delete: (k) => req(() => { stores[s].delete(k); })
        }) };
      }
    };
  }
  return {
    dbs,
    open(name, ver) {
      const r = {};
      setImmediate(() => {
        const fresh = !dbs[name];
        if (fresh) dbs[name] = { stores: {} };
        r.result = db(name);
        r.transaction = { abort() {} };
        if (fresh && ver && r.onupgradeneeded) r.onupgradeneeded();
        r.onsuccess && r.onsuccess();
      });
      return r;
    }
  };
}

async function sandbox(data) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
  const timers = [];
  let seq = 0;
  const sent = [];
  const relayLog = [];
  const ctx = {
    console, localStorage, TextEncoder, TextDecoder, AbortController, btoa, atob,
    crypto: globalThis.crypto, indexedDB: fakeIDB(),
    navigator: { onLine: true },
    setTimeout: (fn, ms) => { const id = ++seq; timers.push({ id, fn, at: ms || 0 }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    fetch: async (url, o) => {
      const body = JSON.parse(o.body);
      relayLog.push(body.op);
      if (body.op === "send") sent.push({ to: body.rcpt[0], raw: Buffer.from(body.raw, "base64").toString("latin1") });
      const res = body.op === "search" ? { msgs: [] } : {};
      return { json: async () => ({ ok: true, data: res }) };
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["newsletter/core.js", "newsletter/render.js", "mail/compose.js", "mail/mime.js", "newsletter/engine.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  }
  // Mail's account and its sealed password, as Mail keeps them
  localStorage.setItem("oros-mail-data", JSON.stringify({ accounts: [{ id: "acct01", m: 1, email: "me@example.com",
    imap: { host: "imap.example.com", port: 993, sec: "tls" }, smtp: { host: "smtp.example.com", port: 465, sec: "tls" } }] }));
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("secret"));
  ctx.indexedDB.dbs["oros-mail"] = { stores: { keys: new Map([["device", key]]), creds: new Map([["acct01", { iv: iv.buffer, data: sealed }]]) } };
  localStorage.setItem("oros-newsletter-data", JSON.stringify(data));
  localStorage.setItem("oros-newsletter-dev", JSON.stringify({ dev: "devaaa1", used: {}, inbox: { at: Date.now() } }));
  const E = ctx.OrosNewsletterEngine;
  const notes = [];
  const engine = E.create({ fs: () => null, dirty() {}, onState() {}, onChange() {}, notify: (k, i) => notes.push([k, i]) });
  // run the earliest timer, then let promises (webcrypto, fake IDB) settle
  async function run(steps) {
    for (let i = 0; i < steps && timers.length; i++) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = timers.shift();
      t.fn();
      for (let j = 0; j < 30; j++) await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 10));     // webcrypto under load
      for (let j = 0; j < 30; j++) await new Promise((r) => setImmediate(r));
    }
  }
  const read = () => JSON.parse(localStorage.getItem("oros-newsletter-data"));
  return { ctx, E, engine, run, read, sent, notes, relayLog, localStorage };
}

module.exports = { sandbox, fakeIDB };
