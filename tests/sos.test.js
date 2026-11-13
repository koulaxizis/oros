// SOS-1 — SOS and reset signals (Bible SOS-1, sync.js judgeCloud).
// An SOS or a factory reset leaves a signal where the blob was. A
// device that synced before it and holds the passphrase obeys it (SOS:
// erase, reset: ask), never fills the cloud again on its own; a new
// device takes the signal as an empty cloud; a signal sealed with
// another passphrase erases nothing; an SOS travels on in the blobs
// of a cloud that was started again.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RealFakeDropbox: FakeDropbox, createDevice, writeKey, readKey, cloudPayload } = require("./harness");   // Dropbox: Transfer lives only there

const SLICES = { "oros-slices": { notes: "app-notes" } };
const PASS = "test-passphrase";   // = harness PASSPHRASE

function blob(db) {
  const f = db.files.get("/orOS-data.json");
  return f ? JSON.parse(f.text) : null;
}
async function withData(db, name, items) {
  const d = await createDevice(db, name, SLICES);
  writeKey(d, "app-notes", { items });
  d.sync.markDirty();
  return d;
}
async function rejectsWith(p, msg) {
  await assert.rejects(p, (e) => e && e.message === msg);
}

test("harness passphrase is the one the tests type", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A", SLICES);
  await rejectsWith(A.sync.sosEverywhere("not it"), "wrong-passphrase");
  assert.equal(A.sync.isConnected(), true, "a wrong passphrase changes nothing");
  const r = await A.sync.sosEverywhere(PASS);
  assert.equal(r.signalled, true);
});

test("SOS: the blob becomes an SOS signal, every other orOS file goes, the sign-in is revoked", async () => {
  const db = new FakeDropbox();
  const A = await withData(db, "A", { a: 1 });
  await A.sync.push();
  db.put("/orOS-backup-2026-01-01.json", "x");
  db.put("/vault/manifest.json", "m");
  db.put("/transfer/abc/p0", "sealed");
  db.put("/someone-else.txt", "keep");

  const r = await A.sync.sosEverywhere(PASS);
  assert.equal(r.signalled, true);
  assert.equal(r.revoked, true);
  assert.deepEqual([...db.files.keys()].sort(), ["/orOS-data.json", "/someone-else.txt"]);
  const b = blob(db);
  assert.equal(b.ver, "oros-signal");
  assert.equal(b.sig.kind, "sos");
  assert.ok(!("apps" in b) && !/"a":1/.test(JSON.stringify(b)), "no data in clear");
  assert.equal(A.sync.isConnected(), false);
});

test("SOS: a device that synced before erases itself and sends nothing", async () => {
  const db = new FakeDropbox();
  const A = await withData(db, "A", { a: 1 });
  await A.sync.push();
  const B = await createDevice(db, "B", SLICES);
  await B.sync.pull();
  assert.deepEqual(readKey(B, "app-notes"), { items: { a: 1 } });

  await A.sync.sosEverywhere(PASS);
  const before = db.files.get("/orOS-data.json").rev;

  const seen = [];
  B.sync.onSignal((s) => seen.push(s.kind));
  writeKey(B, "app-notes", { items: { a: 1, b: 2 } });
  B.sync.markDirty();
  await rejectsWith(B.sync.pull(), "cloud-sos");
  assert.deepEqual(seen, ["sos"], "the shell is told to erase this device");
  await rejectsWith(B.sync.push(), "engine-suspended");
  assert.equal(db.files.get("/orOS-data.json").rev, before, "the signal is still there");
  assert.equal(B.sync.cloudSignal().kind, "sos");
});

test("SOS: an older push that missed the signal is refused, the signal stays", async () => {
  const db = new FakeDropbox();
  const A = await withData(db, "A", { a: 1 });
  await A.sync.push();
  const B = await createDevice(db, "B", SLICES);
  await B.sync.pull();
  await A.sync.sosEverywhere(PASS);

  writeKey(B, "app-notes", { items: { a: 9 } });
  B.sync.markDirty();
  await assert.rejects(B.sync.push());                    // conflict → learns the cloud → SOS
  assert.equal(blob(db).ver, "oros-signal");
});

test("SOS: a signal sealed with another passphrase erases nothing and is not overwritten", async () => {
  const db = new FakeDropbox();
  const A = await withData(db, "A", { a: 1 });
  await A.sync.push();
  const B = await createDevice(db, "B", SLICES);
  await B.sync.pull();

  const X = await createDevice(db, "X", SLICES);          // someone with the Dropbox but not the passphrase
  X.sync.setPassphrase("another-passphrase-9", false);
  await X.sync.sosEverywhere("another-passphrase-9");

  const seen = [];
  B.sync.onSignal((s) => seen.push(s.kind));
  await rejectsWith(B.sync.pull(), "cloud-closed");
  assert.deepEqual(seen, [], "no erase");
  assert.deepEqual(readKey(B, "app-notes"), { items: { a: 1 } });
  B.sync.markDirty();
  await assert.rejects(B.sync.push());
  assert.equal(blob(db).ver, "oros-signal");
  assert.equal(B.sync.cloudSignal().verified, false);
});

