// WebDAV W4 — moving a device's orOS cloud between Dropbox and WebDAV.
// The sync file and every Vault object (Drive files that stay in the
// cloud included) are copied byte for byte; nothing is decrypted.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
// The real binary Dropbox of the vault harness, whatever OROS_CLOUD says.
const saved = process.env.OROS_CLOUD;
delete process.env.OROS_CLOUD;
const { vaultDevice, BinDropbox } = require("./vault-harness");
if (saved !== undefined) process.env.OROS_CLOUD = saved;
const { FakeWebDAV } = require("./harness");

const DAV_URL = "https://dav.test/remote.php/dav/files/u";
const FORM = { url: DAV_URL, user: "u", pass: "app-pass", dir: "orOS" };
const PC = "/internal/Drive/PC/Documents";
const DROPBOX_TOKENS = {
  "oros-db-access": "token-B", "oros-db-refresh": "refresh-B",
  "oros-db-expiry": String(Date.now() + 864e5)
};

// One fetch that reaches both clouds, as a browser does.
function both(db, dav, name) {
  const d = db.fetchFor(name), w = dav.fetchFor(name);
  return (url, o) => (/^https:\/\/dav\.test\//.test(String(url)) ? w(url, o) : d(url, o));
}

async function pushBlob(dev) {
  dev.ctx.orosSync.markDirty();
  await dev.ctx.orosSync.push();
}

// A (a computer running orOS Drive) fills a cloud; B (a phone) syncs
// it, so the Drive files are in B's cloud only.
async function filled(cloud) {
  const A = await vaultDevice(cloud, "A");
  await A.write(PC + "/report.txt", "quarterly report");
  await A.write("/internal/Notes/todo.md", "buy milk");
  assert.equal((await A.sync()).stats.uploaded, 2);
  await pushBlob(A);
  const B = await vaultDevice(cloud, "B");
  await B.sync();
  assert.equal(B.disk.has(PC + "/report.txt"), false);
  return { A, B };
}

function davVault(dav) {
  return [...dav.files.keys()].filter((k) => k.startsWith("/vault/")).map((k) => k.slice(7)).sort();
}
function dbVault(db) {
  return [...db.files.keys()].filter((k) => k.startsWith("/vault/")).map((k) => k.slice(7)).sort();
}

test("Dropbox → WebDAV copies the sync file and every Vault object, Drive files included", async () => {
  const db = new BinDropbox();
  const { B: B0 } = await filled(db);
  const dav = new FakeWebDAV();
  const B = await vaultDevice(db, "B", { seed: Object.fromEntries(B0.localStorage.map), fetch: both(db, dav, "B") });
  for (const [p, b] of B0.disk) B.disk.set(p, b);
  const seen = [];
  B.ctx.orosSync.onMove((p) => seen.push(p));

  const acc = await B.ctx.orosSync.moveToWebdav(FORM);
  assert.equal(acc.email, "u@dav.test");
  assert.equal(B.ctx.orosSync.getProvider(), "webdav");
  assert.equal(B.localStorage.getItem("oros-db-refresh"), null, "this device left Dropbox");
  assert.equal(B.localStorage.getItem("oros-dav-pass"), "app-pass");
  assert.deepEqual(davVault(dav), dbVault(db));
  for (const k of dbVault(db)) {
    assert.ok(Buffer.compare(dav.files.get("/vault/" + k).data, db.files.get("/vault/" + k).data) === 0, k);
  }
  assert.equal(dav.files.get("/orOS-data.json").text, db.files.get("/orOS-data.json").data.toString("utf8"));
  assert.ok(db.files.has("/orOS-data.json"), "the old cloud is left as it was");
  assert.deepEqual({ ...seen[seen.length - 1] }, { done: dbVault(db).length + 1, total: dbVault(db).length + 1 });

  // The Vault on the new cloud: nothing to re-upload, Drive files still on demand.
  const r = await B.sync();
  assert.equal(r.stats.failed, 0);
  assert.equal(B.vault.isRemoteOnly(PC + "/report.txt"), true);
  await B.vault.fetch(PC + "/report.txt");
  assert.equal(await B.read(PC + "/report.txt"), "quarterly report");

  // Another device connected to the server sees everything, same passphrase.
  const C = await vaultDevice(dav, "C");
  assert.equal((await C.sync()).stats.failed, 0);
  assert.equal(await C.read("/internal/Notes/todo.md"), "buy milk");
  assert.equal(C.vault.isRemoteOnly(PC + "/report.txt"), true);
  assert.deepEqual((await C.ctx.orosSync.pull()).ok, true);
});

test("a server that already holds orOS data is refused and the device stays on Dropbox", async () => {
  const db = new BinDropbox();
  const { B: B0 } = await filled(db);
  const dav = new FakeWebDAV();
  dav.put("/orOS-data.json", "someone else's cloud");
  const B = await vaultDevice(db, "B", { seed: Object.fromEntries(B0.localStorage.map), fetch: both(db, dav, "B") });
  await assert.rejects(B.ctx.orosSync.moveToWebdav(FORM), /move-target-used/);
  assert.equal(B.ctx.orosSync.getProvider(), "dropbox");
  assert.equal(B.ctx.orosSync.isConnected(), true);
  assert.equal(B.localStorage.getItem("oros-dav-pass"), null);
  assert.equal(B.ctx.orosSync.errorKey(new Error("move-target-used")), "sync.err.move-target-used");
  // The engine works again afterwards.
  await pushBlob(B);
});

test("moving needs Dropbox connected, and an empty cloud has nothing to move", async () => {
  const dav = new FakeWebDAV();
  const D = await vaultDevice(dav, "D");
  await assert.rejects(D.ctx.orosSync.moveToWebdav(FORM), /move-not-connected/);
  const db = new BinDropbox();
  const E = await vaultDevice(db, "E", { fetch: both(db, new FakeWebDAV(), "E") });
  await assert.rejects(E.ctx.orosSync.moveToWebdav(FORM), /move-empty/);
  assert.equal(E.ctx.orosSync.getProvider(), "dropbox");
});

test("WebDAV → Dropbox: after the Dropbox sign-in the copy runs before the engine starts", async () => {
  const dav = new FakeWebDAV();
  const { B: B0 } = await filled(dav);
  const db = new BinDropbox();
  await assert.rejects(B0.ctx.orosSync.moveToWebdav(FORM), /move-not-connected/);
  // moveToDropbox() leaves the marker, then the page goes to Dropbox.
  B0.ctx.orosSync.moveToDropbox().catch(() => {});
  assert.equal(B0.localStorage.getItem("oros-sync-move"), "dropbox");

  // Back from the sign-in: Dropbox tokens next to the WebDAV ones.
  const seed = Object.assign(Object.fromEntries(B0.localStorage.map), DROPBOX_TOKENS);
  const B = await vaultDevice(dav, "B", { seed, fetch: both(db, dav, "B") });
  for (const [p, b] of B0.disk) B.disk.set(p, b);
  assert.equal((await B.ctx.orosSync.moveDone).moved, "dropbox");
  assert.equal(B.ctx.orosSync.getProvider(), "dropbox");
  assert.equal(B.localStorage.getItem("oros-dav-pass"), null, "this device left the server");
  assert.equal(B.localStorage.getItem("oros-sync-move"), null);
  assert.deepEqual(dbVault(db), davVault(dav));
  assert.equal(db.files.get("/orOS-data.json").data.toString("utf8"), dav.files.get("/orOS-data.json").text);
  assert.ok(dav.log.some((e) => e.op === "revoke"), "the Nextcloud app password is deleted");

  const r = await B.sync();
  assert.equal(r.stats.failed, 0);
  assert.equal(B.vault.isRemoteOnly(PC + "/report.txt"), true);
  await B.vault.fetch(PC + "/report.txt");
  assert.equal(await B.read(PC + "/report.txt"), "quarterly report");
});

test("WebDAV → Dropbox into a used Dropbox: the device stays on WebDAV and forgets the sign-in", async () => {
  const dav = new FakeWebDAV();
  const { B: B0 } = await filled(dav);
  const db = new BinDropbox();
  const other = await vaultDevice(db, "X");
  await pushBlob(other);
  const seed = Object.assign(Object.fromEntries(B0.localStorage.map), DROPBOX_TOKENS, { "oros-sync-move": "dropbox" });
  const B = await vaultDevice(dav, "B", { seed, fetch: both(db, dav, "B") });
  const done = await B.ctx.orosSync.moveDone;
  assert.match(String(done.error && done.error.message), /move-target-used/);
  assert.equal(B.ctx.orosSync.getProvider(), "webdav");
  assert.equal(B.ctx.orosSync.isConnected(), true);
  assert.equal(B.localStorage.getItem("oros-db-refresh"), null);
  assert.equal(B.localStorage.getItem("oros-dav-pass"), "app-pass");
  assert.equal((await B.sync()).stats.failed, 0);
});

test("a cancelled Dropbox sign-in leaves the WebDAV device as it was", async () => {
  const dav = new FakeWebDAV();
  const { B: B0 } = await filled(dav);
  const seed = Object.assign(Object.fromEntries(B0.localStorage.map), { "oros-sync-move": "dropbox" });
  const B = await vaultDevice(dav, "B", { seed });
  assert.equal(await B.ctx.orosSync.moveDone, null);
  assert.equal(B.ctx.orosSync.getProvider(), "webdav");
  assert.equal(B.localStorage.getItem("oros-sync-move"), null);
});

test("while the copy runs, the engine and the Vault wait", async () => {
  const db = new BinDropbox();
  const { B: B0 } = await filled(db);
  const dav = new FakeWebDAV();
  const B = await vaultDevice(db, "B", { seed: Object.fromEntries(B0.localStorage.map), fetch: both(db, dav, "B") });
  const moving = B.ctx.orosSync.moveToWebdav(FORM);
  await assert.rejects(B.ctx.orosSync.storage.getRevision("manifest.json"), /in flight/);
  await assert.rejects(B.ctx.orosSync.push(), /in flight/);
  await assert.rejects(B.ctx.orosSync.moveToWebdav(FORM), /in flight/);
  await moving;
  assert.equal(await B.ctx.orosSync.storage.getRevision("nothing-here"), null);
});
