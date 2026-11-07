// Passwords: two-factor codes from more authenticator apps (PW-OTP3).
// Proton Authenticator (plain and with a password), Ente Auth (plain
// text and encrypted), a file of otpauth:// links, andOTP (plain, new and
// old encrypted format), FreeOTP+, Stratum / Authenticator Pro (plain,
// encrypted and legacy encrypted), LastPass Authenticator, Bitwarden
// Authenticator, and Steam Guard codes everywhere. Encrypted fixtures
// are built here with Node's own crypto following each app's published
// reader (Aegis' importers), so our readers are checked against an
// independent implementation; the Ente file in tests/fixtures/passwords
// was written by libsodium itself (crypto_pwhash + secretstream).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PC = require(path.join(ROOT, "passwords/pmcore.js"));
const I = require(path.join(ROOT, "passwords/import.js"));
const OX = require(path.join(ROOT, "passwords/otpexport.js"));
const K = require(path.join(ROOT, "passwords/pmkinds.js"));
const A = require(path.join(ROOT, "passwords/afindex.js"));
const OLD = require(path.join(ROOT, "tests/fixtures/pmcore-4.96.00.js"));
const argon = require(path.join(ROOT, "vendor/hash-wasm/argon2.umd.min.js"));

const enc = (s) => new TextEncoder().encode(s);
const NOW = Date.UTC(2026, 10, 6);
const S1 = "4SJHB4GSD43FZBAI7C2HLRJGPQ";
const S2 = "5OM4WOOGPLQEF6UGN3CPEOOLWU";
const S3 = "JRZCL47CMXVOQMNPZR2F7J4RGI";
function b32(s) {
  const A32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", out = [];
  let buf = 0, bits = 0;
  for (const c of s) { buf = (buf << 5) | A32.indexOf(c); bits += 5; if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); } buf &= (1 << bits) - 1; }
  return Buffer.from(out);
}
const parseFile = (name, data) => I.parse({ name, bytes: typeof data === "string" ? enc(data) : new Uint8Array(data) }, NOW);
const gcm = (key, iv, plain, aad) => {
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (aad) c.setAAD(aad);
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
};
const vault = (entries) => PC.normSnap({ v: 1, d: {}, e: entries.map((e, i) => Object.assign({ id: "b00000000000000" + i, m: 1000 }, e)) });

// Steam Guard reference (independent: Node's HMAC, the published rule:
// RFC 4226 dynamic truncation, then 5 characters of this alphabet).
function steamRef(secretB32, t) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(t / 30)));
  const h = crypto.createHmac("sha1", b32(secretB32)).update(msg).digest();
  const off = h[19] & 15;
  let bin = h.readUInt32BE(off) & 0x7fffffff, out = "";
  for (let i = 0; i < 5; i++) { out += "23456789BCDFGHJKMNPQRTVWXY"[bin % 26]; bin = Math.floor(bin / 26); }
  return out;
}

