// SY-Z (2026-11-27): the sync mailbox ("oros-remote-carry") is stored
// packed once it is big, so a phone that relays many apps it never
// opened no longer fills the ~5 MB localStorage and stops syncing.
// The packing must be lossless for any text, old plain mailboxes must
// keep working, and every SY-Q1 rule (a mailbox that cannot be kept
// stops the upload) must still hold.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeDropbox, createDevice, readKey, writeKey, edit, cloudPayload, reboot, registerLive, lwwRecordMerge } = require("./harness");

const CARRY = "oros-remote-carry";
const PACKED = "\u0001Z1";

function rnd(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

// A big app slice that looks like real data (repeated field names,
// Greek and English words, ids, numbers).
function bigSlice(n, seed) {
  const r = rnd(seed);
  const words = ["σημείωση", "λίστα", "Καλημέρα", "book", "chapter", "εκδόσεις", "Γλαρόλυκοι", "draft", "τιμή", "invoice"];
  const items = {};
  for (let i = 0; i < n; i++) {
    const id = "id" + Math.floor(r() * 1e9).toString(36) + i;
    items[id] = { v: words[i % words.length] + " " + Math.floor(r() * 10000), t: 1700000000000 + i * 1000, tags: [words[(i * 7) % words.length]] };
  }
  return { ver: 2, items };
}

test("lzPack/lzUnpack: lossless for any UTF-16 text", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const { pack, unpack } = A.sync._lz;
  const r = rnd(7);
  const samples = ["", "a", "aa", "aaaa", "abababababab", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "Καλημέρα κόσμε 🎵 \u0000\u0001￿", "\ud83d", "\udc00x\ud800", JSON.stringify(bigSlice(300, 3))];
  for (let k = 0; k < 40; k++) {                     // random text over small and full alphabets
    let s = "";
    const len = Math.floor(r() * 3000);
    const wide = k % 3 === 0;
    for (let i = 0; i < len; i++) s += String.fromCharCode(wide ? Math.floor(r() * 65536) : 97 + Math.floor(r() * 4));
    samples.push(s);
  }
  for (const s of samples) {
    const z = pack(s);
    for (let i = 0; i < z.length; i++) {
      const c = z.charCodeAt(i);
      assert.ok(c >= 32 && c < 32800, "packed text uses only plain characters");
    }
    assert.equal(unpack(z), s);
  }
  assert.throws(() => unpack(pack("hello world").slice(0, 2)), /lz-/, "cut text is refused, never half-read");
});

test("a big mailbox is stored packed, read back the same, and much smaller", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B", { "oros-slices": { invoices: "app-invoices", publish: "app-publish" } });
  writeKey(B, "app-invoices", bigSlice(2000, 1));
  writeKey(B, "app-publish", bigSlice(1500, 2));
  B.sync.markDirty();
  await B.sync.push();

  await A.sync.pull();                              // A never opened these apps: they go to its mailbox
  const raw = A.localStorage.getItem(CARRY);
  assert.ok(raw.startsWith(PACKED), "stored packed");
  const plain = JSON.stringify({ invoices: bigSlice(2000, 1), publish: bigSlice(1500, 2) });
  assert.ok(raw.length < plain.length / 2, "packed " + raw.length + " vs plain " + plain.length);
  assert.deepEqual(A.sync.carryPeek("invoices"), bigSlice(2000, 1));
  const sizes = A.sync.carrySizes();
  assert.equal(sizes.stored, raw.length);
  assert.deepEqual(Object.keys(sizes.apps).sort(), ["invoices", "publish"]);

  // A relays them untouched on its own push, and after a restart too.
  edit(A, "notes", () => ({ items: { a: { v: "x", t: 1 } } }));
  await A.sync.push();
  const cloud = await cloudPayload(db, A);
  assert.deepEqual(cloud.apps.invoices, bigSlice(2000, 1));
  assert.deepEqual(cloud.apps.publish, bigSlice(1500, 2));
  const A2 = await reboot(db, A);
  assert.deepEqual(A2.sync.carryPeek("publish"), bigSlice(1500, 2));
});

