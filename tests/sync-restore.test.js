// Quality gate Q5 (A43): restore a cloud backup from the UI.
// A restore is a ROLLBACK for every device, not a merge:
//   · before it, this device's state goes to a local rescue copy and
//     the cloud blob as it is now becomes one more backup;
//   · the backup is opened with the current passphrase, or the old one
//     it was sealed with (restore-oldpass asks for it);
//   · the restored state is uploaded conditionally with a higher
//     meta.restoreEpoch and replaces the local state;
//   · a device that pulls a newer epoch keeps its own rescue copy
//     (required when it has unpushed work) and takes the cloud whole.
// Listed in tests/sync-webdav.test.js, so it runs for both providers.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeDropbox, createDevice, registerLive, readKey, edit, lwwRecordMerge, cloudPayload, reboot } = require("./harness");

const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise((r) => setTimeout(r, 5));
const sink = (box) => (text, reason) => { box.push({ reason, data: JSON.parse(text) }); return Promise.resolve(true); };
const item = (v, t) => ({ v, t });

// A and B share "notes" (live, merge-capable). Cloud history:
//   v1 { a }  →  (backup of v1)  →  v2 { a, b }
// B has pulled v2. Returns the devices and the backup's name.
async function twoDevices(db) {
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B");
  registerLive(A, "notes", lwwRecordMerge);
  registerLive(B, "notes", lwwRecordMerge);
  edit(A, "notes", () => ({ items: { a: item(1, 1) } }));
  await A.sync.push();
  edit(A, "notes", (d) => { d.items.b = item(2, 2); return d; });
  await A.sync.push();                          // the day's first copy keeps v1
  await B.sync.pull();
  const list = await A.sync.listBackups();
  assert.equal(list.length, 1, "one backup so far");
  return { A, B, name: list[0].name };
}

