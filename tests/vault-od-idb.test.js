// VD-ODB (2026-11-28) — the cloud-only list of orOS Drive folders lives in
// memory and IndexedDB, not in localStorage: a computer's mirror is tens
// of thousands of files, and a full localStorage refused the list without
// a word, so no device listed /internal/Drive/<computer>.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BinDropbox, vaultDevice } = require("./vault-harness");

const PC = "/internal/Drive/ckDesktop/Documents";

// A small IndexedDB: one database, object stores of key → value
// (structured clone = JSON round trip), callbacks on a later tick.
function fakeIdb() {
  const dbs = new Map();
  const later = (fn) => setImmediate(fn);
  return {
    dbs,
    open(name) {
      const req = {};
      later(() => {
        let fresh = false;
        if (!dbs.has(name)) { dbs.set(name, new Map()); fresh = true; }
        const stores = dbs.get(name);
        const db = {
          createObjectStore(s) { stores.set(s, new Map()); },
          transaction(s) {
            const tx = {};
            tx.objectStore = () => ({
              get(k) {
                const r = {};
                later(() => { const v = stores.get(s).get(k); r.result = v === undefined ? undefined : JSON.parse(v); r.onsuccess && r.onsuccess(); });
                return r;
              },
              put(v, k) { stores.get(s).set(k, JSON.stringify(v)); later(() => tx.oncomplete && tx.oncomplete()); }
            });
            return tx;
          }
        };
        req.result = db;
        if (fresh && req.onupgradeneeded) req.onupgradeneeded();
        req.onsuccess && req.onsuccess();
      });
      return req;
    }
  };
}
// localStorage that refuses any value over `max` characters (a full one).
function capStorage(dev, max) {
  const set = dev.localStorage.setItem.bind(dev.localStorage);
  dev.localStorage.setItem = (k, v) => { if (String(v).length > max) throw new Error("QuotaExceededError"); set(k, v); };
}
const tick = () => new Promise((r) => setImmediate(r));
async function flush(dev) {
  for (let i = 0; i < 5; i++) {
    const t = dev.timers.splice(0);
    t.forEach((x) => { try { x.fn(); } catch (e) {} });
    await tick(); await tick();
  }
}

async function seeded(n) {
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  for (let i = 0; i < n; i++) await A.write(PC + "/Τιμολόγια/τιμολόγιο " + i + ".pdf", "invoice " + i);
  await A.write("/internal/Notes/todo.md", "buy milk");
  await A.sync();
  return db;
}

test("a list localStorage refuses is kept in IndexedDB and survives a restart", async () => {
  const db = await seeded(40);
  const idb = fakeIdb();
  const B = await vaultDevice(db, "B", { idb });
  capStorage(B, 2000);                                  // the list is ~6,000 characters
  const r = await B.sync();
  assert.equal(r.stats.failed, 0);
  assert.equal(B.vault.remoteOnly(PC).length, 40, "listed now");
  await flush(B);
  assert.equal(B.localStorage.getItem("oros-vault-ondemand"), null, "nothing in localStorage");
  const kept = JSON.parse(idb.dbs.get("oros-vault-od").get("od").get("m"));
  assert.equal(Object.keys(kept).length, 40, "the whole list is in IndexedDB");
  // The same device starts again (a reload): the list is there before any sync.
  const seed = {};
  for (const [k, v] of B.localStorage.map) seed[k] = v;
  const B2 = await vaultDevice(db, "B", { idb, seed });
  await flush(B2);
  assert.equal(B2.vault.remoteOnly(PC).length, 40, "listed after a restart, with no sync");
  const r2 = await B2.sync();                           // idle: the cloud did not move
  assert.equal(r2.stats.failed, 0);
  assert.equal(B2.vault.remoteOnly(PC).length, 40, "an idle check keeps it");
});

test("an older device's list in localStorage moves to IndexedDB", async () => {
  const db = await seeded(3);
  const B = await vaultDevice(db, "B");                 // no IndexedDB: the old place
  await B.sync();
  const old = B.localStorage.getItem("oros-vault-ondemand");
  assert.ok(old && Object.keys(JSON.parse(old)).length === 3);
  const seed = {};
  for (const [k, v] of B.localStorage.map) seed[k] = v;
  const idb = fakeIdb();
  const B2 = await vaultDevice(db, "B", { idb, seed });
  await flush(B2);
  assert.equal(B2.vault.remoteOnly(PC).length, 3);
  assert.equal(B2.localStorage.getItem("oros-vault-ondemand"), null, "taken out of localStorage");
  assert.equal(Object.keys(JSON.parse(idb.dbs.get("oros-vault-od").get("od").get("m"))).length, 3);
  assert.ok(B2.localStorage.getItem("oros-vault-rev"), "a list that was there keeps the revision");
});

test("a list that never fit is downloaded again once (the revision is forgotten)", async () => {
  const db = await seeded(40);
  const B = await vaultDevice(db, "B");                 // the old engine on a full localStorage
  capStorage(B, 2000);
  await B.sync();
  assert.equal(B.localStorage.getItem("oros-vault-ondemand"), null, "the write was refused");
  assert.ok(B.localStorage.getItem("oros-vault-rev"), "yet the revision was kept");
  const seed = {};
  for (const [k, v] of B.localStorage.map) seed[k] = v;
  const B2 = await vaultDevice(db, "B", { idb: fakeIdb(), seed });
  capStorage(B2, 2000);
  for (let i = 0; i < 6; i++) await tick();             // the list is read (no timers: no auto sync)
  assert.equal(B2.vault.remoteOnly(PC).length, 0, "nothing known yet");
  const r = await B2.sync();                            // the cloud did not move, the list comes back
  assert.equal(r.stats.failed, 0);
  assert.equal(B2.vault.remoteOnly(PC).length, 40);
  assert.equal(r.stats.deleted, 0, "nothing on the device is touched");
});

test("without IndexedDB the list stays in localStorage, as before", async () => {
  const db = await seeded(2);
  const B = await vaultDevice(db, "B");
  await B.sync();
  assert.equal(Object.keys(JSON.parse(B.localStorage.getItem("oros-vault-ondemand"))).length, 2);
});
