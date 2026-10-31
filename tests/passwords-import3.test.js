// Passwords: import wave 2 of passwords/import.js. Exports with a
// password (Bitwarden "password protected" .json with PBKDF2 and
// Argon2id, Aegis encrypted vault with scrypt, 2FAS backup with a
// password) are opened by unlock(); Keeper (JSON, CSV with and without
// a header), RoboForm and Zoho Vault CSV, KeePass 2 XML. The encrypted
// fixtures are built here with Node's own crypto following each app's
// published format, so the test checks our reader against an
// independent implementation. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PC = require(path.join(ROOT, "passwords/pmcore.js"));
const I = require(path.join(ROOT, "passwords/import.js"));
const argon = require(path.join(ROOT, "vendor/hash-wasm/argon2.umd.min.js"));

const enc = (s) => new TextEncoder().encode(s);
const hex = (b) => Buffer.from(b).toString("hex");
const NOW = Date.UTC(2026, 9, 1);
const SECRET = "JBSWY3DPEHPK3PXP";

function vault(entries) {
  return PC.normSnap({ v: 1, d: {}, e: entries.map((e, i) => Object.assign({ id: "a00000000000000" + i, m: 1000 }, e)) });
}
async function parseFile(name, text) { return I.parse({ name, bytes: enc(text) }, NOW); }

// ---------- scrypt (RFC 7914 test vectors) ----------
test("scrypt matches RFC 7914", async () => {
  assert.equal(hex(await I.scrypt(enc(""), enc(""), 16, 1, 1, 64)),
    "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906");
  assert.equal(hex(await I.scrypt(enc("password"), enc("NaCl"), 1024, 8, 16, 64)),
    "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640");
  assert.equal(hex(await I.scrypt(enc("pw"), enc("salt"), 2048, 8, 1, 32)),
    crypto.scryptSync("pw", "salt", 32, { N: 2048, r: 8, p: 1 }).toString("hex"));
});

// ---------- Bitwarden "password protected" ----------
const BW_PLAIN = {
  encrypted: false,
  folders: [{ id: "f1", name: "Work" }],
  items: [
    { id: "b1", type: 1, name: "GitLab", folderId: "f1", notes: "n", favorite: true,
      login: { username: "me", password: "pw-gl", totp: SECRET, uris: [{ uri: "https://gitlab.com" }] } },
    { id: "b2", type: 2, name: "Note", notes: "secret note", secureNote: { type: 0 } }
  ]
};
function bwEnc(text, encKey, macKey) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-cbc", encKey, iv);
  const ct = Buffer.concat([c.update(Buffer.from(text, "utf8")), c.final()]);
  const mac = crypto.createHmac("sha256", macKey).update(Buffer.concat([iv, ct])).digest();
  return "2." + iv.toString("base64") + "|" + ct.toString("base64") + "|" + mac.toString("base64");
}
async function bwFile(password, kdf) {
  const salt = crypto.randomBytes(16).toString("base64");
  let key;
  if (kdf.kdfType === 0) key = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), Buffer.from(salt, "utf8"), kdf.kdfIterations, 32, "sha256");
  else key = Buffer.from(await argon.argon2id({ password, salt: crypto.createHash("sha256").update(salt, "utf8").digest(),
    iterations: kdf.kdfIterations, parallelism: kdf.kdfParallelism, memorySize: kdf.kdfMemory * 1024, hashLength: 32, outputType: "binary" }));
  // HKDF-Expand (no extract), as Bitwarden's stretchKey
  const encKey = expand(key, "enc");
  const macKey = expand(key, "mac");
  return JSON.stringify(Object.assign({ encrypted: true, passwordProtected: true, salt }, kdf, {
    encKeyValidation_DO_NOT_EDIT: bwEnc(crypto.randomUUID(), encKey, macKey),
    data: bwEnc(JSON.stringify(BW_PLAIN), encKey, macKey)
  }));
}
function expand(prk, info) {
  return crypto.createHmac("sha256", prk).update(Buffer.concat([Buffer.from(info), Buffer.from([1])])).digest();
}

