// VD-GC — clean-up of unused cloud objects, only on request. The same
// rules as orOS Drive (koulaxizis/oros-drive vault/clean.go); each test
// below is one way a clean-up could lose a file. Runs on Dropbox here
// and again on WebDAV from sync-webdav.test.js.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("crypto");
const { BinDropbox, vaultDevice } = require("./vault-harness");

const DAY = 864e5;
const OBJ = /^objects\/[0-9a-f]{64}$/;
const objects = (db) => db.vaultKeys().filter((k) => OBJ.test(k));

// The keyed name ("objects/<hex HMAC(h)>") of content hash h.
async function objectName(dev, h) {
  const st = dev.ctx.orosSync.storage;
  const doc = JSON.parse(Buffer.from(await st.getObject("key.json")).toString("utf8"));
  const sealed = await dev.ctx.orosSync.vaultCrypto.decryptJson(doc.wraps[0]);
  const raw = Buffer.from(sealed.k, "base64");
  const d = await webcrypto.subtle.digest("SHA-256", Buffer.concat([Buffer.from("orOS-vault-name:"), raw]));
  const k = await webcrypto.subtle.importKey("raw", d, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "objects/" + Buffer.from(await webcrypto.subtle.sign("HMAC", k, Buffer.from(h))).toString("hex");
}
const sha = async (text) => Buffer.from(await webcrypto.subtle.digest("SHA-256", Buffer.from(text))).toString("hex");

// A wrote three files, then changed one and deleted another: two
// objects nobody names any more, two still in use.
async function leftovers() {
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  await A.write("/internal/a.txt", "first a");
  await A.write("/internal/b.txt", "bee");
  await A.write("/internal/c.txt", "sea");
  await A.sync();
  await A.write("/internal/a.txt", "second a");
  await A.rm("/internal/b.txt");
  await A.sync();
  assert.equal(objects(db).length, 4);
  return { db, A };
}

test("usage counts unused objects and keeps young ones; nothing changes", async () => {
  const { db, A } = await leftovers();
  const before = db.vaultKeys();
  const u = await A.vault.usage();
  assert.equal(u.files, 2);
  assert.equal(u.objects, 4);
  assert.equal(u.unused, 2);
  assert.equal(u.free, 0, "stored less than 30 days ago: kept");
  assert.equal(u.missing, 0);
  assert.equal(u.hold, "");
  assert.ok(u.otherBytes > 0, "manifest and key file are counted apart");
  const r = await A.vault.cleanUp();
  assert.equal(r.removed, 0);
  assert.deepEqual(db.vaultKeys(), before);
});

test("old unused objects are removed; every file still opens on another device", async () => {
  const { db, A } = await leftovers();
  db.age(31 * DAY);
  const u = await A.vault.usage();
  assert.equal(u.free, 2);
  assert.ok(u.freeBytes > 0 && u.freeBytes === u.unusedBytes);
  const r = await A.vault.cleanUp();
  assert.deepEqual([r.removed, r.bytes, r.stopped, r.healed, Array.from(r.lost)], [2, u.freeBytes, false, 0, []]);
  assert.equal(objects(db).length, 2);
  assert.ok(db.vaultKeys().includes("manifest.json") && db.vaultKeys().includes("key.json"));
  assert.ok(db.files.has("/vault/" + await objectName(A, await sha("second a"))));
  assert.ok(db.files.has("/vault/" + await objectName(A, await sha("sea"))));
  const B = await vaultDevice(db, "B");
  const s = await B.sync();
  assert.equal(s.stats.failed, 0);
  assert.equal(await B.read("/internal/a.txt"), "second a");
  assert.equal(await B.read("/internal/c.txt"), "sea");
  assert.equal((await A.vault.usage()).unused, 0);
});

test("29 days is not old enough", async () => {
  const { db, A } = await leftovers();
  db.age(29 * DAY);
  assert.equal((await A.vault.usage()).free, 0);
  assert.equal((await A.vault.cleanUp()).removed, 0);
  assert.equal(objects(db).length, 4);
});

test("no manifest removes nothing (VD-1)", async () => {
  const { db, A } = await leftovers();
  db.age(31 * DAY);
  db.drop("manifest.json");
  const u = await A.vault.usage();
  assert.equal(u.hold, "no-manifest");
  assert.equal(u.free, 0);
  await assert.rejects(A.vault.cleanUp(), /clean-no-manifest/);
  assert.equal(objects(db).length, 4);
});

test("too few of the named objects listed removes nothing", async () => {
  const { db, A } = await leftovers();
  db.age(31 * DAY);
  db.drop(await objectName(A, await sha("sea")));        // 1 of 2 named objects missing
  const u = await A.vault.usage();
  assert.equal(u.missing, 1);
  assert.equal(u.hold, "mismatch");
  assert.equal(u.free, 0);
  await assert.rejects(A.vault.cleanUp(), /clean-mismatch/);
  assert.equal(objects(db).length, 3);
});

test("no vault key removes nothing", async () => {
  const { db, A } = await leftovers();
  db.age(31 * DAY);
  const B = await vaultDevice(db, "B");
  db.drop("key.json");
  await assert.rejects(B.vault.cleanUp());
  assert.equal(objects(db).length, 4);
});

test("the legacy name of a file in use counts as in use", async () => {
  const { db, A } = await leftovers();
  db.putRaw("objects/" + await sha("sea"), "legacy bytes of c");   // c.txt: in use
  db.putRaw("objects/" + await sha("bee"), "legacy bytes of b");   // b.txt: deleted
  db.age(31 * DAY);
  const r = await A.vault.cleanUp();
  assert.equal(r.removed, 3);
  assert.ok(db.files.has("/vault/objects/" + await sha("sea")));
  assert.ok(!db.files.has("/vault/objects/" + await sha("bee")));
});

test("names that are not objects/<64 hex> are never removed", async () => {
  const { db, A } = await leftovers();
  db.putRaw("objects/notes.txt", "x");
  db.putRaw("other/" + "a".repeat(64), "x");
  db.age(31 * DAY);
  const r = await A.vault.cleanUp();
  assert.equal(r.removed, 2);
  for (const k of ["objects/notes.txt", "other/" + "a".repeat(64)]) {
    assert.ok(db.files.has("/vault/" + k), k);
  }
});

test("the manifest moving during the clean-up stops it", async () => {
  const { db, A } = await leftovers();
  db.age(31 * DAY);
  const B = await vaultDevice(db, "B");
  await B.sync();
  const st = A.ctx.orosSync.storage, del = st.deleteObject;
  let n = 0;
  st.deleteObject = async (key) => {
    const r = await del.call(st, key);
    if (++n === 1) { await B.write("/internal/new.txt", "from B"); await B.sync(); }
    return r;
  };
  const r = await A.vault.cleanUp();
  st.deleteObject = del;
  assert.equal(r.removed, 1);
  assert.equal(r.stopped, true);
  assert.equal(objects(db).length, 4, "3 in use + 1 unused left");
});

test("a removed object named again is put back from this device's copy", async () => {
  // B deleted c.txt; A has not synced since and still holds it. 31 days
  // later B writes the same content again: on Dropbox the same bytes
  // keep the old time, and B's manifest lands between A's revision
  // check and A's removal.
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  await A.write("/internal/a.txt", "aa");
  await A.write("/internal/c.txt", "sea");
  await A.sync();
  const B = await vaultDevice(db, "B");
  await B.sync();
  await B.rm("/internal/c.txt");
  await B.sync();
  db.age(31 * DAY);
  const st = A.ctx.orosSync.storage, del = st.deleteObject;
  let raced = false;
  st.deleteObject = async (key) => {
    if (!raced) { raced = true; await B.write("/internal/again.txt", "sea"); await B.sync(); }
    return del.call(st, key);
  };
  const r = await A.vault.cleanUp();
  st.deleteObject = del;
  assert.ok(raced);
  assert.equal(r.removed, 1);
  assert.equal(r.healed, 1);
  assert.deepEqual(Array.from(r.lost), []);
  const C = await vaultDevice(db, "C");
  const s = await C.sync();
  assert.equal(s.stats.failed, 0, "every file in the cloud has its object");
  assert.equal(await C.read("/internal/again.txt"), "sea");
});

test("what cannot be put back is reported", async () => {
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  await A.write("/internal/a.txt", "aa");
  await A.write("/internal/c.txt", "sea");
  await A.sync();
  await A.rm("/internal/c.txt");
  await A.sync();
  db.age(31 * DAY);
  const B = await vaultDevice(db, "B");
  await B.sync();
  const st = A.ctx.orosSync.storage, del = st.deleteObject;
  let raced = false;
  st.deleteObject = async (key) => {
    if (!raced) { raced = true; await B.write("/internal/again.txt", "sea"); await B.sync(); }
    return del.call(st, key);
  };
  const r = await A.vault.cleanUp();
  st.deleteObject = del;
  assert.equal(r.healed, 0);
  assert.deepEqual(Array.from(r.lost), ["/internal/again.txt"]);
  // B, which uploaded it, notices on its next syncs and uploads it again.
  await B.sync();
  await B.sync();
  const C = await vaultDevice(db, "C");
  const s = await C.sync();
  assert.equal(s.stats.failed, 0);
  assert.equal(await C.read("/internal/again.txt"), "sea");
});

test("a restart with uploads still to look at syncs (the key is loaded first)", async () => {
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  await A.write("/internal/a.txt", "aa");
  await A.sync();
  assert.ok(A.localStorage.getItem("oros-vault-sent"), "the upload waits for a second look");
  const seed = {};
  for (const [k, v] of A.localStorage.map) if (/^oros-vault-/.test(k)) seed[k] = v;
  const again = await vaultDevice(db, "A", { seed });          // the same browser, reloaded
  const r = await again.sync();
  assert.equal(r.ok, true);
});
