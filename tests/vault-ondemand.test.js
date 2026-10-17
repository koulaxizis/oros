// VD-OD — orOS Drive folders (/internal/Drive) are on demand: listed
// on every device, downloaded only when opened or kept offline. And the
// manifest a device writes keeps every cloud entry it did not apply.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BinDropbox, vaultDevice, cloudPaths } = require("./vault-harness");

const PC = "/internal/Drive/PC/Documents";

// Device A (standing in for a computer running orOS Drive) puts a
// mirrored folder and an ordinary note into the vault.
async function seeded() {
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  await A.write(PC + "/report.txt", "quarterly report");
  await A.write(PC + "/photos/beach.jpg", "jpeg bytes");
  await A.write("/internal/Notes/todo.md", "buy milk");
  const r = await A.sync();
  assert.equal(r.stats.uploaded, 3);
  return { db, A };
}

test("Drive files are listed but not downloaded; other files are", async () => {
  const { db } = await seeded();
  const B = await vaultDevice(db, "B");
  const r = await B.sync();
  assert.equal(r.stats.failed, 0);
  assert.equal(await B.read("/internal/Notes/todo.md"), "buy milk");
  assert.equal(B.disk.has(PC + "/report.txt"), false);
  assert.equal(db.downloads("B", "/vault/objects/"), 1, "only the note's object was fetched");
  const ro = Array.from(B.vault.remoteOnly(B.vault.driveRoot), (e) => e.path).sort();
  assert.deepEqual(ro, [PC + "/photos/beach.jpg", PC + "/report.txt"]);
  assert.equal(B.vault.remoteOnly(PC + "/photos").length, 1);
  assert.equal(B.vault.isRemoteOnly(PC + "/report.txt"), true);
});

test("a push from a device without the Drive files keeps them in the cloud", async () => {
  const { db, A } = await seeded();
  const B = await vaultDevice(db, "B");
  await B.sync();
  await B.write("/internal/Notes/todo.md", "buy milk and bread");
  await B.sync();
  assert.deepEqual(await cloudPaths(B), [PC + "/photos/beach.jpg", PC + "/report.txt", "/internal/Notes/todo.md"]);
  const r = await A.sync();
  assert.equal(r.stats.deleted, 0, "A loses nothing");
  assert.equal(await A.read(PC + "/report.txt"), "quarterly report");
  assert.equal(await A.read("/internal/Notes/todo.md"), "buy milk and bread");
});

test("an idle check followed by an edit still keeps the Drive files", async () => {
  const { db } = await seeded();
  const B = await vaultDevice(db, "B");
  await B.sync();
  await B.sync();                                   // idle: the cloud did not move
  assert.equal(B.vault.remoteOnly().length, 2, "cloud-only list survives the idle check");
  await B.write("/internal/new.txt", "new");
  await B.sync();
  assert.ok((await cloudPaths(B)).includes(PC + "/report.txt"));
});

test("fetch downloads one file, which then syncs like any other", async () => {
  const { db, A } = await seeded();
  const B = await vaultDevice(db, "B");
  await B.sync();
  await B.vault.fetch(PC + "/report.txt");
  assert.equal(await B.read(PC + "/report.txt"), "quarterly report");
  assert.equal(B.vault.isRemoteOnly(PC + "/report.txt"), false);
  assert.equal(B.vault.queueLength(), 0, "a fetch is not a local change");
  // The computer changes it: B, which holds it now, gets the change.
  await A.write(PC + "/report.txt", "quarterly report v2");
  await A.sync();
  const r = await B.sync();
  assert.equal(r.stats.downloaded, 1);
  assert.equal(await B.read(PC + "/report.txt"), "quarterly report v2");
  assert.equal(B.disk.has(PC + "/photos/beach.jpg"), false, "the rest stays in the cloud");
});

test("evict frees space without deleting anything in the cloud", async () => {
  const { db, A } = await seeded();
  const B = await vaultDevice(db, "B");
  await B.sync();
  await B.vault.fetch(PC + "/report.txt");
  await B.vault.fetch(PC + "/photos/beach.jpg");
  await B.write(PC + "/photos/edited.jpg", "edited here");   // local work: never evicted
  const n = await B.vault.evict(PC);
  assert.equal(n, 2);
  assert.equal(B.disk.has(PC + "/report.txt"), false);
  assert.equal(B.disk.has(PC + "/photos/edited.jpg"), true);
  assert.equal(B.vault.isRemoteOnly(PC + "/report.txt"), true);
  await B.sync();
  const paths = await cloudPaths(B);
  assert.ok(paths.includes(PC + "/report.txt") && paths.includes(PC + "/photos/beach.jpg"));
  assert.ok(paths.includes(PC + "/photos/edited.jpg"));
  const r = await A.sync();
  assert.equal(r.stats.deleted, 0);
});