test("SOS: a new device starts the cloud again and carries the SOS on", async () => {
  const db = new FakeDropbox();
  const A = await withData(db, "A", { a: 1 });
  await A.sync.push();
  const D = await createDevice(db, "D", SLICES);           // synced before, then away
  await D.sync.pull();
  await A.sync.sosEverywhere(PASS);

  const C = await withData(db, "C", { c: 1 });             // new device, same passphrase
  const r = await C.sync.pull();
  assert.equal(r.empty, true, "the signal counts as an empty cloud");
  await C.sync.push();
  const b = blob(db);
  assert.equal(b.ver, 1, "a normal blob again");
  assert.equal(b.sig.kind, "sos", "the SOS travels on");
  assert.deepEqual((await cloudPayload(db, C)).apps.notes, { items: { c: 1 } });

  const seen = [];
  D.sync.onSignal((s) => seen.push(s.kind));
  await rejectsWith(D.sync.pull(), "cloud-sos");
  assert.deepEqual(seen, ["sos"], "the device that missed the SOS erases itself");
  assert.deepEqual((await cloudPayload(db, C)).apps.notes, { items: { c: 1 } }, "nothing came back");

  const E = await createDevice(db, "E", SLICES);           // joins the new cloud later
  await E.sync.pull();
  assert.deepEqual(readKey(E, "app-notes"), { items: { c: 1 } });
  writeKey(E, "app-notes", { items: { c: 1, e: 1 } });
  E.sync.markDirty();
  await E.sync.push();
  await C.sync.pull();
  assert.deepEqual(readKey(C, "app-notes"), { items: { c: 1, e: 1 } }, "the new cloud syncs normally");
});

test("SOS: no backup copy is made of a signal", async () => {
  const db = new FakeDropbox();
  const A = await withData(db, "A", { a: 1 });
  await A.sync.push();
  await A.sync.sosEverywhere(PASS);
  const C = await withData(db, "C", { c: 1 });
  await C.sync.pull();
  await C.sync.push();
  assert.deepEqual([...db.files.keys()].filter((p) => p.startsWith("/orOS-backup-")), []);
});

test("SOS: a paired browser's shared sign-in is not revoked, so the paired one still sees the signal", async () => {
  const db = new FakeDropbox();
  const A = await withData(db, "A", { a: 1 });
  A.localStorage.setItem("oros-sync-paired", "1");
  await A.sync.push();
  const r = await A.sync.sosEverywhere(PASS);
  assert.equal(r.revoked, false);
  assert.equal(db.log.filter((e) => e.op === "revoke").length, 0);
});

test("reset: another device asks instead of filling the cloud again; keeping its data replaces the signal", async () => {
  const db = new FakeDropbox();
  const A = await withData(db, "A", { a: 1 });
  await A.sync.push();
  const B = await createDevice(db, "B", SLICES);
  await B.sync.pull();
  await A.sync.wipeEverything();
  assert.equal(blob(db).sig.kind, "reset");

  const seen = [];
  B.sync.onSignal((s) => seen.push(s.kind));
  writeKey(B, "app-notes", { items: { a: 1, b: 2 } });
  B.sync.markDirty();
  await rejectsWith(B.sync.pull(), "cloud-reset");
  assert.deepEqual(seen, ["reset"]);
  await assert.rejects(B.sync.push());
  assert.equal(blob(db).ver, "oros-signal", "nothing was sent on its own");

  assert.equal(await B.sync.adoptSignal(), true);
  await B.sync.push();
  const b = blob(db);
  assert.equal(b.ver, 1);
  assert.equal(b.sig, undefined, "a reset does not travel on");
  assert.deepEqual((await cloudPayload(db, B)).apps.notes, { items: { a: 1, b: 2 } });
});

test("reset: a new device takes the reset signal as an empty cloud", async () => {
  const db = new FakeDropbox();
  const A = await withData(db, "A", { a: 1 });
  await A.sync.push();
  await A.sync.wipeEverything();
  const C = await withData(db, "C", { c: 1 });
  await C.sync.pull();
  await C.sync.push();
  assert.deepEqual((await cloudPayload(db, C)).apps.notes, { items: { c: 1 } });
});

test("reset without the passphrase deletes the blob as before", async () => {
  const db = new FakeDropbox();
  const A = await withData(db, "A", { a: 1 });
  await A.sync.push();
  A.sync.setPassphrase(null, false);
  const r = await A.sync.wipeEverything();
  assert.equal(r.signalled, false);
  assert.equal(db.files.has("/orOS-data.json"), false);
});

test("a passphrase change refuses a signal (no data to re-lock)", async () => {
  const db = new FakeDropbox();
  const A = await withData(db, "A", { a: 1 });
  await A.sync.push();
  const B = await createDevice(db, "B", SLICES);
  await B.sync.pull();
  await A.sync.wipeEverything();
  await rejectsWith(B.sync.changePassphrase(PASS, "a-brand-new-pass-1", false), "cloud-closed");
  assert.equal(blob(db).ver, "oros-signal");
});
