// Passwords vault (passwords/pmcrypto.js + pmcore.js): Argon2 vectors,
// key hierarchy round trips, wrong keys, tamper detection, recovery
// key, password change, the pure sync merge of the encrypted slice and
// the per-entry merge done when the vault is open.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const DIR = path.join(__dirname, "..", "passwords");
const PV = require(path.join(DIR, "pmcrypto.js"));
const PC = require(path.join(DIR, "pmcore.js"));
const argon = require(path.join(__dirname, "..", "vendor", "hash-wasm", "argon2.umd.min.js"));

// Small but real Argon2id settings so the tests stay fast.
const FAST = { kdf: { alg: "argon2id", m: 8192, t: 1, p: 1 } };

function entry(id, m, extra) {
  return Object.assign({ id, m, c: m, title: "T" + id, user: "u", pw: "p" + m, urls: [], notes: "",
                         totp: "", tags: [], fields: [], fav: 0, hist: [] }, extra || {});
}
function sliceOf(kid, vault) { return PV.withVault(PV.empty(), kid, vault); }

test("Argon2 (vendored hash-wasm) matches the reference vectors", async () => {
  // argon2id: PHC reference implementation vector; argon2d: argon2-cffi.
  const id = await argon.argon2id({ password: "password", salt: "somesalt", iterations: 2, memorySize: 65536,
                                    parallelism: 1, hashLength: 32, outputType: "hex" });
  assert.equal(id, "09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7");
  const d = await argon.argon2d({ password: "password", salt: "somesalt", iterations: 2, memorySize: 8192,
                                  parallelism: 2, hashLength: 32, outputType: "hex" });
  assert.equal(d, "92e7d6bd7094b08f6ac71c0f29f59c081989329aaa867149128d2d6dfdb6af9b");
});

