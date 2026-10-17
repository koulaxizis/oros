// Quality gate Q4: no silent sync failure, and Disconnect cancels the
// access at the provider.
//   A37 / A69c — a pull that cannot write a slice (full store, setter
//     that throws) says which slices, through pull()'s result and
//     onApplyFailed; the slice keeps no baseline, so the next pull
//     tries again and lands once space is back.
//   SEC-2 / A71a — disconnectRevoke(): revoke at the provider first
//     (Dropbox auth/token/revoke, Nextcloud app password delete), then
//     forget locally; offline or refused still forgets locally.
// Listed in tests/sync-webdav.test.js, so it runs for both providers.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeDropbox, createDevice, readKey, writeKey } = require("./harness");

// A live slice whose setter fails while `box.full` is true, like an
// app writing to a full localStorage.
function registerFragile(dev, name, box) {
  const key = "app-" + name;
  dev.sync.registerSlice(name, () => readKey(dev, key), (data) => {
    if (box.full) throw new Error("QuotaExceededError");
    writeKey(dev, key, data);
  }, key);
}

test("a pull that cannot write a slice says so, and the next pull lands it", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B");
  writeKey(A, "app-notes", { items: { a: 1 } });
  A.sync.registerSlice("notes", () => readKey(A, "app-notes"), (d) => writeKey(A, "app-notes", d), "app-notes");
  A.sync.markDirty();
  await A.sync.push();

  const box = { full: true };
  const heard = [];
  B.sync.onApplyFailed((names) => heard.push(Array.from(names)));
  registerFragile(B, "notes", box);
  await new Promise((r) => setImmediate(r));   // the open-app pull, if any, settles
  heard.length = 0;

  const r1 = await B.sync.pull();
  assert.deepEqual(Array.from(r1.failed), ["notes"], "the pull result names the slice");
  assert.deepEqual(heard, [["notes"]], "listeners hear it once per pull");
  assert.equal(readKey(B, "app-notes"), null, "nothing written");

  box.full = false;
  const r2 = await B.sync.pull();
  assert.deepEqual(Array.from(r2.failed), [], "nothing failed this time");
  assert.deepEqual(JSON.parse(JSON.stringify(readKey(B, "app-notes"))), { items: { a: 1 } }, "no baseline was kept, so it is applied now");
  assert.equal(heard.length, 1, "no new failure reported");
});

test("a listener that throws never breaks the pull", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B");
  writeKey(A, "app-notes", { items: { a: 1 } });
  A.sync.registerSlice("notes", () => readKey(A, "app-notes"), (d) => writeKey(A, "app-notes", d), "app-notes");
  A.sync.markDirty();
  await A.sync.push();
  B.sync.onApplyFailed(() => { throw new Error("listener bug"); });
  registerFragile(B, "notes", { full: true });
  const r = await B.sync.pull();
  assert.deepEqual(Array.from(r.failed), ["notes"]);
});

test("disconnectRevoke cancels the access at the provider, then forgets it here", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const before = A.sync.getProvider();
  const r = await A.sync.disconnectRevoke(1000);
  assert.equal(r.revoked, true);
  assert.equal(r.offline, false);
  assert.equal(r.provider, before);
  assert.equal(A.sync.isConnected(), false);
  assert.equal(db.log.filter((e) => e.op === "revoke" && e.device === "A").length, 1, "one revoke call");
  assert.equal(A.sync.hasPassphrase(), false);
});

test("offline: disconnectRevoke forgets locally and says it could not revoke", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  A.ctx.navigator.onLine = false;
  const r = await A.sync.disconnectRevoke(1000);
  assert.deepEqual([r.revoked, r.offline], [false, true]);
  assert.equal(A.sync.isConnected(), false);
  assert.equal(db.log.filter((e) => e.op === "revoke").length, 0, "no call while offline");
});

test("a refused or failing revoke still disconnects", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A", {}, {
    fetch: (real) => async (url, opts) => {
      if (/token\/revoke|apppassword/.test(String(url))) throw new TypeError("Failed to fetch");
      return real(url, opts);
    }
  });
  const r = await A.sync.disconnectRevoke(1000);
  assert.deepEqual([r.revoked, r.offline], [false, false]);
  assert.equal(A.sync.isConnected(), false);
});

test("not connected: disconnectRevoke resolves without any call", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A", {}, { connect: false });
  const r = await A.sync.disconnectRevoke(1000);
  assert.equal(r.revoked, false);
  assert.equal(db.log.filter((e) => e.op === "revoke").length, 0);
});

test("the shell never clears the connection before it has asked for the revoke", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "shell.js"), "utf8");
  const fn = src.slice(src.indexOf("function syncDisconnectUser()"), src.indexOf("function syncDisconnectKey("));
  assert.match(fn, /disconnectRevoke\(/, "Disconnect goes through disconnectRevoke");
  assert.ok(src.indexOf("syncAutoFailNotice(err)") !== -1, "automatic failures reach the bell (A72)");
  assert.ok(src.indexOf("onApplyFailed(syncApplyFailNotice)") !== -1, "apply failures reach the bell (A37)");
});
