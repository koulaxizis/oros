// Connected services key sync on by default (KS-ON, links/host.js):
// new accounts travel sealed, old accounts are switched on once, a
// later "off" stays off, bank keys (keysHere) stay on their device, a
// second device opens the sealed keys, and keys are never in clear in
// the synced slice.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const nodeCrypto = require("crypto");

const CORE = fs.readFileSync(path.join(__dirname, "..", "links/core.js"), "utf8");
const HOST = fs.readFileSync(path.join(__dirname, "..", "links/host.js"), "utf8");

// A tiny IndexedDB: one database, object stores of plain Maps.
function fakeIDB() {
  const stores = {};
  const dbo = {
    objectStoreNames: { contains: (n) => !!stores[n] },
    createObjectStore: (n) => { stores[n] = new Map(); },
    transaction: (name) => {
      const t = {};
      const req = (fn) => { const r = {}; setTimeout(() => { r.result = fn(); if (r.onsuccess) r.onsuccess(); setTimeout(() => t.oncomplete && t.oncomplete(), 0); }, 0); return r; };
      t.objectStore = () => ({
        get: (k) => req(() => stores[name].get(k)),
        put: (v, k) => req(() => { stores[name].set(k, v); }),
        delete: (k) => req(() => { stores[name].delete(k); })
      });
      return t;
    }
  };
  return {
    stores,
    open: () => {
      const r = { result: dbo };
      setTimeout(() => { if (r.onupgradeneeded) r.onupgradeneeded(); r.onsuccess(); }, 0);
      return r;
    }
  };
}

// A sealed text the fake sync passphrase opens (AES-GCM with a fixed key).
const PASS_KEY = nodeCrypto.randomBytes(32);
function vault(key) {
  return {
    encryptJson: (o) => {
      const iv = nodeCrypto.randomBytes(12), c = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
      const d = Buffer.concat([c.update(JSON.stringify(o)), c.final()]);
      return "v1." + Buffer.concat([iv, c.getAuthTag(), d]).toString("base64");
    },
    decryptJson: (s) => {
      const b = Buffer.from(String(s).slice(3), "base64");
      const dc = nodeCrypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      dc.setAuthTag(b.subarray(12, 28));
      return JSON.parse(Buffer.concat([dc.update(b.subarray(28)), dc.final()]).toString());
    }
  };
}

// the device clock a day ahead, so the test does not depend on when it runs
class Later extends Date { static now() { return Date.now() + 864e5; } }
function device(opts) {
  opts = opts || {};
  const ls = new Map();
  const localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  const sync = {
    slice: null, dirty: 0, auto: [],
    registerSlice(name, get, set) { this.slice = { get, set }; },
    markDirty() { this.dirty++; },
    hasPassphrase: () => opts.unlocked !== false,
    isConnected: () => true,
    vaultCrypto: vault(opts.passKey || PASS_KEY),
    onAutoSync(fn) { this.auto.push(fn); }
  };
  const win = { localStorage, orosSync: sync, setTimeout, crypto: globalThis.crypto };
  const idb = fakeIDB();
  const run = new Function("window", "localStorage", "indexedDB", "crypto", "Date", "setTimeout",
    CORE + "\n" + HOST);
  run.call(win, win, localStorage, idb, globalThis.crypto, Later, (fn, ms) => (ms >= 1000 ? 0 : setTimeout(fn, ms)));   // no boot timer
  return { win, Lk: win.orosLinks, sync, ls, idb, unlock() { opts.unlocked = true; } };
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));
const WOO_KEYS = { ck: "ck_" + "a".repeat(40), cs: "cs_" + "b".repeat(40) };
async function settle(d) { for (let i = 0; i < 6; i++) await tick(); }

test("KS-ON: a new account travels sealed; a second device opens it", async () => {
  const A = device();
  await tick();
  const id = await A.Lk.add({ p: "woo", name: "Shop", site: "shop.example.com", keys: WOO_KEYS });
  await settle(A);
  const row = JSON.parse(A.ls.get("oros-links-data")).accts.find((a) => a.id === id);
  assert.equal(row.ks, 1);
  assert.ok(row.s && row.s.startsWith("v1."), "sealed copy in the slice");
  assert.ok(!A.ls.get("oros-links-data").includes(WOO_KEYS.ck), "never in clear");
  assert.ok(!A.ls.get("oros-links-data").includes(WOO_KEYS.cs), "never in clear");

  const B = device();
  await tick();
  assert.equal(await B.Lk.hasKeys(id), false);
  B.sync.slice.set(JSON.parse(A.ls.get("oros-links-data")));
  await settle(B);
  assert.equal(await B.Lk.hasKeys(id), true, "the phone has the shop's key");
  // stable: opening the sealed copy writes nothing back (no upload loop)
  assert.equal(B.sync.dirty, 0);
  assert.equal(B.ls.get("oros-links-data"), A.ls.get("oros-links-data"));
});

