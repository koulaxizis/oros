// Merge / conflict behaviour of the sync engine (sync.js).
// Run: node --test tests/
//
// Every test drives two or three simulated devices against one
// in-memory Dropbox (see harness.js). "Live" = the app is open and
// registered a merge function; "closed" = the slice is a proxy over
// the app's localStorage key, hydrated from the persisted registry.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FakeDropbox, createDevice, reboot, registerLive, readKey, writeKey, edit,
  lwwRecordMerge, cloudPayload
} = require("./harness");

const item = (v, t, del) => (del ? { v, t, del: true } : { v, t });

// Two devices that have both synced `base` for slice `name`, either
// live with lwwRecordMerge or as closed proxies (optionally flagged
// as merge-capable, i.e. the app registered a merge function once).
async function syncedPair(name, base, opts) {
  opts = opts || {};
  const db = new FakeDropbox();
  const key = "app-" + name;
  const seed = opts.closed ? { "oros-slices": { [name]: key } } : {};
  if (opts.closed && opts.mergeCapable) seed["oros-slices-merge"] = { [name]: 1 };

  const A = await createDevice(db, "A", seed);
  const B = await createDevice(db, "B", seed);
  if (!opts.closed) {
    registerLive(A, name, lwwRecordMerge);
    registerLive(B, name, lwwRecordMerge);
  }
  writeKey(A, key, base);
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();
  assert.deepEqual(readKey(B, key), base, "setup: B starts from A's synced state");
  return { db, A, B, key };
}

// ---------------------------------------------------------------
// Concurrent edits
// ---------------------------------------------------------------

test("concurrent edits, live merge: stale push is refused, merged and retried", async () => {
  const { db, A, B, key } = await syncedPair("todo", { items: { a1: item("A1", 1) } });

  edit(A, "todo", (s) => { s.items.a2 = item("A2", 2); return s; });
  await A.sync.push();

  // B still holds the revision it pulled before A's second push.
  edit(B, "todo", (s) => { s.items.b1 = item("B1", 2); return s; });
  const before = db.uploads("B").length;
  await B.sync.push();

  const bUploads = db.uploads("B").slice(before).map((u) => u.status);
  assert.deepEqual(bUploads, [409, 200], "first upload refused (stale rev), retry lands");

  const want = { items: { a1: item("A1", 1), a2: item("A2", 2), b1: item("B1", 2) } };
  assert.deepEqual((await cloudPayload(db, B)).apps.todo, want);
  assert.deepEqual(readKey(B, key), want);
  assert.equal(B.sync.isDirty(), false);

  await A.sync.pull();
  assert.deepEqual(readKey(A, key), want, "A converges on the merged state");
  assert.equal(A.sync.isDirty(), false, "nothing left to push once converged");
});

test("concurrent edits, closed app without merge: local kept, other side parked, merged when app opens", async () => {
  const base = { items: { x: item("base", 1) } };
  const { db, A, B, key } = await syncedPair("notes", base, { closed: true });

  edit(A, "notes", (s) => { s.items.a = item("from A", 2); return s; });
  await A.sync.push();

  edit(B, "notes", (s) => { s.items.b = item("from B", 2); return s; });
  await B.sync.pull();

  const bLocal = { items: { x: item("base", 1), b: item("from B", 2) } };
  const aCloud = { items: { x: item("base", 1), a: item("from A", 2) } };
  assert.deepEqual(readKey(B, key), bLocal, "divergence guard: unpushed local not overwritten");
  assert.deepEqual(JSON.parse(B.localStorage.getItem("oros-remote-carry")).notes, aCloud,
    "A's version is parked on B, not dropped");
  assert.equal(B.sync.isDirty(), true);

  await B.sync.push();
  assert.deepEqual((await cloudPayload(db, B)).apps.notes, bLocal, "mergeless: B's local wins the cloud");

  // The app opens on B with a merge function: the parked copy is merged in.
  registerLive(B, "notes", lwwRecordMerge);
  const both = { items: { a: item("from A", 2), b: item("from B", 2), x: item("base", 1) } };
  assert.deepEqual(readKey(B, key), both);
  assert.equal(B.localStorage.getItem("oros-remote-carry"), null, "mailbox entry consumed");
  assert.equal(B.sync.isDirty(), true);

  await B.sync.push();
  await A.sync.pull();
  assert.deepEqual(readKey(A, key), both, "both devices end with both edits");
});

