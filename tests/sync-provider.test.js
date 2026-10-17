// WebDAV W1 — the sync provider contract. The engine reaches the
// cloud only through `provider` (sync.js); these checks pin the paths
// that moved behind it: daily backups and their rotation, factory
// reset (wipe + revoke), and the conditional upload of a passphrase
// change. The same file runs against every provider once there are two.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeDropbox, createDevice, writeKey, cloudPayload } = require("./harness");

const SLICES = { "oros-slices": { notes: "app-notes" } };

function backupNames(db) {
  return [...db.files.keys()].filter((p) => p.startsWith("/orOS-backup-")).sort();
}

test("a push makes one backup a day and keeps the newest seven", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A", SLICES);
  writeKey(A, "app-notes", { items: { a: 1 } });
  A.sync.markDirty();
  await A.sync.push();                         // empty cloud: nothing to back up
  assert.deepEqual(backupNames(db), []);

  for (let d = 1; d <= 8; d++) db.put("/orOS-backup-2026-01-0" + d + ".json", "old" + d);
  writeKey(A, "app-notes", { items: { a: 2 } });
  A.sync.markDirty();
  await A.sync.push();
  const names = backupNames(db);
  assert.equal(names.length, 7, "rotated to seven");
  assert.ok(!names.includes("/orOS-backup-2026-01-01.json"), "the oldest went");
  assert.ok(!names.includes("/orOS-backup-2026-01-02.json"));
  const fresh = names.filter((n) => !/2026-01-0/.test(n));
  assert.equal(fresh.length, 1, "today's copy was made");
  const copy = await A.sync.vaultCrypto.decryptJson(db.files.get(fresh[0]).text);
  assert.deepEqual(copy.apps.notes, { items: { a: 1 } }, "the copy is the blob before this push");

  writeKey(A, "app-notes", { items: { a: 3 } });
  A.sync.markDirty();
  await A.sync.push();
  assert.equal(backupNames(db).filter((n) => !/2026-01-0/.test(n)).length, 1, "no second copy the same day");
  assert.deepEqual((await cloudPayload(db, A)).apps.notes, { items: { a: 3 } });
});

test("factory reset deletes the blob, the backups and the vault, then revokes", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A", SLICES);
  writeKey(A, "app-notes", { items: { a: 1 } });
  A.sync.markDirty();
  await A.sync.push();
  db.put("/orOS-backup-2026-01-01.json", "x");
  db.put("/vault/manifest.json", "m");
  db.put("/vault/objects/ab/cd", "o");
  db.put("/someone-else.txt", "keep");

  const res = await A.sync.wipeEverything();
  assert.equal(res.revoked, true);
  assert.ok(res.wiped >= 3);
  assert.deepEqual([...db.files.keys()], ["/someone-else.txt"], "only orOS files went");
  assert.equal(db.log.filter((e) => e.op === "revoke").length, 1);
  assert.equal(A.sync.isConnected(), false);
});

test("a passphrase change refused by the cloud leaves the old passphrase working", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A", SLICES);
  const B = await createDevice(db, "B", SLICES);
  writeKey(A, "app-notes", { items: { a: 1 } });
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();

  // Another device pushes between A's download and A's upload.
  let raced = false;
  db.beforeUpload = (device, path) => {
    if (device !== "A" || raced || path !== "/orOS-data.json") return;
    raced = true;
    db.beforeUpload = null;
    db.put(path, db.files.get(path).text);    // same content, new revision
  };
  await assert.rejects(A.sync.changePassphrase("test-passphrase", "new-passphrase", false),
    /cloud-changed/);
  assert.ok(raced);
  const payload = await cloudPayload(db, A);    // still sealed with the old one
  assert.deepEqual(payload.apps.notes, { items: { a: 1 } });
  await A.sync.pull();                          // and A still reads it
});