test("an old plain mailbox is packed at boot and nothing in it is lost", async () => {
  const db = new FakeDropbox();
  const carry = { invoices: bigSlice(1500, 4), shop: { v: 1, shops: { s: "Γλαρόλυκοι" } } };
  const A = await createDevice(db, "A", { [CARRY]: carry });
  assert.ok(A.localStorage.getItem(CARRY).startsWith(PACKED));
  assert.deepEqual(A.sync.carryPeek("invoices"), carry.invoices);
  assert.deepEqual(A.sync.carryPeek("shop"), carry.shop);
  A.sync.carryDrop("shop");
  assert.equal(A.sync.carryPeek("shop"), null);
  assert.deepEqual(A.sync.carryPeek("invoices"), carry.invoices);
});

test("a small mailbox stays plain JSON", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A", { [CARRY]: { shop: { v: 1 } } });
  assert.deepEqual(JSON.parse(A.localStorage.getItem(CARRY)), { shop: { v: 1 } });
});

test("a parked copy in a packed mailbox reaches the app's merge when it opens", async () => {
  const db = new FakeDropbox();
  const seed = { "oros-slices": { notes: "app-notes" }, "oros-slices-merge": { notes: 1 } };
  const A = await createDevice(db, "A", seed);
  const B = await createDevice(db, "B", seed);
  writeKey(A, "app-notes", { items: { base: { v: "base", t: 1 } } });
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();
  // both edit while the app is closed; A also holds a big unknown app
  edit(A, "notes", (s) => { s.items.a = { v: "from A", t: 2 }; return s; });
  const bigB = bigSlice(1500, 9);
  edit(B, "notes", (s) => { s.items.b = { v: "from B", t: 2 }; return s; });
  writeKey(B, "app-books", bigB);
  B.localStorage.setItem("oros-slices", JSON.stringify({ notes: "app-notes", books: "app-books" }));
  const B2 = await reboot(db, B);
  B2.sync.markDirty();
  await B2.sync.push();
  await A.sync.pull();
  assert.ok(A.localStorage.getItem(CARRY).startsWith(PACKED), "B's copy parked, packed with the unknown app");
  registerLive(A, "notes", lwwRecordMerge);
  const got = readKey(A, "app-notes");
  assert.equal(got.items.a.v, "from A");
  assert.equal(got.items.b.v, "from B");
  assert.deepEqual(A.sync.carryPeek("books"), bigB, "the other app is still relayed");
  assert.equal(A.sync.carryPeek("notes"), null, "the parked copy was consumed");
});

test("full store: device caches of internet data go first, then the mailbox is kept", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A", {
    "oros-radio-cache:list_top__0": "x".repeat(50000),
    "oros-podcasts-top": "y".repeat(20000),
    "oros-music-data": { keep: true }
  });
  const B = await createDevice(db, "B", { "oros-slices": { invoices: "app-invoices" } });
  writeKey(B, "app-invoices", { ver: 1, docs: { d1: "Τιμολόγιο 1" } });
  B.sync.markDirty();
  await B.sync.push();

  A.localStorage.full = true;                       // no room for the new mailbox entry
  await A.sync.pull();
  assert.equal(A.localStorage.getItem("oros-radio-cache:list_top__0"), null, "radio list cache freed");
  assert.equal(A.localStorage.getItem("oros-podcasts-top"), null, "podcasts top list cache freed");
  assert.deepEqual(JSON.parse(A.localStorage.getItem("oros-music-data")), { keep: true }, "app data untouched");
  // MemoryStorage.full refuses any growth, so the entry still cannot land:
  // the engine must say so and refuse the upload (SY-Q1), never drop it.
  await assert.rejects(A.sync.push(), /storage-full/);
  assert.deepEqual((await cloudPayload(db, A)).apps.invoices, { ver: 1, docs: { d1: "Τιμολόγιο 1" } });
  A.localStorage.full = false;
  await A.sync.push();
  assert.deepEqual(A.sync.carryPeek("invoices"), { ver: 1, docs: { d1: "Τιμολόγιο 1" } });
});