test("Bitwarden password protected (PBKDF2) opens with its password", async () => {
  const text = await bwFile("correct horse", { kdfType: 0, kdfIterations: 5000, kdfMemory: null, kdfParallelism: null });
  const locked = await parseFile("bitwarden_encrypted_export.json", text);
  assert.equal(locked.locked, "bitwarden");
  await assert.rejects(I.unlock(locked, "wrong", NOW), { message: "wrong-password" });
  await assert.rejects(I.unlock(locked, "", NOW), { message: "no-key" });
  const r = await I.unlock(locked, "correct horse", NOW);
  assert.equal(r.source, "bitwarden");
  assert.equal(r.plain, false);
  assert.equal(r.entries.length, 2);
  const gl = r.entries.find((e) => e.title === "GitLab");
  assert.equal(gl.pw, "pw-gl");
  assert.equal(gl.user, "me");
  assert.deepEqual(gl.tags, ["Work"]);
  // into the vault, then again: nothing new
  const a = I.apply(vault([]), r, { now: NOW });
  assert.equal(a.added, 2);
  assert.equal(I.apply(a.snap, await I.unlock(locked, "correct horse", NOW), { now: NOW }).added, 0);
});

test("Bitwarden password protected (Argon2id) opens with its password", async () => {
  const text = await bwFile("pässwörd", { kdfType: 1, kdfIterations: 2, kdfMemory: 16, kdfParallelism: 1 });
  const r = await I.unlock(I.parseText(text, "x.json", NOW), "pässwörd", NOW);
  assert.equal(r.entries.length, 2);
});

test("Bitwarden: KDF settings out of bounds and account-restricted exports are refused", async () => {
  const j = JSON.parse(await bwFile("pw", { kdfType: 0, kdfIterations: 5000 }));
  for (const bad of [{ kdfIterations: 1000 }, { kdfIterations: 5e7 }, { kdfType: 1, kdfIterations: 3, kdfMemory: 4096, kdfParallelism: 1 },
                     { kdfType: 1, kdfIterations: 3, kdfMemory: 64, kdfParallelism: 64 }, { kdfType: 7 }]) {
    const locked = I.parseText(JSON.stringify(Object.assign({}, j, bad)), "", NOW);
    await assert.rejects(I.unlock(locked, "pw", NOW), { message: "kdf-params" });
  }
  // the encrypted kind tied to an account cannot be opened anywhere else
  const acct = I.parseText(JSON.stringify({ encrypted: true, encKeyValidation_DO_NOT_EDIT: "2.a|b|c", folders: [], items: [] }), "", NOW);
  assert.equal(acct.error, "encrypted");
  // a tampered file fails its MAC
  const t = Object.assign({}, j, { data: j.data.replace(/\|([^|]{4})/, "|AAAA") });
  await assert.rejects(I.unlock(I.parseText(JSON.stringify(t), "", NOW), "pw", NOW));
});

// ---------- Aegis encrypted ----------
const AEGIS_DB = { version: 2, entries: [
  { type: "totp", uuid: "u1", name: "me@example.org", issuer: "GitHub", note: "", info: { secret: SECRET, algo: "SHA1", digits: 6, period: 30 } },
  { type: "hotp", uuid: "u2", name: "x", issuer: "Y", info: { secret: SECRET, algo: "SHA1", digits: 6, counter: 1 } }
], groups: [] };
function gcm(key, plain) {
  const nonce = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { nonce, ct, tag: c.getAuthTag() };
}
function aegisFile(password, N) {
  const master = crypto.randomBytes(32), salt = crypto.randomBytes(32);
  const dk = crypto.scryptSync(Buffer.from(password, "utf8"), salt, 32, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  const k = gcm(dk, master), d = gcm(master, Buffer.from(JSON.stringify(AEGIS_DB), "utf8"));
  return JSON.stringify({ version: 1, header: {
    slots: [{ type: 2, uuid: "bio", key: "00", key_params: { nonce: "00", tag: "00" } },
            { type: 1, uuid: "s1", key: hex(k.ct), key_params: { nonce: hex(k.nonce), tag: hex(k.tag) }, n: N, r: 8, p: 1, salt: hex(salt), repaired: true }],
    params: { nonce: hex(d.nonce), tag: hex(d.tag) } }, db: d.ct.toString("base64") });
}

test("Aegis encrypted vault opens with its password (scrypt + AES-GCM)", async () => {
  const locked = await parseFile("aegis-backup.json", aegisFile("test", 1024));
  assert.equal(locked.locked, "aegis");
  await assert.rejects(I.unlock(locked, "nope", NOW), { message: "wrong-password" });
  const r = await I.unlock(locked, "test", NOW);
  assert.equal(r.source, "aegis");
  assert.equal(r.plain, false);
  assert.equal(r.codes.length, 1);
  assert.equal(r.unsupported, 1);
  assert.equal(r.codes[0].issuer, "GitHub");
  assert.equal(r.codes[0].secret, SECRET);
});

test("Aegis: scrypt settings that need too much memory are refused before deriving", async () => {
  const j = JSON.parse(aegisFile("test", 1024));
  for (const bad of [{ n: 1 << 22 }, { n: 1000 }, { r: 64 }, { p: 0 }]) {
    const k = JSON.parse(JSON.stringify(j));
    Object.assign(k.header.slots[1], bad);
    await assert.rejects(I.unlock(I.parseText(JSON.stringify(k), "", NOW), "test", NOW), { message: "kdf-params" });
  }
  // only a biometric slot: cannot be opened here
  const bio = JSON.parse(JSON.stringify(j));
  bio.header.slots = [bio.header.slots[0]];
  assert.equal(I.parseText(JSON.stringify(bio), "", NOW).error, "encrypted-aegis");
});

// ---------- 2FAS with a password ----------
function twofasFile(password, services) {
  const salt = crypto.randomBytes(256), key = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, 10000, 32, "sha256");
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(services), "utf8")), c.final(), c.getAuthTag()]);
  return JSON.stringify({ services: [], groups: [{ id: "g1", name: "Work" }], schemaVersion: 4, appOrigin: "android",
    servicesEncrypted: ct.toString("base64") + ":" + salt.toString("base64") + ":" + iv.toString("base64") });
}

