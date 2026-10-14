// orOS Mail — OpenPGP: the MIME side (mail/pgpmime.js, compose.js
// content()) and, end to end, mail/pgp.js on the vendored, unmodified
// OpenPGP.js (vendor/openpgp/openpgp.min.js, loaded here as the page
// loads it: a script that defines the global "openpgp").
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const C = require("../mail/compose.js");
const PM = require("../mail/pgpmime.js");
const M = require("../mail/mime.js");

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "vendor/openpgp/openpgp.min.js"), "utf8"));
const PG = require("../mail/pgp.js");

const utf8 = (s) => Buffer.from(s, "utf8").toString("latin1");
const me = { name: "Me", addr: "me@x.gr" }, bob = { name: "Bob", addr: "bob@y.gr" };

test("content(): a part to be signed never goes as 7bit with trailing spaces or From lines", () => {
  const plain = C.content({ text: "hello\nworld" });
  assert.match(plain.head, /7bit/);
  const safe1 = C.content({ text: "hello \nworld", safe: true });
  assert.match(safe1.head, /base64/);
  const safe2 = C.content({ text: "From me\nhi", safe: true });
  assert.match(safe2.head, /base64/);
  assert.match(C.content({ text: "hello\nworld", safe: true }).head, /7bit/);
  // build() takes a ready part as is
  const msg = C.build({ from: me, to: [bob], subject: "x", text: "ignored", part: { head: "Content-Type: text/plain\r\n", body: "PART" } });
  assert.match(msg.bin, /\r\nContent-Type: text\/plain\r\nUser-Agent: orOS Mail\r\n\r\nPART\r\n$/);
});

test("PGP/MIME: multipart/signed carries the entity byte for byte; find() gets it back", () => {
  const part = C.content({ text: "Καλημέρα\nline two", attachments: [{ name: "a.txt", type: "text/plain", bin: "abc" }], safe: true });
  const ent = PM.entity(part);
  assert.ok(!/\r\n$/.test(ent) && /^Content-Type: multipart\/mixed/.test(ent));
  const signed = PM.signed(part, "-----BEGIN PGP SIGNATURE-----\nAAAA\n-----END PGP SIGNATURE-----\n", "pgp-sha512");
  assert.match(signed.head, /multipart\/signed; boundary="[^"]+";\r\n micalg="pgp-sha512"; protocol="application\/pgp-signature"/);
  const msg = C.build({ from: me, to: [bob], subject: "s", part: signed });
  const f = PM.find(msg.bin);
  assert.equal(f.kind, "signed");
  assert.equal(f.entity, ent);
  assert.equal(f.micalg, "pgp-sha512");
  assert.match(f.sig, /^-----BEGIN PGP SIGNATURE-----\r\nAAAA\r\n-----END PGP SIGNATURE-----$/);
  // mime.js shows the signed text and the signature as a part
  const p = M.parseMessage(msg.bin);
  assert.equal(p.text, "Καλημέρα\nline two");
  assert.ok(p.attachments.some((a) => a.type === "application/pgp-signature"));
  // a bad micalg falls back
  assert.match(PM.signed(part, "x", "md5; evil").head, /micalg="pgp-sha256"/);
});

