// BK-E — optional encrypted backup files (Settings › Backups, off by
// default). sync.js seals/opens; the shell keeps the derived key in
// IndexedDB and asks for the passphrase of a sealed file on import.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");
const { FakeDropbox, createDevice, readKey, writeKey } = require("./harness");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PW = "backup passphrase 1";

async function device() {
  const D = await createDevice(new FakeDropbox(), "A", { "oros-slices": { notes: "app-notes" } });
  writeKey(D, "app-notes", { items: { a: "secret text" } });
  return D;
}

test("a sealed backup has the documented shape, 600 000 rounds, and hides the content", async () => {
  const D = await device();
  const plain = D.sync.exportData();
  const k = await D.sync.backupKey(PW);
  assert.equal(k.it, 600000);
  assert.equal(Buffer.from(k.s, "base64").length, 16);
  const sealed = await D.sync.sealBackup(plain, k);
  const doc = JSON.parse(sealed);
  assert.equal(doc.format, "oros-backup");
  assert.equal(doc.v, 1);
  assert.deepEqual(Object.keys(doc.enc).sort(), ["ct", "it", "iv", "s"]);
  assert.equal(doc.enc.it, 600000);
  assert.equal(Buffer.from(doc.enc.iv, "base64").length, 12);
  assert.ok(!sealed.includes("secret text"));
  assert.ok(D.sync.backupSealed(sealed));
  assert.equal(D.sync.backupSealed(plain), null, "a plain backup is not sealed");
  // A fresh IV for every file sealed with the same key.
  const again = JSON.parse(await D.sync.sealBackup(plain, k));
  assert.equal(again.enc.s, doc.enc.s);
  assert.notEqual(again.enc.iv, doc.enc.iv);
});

test("the right passphrase opens it and the import restores the data", async () => {
  const D = await device();
  const sealed = await D.sync.sealBackup(D.sync.exportData(), await D.sync.backupKey(PW));
  const E = await createDevice(new FakeDropbox(), "B", { "oros-slices": { notes: "app-notes" } });
  const text = await E.sync.openBackup(sealed, PW);
  assert.ok(E.sync.importData(text) >= 1);
  assert.deepEqual(readKey(E, "app-notes"), { items: { a: "secret text" } });
});

test("a wrong passphrase or a changed file rejects with backup-pass and imports nothing", async () => {
  const D = await device();
  const sealed = await D.sync.sealBackup(D.sync.exportData(), await D.sync.backupKey(PW));
  await assert.rejects(D.sync.openBackup(sealed, "not the passphrase"), /backup-pass/);
  const doc = JSON.parse(sealed);
  const ct = Buffer.from(doc.enc.ct, "base64"); ct[5] ^= 1;
  doc.enc.ct = ct.toString("base64");
  await assert.rejects(D.sync.openBackup(JSON.stringify(doc), PW), /backup-pass/);
});

test("crafted files are refused before any work: rounds out of range, bad IV, not sealed", async () => {
  const D = await device();
  const sealed = JSON.parse(await D.sync.sealBackup("{}", await D.sync.backupKey(PW)));
  for (const it of [1000, 5000001, 600000.5]) {
    const d = JSON.parse(JSON.stringify(sealed)); d.enc.it = it;
    await assert.rejects(D.sync.openBackup(JSON.stringify(d), PW), /bad backup file/);
  }
  const d = JSON.parse(JSON.stringify(sealed)); d.enc.iv = Buffer.alloc(8).toString("base64");
  await assert.rejects(D.sync.openBackup(JSON.stringify(d), PW), /bad backup file/);
  await assert.rejects(D.sync.openBackup(D.sync.exportData(), PW), /bad backup file/);
  assert.equal(D.sync.backupSealed('{"format":"oros-backup","v":2,"enc":{}}'), null);
});

test("an independent implementation of the documented format opens a sealed file", async () => {
  const D = await device();
  const plain = D.sync.exportData();
  const doc = JSON.parse(await D.sync.sealBackup(plain, await D.sync.backupKey(PW)));
  const base = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(PW), "PBKDF2", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt: Buffer.from(doc.enc.s, "base64"), iterations: doc.enc.it, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const out = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(doc.enc.iv, "base64") }, key,
    Buffer.from(doc.enc.ct, "base64"));
  assert.equal(new TextDecoder().decode(out), plain);
});

test("shell: off by default, every write path seals, import asks only for sealed files", () => {
  const sh = read("shell.js");
  assert.match(sh, /var BK_ENC_KEY = "oros-backup-enc";/);
  assert.match(sh, /function bkEncOn\(\) \{\s*try \{ return localStorage\.getItem\(BK_ENC_KEY\) === "1";/);
  // Manual export and the folder file both pass through bkSealIfOn.
  assert.match(sh, /exportJob\.then\(bkSealIfOn\)/);
  assert.match(sh, /return bkSealIfOn\(JSON\.stringify\(filePayload, null, 2\)\)/);
  // On without a key writes nothing (no plain fallback).
  assert.match(sh, /if \(!k\) throw new Error\("backup-nokey"\);/);
  // Import: sealed → dialog, plain → straight in.
  assert.match(sh, /window\.orosSync\.backupSealed\(text\)\) \{\s*showBackupPassDialog\("open"/);
  assert.match(sh, /case "backup\.encrypt":/);
  assert.match(sh, /encLost: bkEncOn\(\) && bkKey === null/);
  // The set dialog keeps the vault's minimum length.
  assert.match(sh, /if \(pw\.length < MIN_PASS_LEN\) \{ errBox\.textContent = window\.t\("sync\.err\.shortpass"\)/);
  // The factory reset removes the key's database.
  assert.match(sh, /\["oros-vault", "oros-fs",/);
});

test("strings: shell and Settings in EN, EL and DE; help in all three", () => {
  global.window = {};
  require("../translations.js");
  const T = global.window.OROS_TRANSLATIONS;
  const keys = ["sync.ok.fsfolder.savedEnc", "sync.ok.backupenc", "sync.err.backupkey", "sync.err.backuppass",
    "sync.bkenc.title", "sync.bkenc.hint", "sync.bkenc.new", "sync.bkenc.confirm", "sync.bkenc.ok",
    "sync.bkenc.working", "sync.bkopen.title", "sync.bkopen.hint", "sync.bkopen.pass", "sync.bkopen.ok"];
  const de = read("i18n/de/shell.js");
  for (const k of keys) {
    assert.ok(T.en[k] && T.el[k], k);
    assert.ok(de.includes(JSON.stringify(k) + ":"), "de " + k);
  }
  delete global.window;
  const core = read("settings/core.js"), deS = read("i18n/de/settings.js");
  for (const k of ["b.enc", "b.enc.hint", "b.enc.change", "b.enc.lost", "b.enc.set", "b.hint.enc", "w.backup-encrypt"]) {
    assert.equal(core.split(JSON.stringify(k) + ":").length, 3, "en+el " + k);
    assert.ok(deS.includes(JSON.stringify(k) + ":"), "de " + k);
  }
  assert.match(core, /\["backup-encrypt", "backup", "b\.enc"\]/);
  assert.match(core, /backupenc: "device"/);
  for (const p of ["help/topics/backup.en.txt", "help/topics/backup.el.txt", "i18n/de/help/topics/backup.txt"]) {
    const h = read(p);
    assert.ok(/AES-256/.test(h) && /10/.test(h), p);
  }
});