test("concurrent edits, closed merge-capable app: conflict deferred, cloud untouched until the app merges", async () => {
  const base = { items: { x: item("base", 1) } };
  const { db, A, B, key } = await syncedPair("kanban", base, { closed: true, mergeCapable: true });

  edit(A, "kanban", (s) => { s.items.a = item("from A", 2); return s; });
  await A.sync.push();
  const aCloud = (await cloudPayload(db, A)).apps.kanban;

  edit(B, "kanban", (s) => { s.items.b = item("from B", 2); return s; });
  await B.sync.pull();
  assert.deepEqual(B.sync.getDeferred(), ["kanban"]);
  assert.deepEqual(readKey(B, key).items.b, item("from B", 2), "B's local edit kept");

  await B.sync.push();
  assert.deepEqual((await cloudPayload(db, B)).apps.kanban, aCloud,
    "deferred slice relays the cloud's copy instead of overwriting it");

  registerLive(B, "kanban", lwwRecordMerge);
  assert.deepEqual(B.sync.getDeferred(), []);
  await B.sync.push();

  await A.sync.pull();
  assert.deepEqual(Object.keys(readKey(A, key).items).sort(), ["a", "b", "x"]);
});

test("concurrent edits, merge function throws: nobody's data is replaced", async () => {
  const { db, A, B, key } = await syncedPair("todo", { items: { x: item("base", 1) } });
  B.sync.registerSlice("todo", () => readKey(B, key),
    (d) => writeKey(B, key, d), key, () => { throw new Error("boom"); });

  edit(A, "todo", (s) => { s.items.a = item("from A", 2); return s; });
  await A.sync.push();
  const aCloud = (await cloudPayload(db, A)).apps.todo;

  edit(B, "todo", (s) => { s.items.b = item("from B", 2); return s; });
  await B.sync.pull();
  assert.deepEqual(readKey(B, key).items.b, item("from B", 2), "local kept");
  assert.equal(readKey(B, key).items.a, undefined, "remote not applied either");
  assert.ok(B.consoleLog.some((l) => l.level === "error" && /merge failed/.test(l.msg)));

  await B.sync.push();
  assert.deepEqual((await cloudPayload(db, B)).apps.todo, aCloud, "cloud copy relayed untouched");
});

// ---------------------------------------------------------------
// Deletions
// ---------------------------------------------------------------

test("deletion vs concurrent edit: newer tombstone wins on both devices", async () => {
  const base = { items: { x: item("x", 1), y: item("y", 1) } };
  const { db, A, B, key } = await syncedPair("todo", base);

  edit(B, "todo", (s) => { s.items.x = item("x edited", 2); s.items.y = item("y edited", 2); return s; });
  edit(A, "todo", (s) => { s.items.x = item("x", 3, true); return s; });
  await A.sync.push();
  await B.sync.push();   // stale → merge → retry

  const want = { items: { x: item("x", 3, true), y: item("y edited", 2) } };
  assert.deepEqual((await cloudPayload(db, B)).apps.todo, want);
  await A.sync.pull();
  assert.deepEqual(readKey(A, key), want);
  assert.deepEqual(readKey(B, key), want);
});

test("deletion on a clean closed app propagates and is not resurrected", async () => {
  const base = { items: { x: item("x", 1) } };
  const { db, A, B, key } = await syncedPair("notes", base, { closed: true });

  edit(A, "notes", () => ({ items: {} }));
  await A.sync.push();
  await B.sync.pull();
  assert.deepEqual(readKey(B, key), { items: {} }, "clean proxy adopts the deletion");
  assert.equal(B.sync.isDirty(), false, "and does not push the old item back");
  assert.equal(B.localStorage.getItem("oros-remote-carry"), null);
  assert.deepEqual((await cloudPayload(db, A)).apps.notes, { items: {} });
});

test("a device without the app never deletes its data from the cloud", async () => {
  const { db, A, key } = await syncedPair("todo", { items: { x: item("x", 1) } });
  const C = await createDevice(db, "C");          // never registered "todo"
  registerLive(C, "habits", lwwRecordMerge);

  await C.sync.pull();
  edit(C, "habits", () => ({ items: { h: item("h", 1) } }));
  await C.sync.push();

  const cloud = (await cloudPayload(db, C)).apps;
  assert.deepEqual(cloud.todo, { items: { x: item("x", 1) } }, "unknown slice carried forward");
  assert.deepEqual(cloud.habits, { items: { h: item("h", 1) } });
  await A.sync.pull();
  assert.deepEqual(readKey(A, key), { items: { x: item("x", 1) } });
});

