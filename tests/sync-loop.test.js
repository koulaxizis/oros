// SY-L1: a slice whose store shape differs from its merge output must
// not re-upload identical content at every pull (endless uploads).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeDropbox, createDevice, readKey, writeKey, cloudPayload } = require("./harness");

// Like Podcasts 0.47-0.48: the merge adds an empty "sh" object, the
// store normalizes it away again.
function registerNormalizing(dev, name) {
  const key = "app-" + name;
  const strip = (d) => {
    if (!d) return d;
    const o = JSON.parse(JSON.stringify(d));
    if (o.q && o.q.sh && !Object.keys(o.q.sh).length) delete o.q.sh;
    return o;
  };
  dev.sync.registerSlice(
    name,
    () => readKey(dev, key),
    (data) => dev.localStorage.setItem(key, JSON.stringify(strip(data))),
    key,
    (a, b) => {
      const items = Object.assign({}, (a && a.items) || {}, (b && b.items) || {});
      return { items, q: { ids: [], sh: {} } };
    }
  );
}

async function pair() {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A", {});
  const B = await createDevice(db, "B", {});
  registerNormalizing(A, "pod");
  registerNormalizing(B, "pod");
  writeKey(A, "app-pod", { items: { a: 1 }, q: { ids: [] } });
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();
  if (B.sync.isDirty()) await B.sync.push();
  await A.sync.pull();
  if (A.sync.isDirty()) await A.sync.push();
  return { db, A, B };
}

test("stored shape equal to the cloud: a pull leaves the device clean", async () => {
  const { db, A, B } = await pair();
  const before = db.uploads("A").length + db.uploads("B").length;
  for (let i = 0; i < 3; i++) {
    await A.sync.pull();
    assert.equal(A.sync.isDirty(), false, "A not dirty after pull " + i);
    await B.sync.pull();
    assert.equal(B.sync.isDirty(), false, "B not dirty after pull " + i);
  }
  assert.equal(db.uploads("A").length + db.uploads("B").length, before, "no uploads while idle");
  assert.deepEqual(readKey(B, "app-pod"), { items: { a: 1 }, q: { ids: [] } });
});

test("a real difference still goes up after the pull", async () => {
  const { db, A, B } = await pair();
  writeKey(B, "app-pod", { items: { a: 1, b: 2 }, q: { ids: [] } });
  B.sync.markDirty();
  await B.sync.push();
  writeKey(A, "app-pod", { items: { a: 1, c: 3 }, q: { ids: [] } });
  await A.sync.pull();
  assert.equal(A.sync.isDirty(), true, "merged state differs from the cloud");
  await A.sync.push();
  assert.deepEqual(Object.keys((await cloudPayload(db, A)).apps.pod.items).sort(), ["a", "b", "c"]);
});
