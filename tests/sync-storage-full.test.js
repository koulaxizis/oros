// The sync engine with a FULL localStorage (R30: every app shares one
// ~5 MB origin store). Nothing may throw into the caller, and no push
// may run on bookkeeping (mailbox, baselines) that could not be saved.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeDropbox, createDevice, readKey, writeKey, edit, cloudPayload } = require("./harness");

const item = (v, t) => ({ v, t });

test("markDirty never throws on a full store, and the change still counts as unsynced", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  A.localStorage.full = true;
  assert.doesNotThrow(() => A.sync.markDirty());
  assert.equal(A.sync.isDirty(), true, "dirty is kept in memory when it cannot be stored");
});

test("a mailbox copy that cannot be saved blocks the push: the other device's work stays in the cloud", async () => {
  const db = new FakeDropbox();
  const name = "notes", key = "app-" + name;
  const seed = { "oros-slices": { [name]: key } };          // closed app, no merge function
  const A = await createDevice(db, "A", seed);
  const B = await createDevice(db, "B", seed);

  writeKey(A, key, { items: { x: item("base", 1) } });
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();

  // A edits offline; B edits and pushes; then A's store fills up.
  edit(A, name, (s) => { s.items.a = item("from A", 2); return s; });
  edit(B, name, (s) => { s.items.b = item("from B", 2); return s; });
  await B.sync.push();
  const bCloud = (await cloudPayload(db, B)).apps[name];
  A.localStorage.full = true;

  await A.sync.pull();                                       // B's copy must be parked: it cannot be
  await assert.rejects(A.sync.push(), /storage-full/, "push refused while the mailbox cannot be saved");
  assert.equal(A.sync.errorKey(new Error("storage-full")), "sync.err.storage");
  assert.deepEqual((await cloudPayload(db, A)).apps[name], bCloud, "B's edit is still in the cloud");
  assert.deepEqual(readKey(A, key).items.a, item("from A", 2), "A's edit is still local");

  // Space comes back: the next push learns the cloud again, parks it, and goes up.
  A.localStorage.full = false;
  await A.sync.push();
  assert.deepEqual(JSON.parse(A.localStorage.getItem("oros-remote-carry"))[name], bCloud,
    "B's version parked on A once storage allows it");
});

test("a token refresh on a full store still yields a usable token", async () => {
  const db = new FakeDropbox();
  let refreshes = 0;
  const A = await createDevice(db, "A", { "oros-db-expiry": "1" }, {   // token expired: next call refreshes
    fetch: (real) => async (url, opts) => {
      if (String(url).indexOf("oauth2/token") !== -1) {
        refreshes++;
        return { ok: true, status: 200,
          json: async () => ({ access_token: "a-much-longer-fresh-access-token", expires_in: 14400 }) };
      }
      return real(url, opts);
    }
  });
  A.localStorage.full = true;
  A.sync.markDirty();
  await A.sync.push();                                       // refresh → saving it fails → kept in memory
  assert.equal(refreshes, 1);
  assert.ok(db.uploads("A").some((u) => u.status === 200), "upload went through");
});