test("PGP/MIME: multipart/encrypted (RFC 3156 §4), also as the first part of a mixed message", () => {
  const arm = "-----BEGIN PGP MESSAGE-----\n\nwcBMA\n-----END PGP MESSAGE-----\n";
  const enc = PM.encrypted(arm);
  assert.match(enc.head, /multipart\/encrypted; boundary="[^"]+";\r\n protocol="application\/pgp-encrypted"/);
  assert.match(enc.body, /Content-Type: application\/pgp-encrypted\r\nContent-Description: PGP\/MIME version identification\r\n\r\nVersion: 1\r\n/);
  const msg = C.build({ from: me, to: [bob], subject: "s", part: enc });
  const f = PM.find(msg.bin);
  assert.equal(f.kind, "encrypted");
  assert.equal(f.armored, PM.crlf(arm).replace(/\r\n$/, ""));
  // a list footer added after it (multipart/mixed around it)
  const wrapped = "Content-Type: multipart/mixed; boundary=\"OUT\"\r\n\r\n--OUT\r\n" + enc.head + "\r\n" + enc.body + "\r\n--OUT\r\nContent-Type: text/plain\r\n\r\nfooter\r\n--OUT--\r\n";
  assert.equal(PM.find(wrapped).kind, "encrypted");
  // a base64 armored part is decoded
  const b64 = "Content-Type: multipart/encrypted; protocol=\"application/pgp-encrypted\"; boundary=b\r\n\r\n--b\r\nContent-Type: application/pgp-encrypted\r\n\r\nVersion: 1\r\n--b\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
    Buffer.from(arm).toString("base64") + "\r\n--b--\r\n";
  assert.match(PM.find(b64).armored, /BEGIN PGP MESSAGE/);
  assert.equal(PM.find("Content-Type: text/plain\r\n\r\nhi"), null);
  assert.equal(PM.find("Content-Type: multipart/signed; boundary=b\r\n\r\n--b\r\nx\r\n--b\r\nno sig\r\n--b--"), null);
});

test("inline armor: encrypted and clear-signed blocks; quoted ones are not taken", () => {
  const t1 = "Hi\n-----BEGIN PGP MESSAGE-----\n\nabc\n-----END PGP MESSAGE-----\nBye";
  const r = PM.inline(t1);
  assert.equal(r.kind, "inline-enc");
  assert.equal(r.before, "Hi\n");
  assert.equal(r.after, "\nBye");
  const t2 = "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\ntext\n-----BEGIN PGP SIGNATURE-----\n\nsig\n-----END PGP SIGNATURE-----\n";
  assert.equal(PM.inline(t2).kind, "inline-signed");
  assert.equal(PM.inline("> -----BEGIN PGP MESSAGE-----\n> x\n> -----END PGP MESSAGE-----"), null);
  assert.equal(PM.inline("nothing here"), null);
  assert.ok(PM.isKey("x\n-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nAA\n-----END PGP PUBLIC KEY BLOCK-----\n"));
  assert.ok(!PM.isKey("-----BEGIN PGP MESSAGE-----"));
});

// ---------- end to end with OpenPGP.js ----------
function memStore() {
  const m = new Map();
  return { m, all: async () => [...m.values()].map((v) => JSON.parse(JSON.stringify(v))),
           put: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); }, del: async (k) => { m.delete(k); } };
}