test("2FAS backup with a password opens with it (PBKDF2 + AES-GCM)", async () => {
  const text = twofasFile("1234", [
    { name: "Proton", secret: SECRET, groupId: "g1", otp: { account: "me@proton.me", issuer: "Proton", digits: 6, period: 30, algorithm: "SHA1", tokenType: "TOTP" } },
    { name: "Steam", secret: SECRET, otp: { tokenType: "STEAM" } }
  ]);
  const locked = await parseFile("2fas-backup.2fas", text);
  assert.equal(locked.locked, "2fas");
  await assert.rejects(I.unlock(locked, "4321", NOW), { message: "wrong-password" });
  const r = await I.unlock(locked, "1234", NOW);
  assert.equal(r.source, "2fas");
  assert.equal(r.codes.length, 1);
  assert.equal(r.unsupported, 1);
  assert.deepEqual(r.codes[0].tags, ["Work"]);
  const a = I.apply(vault([{ title: "Proton", user: "me@proton.me", pw: "x", urls: ["https://proton.me"] }]), r, { now: NOW });
  assert.equal(a.attached, 1);
});

// ---------- Keeper ----------
test("Keeper CSV without a header, with custom fields and its 2FA field", async () => {
  const csv = [
    'Social,Facebook,me@example.org,pw-fb,https://facebook.com,"two\nlines",,Recovery,abc,TFC:Keeper,otpauth://totp/Facebook:me?secret=' + SECRET,
    'Work\\Infra,Server,root,pw-root,ssh://10.0.0.1,,Team,,',
    ",Wifi code,,,,the wifi is xyz,"
  ].join("\n");
  const r = await parseFile("keeper.csv", csv);
  assert.equal(r.source, "keeper");
  assert.equal(r.entries.length, 3);
  const fb = r.entries.find((e) => e.title === "Facebook");
  assert.equal(fb.user, "me@example.org");
  assert.equal(fb.pw, "pw-fb");
  assert.equal(fb.notes, "two\nlines");
  assert.match(fb.totp, /^otpauth:/);
  assert.deepEqual(fb.fields.map((f) => [f.n, f.v]), [["Recovery", "abc"]]);
  assert.deepEqual(r.entries.find((e) => e.title === "Server").tags.sort(), ["Team", "Work/Infra"]);
  assert.equal(r.types.note, 1);
  // the same rows under another file name are still recognised
  assert.equal((await parseFile("export.csv", csv)).source, "keeper");
});

test("Keeper JSON export", async () => {
  const j = { shared_folders: [], records: [
    { uid: "k1", title: "Bank", login: "me", password: "pw-bank", login_url: "https://bank.example", notes: "",
      custom_fields: { "TFC:Keeper": "otpauth://totp/Bank:me?secret=" + SECRET, PIN: "1234" }, folders: [{ shared_folder: "Family", folder: "Money" }] },
    { uid: "k2", title: "Secret", notes: "only text", $type: "encryptedNotes" }
  ] };
  const r = await parseFile("keeper.json", JSON.stringify(j));
  assert.equal(r.source, "keeper");
  const b = r.entries.find((e) => e.title === "Bank");
  assert.match(b.totp, /^otpauth:/);
  assert.deepEqual(b.tags, ["Family/Money"]);
  assert.deepEqual(b.fields, [{ h: 1, n: "PIN", v: "1234" }]);
  assert.equal(r.types.note, 1);
});

