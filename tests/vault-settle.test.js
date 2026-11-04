// VD-SETTLE — a big file goes to the cloud once it stops changing.
// Every upload of new content is one more object in the cloud (VD-GC
// removes old ones only on request), so a big file saved every few
// seconds must not go up every few seconds. Each test is one promise:
// nothing local is lost, small files and deletions never wait,
// leaving the page sends everything, a file that never stops
// changing still goes up.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BinDropbox, vaultDevice, cloudPaths } = require("./vault-harness");

const OBJ = /^objects\/[0-9a-f]{64}$/;
const objects = (db) => db.vaultKeys().filter((k) => OBJ.test(k));
const BIG = (tag) => tag + ":" + "x".repeat(300 * 1024);

// Move this device's clock (vault.js reads Date at call time).
function shiftClock(dev, ms) {
  const Real = Date;
  class Shifted extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + ms); }
    static now() { return Real.now() + ms; }
  }
  dev.ctx.Date = Shifted;
}

test("a big file just written waits; small files and the manifest go up", async () => {
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  await A.write("/internal/small.txt", "small");
  await A.write("/internal/doc.json", BIG("v1"));
  const r = await A.sync();
  assert.equal(r.stats.waiting, 1);
  assert.deepEqual(await cloudPaths(A), ["/internal/small.txt"]);
  assert.ok(A.vault.isQueued("/internal/doc.json"), "still local work");
  assert.ok(!A.vault.isQueued("/internal/small.txt"));
  assert.ok(A.timers.some((t) => t.ms > A.vault.settleMs), "a later sync is armed");
});

test("ten saves in a row leave one object, not ten", async () => {
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  for (let i = 0; i < 10; i++) {
    await A.write("/internal/doc.json", BIG("v" + i));
    await A.sync();
  }
  assert.equal(objects(db).length, 0, "nothing went up while it kept changing");
  shiftClock(A, A.vault.settleMs + 1000);
  await A.sync();
  assert.equal(objects(db).length, 1);
  assert.deepEqual(await cloudPaths(A), ["/internal/doc.json"]);
  const B = await vaultDevice(db, "B");
  await B.sync();
  assert.equal(await B.read("/internal/doc.json"), BIG("v9"));
});

test("leaving the page sends a waiting file at once", async () => {
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  await A.write("/internal/doc.json", BIG("v1"));
  await A.sync();
  assert.equal(objects(db).length, 0);
  const r = await A.vault.sync("hide");
  assert.equal(r.stats.waiting, 0);
  assert.equal(objects(db).length, 1);
  assert.ok(!A.vault.isQueued("/internal/doc.json"));
});

test("a file that never stops changing still goes up after the longest wait", async () => {
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  await A.write("/internal/doc.json", BIG("v1"));
  await A.sync();                                       // held from now
  shiftClock(A, A.vault.settleMaxMs + 1000);
  await A.write("/internal/doc.json", BIG("v2"));       // written again just now
  await A.sync();
  assert.equal(objects(db).length, 1);
  const B = await vaultDevice(db, "B");
  await B.sync();
  assert.equal(await B.read("/internal/doc.json"), BIG("v2"));
});

test("a deletion of a big file never waits", async () => {
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  await A.write("/internal/doc.json", BIG("v1"));
  await A.vault.sync("hide");
  assert.deepEqual(await cloudPaths(A), ["/internal/doc.json"]);
  await A.rm("/internal/doc.json");
  await A.sync();
  assert.deepEqual(await cloudPaths(A), []);
});

test("a waiting file is local work: a remote version never overwrites it", async () => {
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  const B = await vaultDevice(db, "B");
  await A.write("/internal/doc.json", BIG("a1"));
  await A.vault.sync("hide");
  await B.sync();
  await B.write("/internal/doc.json", BIG("b2"));
  await B.vault.sync("hide");
  await A.write("/internal/doc.json", BIG("a3"));
  await A.sync();                                       // A's version waits
  assert.equal(await A.read("/internal/doc.json"), BIG("a3"), "A keeps its own edit");
  await A.vault.sync("hide");
  const paths = await cloudPaths(A);
  assert.ok(paths.includes("/internal/doc.json"));
  // whatever FILES-V decides, both versions still exist somewhere
  const C = await vaultDevice(db, "C");
  await C.sync();
  const all = [];
  for (const [p, b] of C.disk) all.push(Buffer.from(await b.arrayBuffer()).toString("utf8").slice(0, 2));
  assert.ok(all.includes("a3"), "A's edit reached the cloud");
});

test("usage names the files sent most often and when the first copy can go", async () => {
  const db = new BinDropbox();
  const A = await vaultDevice(db, "A");
  for (let i = 0; i < 3; i++) {
    await A.write("/internal/Atelier/Poster · at-abc.atelier", BIG("v" + i));
    await A.vault.sync("hide");
  }
  await A.write("/internal/once.txt", "once");
  await A.sync();
  const u = await A.vault.usage();
  assert.equal(u.unused, 2);
  assert.equal(u.free, 0);
  assert.ok(u.nextFreeAt > Date.now() + 29 * 864e5, "about 30 days from now");
  assert.equal(u.sentMost.length, 1, "a file sent once is not listed");
  assert.equal(u.sentMost[0].name, "Poster · at-abc.atelier", "the name only, never the folder");
  assert.equal(u.sentMost[0].n, 3);
  assert.ok(u.sentMost[0].bytes > 900 * 1024);
});