test("keep offline downloads a folder and keeps it", async () => {
  const { db } = await seeded();
  const B = await vaultDevice(db, "B");
  await B.sync();
  assert.equal(B.vault.setKeptOffline(PC + "/photos", true), true);
  assert.equal(B.vault.isKeptOffline(PC + "/photos/beach.jpg"), true);
  await B.sync();
  assert.equal(await B.read(PC + "/photos/beach.jpg"), "jpeg bytes");
  assert.equal(B.disk.has(PC + "/report.txt"), false);
  assert.equal(await B.vault.evict(PC), 0, "a folder kept offline is not evicted");
  assert.equal(B.vault.setKeptOffline("/internal/Notes", true), false, "only Drive folders");
});

test("a Drive file deleted on the computer leaves the cloud-only list", async () => {
  const { db, A } = await seeded();
  const B = await vaultDevice(db, "B");
  await B.sync();
  await A.rm(PC + "/report.txt");
  await A.sync();
  await B.sync();
  assert.equal(B.vault.isRemoteOnly(PC + "/report.txt"), false);
  assert.equal(B.vault.remoteOnly().length, 1);
});

test("a file whose download failed is not dropped from the cloud by the next push", async () => {
  const { db, A } = await seeded();
  // A adds a file, then its stored object is damaged.
  await A.write("/internal/big.bin", "important");
  await A.sync();
  const before = new Set(db.files.keys());
  const B = await vaultDevice(db, "B");
  for (const k of db.files.keys()) {
    if (!k.startsWith("/vault/objects/")) continue;
    const f = db.files.get(k);
    f.data = Buffer.from(f.data);
    f.data[f.data.length - 1] ^= 1;                // every object unreadable for B
  }
  await B.write("/internal/mine.txt", "B's own file");
  const r = await B.sync();
  assert.ok(r.stats.failed >= 1);
  const paths = await cloudPaths(B);
  assert.ok(paths.includes("/internal/big.bin"), "the entry B could not fetch is still there");
  assert.ok(paths.includes("/internal/Notes/todo.md"));
  assert.ok(paths.includes("/internal/mine.txt"));
  assert.ok(before.size > 0);
});

test("removeRemote deletes a cloud-only folder in the cloud and on the computer", async () => {
  const { db, A } = await seeded();
  const B = await vaultDevice(db, "B");
  await B.sync();
  assert.equal(await B.vault.removeRemote(PC + "/photos"), 1);
  assert.equal(B.vault.isRemoteOnly(PC + "/photos/beach.jpg"), false);
  assert.equal(B.vault.queueLength(), 1);
  const r = await B.sync();
  assert.equal(r.stats.failed, 0);
  assert.equal(B.vault.queueLength(), 0);
  assert.deepEqual(await cloudPaths(B), [PC + "/report.txt", "/internal/Notes/todo.md"]);
  assert.equal(B.vault.manifestEntry(PC + "/photos/beach.jpg"), null);
  assert.equal(B.vault.isRemoteOnly(PC + "/report.txt"), true, "the rest stays listed");
  const ra = await A.sync();
  assert.equal(ra.stats.deleted, 1);
  assert.equal(A.disk.has(PC + "/photos/beach.jpg"), false);
  assert.equal(await A.read(PC + "/report.txt"), "quarterly report");
});

test("removeRemote of a whole folder, with files on this device moved away by Files", async () => {
  const { db, A } = await seeded();
  const B = await vaultDevice(db, "B");
  await B.sync();
  await B.vault.fetch(PC + "/report.txt");
  await B.rm(PC + "/report.txt");                   // Files: the local copy goes to the Trash
  assert.equal(await B.vault.removeRemote(PC), 1);
  await B.sync();
  assert.deepEqual(await cloudPaths(B), ["/internal/Notes/todo.md"]);
  assert.equal(B.vault.remoteOnly().length, 0);
  await A.sync();
  assert.equal(A.disk.has(PC + "/report.txt"), false);
  assert.equal(A.disk.has(PC + "/photos/beach.jpg"), false);
});

test("removeRemote never deletes a file changed on the computer meanwhile", async () => {
  const { db, A } = await seeded();
  const B = await vaultDevice(db, "B");
  await B.sync();
  await B.vault.removeRemote(PC + "/photos");
  await A.write(PC + "/photos/beach.jpg", "retouched");
  await A.sync();
  await B.sync();
  assert.ok((await cloudPaths(B)).includes(PC + "/photos/beach.jpg"), "the newer version stays");
  await A.sync();
  assert.equal(await A.read(PC + "/photos/beach.jpg"), "retouched");
});

test("removeRemote only acts inside orOS Drive", async () => {
  const { db } = await seeded();
  const B = await vaultDevice(db, "B");
  await B.sync();
  assert.equal(await B.vault.removeRemote("/internal/Notes"), 0);
  assert.equal(await B.vault.removeRemote(B.vault.driveRoot), 0, "never the whole Drive at once");
  assert.equal(await B.vault.removeRemote("/internal/Drive/PCX"), 0, "a name prefix is not a folder");
  assert.equal(B.vault.queueLength(), 0);
});
