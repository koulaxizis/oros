// Passwords PW-OTP2: "2FA only" entries (pmkinds.js kind "otp") and
// the exports to Aegis (encrypted vault) and 2FAS (passwords/
// otpexport.js). The Aegis file is opened twice: with Node's own
// crypto (scrypt + AES-GCM, an independent implementation of Aegis'
// published format) and with our importer; the 2FAS file goes back
// through the importer. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PC = require(path.join(ROOT, "passwords/pmcore.js"));
const K = require(path.join(ROOT, "passwords/pmkinds.js"));
const I = require(path.join(ROOT, "passwords/import.js"));
const X = require(path.join(ROOT, "passwords/otpexport.js"));

const NOW = Date.UTC(2026, 10, 1, 12);
const SECRET = "JBSWY3DPEHPK3PXP";
const SECRET2 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

function entry(o) { return PC.normEntry(Object.assign(PC.blankEntry(NOW), { id: PC.newId() }, o), NOW); }
function otpEntry(issuer, account, uri) {
  return PC.normEntry(K.withData(entry({ title: issuer, user: account, totp: uri, pw: "dropped", urls: ["https://x.example"] }), "otp", {}), NOW);
}
function sample() {
  return [
    otpEntry("GitHub", "maria", "otpauth://totp/GitHub:maria?secret=" + SECRET + "&issuer=GitHub"),
    entry({ title: "Bank", user: "m.p", pw: "pw", totp: "otpauth://totp/Bank:m.p?secret=" + SECRET2 + "&algorithm=SHA256&digits=8&period=60" }),
    entry({ title: "No code", user: "x", pw: "y" }),
    entry({ title: "Broken", user: "z", totp: "not a secret" }),
    entry({ title: "Bare secret", user: "dana", totp: SECRET })
  ];
}

test("kind otp: a login with the marker, no password or history, keeps account, secret and sites", () => {
  const e = sample()[0];
  assert.equal(K.kindOf(e), "otp");
  assert.equal(e.pw, "");
  assert.deepEqual(e.hist, []);
  assert.equal(e.user, "maria");
  assert.match(e.totp, /^otpauth:\/\/totp\//);
  assert.deepEqual(e.urls, ["https://x.example"]);
  assert.ok(K.hasContent(e));
  assert.ok(!K.hasContent(K.withData(entry({ title: "t" }), "otp", {})));
  assert.equal(K.summary(e), "maria");
  assert.ok(K.KINDS.includes("otp"));
  // search never hits the marker value
  assert.ok(!PC.matches(e, "otp"));
});

test("codes(): valid TOTP only, sorted, algorithm / digits / period kept, duplicates once", () => {
  const list = sample();
  list.push(entry({ title: "GitHub again", user: "maria", totp: "otpauth://totp/GitHub:maria?secret=" + SECRET + "&issuer=GitHub" }));
  const c = X.codes(list);
  assert.deepEqual(c.map((x) => x.issuer || x.account), ["Bank", "Bare secret", "GitHub"]);
  const bank = c[0];
  assert.equal(bank.algo, "SHA256"); assert.equal(bank.digits, 8); assert.equal(bank.period, 60);
  assert.equal(bank.secret, SECRET2);
  assert.equal(c[1].account, "dana");    // a bare secret takes title + user name
  assert.ok(PC.parseOtp(bank.uri).secret);
});

test("Aegis export: Node's scrypt + AES-GCM open it, and our importer reads the same codes", async () => {
  const text = await X.toAegis(sample(), "file pass 1", { scrypt: I.scrypt });
  const j = JSON.parse(text);
  assert.equal(j.version, 1);
  const sl = j.header.slots[0];
  assert.equal(sl.type, 1); assert.equal(sl.n, 32768); assert.equal(sl.r, 8); assert.equal(sl.p, 1);
  assert.match(sl.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // independent: Node's crypto
  const dk = crypto.scryptSync("file pass 1", Buffer.from(sl.salt, "hex"), 32, { N: sl.n, r: sl.r, p: sl.p, maxmem: 64 * 1024 * 1024 });
  const d1 = crypto.createDecipheriv("aes-256-gcm", dk, Buffer.from(sl.key_params.nonce, "hex"));
  d1.setAuthTag(Buffer.from(sl.key_params.tag, "hex"));
  const mk = Buffer.concat([d1.update(Buffer.from(sl.key, "hex")), d1.final()]);
  const d2 = crypto.createDecipheriv("aes-256-gcm", mk, Buffer.from(j.header.params.nonce, "hex"));
  d2.setAuthTag(Buffer.from(j.header.params.tag, "hex"));
  const db = JSON.parse(Buffer.concat([d2.update(Buffer.from(j.db, "base64")), d2.final()]).toString("utf8"));
  assert.equal(db.version, 2);
  assert.equal(db.entries.length, 3);
  const gh = db.entries.find((x) => x.issuer === "GitHub");
  assert.deepEqual(gh.info, { secret: SECRET, algo: "SHA1", digits: 6, period: 30 });
  assert.equal(gh.name, "maria"); assert.equal(gh.type, "totp");
  // our importer
  const locked = I.parseText(text);
  assert.equal(locked.locked, "aegis");
  await assert.rejects(I.unlock(locked, "wrong", NOW), /wrong-password/);
  const r = await I.unlock(locked, "file pass 1", NOW);
  assert.equal(r.codes.length, 3);
  const bank = r.codes.find((x) => x.issuer === "Bank");
  const p = PC.parseOtp(bank.uri);
  assert.equal(p.algo, "SHA-256"); assert.equal(p.digits, 8); assert.equal(p.period, 60);
});

test("Aegis export refuses an empty password and nothing without the KDF", async () => {
  await assert.rejects(X.toAegis(sample(), "", { scrypt: I.scrypt }), /no-key/);
  await assert.rejects(X.toAegis(sample(), "x", {}), /no-kdf/);
});

test("2FAS export (no password): schema 4, read back by the importer with the same codes", async () => {
  const text = X.to2fas(sample(), NOW);
  const j = JSON.parse(text);
  assert.equal(j.schemaVersion, 4);
  assert.equal(j.servicesEncrypted, undefined);
  assert.equal(j.services.length, 3);
  assert.deepEqual(j.services.map((s) => s.order.position), [0, 1, 2]);
  const gh = j.services.find((s) => s.name === "GitHub");
  assert.equal(gh.secret, SECRET);
  assert.equal(gh.otp.tokenType, "TOTP");
  assert.equal(gh.otp.account, "maria");
  const r = I.parseText(text);
  assert.equal(r.codes.length, 3);
  assert.deepEqual(r.codes.map((c) => c.secret).sort(), [SECRET, SECRET, SECRET2].sort());
});

test("imported codes with no matching entry become 2FA-only entries", () => {
  const res = I.parseText("otpauth://totp/Example:alice?secret=" + SECRET + "&issuer=Example");
  const base = PC.normSnap({ v: 1, d: {}, e: [] });
  const pv = I.apply(base, res, { now: NOW });
  assert.equal(pv.codesNew, 1);
  const e = pv.snap.e[0];
  assert.equal(K.kindOf(e), "otp");
  assert.equal(e.title, "Example"); assert.equal(e.user, "alice");
});
