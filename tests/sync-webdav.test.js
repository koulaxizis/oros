// WebDAV W2 — the WebDAV sync provider.
// 1. Every two-device suite (blob engine, backups, reset, Vault Drive)
//    runs again against an in-memory WebDAV server (OROS_CLOUD=webdav):
//    the Dropbox lessons (A36 lost update, SY-D1/D4 conditional writes)
//    must hold for both providers.
// 2. connectWebdav(): the probe that refuses unsafe servers, the
//    switch between providers, and what a switch does to the Vault.
// Run: node --test tests/

"use strict";

process.env.OROS_CLOUD = "webdav";

const test = require("node:test");
const assert = require("node:assert/strict");

for (const suite of ["sync-merge", "sync-loop", "sync-kdf", "sync-storage-full",
                     "sync-provider", "vault-ondemand", "passwords-vault"]) {
  test.describe("webdav: " + suite, () => { require("./" + suite + ".test.js"); });
}

const { FakeWebDAV, RealFakeDropbox, createDevice, writeKey, cloudPayload } = require("./harness");

const URL0 = "https://dav.test/remote.php/dav/files/u";
const FORM = { url: URL0 + "/", user: "u", pass: "app-pass", dir: "orOS" };

// A device on this browser with nothing connected yet.
function blank(cloud, name, seed) {
  return createDevice(cloud, name, seed, { connect: false });
}

test("connectWebdav proves the server, saves it and syncs through it", async () => {
  const dav = new FakeWebDAV();
  const A = await blank(dav, "A", { "oros-slices": { notes: "app-notes" } });
  assert.equal(A.sync.isConnected(), false);
  const acc = await A.sync.connectWebdav(FORM);
  assert.equal(acc.email, "u@dav.test");
  assert.equal(A.sync.getProvider(), "webdav");
  assert.equal(A.sync.isConnected(), true);
  assert.ok(![...dav.files.keys()].some((k) => /oros-probe/.test(k)), "the probe file is gone");
  assert.equal(A.localStorage.getItem("oros-dav-pass"), "app-pass");

  writeKey(A, "app-notes", { items: { a: 1 } });
  A.sync.markDirty();
  await A.sync.push();
  assert.deepEqual((await cloudPayload(dav, A)).apps.notes, { items: { a: 1 } });
});

test("a server that ignores If-Match / If-None-Match is refused and nothing is saved", async () => {
  const dav = new FakeWebDAV();
  dav.ignoreConditions = true;
  const A = await blank(dav, "A");
  await assert.rejects(A.sync.connectWebdav(FORM), /dav-conditions/);
  assert.equal(A.sync.isConnected(), false);
  assert.equal(A.localStorage.getItem("oros-dav-pass"), null);
  assert.equal(A.sync.errorKey(new Error("dav-conditions")), "sync.err.dav-conditions");
});

test("weak, unreadable or unchanging ETags are refused", async () => {
  const weak = new FakeWebDAV();
  weak.weakEtags = true;
  await assert.rejects((await blank(weak, "A")).sync.connectWebdav(FORM), /dav-conditions/);
  const hidden = new FakeWebDAV();
  hidden.hideEtag = true;
  await assert.rejects((await blank(hidden, "A")).sync.connectWebdav(FORM), /dav-etag/);
  const stale = new FakeWebDAV();
  stale.staleEtags = true;
  await assert.rejects((await blank(stale, "A")).sync.connectWebdav(FORM), /dav-conditions/);
});