test("Steam Guard: every input form, codes match the reference, older builds show none", async () => {
  const forms = ["steam://" + S3, "otpauth://steam/Steam:gamer?secret=" + S3 + "&issuer=Steam",
                 "otpauth://totp/Steam:gamer?secret=" + S3 + "&digits=5&encoder=steam&issuer=Steam"];
  for (const f of forms) {
    const o = PC.parseOtp(f);
    assert.equal(o.error, undefined, f);
    assert.equal(o.steam, true); assert.equal(o.digits, 5); assert.equal(o.period, 30);
    for (const t of [59, 1111111109, 1234567890, 2000000000]) {
      const r = await PC.totp(o, t * 1000);
      assert.equal(r.code, steamRef(S3, t));
      assert.match(r.code, /^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
    }
  }
  // what orOS stores: a 4.96.00 parser refuses it (no wrong code shown)
  assert.equal(OLD.parseOtp(forms[2]).error, "digits");
  // ordinary TOTP unchanged
  const n = PC.parseOtp("otpauth://totp/x?secret=" + S1);
  assert.ok(!n.steam); assert.equal((await PC.totp(n, 59000)).code.length, 6);
});

test("Proton Authenticator: plain .json and the password-protected export", async () => {
  const plain = { version: 1, entries: [
    { id: "a", content: { uri: "otpauth://totp/Deno:Mason?secret=" + S1 + "&issuer=Deno&algorithm=SHA1&digits=6&period=30", entry_type: "Totp", name: "Mason" }, note: null },
    { id: "b", content: { uri: "otpauth://totp/SPDX:James?secret=" + S2 + "&issuer=SPDX&algorithm=SHA256&digits=7&period=20", entry_type: "Totp", name: "James" }, note: "work" },
    { id: "c", content: { uri: "steam://" + S3, entry_type: "Steam", name: "gamer" }, note: null },
    { id: "d", content: { uri: "otpauth://hotp/H:h?secret=" + S1 + "&counter=1", entry_type: "Hotp", name: "h" } }
  ] };
  const r = await parseFile("Proton_Authenticator_backup.json", JSON.stringify(plain));
  assert.equal(r.source, "protonauth");
  assert.equal(r.codes.length, 3); assert.equal(r.unsupported, 1);
  assert.equal(r.codes[1].notes, "work");
  assert.equal(r.codes[1].uri, "otpauth://totp/SPDX:James?secret=" + S2 + "&issuer=SPDX&algorithm=SHA256&digits=7&period=20");
  assert.equal(r.codes[2].issuer, "Steam"); assert.equal(r.codes[2].account, "gamer");
  assert.match(r.codes[2].uri, /encoder=steam/);
  assert.equal(r.plain, true);
  // encrypted: Argon2id t 2, 19 MiB, p 1 → AES-256-GCM, nonce first, fixed AAD
  const salt = crypto.randomBytes(16), nonce = crypto.randomBytes(12);
  const key = Buffer.from(await argon.argon2id({ password: enc("test pw"), salt, iterations: 2, parallelism: 1, memorySize: 19 * 1024, hashLength: 32, outputType: "binary" }));
  const content = Buffer.concat([nonce, gcm(key, nonce, Buffer.from(JSON.stringify(plain)), Buffer.from("proton.authenticator.export.v1"))]);
  const file = JSON.stringify({ version: 1, salt: salt.toString("base64"), content: content.toString("base64") });
  const locked = await parseFile("proton.json", file);
  assert.equal(locked.locked, "protonauth");
  await assert.rejects(I.unlock(locked, "wrong", NOW), { message: "wrong-password" });
  const u = await I.unlock(locked, "test pw", NOW);
  assert.equal(u.codes.length, 3); assert.equal(u.plain, false);
});

test("Ente Auth: plain text export and the encrypted export (libsodium secretstream)", async () => {
  const cd = encodeURIComponent(JSON.stringify({ pinned: false, trashed: false, tags: ["Work"] }));
  const gone = encodeURIComponent(JSON.stringify({ trashed: true }));
  const txt = ["otpauth://totp/Airbnb:Elijah?secret=" + S1 + "&issuer=Airbnb&algorithm=SHA512&digits=8&period=50&codeDisplay=" + cd,
               "otpauth://hotp/Air%20Canada:Ben?secret=" + S2 + "&issuer=Air+Canada&counter=50",
               "otpauth://steam/Boeing:Sophia?secret=" + S3 + "&issuer=Boeing&algorithm=SHA1&digits=5&period=30",
               "otpauth://totp/Old:x?secret=" + S2 + "&issuer=Old&codeDisplay=" + gone, ""].join("\n");
  const r = await parseFile("ente-auth-codes-2026-11-06.txt", txt);
  assert.equal(r.source, "ente");
  assert.equal(r.codes.length, 2); assert.equal(r.unsupported, 1); assert.equal(r.trashed, 1);
  assert.deepEqual(r.codes[0].tags, ["Work"]);
  assert.equal(r.codes[0].uri, "otpauth://totp/Airbnb:Elijah?secret=" + S1 + "&issuer=Airbnb&algorithm=SHA512&digits=8&period=50");
  assert.equal(r.codes[1].uri, "otpauth://totp/Boeing:Sophia?secret=" + S3 + "&issuer=Boeing&digits=5&encoder=steam");
  // the encrypted file, written by libsodium (password "correct horse")
  const file = fs.readFileSync(path.join(ROOT, "tests/fixtures/passwords/ente-auth-encrypted.json"));
  const locked = await parseFile("ente-auth-codes-encrypted.txt", file);
  assert.equal(locked.locked, "ente");
  await assert.rejects(I.unlock(locked, "wrong horse", NOW), { message: "wrong-password" });
  const u = await I.unlock(locked, "correct horse", NOW);
  assert.equal(u.codes.length, 2); assert.equal(u.unsupported, 1);
  assert.equal(u.codes[0].issuer, "Deno"); assert.match(u.codes[1].uri, /encoder=steam/);
  // KDF settings are bounded before anything is derived
  const big = JSON.parse(file); big.kdfParams.memLimit = 4 * 1024 * 1024 * 1024;
  await assert.rejects(I.unlock(I.parseText(JSON.stringify(big)), "x", NOW), { message: "kdf-params" });
});

test("A file of otpauth:// links (one per line or comma separated); one link stays one link", () => {
  const r = I.parseText("otpauth://totp/A:a?secret=" + S1 + "&issuer=A, otpauth://totp/B:b?secret=" + S2 + "\r\nnot a link\n", "links.txt", NOW);
  assert.equal(r.source, "otplist");
  assert.equal(r.codes.length, 2); assert.equal(r.skipped, 1);
  assert.equal(I.parseText("otpauth://totp/A:a?secret=" + S1).source, "otpauth");
  assert.equal(I.parseText("otpauth://hotp/A:a?secret=" + S1 + "&counter=1").error, "hotp");
  assert.equal(I.parseText("steam://" + S3).codes[0].issuer, "Steam");
});

test("andOTP: plain .json, encrypted .json.aes (PBKDF2-SHA1 + AES-GCM) and the old format", async () => {
  const list = [
    { secret: S1 + "======", issuer: "Deno", label: "Mason", digits: 6, type: "TOTP", algorithm: "SHA1", period: 30, tags: ["Dev"] },
    { secret: S2, label: "SPDX - James", digits: 7, type: "TOTP", algorithm: "SHA256", period: 20, tags: [] },
    { secret: S3, issuer: "Boeing", label: "Sophia", digits: 5, type: "STEAM", algorithm: "SHA1", period: 30 },
    { secret: S1, issuer: "H", label: "h", digits: 6, type: "HOTP", algorithm: "SHA1", counter: 3 }
  ];
  const r = I.parseText(JSON.stringify(list), "otp_accounts.json", NOW);
  assert.equal(r.source, "andotp");
  assert.equal(r.codes.length, 3); assert.equal(r.unsupported, 1);
  assert.equal(r.codes[1].issuer, "SPDX"); assert.equal(r.codes[1].account, "James");
  assert.deepEqual(r.codes[0].tags, ["Dev"]);
  assert.match(r.codes[2].uri, /encoder=steam/);
  // new format
  const iter = 140000, salt = crypto.randomBytes(12), nonce = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync("test", salt, iter, 32, "sha1");
  const head = Buffer.alloc(4); head.writeUInt32BE(iter);
  const file = Buffer.concat([head, salt, nonce, gcm(key, nonce, Buffer.from(JSON.stringify(list)))]);
  const locked = await parseFile("otp_accounts_2026-11-06_12-00-00.json.aes", file);
  assert.equal(locked.locked, "andotp");
  await assert.rejects(I.unlock(locked, "nope", NOW), { message: "wrong-password" });
  const u = await I.unlock(await parseFile("otp_accounts.json.aes", file), "test", NOW);
  assert.equal(u.codes.length, 3);
  // old format: SHA-256(password) as the key, nonce first
  const okey = crypto.createHash("sha256").update("test").digest(), on = crypto.randomBytes(12);
  const old = Buffer.concat([on, gcm(okey, on, Buffer.from(JSON.stringify(list)))]);
  const u2 = await I.unlock(await parseFile("otp_accounts.json.aes", old), "test", NOW);
  assert.equal(u2.codes.length, 3);
  // an old-format nonce may start with "{" or "[": still a locked file
  for (const first of [0x7b, 0x5b]) {
    const n2 = crypto.randomBytes(12); n2[0] = first;
    const f2 = Buffer.concat([n2, gcm(okey, n2, Buffer.from(JSON.stringify(list)))]);
    const l2 = await parseFile("otp_accounts.json.aes", f2);
    assert.equal(l2.locked, "andotp");
    assert.equal((await I.unlock(l2, "test", NOW)).codes.length, 3);
  }
});

test("FreeOTP+ .json (secret as signed bytes)", () => {
  const signed = (s) => Array.from(b32(s)).map((n) => (n > 127 ? n - 256 : n));
  const j = { tokenOrder: ["Deno:Mason"], tokens: [
    { algo: "SHA1", digits: 6, issuerExt: "Deno", issuerInt: "Deno", label: "Mason", period: 30, secret: signed(S1), type: "TOTP" },
    { algo: "SHA512", counter: 10, digits: 8, issuerExt: "WWE", label: "x", period: 30, secret: signed(S2), type: "HOTP" }
  ] };
  const r = I.parseText(JSON.stringify(j), "freeotp-backup.json", NOW);
  assert.equal(r.source, "freeotp");
  assert.equal(r.codes.length, 1); assert.equal(r.unsupported, 1);
  assert.equal(r.codes[0].secret, S1);
});

function stratumJson() {
  return { Authenticators: [
    { Type: 2, Icon: "deno", Issuer: "Deno", Username: "Mason", Secret: S1, Pin: null, Algorithm: 0, Digits: 6, Period: 30, Counter: 0 },
    { Type: 2, Issuer: "SPDX", Username: null, Secret: S2, Algorithm: 1, Digits: 7, Period: 20, Counter: 0 },
    { Type: 4, Issuer: "Steam", Username: "gamer", Secret: S3, Algorithm: 0, Digits: 5, Period: 30, Counter: 0 },
    { Type: 1, Issuer: "H", Username: "h", Secret: S1, Algorithm: 0, Digits: 6, Period: 30, Counter: 4 }
  ], Categories: [{ Id: "c1", Name: "Work" }], AuthenticatorCategories: [{ CategoryId: "c1", AuthenticatorSecret: S1 }] };
}
test("Stratum / Authenticator Pro: plain, encrypted (Argon2id + AES-GCM) and legacy (PBKDF2 + AES-CBC)", async () => {
  const r = I.parseText(JSON.stringify(stratumJson()), "backup.json", NOW);
  assert.equal(r.source, "stratum");
  assert.equal(r.codes.length, 3); assert.equal(r.unsupported, 1);
  assert.deepEqual(r.codes[0].tags, ["Work"]);
  assert.equal(r.codes[1].uri, "otpauth://totp/SPDX:?secret=" + S2 + "&issuer=SPDX&algorithm=SHA256&digits=7&period=20");
  assert.match(r.codes[2].uri, /encoder=steam/);
  const plain = Buffer.from(JSON.stringify(stratumJson()));
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = Buffer.from(await argon.argon2id({ password: enc("test"), salt, iterations: 3, parallelism: 4, memorySize: 64 * 1024, hashLength: 32, outputType: "binary" }));
  const file = Buffer.concat([Buffer.from("AUTHENTICATORPRO"), salt, iv, gcm(key, iv, plain)]);
  const locked = await parseFile("stratum-backup.authpro", file);
  assert.equal(locked.locked, "stratum");
  await assert.rejects(I.unlock(locked, "no", NOW), { message: "wrong-password" });
  assert.equal((await I.unlock(await parseFile("x.authpro", file), "test", NOW)).codes.length, 3);
  const lsalt = crypto.randomBytes(20), liv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-cbc", crypto.pbkdf2Sync("test", lsalt, 64000, 32, "sha1"), liv);
  const legacy = Buffer.concat([Buffer.from("AuthenticatorPro"), lsalt, liv, c.update(plain), c.final()]);
  const lk = await parseFile("old.authpro", legacy);
  assert.equal(lk.locked, "stratum");
  await assert.rejects(I.unlock(lk, "no", NOW), { message: "wrong-password" });
  assert.equal((await I.unlock(await parseFile("old.authpro", legacy), "test", NOW)).codes.length, 3);
});

test("LastPass Authenticator export .json (not 1Password)", () => {
  const j = { deviceId: "d", version: 3, localDeviceId: "l", accounts: [
    { accountID: "1", issuerName: "GitHub", originalIssuerName: "GitHub", userName: "ann", originalUserName: "ann", pushNotification: false,
      secret: S1, timeStep: 30, digits: 6, creationTimestamp: 1, isFavorite: false, algorithm: "SHA1", folderData: { folderId: 2, position: 0 } },
    { accountID: "2", issuerName: "Bank", userName: "b", secret: S2, timeStep: 60, digits: 8, algorithm: "SHA256", folderData: { folderId: 0, position: 1 } }
  ], folders: [{ id: 0, name: "Other Accounts", isOpened: true }, { id: 2, name: "Work", isOpened: true }] };
  const r = I.parseText(JSON.stringify(j), "lastpass-authenticator.json", NOW);
  assert.equal(r.source, "lastpassauth");
  assert.equal(r.codes.length, 2);
  assert.deepEqual(r.codes[0].tags, ["Work"]); assert.deepEqual(r.codes[1].tags, []);
  assert.equal(r.codes[1].uri, "otpauth://totp/Bank:b?secret=" + S2 + "&issuer=Bank&algorithm=SHA256&digits=8&period=60");
});

test("Bitwarden Authenticator: code-only items become codes; a real login keeps its code", () => {
  const j = { encrypted: false, items: [
    { id: "1", type: 1, name: "Deno", login: { username: "Mason", password: null, uris: null, totp: "otpauth://totp/Deno:Mason?secret=" + S1 + "&issuer=Deno" } },
    { id: "2", type: 1, name: "Steam", login: { totp: "steam://" + S3 } },
    { id: "3", type: 1, name: "Mail", login: { username: "me", password: "pw", totp: S2 } }
  ] };
  const r = I.parseText(JSON.stringify(j), "bitwarden_export.json", NOW);
  assert.equal(r.source, "bitwarden");
  assert.equal(r.codes.length, 2); assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].totp, S2);
  const csv = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n" +
              ",,login,Deno,,,0,,Mason,,otpauth://totp/Deno:Mason?secret=" + S1 + "&issuer=Deno\n";
  const c = I.parseText(csv, "bitwarden_export.csv", NOW);
  assert.equal(c.codes.length, 1); assert.equal(c.entries.length, 0);
});

