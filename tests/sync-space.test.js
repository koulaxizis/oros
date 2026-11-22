// SPACE-1 — Settings › Sync › Space in the cloud: orosSync.cloudSpace()
// asks Dropbox (users/get_space_usage) or the WebDAV server (RFC 4331
// quota properties on the orOS folder) how much room the account has.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeWebDAV, RealFakeDropbox, createDevice } = require("./harness");

const GB = 1024 * 1024 * 1024;
const plain = (o) => JSON.parse(JSON.stringify(o));   // the device runs in its own realm

test("Dropbox: used, total and free of the whole account", async () => {
  const db = new RealFakeDropbox();
  db.space = { used: 1.5 * GB, allocation: { ".tag": "individual", allocated: 2 * GB } };
  const A = await createDevice(db, "A");
  assert.deepEqual(plain(await A.sync.cloudSpace()), { used: 1.5 * GB, total: 2 * GB, free: 0.5 * GB });
});

test("Dropbox team: the team's shared space counts", async () => {
  const db = new RealFakeDropbox();
  db.space = { used: 1 * GB, allocation: { ".tag": "team", used: 900 * GB, allocated: 1000 * GB } };
  const A = await createDevice(db, "A");
  assert.deepEqual(plain(await A.sync.cloudSpace()), { used: 900 * GB, total: 1000 * GB, free: 100 * GB });
});

test("Dropbox: no allocation or a refused call reads as not reported", async () => {
  const db = new RealFakeDropbox();
  db.space = { used: 5, allocation: { ".tag": "individual", allocated: 0 } };
  const A = await createDevice(db, "A");
  assert.equal(await A.sync.cloudSpace(), null);
  db.space = null;
  assert.equal(await A.sync.cloudSpace(), null);
});

test("WebDAV: quota-used-bytes + quota-available-bytes", async () => {
  const dav = new FakeWebDAV();
  dav.quota = { used: 3 * GB, avail: 7 * GB };
  const A = await createDevice(dav, "A");
  assert.equal(A.sync.getProvider(), "webdav");
  assert.deepEqual(plain(await A.sync.cloudSpace()), { used: 3 * GB, total: 10 * GB, free: 7 * GB });
});

test("WebDAV: Nextcloud's negative 'no limit' leaves total and free unknown", async () => {
  const dav = new FakeWebDAV();
  dav.quota = { used: 123456, avail: -3 };
  const A = await createDevice(dav, "A");
  assert.deepEqual(plain(await A.sync.cloudSpace()), { used: 123456, total: null, free: null });
});

test("WebDAV: a server without quota properties reads as not reported", async () => {
  const dav = new FakeWebDAV();
  dav.quota = {};
  const A = await createDevice(dav, "A");
  assert.equal(await A.sync.cloudSpace(), null);
});

test("WebDAV: an unreachable server rejects with a network error", async () => {
  const dav = new FakeWebDAV();
  const A = await createDevice(dav, "A");
  dav.noCors = true;
  await assert.rejects(A.sync.cloudSpace(), /network error/);
});

test("not connected: null, nothing asked", async () => {
  const db = new RealFakeDropbox();
  const A = await createDevice(db, "A", null, { connect: false });
  const before = db.log.length;
  assert.equal(await A.sync.cloudSpace(), null);
  assert.equal(db.log.length, before);
});
