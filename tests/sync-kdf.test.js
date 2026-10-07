// A70 — key derivation strength. New blobs are sealed with PBKDF2
// 600,000 rounds and carry "iter"; blobs without it (everything
// written before) are read at 100,000 and upgraded by the next push.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("crypto");
const { FakeDropbox, createDevice, readKey, writeKey, cloudPayload } = require("./harness");

const PASS = "test-passphrase";              // the harness passphrase
const b64 = (u8) => Buffer.from(u8).toString("base64");

// A blob exactly as sync.js wrote it before A70: no "iter", 100,000 rounds.
async function legacyBlob(payload) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const base = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(PASS), "PBKDF2", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const data = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key,
    new TextEncoder().encode(JSON.stringify(payload))));
  return JSON.stringify({ ver: 1, salt: b64(salt), iv: b64(iv), data: b64(data) });
}

test("a new push seals the blob with 600,000 rounds and says so", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A", { "oros-slices": { notes: "app-notes" } });
  writeKey(A, "app-notes", { items: { x: 1 } });
  A.sync.markDirty();
  await A.sync.push();
  const blob = JSON.parse(db.files.get("/orOS-data.json").text);
  assert.equal(blob.iter, 600000);
  assert.deepEqual((await cloudPayload(db, A)).apps.notes, { items: { x: 1 } });
});

test("a blob written before A70 is read, and the next push upgrades it without losing data", async () => {
  const db = new FakeDropbox();
  const old = { shell: null, apps: { notes: { items: { kept: "from the old blob" } } }, meta: {} };
  db.put("/orOS-data.json", await legacyBlob(old));
  db.put("/orOS-backup-2026-10-01.json", await legacyBlob(old));     // an old cloud backup

  const A = await createDevice(db, "A", { "oros-slices": { notes: "app-notes" } });
  await A.sync.pull();
  assert.deepEqual(readKey(A, "app-notes"), { items: { kept: "from the old blob" } });

  writeKey(A, "app-notes", { items: { kept: "from the old blob", added: "after" } });
  A.sync.markDirty();
  await A.sync.push();
  const blob = JSON.parse(db.files.get("/orOS-data.json").text);
  assert.equal(blob.iter, 600000, "upgraded");
  assert.deepEqual((await cloudPayload(db, A)).apps.notes,
    { items: { kept: "from the old blob", added: "after" } });

  const backup = await A.sync.vaultCrypto.decryptJson(db.files.get("/orOS-backup-2026-10-01.json").text);
  assert.deepEqual(backup.apps.notes, old.apps.notes, "old backups stay readable");
});

test("a blob claiming an absurd round count is refused, not derived", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const blob = JSON.parse(await legacyBlob({ shell: null, apps: {}, meta: {} }));
  blob.iter = 1e9;
  db.put("/orOS-data.json", JSON.stringify(blob));
  const err = await A.sync.pull().then(() => null, (e) => e);
  assert.ok(err, "pull rejects");
  assert.equal(A.sync.errorKey(err), "sync.err.version");
});

test("a passphrase change re-seals with 600,000 rounds and the other device follows with the new one", async () => {
  const db = new FakeDropbox();
  const old = { shell: null, apps: { notes: { items: { a: 1 } } }, meta: {} };
  db.put("/orOS-data.json", await legacyBlob(old));
  const A = await createDevice(db, "A", { "oros-slices": { notes: "app-notes" } });
  await A.sync.pull();
  await A.sync.changePassphrase(PASS, "a-new-longer-passphrase", false);
  const blob = JSON.parse(db.files.get("/orOS-data.json").text);
  assert.equal(blob.iter, 600000);

  const B = await createDevice(db, "B", { "oros-slices": { notes: "app-notes" } });
  B.sync.setPassphrase("a-new-longer-passphrase", false);
  await B.sync.pull();
  assert.deepEqual(readKey(B, "app-notes"), { items: { a: 1 } });
});