test("the backup list shows the newest copies first, with a time", async () => {
  const db = new FakeDropbox();
  const { A, name } = await twoDevices(db);
  const list = Array.from(await A.sync.listBackups()).map(plain);
  assert.equal(list[0].name, name);
  assert.match(list[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(!Number.isNaN(Date.parse(list[0].at)));
});

test("restore is a rollback here and on the other device, not a merge", async () => {
  const db = new FakeDropbox();
  const { A, B, name } = await twoDevices(db);
  const rescues = [];
  A.sync.setRescueSink(sink(rescues));
  const heardB = [];
  B.sync.onRestored((info) => heardB.push(plain(info)));
  await tick();

  const r = await A.sync.restoreBackup(name);
  assert.equal(r.ok, true);
  assert.equal(r.epoch, 1);
  assert.deepEqual(plain(readKey(A, "app-notes")), { items: { a: item(1, 1) } }, "A holds the backup, item b is gone");
  const cloud = plain(await cloudPayload(db, A));
  assert.deepEqual(cloud.apps.notes, { items: { a: item(1, 1) } });
  assert.equal(cloud.meta.restoreEpoch, 1);
  assert.equal(cloud.meta.restoredFrom, name);
  assert.equal(rescues.length, 1, "one rescue copy");
  assert.deepEqual(rescues[0].data.apps.notes, { items: { a: item(1, 1), b: item(2, 2) } }, "the rescue holds the state before");
  const after = Array.from(await A.sync.listBackups()).map(plain);
  assert.equal(after.length, 2, "the state before the restore became a backup");
  assert.equal(A.sync.isDirty(), false, "nothing left to upload");

  // B pulls: its merge would keep b (b is newer than nothing); a rollback drops it.
  const pb = await B.sync.pull();
  assert.equal(pb.restored, true);
  assert.deepEqual(plain(readKey(B, "app-notes")), { items: { a: item(1, 1) } });
  assert.equal(B.sync.isDirty(), false, "B does not upload anything back");
  assert.equal(heardB.length, 1);
  assert.equal(heardB[0].here, false);
  assert.equal(heardB[0].from, name);

  // From now on both merge normally again, and the epoch stays in the cloud.
  const ups = db.uploads().length;
  await B.sync.pull();
  await A.sync.pull();
  assert.equal(db.uploads().length, ups, "no endless uploads after a restore");
  edit(B, "notes", (d) => { d.items.c = item(3, 3); return d; });
  await B.sync.push();
  const p2 = await A.sync.pull();
  assert.notEqual(p2.restored, true, "the same epoch is not rolled back twice");
  assert.deepEqual(Object.keys(readKey(A, "app-notes").items).sort(), ["a", "c"]);
  assert.equal(plain(await cloudPayload(db, A)).meta.restoreEpoch, 1, "every push carries the epoch");
});

test("a device with unpushed work keeps it in a rescue copy, or the rollback waits", async () => {
  const db = new FakeDropbox();
  const { A, B, name } = await twoDevices(db);
  A.sync.setRescueSink(sink([]));
  await tick();
  edit(B, "notes", (d) => { d.items.z = item(9, 9); return d; });   // not pushed
  await A.sync.restoreBackup(name);

  await assert.rejects(B.sync.pull(), /restore-rescue-failed/, "no sink: the rollback refuses");
  assert.ok(readKey(B, "app-notes").items.z, "B's unpushed work is untouched");

  const rescues = [];
  B.sync.setRescueSink(sink(rescues));
  await B.sync.pull();
  assert.equal(rescues.length, 1);
  assert.ok(rescues[0].data.apps.notes.items.z, "the rescue copy holds the unpushed item");
  assert.deepEqual(plain(readKey(B, "app-notes")), { items: { a: item(1, 1) } });
});

test("a push from a device that has not seen the restore follows it first", async () => {
  const db = new FakeDropbox();
  const { A, B, name } = await twoDevices(db);
  A.sync.setRescueSink(sink([]));
  B.sync.setRescueSink(sink([]));
  await tick();
  await A.sync.restoreBackup(name);
  edit(B, "notes", (d) => { d.items.z = item(9, 9); return d; });
  await B.sync.push();                       // refused once, learns the restore, uploads
  const cloud = plain(await cloudPayload(db, A));
  assert.deepEqual(Object.keys(cloud.apps.notes.items), ["a"], "the old state did not come back");
  assert.equal(cloud.meta.restoreEpoch, 1);
});

test("a backup sealed with the old passphrase asks for it", async () => {
  const db = new FakeDropbox();
  const { A, name } = await twoDevices(db);
  A.sync.setRescueSink(sink([]));
  await A.sync.changePassphrase("test-passphrase", "new-pass", false);
  await tick();
  await assert.rejects(A.sync.restoreBackup(name), /restore-oldpass$/);
  await assert.rejects(A.sync.restoreBackup(name, "wrong"), /restore-oldpass-wrong/);
  assert.equal(A.sync.errorKey(new Error("restore-oldpass")), "sync.err.restore-oldpass");
  const r = await A.sync.restoreBackup(name, "test-passphrase");
  assert.equal(r.ok, true);
  const cloud = plain(await cloudPayload(db, A));   // decrypts with the passphrase in memory = new-pass
  assert.deepEqual(cloud.apps.notes, { items: { a: item(1, 1) } }, "re-sealed with the current passphrase");
});

test("no rescue copy, no restore: the cloud stays as it was", async () => {
  const db = new FakeDropbox();
  const { A, name } = await twoDevices(db);
  const before = db.files.get("/orOS-data.json").text;
  await assert.rejects(A.sync.restoreBackup(name), /restore-rescue-failed/);
  assert.equal(db.files.get("/orOS-data.json").text, before);
  assert.equal(Object.keys(readKey(A, "app-notes").items).length, 2);
  await assert.rejects(A.sync.restoreBackup("../orOS-data.json"), /restore-missing/);
  await assert.rejects(A.sync.restoreBackup("orOS-backup-2000-01-01T00-00-00-000Z.json"), /restore-missing/);
});

test("another device writing during the restore: the restore retries and wins", async () => {
  const db = new FakeDropbox();
  const { A, B, name } = await twoDevices(db);
  A.sync.setRescueSink(sink([]));
  await tick();
  let once = true;
  db.beforeUpload = (device, p) => {
    if (once && device === "A" && p === "/orOS-data.json") {
      once = false;
      db.put("/orOS-data.json", db.files.get("/orOS-data.json").text);   // B-like write, new rev
    }
  };
  const r = await A.sync.restoreBackup(name);
  db.beforeUpload = null;
  assert.equal(r.ok, true);
  assert.deepEqual(plain(await cloudPayload(db, A)).apps.notes, { items: { a: item(1, 1) } });
  assert.equal(plain(await cloudPayload(db, A)).meta.restoreEpoch, 1);
  await B.sync.pull();
  assert.deepEqual(Object.keys(readKey(B, "app-notes").items), ["a"]);
});

test("apps the backup does not hold keep their data; a new device just applies", async () => {
  const db = new FakeDropbox();
  const { A, B, name } = await twoDevices(db);
  registerLive(B, "todo", lwwRecordMerge);
  edit(B, "todo", () => ({ items: { t: item(1, 5) } }));
  await B.sync.push();
  await A.sync.pull();                      // A relays todo (unknown there)
  A.sync.setRescueSink(sink([]));
  B.sync.setRescueSink(sink([]));
  await tick();
  await A.sync.restoreBackup(name);
  const cloud = plain(await cloudPayload(db, A));
  assert.equal(cloud.apps.todo, undefined, "the unknown todo copy is rolled back with the rest");
  await B.sync.pull();
  assert.ok(readKey(B, "app-todo").items.t, "B keeps its todo");
  assert.equal(B.sync.isDirty(), true, "and uploads it");
  await B.sync.push();
  assert.ok(plain(await cloudPayload(db, A)).apps.todo.items.t);

  const C = await createDevice(db, "C");    // no baselines: a first pull
  registerLive(C, "notes", lwwRecordMerge);
  await C.sync.pull();
  assert.deepEqual(Object.keys(readKey(C, "app-notes").items), ["a"]);
  edit(C, "notes", (d) => { d.items.n = item(4, 4); return d; });
  await C.sync.push();
  assert.equal(plain(await cloudPayload(db, A)).meta.restoreEpoch, 1, "C carries the epoch it adopted");
});

test("a restore survives a reboot of the other device (the epoch is stored)", async () => {
  const db = new FakeDropbox();
  const { A, B, name } = await twoDevices(db);
  A.sync.setRescueSink(sink([]));
  await tick();
  await A.sync.restoreBackup(name);
  await B.sync.pull();
  const B2 = await reboot(db, B);
  await B2.sync.pull();
  assert.deepEqual(Object.keys(readKey(B2, "app-notes").items), ["a"]);
  assert.equal(db.uploads("B").length, 0, "B never uploads the old state");
});

test("the shell and Settings offer the restore", () => {
  const fs = require("fs"), path = require("path");
  const shell = fs.readFileSync(path.join(__dirname, "..", "shell.js"), "utf8");
  const settings = fs.readFileSync(path.join(__dirname, "..", "settings", "settings.js"), "utf8");
  assert.match(shell, /setRescueSink\(/, "the shell stores rescue copies");
  assert.match(shell, /restoreBackup\(/);
  assert.match(shell, /listBackups\(/);
  assert.match(settings, /sync\.restore/);
  assert.match(settings, /sync\.backups\.load/);
});