// ---------- RoboForm, Zoho Vault ----------
test("RoboForm CSV", async () => {
  const csv = "Name,Url,MatchUrl,Login,Pwd,Note,Folder,RfFieldsV2\n" +
    "Amazon,https://www.amazon.com/,https://www.amazon.com/,me@x.org,pw-amz,,/Shopping,\n" +
    "Safe note,,,,,the note text,/Notes,\n";
  const r = await parseFile("RoboForm Export.csv", csv);
  assert.equal(r.source, "roboform");
  const a = r.entries.find((e) => e.title === "Amazon");
  assert.equal(a.pw, "pw-amz");
  assert.equal(a.user, "me@x.org");
  assert.deepEqual(a.tags, ["Shopping"]);
  assert.equal(r.types.note, 1);
});

test("Zoho Vault CSV (login in SecretData lines)", async () => {
  const csv = "Password Name,Password URL,Description,Notes,Favorite,Tags,SecretData,CustomData,ChamberName\n" +
    '"Mail","https://mail.example","","note 1","1","a,b","SecretType:Web Account\nUser Name:me@mail\nPassword:pw-mail\nRecovery code:rc-9","","Personal"\n';
  const r = await parseFile("zoho.csv", csv);
  assert.equal(r.source, "zoho");
  const m = r.entries[0];
  assert.equal(m.user, "me@mail");
  assert.equal(m.pw, "pw-mail");
  assert.equal(m.fav, 1);
  assert.deepEqual(m.tags.sort(), ["Personal", "a", "b"]);
  assert.deepEqual(m.fields.map((f) => [f.n, f.v, f.h]), [["Recovery code", "rc-9", 0]]);
});

// ---------- KeePass 2 XML ----------
const KP_XML = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<KeePassFile><Meta><DatabaseName>Mine</DatabaseName><RecycleBinEnabled>True</RecycleBinEnabled><RecycleBinUUID>cmVjeWNsZWJpbnV1aWQxMg==</RecycleBinUUID></Meta>
<Root><Group><UUID>cm9vdHJvb3Ryb290cm9vdA==</UUID><Name>Mine</Name>
 <Entry><UUID>ZW50cnkxZW50cnkxZW50cg==</UUID>
  <String><Key>Title</Key><Value>Router &amp; Co</Value></String>
  <String><Key>UserName</Key><Value>admin</Value></String>
  <String><Key>Password</Key><Value ProtectInMemory="True">pw-router</Value></String>
  <String><Key>URL</Key><Value>http://192.168.1.1</Value></String>
  <String><Key>PIN</Key><Value ProtectInMemory="True">9999</Value></String>
 </Entry>
 <Group><UUID>c3ViZ3JvdXBzdWJncm91cA==</UUID><Name>Email</Name>
  <Entry><UUID>ZW50cnkyZW50cnkyZW50cg==</UUID><String><Key>Title</Key><Value>Mail</Value></String><String><Key>Password</Key><Value>pw-mail</Value></String></Entry>
 </Group>
 <Group><UUID>cmVjeWNsZWJpbnV1aWQxMg==</UUID><Name>Recycle Bin</Name>
  <Entry><UUID>ZW50cnkzZW50cnkzZW50cg==</UUID><String><Key>Title</Key><Value>Old</Value></String></Entry>
 </Group>
</Group></Root></KeePassFile>`;

test("KeePass 2 XML export", async () => {
  const r = await parseFile("Database.xml", KP_XML);
  assert.equal(r.source, "keepassxml");
  assert.equal(r.plain, true);
  assert.equal(r.entries.length, 2);
  assert.equal(r.recycled, 1);
  const rt = r.entries.find((e) => e.title === "Router & Co");
  assert.equal(rt.pw, "pw-router");
  assert.deepEqual(rt.fields, [{ h: 1, n: "PIN", v: "9999" }]);
  assert.deepEqual(r.entries.find((e) => e.title === "Mail").tags, ["Email"]);
  // a value still protected by the inner stream means a damaged file
  assert.equal(I.parseText(KP_XML.replace('<Value ProtectInMemory="True">pw-router', '<Value Protected="True">cHc='), "", NOW).error, "bad-file");
  // other XML is not a known export
  assert.equal(I.parseText("<?xml version=\"1.0\"?><rss><channel/></rss>", "", NOW).error, "format");
});

// ---------- the earlier sources still go where they did ----------
test("plain CSV of Chrome is still read by the generic mapper", async () => {
  const r = await parseFile("Chrome Passwords.csv", "name,url,username,password,note\nsite,https://a.example,u,p,\n");
  assert.equal(r.source, "chrome");
  assert.equal(r.entries.length, 1);
});