test("Steam codes: into the vault, out to Aegis / 2FAS, never into the phone's fill index", async () => {
  const r = I.parseText("steam://" + S3, "", NOW);
  const a = I.apply(vault([]), r, { now: NOW });
  assert.equal(a.codesNew, 1);
  const e = a.snap.e[0];
  assert.equal(K.kindOf(e), "otp");
  const list = OX.codes(a.snap.e);
  assert.equal(list[0].steam, true);
  assert.match(list[0].uri, /&digits=5&encoder=steam$/);
  const twofas = JSON.parse(OX.to2fas(a.snap.e, NOW));
  assert.equal(twofas.services[0].otp.tokenType, "STEAM");
  const back = I.parseText(JSON.stringify(twofas), "x.2fas", NOW);
  assert.equal(back.codes[0].uri, list[0].uri);
  const aegis = await OX.toAegis(a.snap.e, "12345678", { scrypt: I.scrypt });
  const ab = await I.unlock(I.parseText(aegis), "12345678", NOW);
  assert.equal(ab.codes[0].uri, list[0].uri);
  const idx = A.lists(a.snap.e, K, PC);
  assert.equal(idx.index.length, 0);   // a code-only Steam entry has nothing the phone can fill
});

test("Nothing is executed or evaluated: hostile names stay text, huge KDF settings are refused", async () => {
  const j = { version: 1, entries: [{ content: { uri: "otpauth://totp/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E:a?secret=" + S1, name: "<script>x</script>" } }] };
  const r = I.parseText(JSON.stringify(j), "p.json", NOW);
  assert.equal(r.codes[0].issuer, "<img src=x onerror=alert(1)>");   // plain text; the app shows it with textContent
  const src = fs.readFileSync(path.join(ROOT, "passwords/import.js"), "utf8");
  assert.doesNotMatch(src, /\beval\s*\(|new Function|innerHTML|console\./);
  const ente = { version: 1, kdfParams: { memLimit: 1024, opsLimit: 1, salt: "AAAAAAAAAAAAAAAAAAAAAA==" }, encryptedData: "AA==", encryptionNonce: "AA==" };
  await assert.rejects(I.unlock(I.parseText(JSON.stringify(ente)), "x", NOW), { message: "kdf-params" });
});

test("An empty file (0 bytes) is told apart; the pasted text of an export reads like the file", async () => {
  assert.equal((await I.parse({ name: "proton_authenticator_backup.json", bytes: new Uint8Array(0) }, NOW)).error, "zero");
  const j = JSON.stringify({ version: 1, entries: [{ id: "x", content: { uri: "otpauth://totp/me%40mail.com?secret=" + S1, entry_type: "Totp", name: "me@mail.com" }, note: null }] });
  const r = I.parseText(j, "pasted", NOW);
  assert.equal(r.source, "protonauth"); assert.equal(r.codes.length, 1); assert.equal(r.codes[0].account, "me@mail.com");
  assert.equal(I.parseText(JSON.stringify({ version: 1, salt: "AAAA", content: "BBBB" }), "pasted", NOW).locked, "protonauth");
});