test("KS-ON: accounts from before are switched on once; a later off stays off", async () => {
  const A = device();
  await tick();
  const id = await A.Lk.add({ p: "woo", name: "Shop", site: "shop.example.com", keys: WOO_KEYS });
  await settle(A);
  // the row as an older version wrote it: ks off, changed long ago
  const old = JSON.parse(A.ls.get("oros-links-data"));
  old.accts[0] = Object.assign({}, old.accts[0], { m: Date.UTC(2026, 9, 20), ks: 0, s: "", sm: 0 });
  A.ls.set("oros-links-data", JSON.stringify(old));
  const B = device();
  await tick();
  B.sync.slice.set(old);
  await settle(B);
  const b = JSON.parse(B.ls.get("oros-links-data")).accts[0];
  assert.equal(b.ks, 1, "switched on");
  assert.ok(b.m > Date.UTC(2026, 10, 9, 21), "stamped now");
  assert.ok(B.sync.dirty > 0, "the switch is uploaded");
  // back on A: the switch arrives, A has the keys and seals them
  A.sync.slice.set(JSON.parse(B.ls.get("oros-links-data")));
  await settle(A);
  const a = JSON.parse(A.ls.get("oros-links-data")).accts[0];
  assert.equal(a.ks, 1);
  assert.ok(a.s.startsWith("v1."));
  // the person turns it off: no device turns it back on
  assert.equal(A.Lk.setKeySync(id, false), true);
  const off = JSON.parse(A.ls.get("oros-links-data"));
  B.sync.slice.set(off);
  await settle(B);
  assert.equal(JSON.parse(B.ls.get("oros-links-data")).accts[0].ks, 0);
  assert.equal(JSON.parse(B.ls.get("oros-links-data")).accts[0].s, "");
});

test("KS-ON: bank keys (keysHere) stay on their device by default", async () => {
  const L = require("../links/core.js");
  assert.equal(L.PLATFORMS.ebank.keysHere, true);
  Object.keys(L.PLATFORMS).filter((p) => p !== "ebank").forEach((p) => assert.ok(!L.PLATFORMS[p].keysHere, p));
  const A = device();
  await tick();
  const { privateKey } = nodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const id = await A.Lk.add({ p: "ebank", name: "Bank", keys: { app: "0b1c2d3e-0000-4000-8000-000000000001", pem } });
  await settle(A);
  const row = JSON.parse(A.ls.get("oros-links-data")).accts.find((a) => a.id === id);
  assert.equal(row.ks, 0);
  assert.equal(row.s, "");
  // an old bank row is not switched on either
  const B = device();
  await tick();
  B.sync.slice.set({ ver: 1, accts: [Object.assign({}, row, { m: Date.UTC(2026, 9, 20) })] });
  await settle(B);
  assert.equal(JSON.parse(B.ls.get("oros-links-data")).accts[0].ks, 0);
  assert.equal(A.Lk.platforms().find((p) => p.id === "ebank").keysHere, true);
});

test("KS-ON: sync unlocked later seals the keys after the next sync round", async () => {
  const A = device({ unlocked: false });
  await tick();
  const id = await A.Lk.add({ p: "woo", name: "Shop", site: "shop.example.com", keys: WOO_KEYS });
  await settle(A);
  let row = JSON.parse(A.ls.get("oros-links-data")).accts.find((a) => a.id === id);
  assert.equal(row.ks, 1);
  assert.equal(row.s, "", "nothing sealed without a passphrase");
  A.unlock();
  A.sync.auto.forEach((fn) => fn("done"));
  await settle(A);
  row = JSON.parse(A.ls.get("oros-links-data")).accts.find((a) => a.id === id);
  assert.ok(row.s.startsWith("v1."));
});