// ---------------------------------------------------------------
// Stale pulls / stale cloud state
// ---------------------------------------------------------------

test("stale cloud copy never reverts unpushed local work", async () => {
  const base = { items: { x: item("base", 1) } };
  for (const mergeCapable of [false, true]) {
    const { B, key } = await syncedPair("notes", base, { closed: true, mergeCapable });
    edit(B, "notes", (s) => { s.items.x = item("offline edit", 2); return s; });

    await B.sync.pull();   // cloud still holds `base` — older than local
    assert.deepEqual(readKey(B, key).items.x, item("offline edit", 2), "mergeCapable=" + mergeCapable);
    assert.deepEqual(B.sync.getDeferred(), [], "only-local-changed is not a conflict");
    assert.equal(B.sync.isDirty(), true, "local must still reach the cloud");
  }
});

test("a closed app's stale proxy after reboot catches up from the cloud", async () => {
  const { db, A, B, key } = await syncedPair("todo", { items: { x: item("x", 1) } });
  const B2 = await reboot(db, B);   // app closed on B: proxy, no merge fn

  edit(A, "todo", (s) => { s.items.y = item("y", 2); return s; });
  await A.sync.push();
  await B2.sync.pull();
  assert.deepEqual(readKey(B2, key), { items: { x: item("x", 1), y: item("y", 2) } });
  assert.equal(B2.sync.isDirty(), false);
});

test("other devices keep pushing: retries give up, nothing uploaded, dirty kept", async () => {
  const { db, A, B, key } = await syncedPair("todo", { items: { x: item("x", 1) } });
  edit(A, "todo", (s) => { s.items.a = item("A", 2); return s; });
  await A.sync.push();
  const aBlob = db.files.get("/orOS-data.json").text;

  edit(B, "todo", (s) => { s.items.b = item("B", 2); return s; });
  db.beforeUpload = (device) => { if (device === "B") db.put("/orOS-data.json", aBlob); };
  await assert.rejects(B.sync.push(), /cloud-changed/);
  db.beforeUpload = null;

  assert.deepEqual(db.uploads("B").map((u) => u.status), [409, 409, 409, 409],
    "first try + 3 retries, all refused, none landed");
  assert.equal(B.sync.isDirty(), true);
  assert.deepEqual(readKey(B, key).items.b, item("B", 2));
  assert.equal(B.sync.errorKey(new Error("cloud-changed")), "sync.err.busy");

  await B.sync.push();   // the race is over: next attempt lands
  assert.deepEqual(Object.keys((await cloudPayload(db, B)).apps.todo.items).sort(), ["a", "b", "x"]);
});

test("an edit racing an upload stays dirty and goes up next push", async () => {
  const { db, B, key } = await syncedPair("todo", { items: { x: item("x", 1) } });
  edit(B, "todo", (s) => { s.items.b1 = item("b1", 2); return s; });

  let raced = false;
  db.beforeUpload = (device) => {
    if (device !== "B" || raced) return;
    raced = true;
    edit(B, "todo", (s) => { s.items.b2 = item("b2", 3); return s; });
  };
  await B.sync.push();
  db.beforeUpload = null;

  assert.deepEqual(Object.keys((await cloudPayload(db, B)).apps.todo.items).sort(), ["b1", "x"]);
  assert.equal(B.sync.isDirty(), true, "raced edit not marked synced");

  await B.sync.push();
  assert.deepEqual(Object.keys((await cloudPayload(db, B)).apps.todo.items).sort(), ["b1", "b2", "x"]);
  assert.equal(B.sync.isDirty(), false);
  assert.ok(readKey(B, key).items.b2);
});

test("a pull is refused while a push is in flight", async () => {
  const { B } = await syncedPair("todo", { items: { x: item("x", 1) } });
  edit(B, "todo", (s) => { s.items.y = item("y", 2); return s; });
  const pushing = B.sync.push();
  await assert.rejects(B.sync.pull(), /push already in flight/);
  await pushing;
});