test("wrong password, unreachable server and bad addresses each get their reason", async () => {
  const dav = new FakeWebDAV();
  const A = await blank(dav, "A");
  await assert.rejects(A.sync.connectWebdav(Object.assign({}, FORM, { pass: "nope" })), /dav-auth/);
  await assert.rejects(A.sync.connectWebdav(Object.assign({}, FORM, { url: "https://elsewhere.test/dav" })), /dav-unreachable/);
  await assert.rejects(A.sync.connectWebdav(Object.assign({}, FORM, { url: "http://nas.example.com/dav" })), /dav-url/);
  await assert.rejects(A.sync.connectWebdav(Object.assign({}, FORM, { url: "https://u:p@dav.test/x" })), /dav-url/);
  await assert.rejects(A.sync.connectWebdav(Object.assign({}, FORM, { dir: "../up" })), /dav-url/);
  await assert.rejects(A.sync.connectWebdav(Object.assign({}, FORM, { pass: "" })), /dav-missing/);
  assert.equal(A.sync.isConnected(), false);
});

test("the sync folder and the Vault's folders are created on the way", async () => {
  const dav = new FakeWebDAV();
  dav.dirs.clear();
  const A = await blank(dav, "A");
  await A.sync.connectWebdav(FORM);
  assert.ok(dav.dirs.has(""), "the sync folder was made");
  const st = A.sync.storage;
  await st.putObject("objects/ab/cdef", new Uint8Array([1, 2, 3]), null);
  await assert.rejects(st.putObject("objects/ab/cdef", new Uint8Array([4]), null), /storage-conflict/);
  const rev = await st.getRevision("objects/ab/cdef");
  await st.putObject("objects/ab/cdef", new Uint8Array([5]), rev);
  await assert.rejects(st.putObject("objects/ab/cdef", new Uint8Array([6]), rev), /storage-conflict/);
  assert.deepEqual([...new Uint8Array(await st.getObject("objects/ab/cdef"))], [5]);
  assert.deepEqual([...await st.listPrefix("objects/")], ["objects/ab/cdef"]);
  assert.equal(await st.getObject("missing"), null);
  await st.deleteObject("objects/ab/cdef");
  assert.equal(await st.getRevision("objects/ab/cdef"), null);
});

test("moving a device from Dropbox to WebDAV starts the new cloud cleanly", async () => {
  const db = new RealFakeDropbox();
  const A = await createDevice(db, "A", { "oros-slices": { notes: "app-notes" } });
  writeKey(A, "app-notes", { items: { a: 1 } });
  A.sync.markDirty();
  await A.sync.push();
  ["oros-vault-manifest", "oros-vault-rev", "oros-vault-seeded"].forEach((k) => A.localStorage.setItem(k, "old"));

  const dav = new FakeWebDAV();
  const B = await createDevice(db, "A", Object.fromEntries(A.localStorage.map), {
    fetch: () => dav.fetchFor("A")
  });
  B.sync.disconnect();
  assert.equal(B.sync.getProvider(), "dropbox");
  B.sync.setPassphrase("test-passphrase", false);
  await B.sync.connectWebdav(FORM);
  B.sync.setPassphrase("test-passphrase", false);
  ["oros-vault-manifest", "oros-vault-rev", "oros-vault-seeded"].forEach((k) =>
    assert.equal(B.localStorage.getItem(k), null, k + " belonged to the old cloud"));
  assert.equal(B.sync.isDirty(), true, "everything goes up to the new cloud");
  await B.sync.reconcile("test");
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 20 && !dav.files.has("/orOS-data.json"); i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual((await cloudPayload(dav, B)).apps.notes, { items: { a: 1 } });
});

test("disconnect goes back to Dropbox as the default; reset on Nextcloud revokes the app password", async () => {
  const dav = new FakeWebDAV();
  const A = await blank(dav, "A");
  await A.sync.connectWebdav(FORM);
  A.sync.disconnect();
  assert.equal(A.sync.getProvider(), "dropbox");
  assert.equal(A.sync.isConnected(), false);
  assert.equal(A.localStorage.getItem("oros-dav-pass"), null);
  assert.equal(A.localStorage.getItem("oros-sync-provider"), null);

  await A.sync.connectWebdav(FORM);
  const r = await A.sync.wipeEverything();
  assert.equal(r.revoked, true);
  assert.equal(dav.log.filter((e) => e.op === "revoke").length, 1);
});