test("OpenPGP end to end: keys, sign + verify, encrypt + decrypt, import, clear-signed", async () => {
  const st = memStore();
  await PG.init(st);
  const mine = (await PG.generate({ name: "Me", email: "me@x.gr", pass: "correct horse" })).meta;
  assert.equal(mine.own, true);
  assert.deepEqual(mine.emails, ["me@x.gr"]);
  assert.match(mine.sec, /BEGIN PGP PRIVATE KEY BLOCK/);
  // stored locked: the private key in the store needs the passphrase
  const stored = st.m.get(mine.fpr);
  const locked = await openpgp.readPrivateKey({ armoredKey: stored.sec });
  assert.equal(locked.isDecrypted(), false);
  await assert.rejects(PG.unlock(mine, "wrong"));
  const priv = await PG.unlock(mine, "correct horse");
  assert.equal(PG.cached(mine.fpr), priv);

  // Bob: a second key made elsewhere, imported as public only
  const b = await openpgp.generateKey({ userIDs: [{ name: "Bob", email: "Bob@Y.gr" }], passphrase: "bob pass 123", format: "armored" });
  let r = await PG.importText(b.publicKey, async () => "");
  assert.equal(r.added.length, 1);
  const bobMeta = r.added[0];
  assert.equal(bobMeta.own, false);
  assert.deepEqual(PG.forEmail("bob@y.gr").map((k) => k.fpr), [bobMeta.fpr]);
  assert.equal(PG.hasOwn("bob@y.gr"), false);
  r = await PG.importText(b.publicKey, async () => "");
  assert.equal(r.updated.length, 1);

  // sign (PGP/MIME) and verify
  const part = C.content({ text: "Signed text \nΓειά", safe: true });
  const s = await PG.sign(PM.entity(part), priv);
  assert.match(s.micalg, /^pgp-sha(256|384|512)$/);
  const msg = C.build({ from: me, to: [bob], subject: "signed", part: PM.signed(part, s.armored, s.micalg) });
  const f = PM.find(msg.bin);
  let v = await PG.verifyDetached(PM.crlf(f.entity), f.sig);
  assert.equal(v.state, "ok");
  assert.equal(v.signer.fpr, mine.fpr);
  // one byte changed on the way
  v = await PG.verifyDetached(PM.crlf(f.entity).replace("Content-Type", "Content-type"), f.sig);
  assert.equal(v.state, "bad");

  // encrypt to Bob and me (signed inside), Bob decrypts
  const ent = PM.entity(C.content({ text: "Secret Μυστικό", safe: true }));
  const arm = await PG.encrypt(ent, [bobMeta, mine], priv);
  const em = C.build({ from: me, to: [bob], subject: "enc", part: PM.encrypted(arm) });
  assert.ok(em.bin.indexOf("Secret") < 0);
  const fe = PM.find(em.bin);
  assert.equal(fe.kind, "encrypted");
  assert.deepEqual((await PG.keysFor(fe.armored)).map((k) => k.fpr), [mine.fpr]);   // Bob's private key is not here
  const bobPriv = await openpgp.decryptKey({ privateKey: await openpgp.readPrivateKey({ armoredKey: b.privateKey }), passphrase: "bob pass 123" });
  const out = await PG.decrypt(fe.armored, [bobPriv]);
  assert.equal(out.bin, ent);
  assert.equal(out.sig.state, "ok");
  assert.equal(M.parseMessage(out.bin).text, "Secret Μυστικό");
  // and I can read my own copy in Sent
  assert.equal((await PG.decrypt(fe.armored, [priv])).bin, ent);

  // a private key without a passphrase is locked with one before it is kept
  const c = await openpgp.generateKey({ userIDs: [{ email: "carol@z.gr" }], format: "armored" });
  r = await PG.importText(c.privateKey, async () => "carol passphrase");
  const carol = r.added[0];
  assert.equal(carol.own, true);
  assert.equal((await openpgp.readPrivateKey({ armoredKey: carol.sec })).isDecrypted(), false);
  await PG.unlock(carol, "carol passphrase");
  await assert.rejects(PG.importText(c.privateKey.replace(/[A-Za-z]/, "_"), async () => "x"));

  // inline clear-signed
  const cs = await openpgp.sign({ message: await openpgp.createCleartextMessage({ text: "Hello Bob\nline 2" }), signingKeys: priv });
  const vc = await PG.verifyClear(cs);
  assert.equal(vc.text, "Hello Bob\nline 2");
  assert.equal(vc.sig.state, "ok");

  // removal
  await PG.remove(bobMeta.fpr);
  assert.equal(PG.forEmail("bob@y.gr").length, 0);
  assert.equal(st.m.has(bobMeta.fpr), false);
  // a signature by a key not on the device
  const bs = await openpgp.sign({ message: await openpgp.createMessage({ binary: Buffer.from(utf8("x"), "latin1") }), signingKeys: bobPriv, detached: true });
  v = await PG.verifyDetached(utf8("x"), bs);
  assert.equal(v.state, "unknown");
  assert.match(v.keyId, /^[0-9a-f]{16}$/);
});