test("bytes helpers: base64 round trip, canonical JSON", () => {
  for (let n = 0; n < 70; n++) {
    const b = PV.random(n);
    assert.deepEqual(Array.from(PV.unb64(PV.b64(b))), Array.from(b));
    assert.equal(PV.b64(b), Buffer.from(b).toString("base64"));
  }
  assert.throws(() => PV.unb64("ab$c"));
  assert.equal(PV.canon({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}');
});

test("KDF settings: defaults, bounds refused, PBKDF2 fallback opens", async () => {
  assert.deepEqual(PV.KDF_ARGON, { alg: "argon2id", m: 65536, t: 3, p: 1 });
  assert.equal(PV.PBKDF2_ITER, 600000);
  const salt = PV.b64(PV.random(16));
  assert.equal(PV.normKdf({ alg: "argon2id", m: 4096, t: 3, p: 1, salt }), null);          // too little memory
  assert.equal(PV.normKdf({ alg: "argon2id", m: 4194304, t: 3, p: 1, salt }), null);       // 4 GiB: refused
  assert.equal(PV.normKdf({ alg: "argon2id", m: 65536, t: 99, p: 1, salt }), null);
  assert.equal(PV.normKdf({ alg: "pbkdf2-sha256", i: 100000, salt }), null);               // too few rounds
  assert.equal(PV.normKdf({ alg: "pbkdf2-sha256", i: 9e9, salt }), null);
  assert.equal(PV.normKdf({ alg: "scrypt", salt }), null);
  assert.equal(PV.normKdf({ alg: "argon2id", m: 65536, t: 3, p: 1, salt: "AAAA" }), null); // short salt
  const v = await PV.create("correct horse battery", { kdf: { alg: "pbkdf2-sha256", i: 600000 } });
  assert.equal(v.vault.kdf.alg, "pbkdf2-sha256");
  const s = await PV.unlock(v.vault, v.kid, "correct horse battery");
  assert.equal(s.kid, v.kid);
  await assert.rejects(PV.unlock(v.vault, v.kid, "correct horse batterY"), /wrong-password/);
});

test("create → seal → unlock → open: round trip; wrong password refused; no plaintext stored", async () => {
  const pw = "Μυστικό master pass 42!";
  const v = await PV.create(pw, FAST);
  assert.match(v.kid, /^[0-9a-f]{24}$/);
  assert.match(v.recovery, /^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2}$/);
  // The session holds non-extractable keys only.
  assert.equal(v.session.ek.extractable, false);
  assert.equal(v.session.ik.extractable, false);
  let snap = PC.upsert(PC.emptySnap(), entry("0123456789abcdef", 1000, { title: "Bank of Hellas", pw: "hunter2-SECRET",
                        notes: "PIN 9876", urls: ["https://bank.example"] }));
  const sealed = await PV.seal(v.session, v.vault, snap, { now: 2000 });
  let slice = PV.withVault(sliceOf(v.kid, v.vault), v.kid, v.vault, sealed.id, sealed.blob);
  const stored = JSON.stringify(slice);
  ["Bank of Hellas", "hunter2-SECRET", "9876", "bank.example", pw].forEach((s) => assert.ok(!stored.includes(s), s));

  // A second device: unlock from the stored slice alone.
  const again = PV.normSlice(JSON.parse(stored));
  const kid = PV.primaryKid(again);
  const s2 = await PV.unlock(again.vaults[kid], kid, pw);
  const ids = Object.keys(again.vaults[kid].blobs);
  assert.equal(ids.length, 1);
  const back = await PV.openBlob(s2, ids[0], again.vaults[kid].blobs[ids[0]]);
  assert.deepEqual(PC.normSnap(back), snap);
  // NFC: the same password typed with combining accents opens it too.
  await PV.unlock(again.vaults[kid], kid, pw.normalize("NFD"));
  await assert.rejects(PV.unlock(again.vaults[kid], kid, "wrong"), /wrong-password/);
  await assert.rejects(PV.unlock(again.vaults[kid], kid, ""), /wrong-password/);
});

test("blobs: fresh IV per save; tampered ciphertext or header is refused; another vault's key fails", async () => {
  const v = await PV.create("pw-one-two-three", FAST);
  const snap = PC.upsert(PC.emptySnap(), entry("00000000000000a1", 5));
  const a = await PV.seal(v.session, v.vault, snap, { now: 10 });
  const b = await PV.seal(v.session, v.vault, snap, { now: 10 });
  assert.notEqual(a.blob.iv, b.blob.iv);
  assert.notEqual(a.id, b.id);
  await PV.openBlob(v.session, a.id, a.blob);
  const ct = PV.unb64(a.blob.ct); ct[3] ^= 1;
  await assert.rejects(PV.openBlob(v.session, a.id, Object.assign({}, a.blob, { ct: PV.b64(ct) })), /bad-blob/);
  await assert.rejects(PV.openBlob(v.session, a.id, Object.assign({}, a.blob, { t: 11 })), /bad-blob/);
  await assert.rejects(PV.openBlob(v.session, a.id, Object.assign({}, a.blob, { sup: [b.id] })), /bad-blob/);
  await assert.rejects(PV.openBlob(v.session, b.id, a.blob), /bad-blob/);
  const other = await PV.create("pw-one-two-three", FAST);
  await assert.rejects(PV.openBlob(other.session, a.id, a.blob), /bad-blob/);
  // The wrapped key cannot be moved to another vault id (AAD).
  await assert.rejects(PV.unlock(v.vault, other.kid, "pw-one-two-three"), /wrong-password/);
});

test("recovery key opens the vault and sets a new password; a new recovery key replaces the old", async () => {
  const v = await PV.create("first-password-1", FAST);
  const typed = v.recovery.toLowerCase().replace(/-/g, " ").replace(/0/g, "o");
  assert.ok(PV.rkDecode(typed));
  const r = await PV.rewrap(v.vault, v.kid, { recovery: typed }, "second-password-2", Object.assign({ now: v.vault.kt + 5 }, FAST));
  assert.ok(r.vault.kt > v.vault.kt);
  await PV.unlock(r.vault, v.kid, "second-password-2");
  await assert.rejects(PV.unlock(r.vault, v.kid, "first-password-1"), /wrong-password/);
  await assert.rejects(PV.rewrap(v.vault, v.kid, { recovery: "AAAA-BBBB" }, "x", FAST), /wrong-recovery/);
  await assert.rejects(PV.rewrap(v.vault, v.kid, { recovery: PV.rkEncode(PV.random(16)) }, "x", FAST), /wrong-recovery/);
  // Data sealed before the change opens after it (VK is unchanged).
  const sealed = await PV.seal(v.session, v.vault, PC.upsert(PC.emptySnap(), entry("00000000000000b2", 7)), { now: 9 });
  await PV.openBlob(r.session, sealed.id, sealed.blob);
  // New recovery key: the old one stops working.
  const n = await PV.newRecovery(r.vault, v.kid, "second-password-2");
  assert.notEqual(n.recovery, v.recovery);
  await assert.rejects(PV.rewrap(n.vault, v.kid, { recovery: v.recovery }, "x", FAST), /wrong-recovery/);
  await PV.rewrap(n.vault, v.kid, { recovery: n.recovery }, "third-password-3", FAST);
  await assert.rejects(PV.newRecovery(r.vault, v.kid, "nope"), /wrong-password/);
  // Change with the current password.
  const c = await PV.rewrap(n.vault, v.kid, { password: "second-password-2" }, "fourth-password-4", FAST);
  await PV.unlock(c.vault, v.kid, "fourth-password-4");
});

test("mergeSlice: blobs union minus superseded, header by kt, gone vaults dropped, symmetric and idempotent", async () => {
  const v = await PV.create("pw", FAST);
  const base = sliceOf(v.kid, v.vault);
  const s0 = await PV.seal(v.session, v.vault, PC.emptySnap(), { now: 1 });
  const A0 = PV.withVault(base, v.kid, v.vault, s0.id, s0.blob);
  const vA = A0.vaults[v.kid];
  // Two devices save concurrently on top of s0.
  const sA = await PV.seal(v.session, vA, PC.upsert(PC.emptySnap(), entry("000000000000000a", 2)), { now: 2 });
  const sB = await PV.seal(v.session, vA, PC.upsert(PC.emptySnap(), entry("000000000000000b", 3)), { now: 3 });
  assert.deepEqual(sA.blob.sup, [s0.id]);
  const A = PV.withVault(A0, v.kid, vA, sA.id, sA.blob);
  const B = PV.withVault(A0, v.kid, vA, sB.id, sB.blob);
  assert.deepEqual(Object.keys(A.vaults[v.kid].blobs), [sA.id]);           // s0 superseded
  const AB = PV.mergeSlice(A, B), BA = PV.mergeSlice(B, A);
  assert.equal(JSON.stringify(AB), JSON.stringify(BA));
  assert.equal(JSON.stringify(PV.mergeSlice(AB, AB)), JSON.stringify(AB));
  assert.equal(JSON.stringify(PV.mergeSlice(AB, A0)), JSON.stringify(AB));    // an older copy adds nothing
  assert.deepEqual(Object.keys(AB.vaults[v.kid].blobs).sort(), [sA.id, sB.id].sort());
  // Header: the larger kt wins whichever side it is on.
  const r = await PV.rewrap(vA, v.kid, { password: "pw" }, "pw2", Object.assign({ now: 50 }, FAST));
  const H = PV.withVault(A0, v.kid, r.vault);
  assert.deepEqual(PV.mergeSlice(AB, H).vaults[v.kid].pw, r.vault.pw);
  assert.deepEqual(PV.mergeSlice(H, AB).vaults[v.kid].pw, r.vault.pw);
  assert.equal(Object.keys(PV.mergeSlice(H, AB).vaults[v.kid].blobs).length, 2);
  // A gone vault disappears everywhere and cannot come back.
  const G = PV.withGone(AB, v.kid, 99);
  assert.deepEqual(G.vaults, {});
  assert.deepEqual(PV.mergeSlice(G, AB).vaults, {});
  assert.deepEqual(PV.mergeSlice(AB, G).vaults, {});
  // Two vaults: the older is primary.
  const w = await PV.create("pw", Object.assign({ now: v.vault.c + 1000 }, FAST));
  const two = PV.mergeSlice(AB, sliceOf(w.kid, w.vault));
  assert.equal(PV.primaryKid(two), v.kid);
});

test("normSlice: malformed input is dropped, never thrown", () => {
  [null, 3, "x", [], { v: 2 }, { v: 1, vaults: [] }, { v: 1, vaults: { nothex: {} } }].forEach((raw) => {
    assert.deepEqual(PV.normSlice(raw), PV.empty());
  });
  const kid = "a".repeat(24);
  const bad = { v: 1, vaults: { [kid]: { c: 1, kt: 1, kdf: { alg: "argon2id", m: 65536, t: 3, p: 1, salt: PV.b64(PV.random(16)) },
    pw: { iv: "AAAA", ct: "AAAA" }, rk: null, blobs: { ["s" + "0".repeat(32)]: { t: 1, iv: "%%", ct: "AAAA", sup: [] },
    ["s" + "1".repeat(32)]: { t: 1, iv: "AAAA", ct: "AAAA", sup: ["junk"] } } } }, gone: {} };
  const n = PV.normSlice(bad);
  assert.deepEqual(Object.keys(n.vaults), [kid]);
  assert.deepEqual(n.vaults[kid].blobs, {});
});

test("two open devices converge: entries merge per item, deletes travel, merge blobs are identical", async () => {
  const pw = "shared-master-pw";
  const v = await PV.create(pw, FAST);
  const devA = { slice: sliceOf(v.kid, v.vault) };
  // Each device opens the vault on its own.
  const sessA = await PV.unlock(v.vault, v.kid, pw), sessB = await PV.unlock(v.vault, v.kid, pw);
  async function openAll(sess, slice) {
    const vault = slice.vaults[sess.kid];
    let snap = PC.emptySnap();
    for (const id of Object.keys(vault.blobs)) snap = PC.mergeSnap(snap, await PV.openBlob(sess, id, vault.blobs[id]));
    return snap;
  }
  async function save(sess, slice, snap, now) {
    const s = await PV.seal(sess, slice.vaults[sess.kid], snap, { now });
    return PV.withVault(slice, sess.kid, slice.vaults[sess.kid], s.id, s.blob);
  }
  // A adds two entries and syncs; B gets the slice.
  let snapA = PC.upsert(PC.upsert(PC.emptySnap(), entry("00000000000000a1", 100)), entry("00000000000000a2", 100));
  devA.slice = await save(sessA, devA.slice, snapA, 101);
  const devB = { slice: JSON.parse(JSON.stringify(devA.slice)) };
  let snapB = await openAll(sessB, devB.slice);
  assert.deepEqual(snapB, snapA);
  // Offline: A edits a1 and deletes a2; B edits a2 later than the delete and adds b1.
  snapA = PC.upsert(snapA, entry("00000000000000a1", 200, { title: "edited on A" }));
  snapA = PC.remove(snapA, "00000000000000a2", 210);
  devA.slice = await save(sessA, devA.slice, snapA, 211);
  snapB = PC.upsert(snapB, entry("00000000000000a2", 300, { title: "edited on B after the delete" }));
  snapB = PC.upsert(snapB, entry("00000000000000b1", 300));
  devB.slice = await save(sessB, devB.slice, snapB, 301);
  // The engine's merge (no keys) on both devices.
  const mA = PV.mergeSlice(devA.slice, devB.slice), mB = PV.mergeSlice(devB.slice, devA.slice);
  assert.equal(JSON.stringify(mA), JSON.stringify(mB));
  const ids = Object.keys(mA.vaults[v.kid].blobs);
  assert.equal(ids.length, 2);
  // Each open device merges the entries and writes ONE merge blob.
  const fullA = await openAll(sessA, mA), fullB = await openAll(sessB, mB);
  assert.deepEqual(fullA, fullB);
  const titles = fullA.e.map((e) => e.title).sort();
  assert.deepEqual(titles, ["T00000000000000b1", "edited on A", "edited on B after the delete"]);
  const xA = await PV.sealMerge(sessA, mA.vaults[v.kid], ids, fullA);
  const xB = await PV.sealMerge(sessB, mB.vaults[v.kid], ids, fullB);
  assert.equal(xA.id, xB.id);
  assert.deepEqual(xA.blob, xB.blob);                   // same bytes: no upload ping-pong
  assert.equal(xA.id, await PV.mergeId(ids.slice().reverse()));
  const fA = PV.withVault(mA, v.kid, mA.vaults[v.kid], xA.id, xA.blob);
  const fB = PV.withVault(mB, v.kid, mB.vaults[v.kid], xB.id, xB.blob);
  assert.equal(JSON.stringify(fA), JSON.stringify(fB));
  assert.deepEqual(Object.keys(fA.vaults[v.kid].blobs), [xA.id]);
  // A late copy of an old blob is superseded again on arrival.
  assert.equal(JSON.stringify(PV.mergeSlice(fA, devA.slice)), JSON.stringify(fA));
  // Delete after the last edit wins.
  let snapC = PC.remove(fullA, "00000000000000b1", 400);
  assert.ok(!snapC.e.some((e) => e.id === "00000000000000b1"));
  assert.ok(!PC.mergeSnap(snapC, fullA).e.some((e) => e.id === "00000000000000b1"));
});

test("pmcore merge: per-item LWW, equal mtime tie-break, tombstones, symmetric/associative", () => {
  const a = { v: 1, d: {}, e: [entry("0000000000000001", 5, { title: "a" }), entry("0000000000000002", 5)] };
  const b = { v: 1, d: { "0000000000000002": 5 }, e: [entry("0000000000000001", 5, { title: "b" })] };
  const c = { v: 1, d: {}, e: [entry("0000000000000003", 9)] };
  const ab = PC.mergeSnap(a, b), ba = PC.mergeSnap(b, a);
  assert.equal(PC.canon(ab), PC.canon(ba));
  assert.equal(ab.e.length, 1);                              // tomb at m hides the entry (delete wins ties)
  assert.equal(ab.e[0].title, "b");                          // equal m → larger canonical JSON
  assert.equal(PC.canon(PC.mergeSnap(PC.mergeSnap(a, b), c)), PC.canon(PC.mergeSnap(a, PC.mergeSnap(b, c))));
  assert.equal(PC.canon(PC.mergeSnap(ab, ab)), PC.canon(ab));
  // Remove of an entry with m in the future still hides it.
  const r = PC.remove(PC.normSnap(c), "0000000000000003", 1);
  assert.equal(r.e.length, 0);
  assert.equal(r.d["0000000000000003"], 10);
  // History keeps the replaced password, newest first, ≤ 5.
  let prev = PC.normEntry(entry("0000000000000004", 1, { pw: "p0" }));
  for (let i = 1; i <= 7; i++) {
    const next = Object.assign({}, prev, { pw: "p" + i });
    next.hist = PC.withHistory(prev, next, 100 + i);
    prev = PC.normEntry(next);
  }
  assert.deepEqual(prev.hist.map((h) => h.pw), ["p6", "p5", "p4", "p3", "p2"]);
});

test("normEntry bounds every value and drops junk", () => {
  const e = PC.normEntry({ id: "00000000000000ff", m: 5, title: "x\ny".repeat(300), urls: ["a", "a", "", 3],
                           tags: [" t ", "t", "/u/"], fields: [{ n: "k", v: "v", h: "yes" }, null, {}],
                           hist: [{ pw: "" }, { pw: "q", t: -1 }], evil: "<script>" });
  assert.equal(e.title.length, 200);
  assert.ok(!/\n/.test(e.title));
  assert.deepEqual(e.urls, ["a", "3"]);
  assert.deepEqual(e.tags, ["t", "u"]);
  assert.deepEqual(e.fields, [{ h: 1, n: "k", v: "v" }]);
  assert.deepEqual(e.hist, [{ pw: "q", t: 5 }]);
  assert.equal(e.evil, undefined);
  assert.equal(PC.normEntry({ id: "short" }), null);
  assert.equal(PC.safeUrl("javascript:alert(1)"), null);
  assert.equal(PC.safeUrl("example.org/x"), "https://example.org/x");
  assert.equal(PC.safeUrl("http://a.b"), "http://a.b");
});
