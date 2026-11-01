// Passwords: TOTP (RFC 6238 vectors, otpauth URIs), Bitwarden JSON and
// CSV imports, Bitwarden export round trip, and the KeePass KDBX
// reader/writer (passwords/kdbx.js) against fixtures made by an
// independent implementation (kdbxweb 2.1.1, MIT: KDBX 3.1 with
// Salsa20, KDBX 4 with AES-KDF / Argon2d / Argon2id, AES / ChaCha20,
// a key file). Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const nodeCrypto = require("crypto");

const DIR = path.join(__dirname, "..", "passwords");
const PC = require(path.join(DIR, "pmcore.js"));
const K = require(path.join(DIR, "kdbx.js"));
const FX = path.join(__dirname, "fixtures", "passwords");
const PW = "orOS-test-1";

// ---------- TOTP ----------
test("TOTP: every RFC 6238 Appendix B test vector (SHA-1, SHA-256, SHA-512, 8 digits)", async () => {
  const keys = {
    "SHA-1": Buffer.from("12345678901234567890"),
    "SHA-256": Buffer.from("12345678901234567890123456789012"),
    "SHA-512": Buffer.from("1234567890123456789012345678901234567890123456789012345678901234")
  };
  const V = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"]
  ];
  for (const [t, s1, s256, s512] of V) {
    for (const [algo, want] of [["SHA-1", s1], ["SHA-256", s256], ["SHA-512", s512]]) {
      const r = await PC.totp({ secret: new Uint8Array(keys[algo]), algo, digits: 8, period: 30 }, t * 1000);
      assert.equal(r.code, want, `${algo} t=${t}`);
    }
  }
  const r = await PC.totp({ secret: new Uint8Array(keys["SHA-1"]), algo: "SHA-1", digits: 6, period: 30 }, 59000);
  assert.equal(r.code, "287082");
  assert.equal(r.left, 1);
});

test("TOTP: base32 and otpauth:// parsing; HOTP and bad values refused", () => {
  const b = PC.base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(Buffer.from(b).toString(), "12345678901234567890");
  assert.equal(PC.base32Encode(b), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(Buffer.from(PC.base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq")).toString(), "12345678901234567890");
  const o = PC.parseOtp("otpauth://totp/ACME%20Co:john%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60");
  assert.equal(o.issuer, "ACME Co");
  assert.equal(o.account, "john@example.com");
  assert.equal(o.algo, "SHA-256");
  assert.equal(o.digits, 8);
  assert.equal(o.period, 60);
  assert.equal(PC.parseOtp("JBSWY3DPEHPK3PXP").digits, 6);
  assert.equal(PC.parseOtp("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1").error, "hotp");
  assert.equal(PC.parseOtp("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5").error, "algo");
  assert.equal(PC.parseOtp("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=4").error, "digits");
  assert.equal(PC.parseOtp("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=5").error, "period");
  assert.equal(PC.parseOtp("not base32 !").error, "secret");
  assert.equal(PC.parseOtp("ABC").error, "secret");
  assert.equal(PC.parseOtp("").error, "empty");
});

// ---------- Bitwarden ----------
const BW = {
  encrypted: false,
  folders: [{ id: "f1", name: "Work" }],
  items: [
    { id: "i1", type: 1, name: "Git forge", notes: "2FA on", favorite: true, folderId: "f1",
      revisionDate: "2024-03-01T10:00:00.000Z", creationDate: "2023-01-01T00:00:00.000Z",
      fields: [{ name: "Recovery", value: "abc-def", type: 1 }, { name: "Team", value: "core", type: 0 },
               { name: "Linked", value: null, type: 3, linkedId: 100 }],
      login: { username: "maria", password: "S3cr3t!", totp: "otpauth://totp/forge:maria?secret=JBSWY3DPEHPK3PXP",
               uris: [{ match: null, uri: "https://git.example" }, { uri: "https://ssh.example" }] },
      passwordHistory: [{ lastUsedDate: "2024-01-01T00:00:00.000Z", password: "old1" }] },
    { id: "i2", type: 3, name: "My card", notes: null, folderId: null,
      card: { cardholderName: "M. P.", brand: "Visa", number: "4111111111111111", expMonth: "1", expYear: "2030", code: "123" } },
    { id: "i3", type: 4, name: "Passport", identity: { firstName: "Maria", lastName: "P", passportNumber: "AB123" } },
    { id: "i4", type: 2, name: "Wi-Fi", notes: "router pw: x", secureNote: { type: 0 } },
    { id: "i5", type: 1, name: "", login: {} }
  ]
};

test("Bitwarden JSON import: logins, folders, cards, identities, notes, hidden fields, history", () => {
  const r = PC.fromBitwarden(JSON.stringify(BW), 5e12);
  assert.equal(r.entries.length, 4);
  assert.equal(r.skipped, 1);
  const [git, card, id, note] = r.entries;
  assert.equal(git.title, "Git forge");
  assert.equal(git.user, "maria");
  assert.equal(git.pw, "S3cr3t!");
  assert.deepEqual(git.urls, ["https://git.example", "https://ssh.example"]);
  assert.deepEqual(git.tags, ["Work"]);
  assert.equal(git.fav, 1);
  assert.equal(git.m, Date.parse("2024-03-01T10:00:00.000Z"));
  assert.equal(git.c, Date.parse("2023-01-01T00:00:00.000Z"));
  assert.deepEqual(git.fields, [{ h: 1, n: "Recovery", v: "abc-def" }, { h: 0, n: "Team", v: "core" }]);
  assert.deepEqual(git.hist, [{ pw: "old1", t: Date.parse("2024-01-01T00:00:00.000Z") }]);
  assert.match(git.totp, /^otpauth:/);
  // cards, identities and notes become their own types (PW-K1)
  assert.deepEqual(card.fields.map((f) => [f.n, f.v, f.h]), [["oros:k", "card", 0], ["oros:cc.holder", "M. P.", 0],
    ["oros:cc.num", "4111111111111111", 1], ["oros:cc.exp", "01/2030", 0], ["oros:cc.cvv", "123", 1]]);
  assert.deepEqual(id.fields.map((f) => [f.n, f.v, f.h]), [["oros:k", "identity", 0], ["oros:id.first", "Maria", 0],
    ["oros:id.last", "P", 0], ["oros:id.pass", "AB123", 1]]);
  assert.equal(note.notes, "router pw: x");
  assert.deepEqual(note.fields, [{ h: 0, n: "oros:k", v: "note" }]);
  assert.equal(PC.fromBitwarden(JSON.stringify({ encrypted: true, items: [] })).error, "encrypted");
  assert.equal(PC.fromBitwarden("{nope").error, "json");
  assert.equal(PC.fromBitwarden("{}").error, "format");
});

test("Bitwarden export → import keeps every login value", () => {
  const src = PC.fromBitwarden(JSON.stringify(BW), 5e12).entries;
  const text = PC.toBitwarden(src);
  const j = JSON.parse(text);
  assert.equal(j.encrypted, false);
  assert.equal(j.folders.length, 1);
  const back = PC.fromBitwarden(text, 5e12).entries;
  const strip = (e) => { const c = Object.assign({}, e); delete c.id; return c; };
  assert.deepEqual(back.map(strip), src.map(strip));
});

test("CSV import: Bitwarden, Chrome, KeePassXC headers; quotes and newlines; dedupe", () => {
  const bw = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n" +
             "Work,1,login,Forge,\"multi\nline, \"\"quoted\"\"\",,0,https://git.example,maria,\"p,w\"\"1\",JBSWY3DPEHPK3PXP\n";
  const a = PC.fromCsv(bw, 5e12);
  assert.equal(a.entries.length, 1);
  const e = a.entries[0];
  assert.equal(e.title, "Forge");
  assert.equal(e.pw, 'p,w"1');
  assert.equal(e.notes, 'multi\nline, "quoted"');
  assert.deepEqual(e.tags, ["Work"]);
  assert.equal(e.fav, 1);
  assert.equal(e.totp, "JBSWY3DPEHPK3PXP");
  const chrome = "name,url,username,password,note\r\nexample.com,https://example.com/,bob,pw1,\r\n,https://x.org/a,al,pw2,n\r\n";
  const c = PC.fromCsv(chrome, 5e12);
  assert.deepEqual(c.entries.map((x) => [x.title, x.user, x.pw]), [["example.com", "bob", "pw1"], ["x.org", "al", "pw2"]]);
  const kpx = '"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"\n' +
              '"Root/Mail","Inbox","u","p","https://m.example","","","0","2024-02-03T04:05:06Z","2024-01-01T00:00:00Z"\n';
  const k = PC.fromCsv(kpx, 5e12).entries[0];
  assert.equal(k.title, "Inbox");
  assert.deepEqual(k.tags, ["Root/Mail"]);
  assert.equal(k.m, Date.parse("2024-02-03T04:05:06Z"));
  assert.equal(PC.fromCsv("a,b\n1,2").error, "format");
  const d = PC.dedupe(c.entries, PC.fromCsv(chrome, 5e12).entries.concat(a.entries));
  assert.equal(d.duplicates, 2);
  assert.equal(d.entries.length, 1);
});

// ---------- KDBX ----------
test("ChaCha20 keystream matches Node's own ChaCha20 (RFC 7539)", () => {
  const key = nodeCrypto.randomBytes(32), nonce = nodeCrypto.randomBytes(12);
  const data = nodeCrypto.randomBytes(300);
  for (const counter of [0, 1, 7]) {
    const iv = Buffer.concat([Buffer.from([counter, 0, 0, 0]), nonce]);
    const c = nodeCrypto.createCipheriv("chacha20", key, iv);
    const want = Buffer.concat([c.update(data), c.final()]);
    const ks = K.chacha20(new Uint8Array(key), new Uint8Array(nonce), counter);
    // XOR in uneven pieces: the stream keeps its place between calls.
    const got = Buffer.concat([ks.xor(data.subarray(0, 7)), ks.xor(data.subarray(7, 130)), ks.xor(data.subarray(130))]);
    assert.ok(got.equals(want), "counter " + counter);
  }
});

test("AES-KDF (chained CBC) equals AES-ECB applied round by round", async () => {
  const seed = nodeCrypto.randomBytes(32), data = nodeCrypto.randomBytes(32), rounds = 1234;
  let a = data.subarray(0, 16), b = data.subarray(16);
  for (let i = 0; i < rounds; i++) {
    const ea = nodeCrypto.createCipheriv("aes-256-ecb", seed, null); ea.setAutoPadding(false);
    a = ea.update(a);
    const eb = nodeCrypto.createCipheriv("aes-256-ecb", seed, null); eb.setAutoPadding(false);
    b = eb.update(b);
  }
  const want = nodeCrypto.createHash("sha256").update(Buffer.concat([a, b])).digest();
  const got = await K.aesKdf(new Uint8Array(seed), new Uint8Array(data), rounds);
  assert.ok(Buffer.from(got).equals(want));
});

function checkFixture(r, v) {
  assert.equal(r.version, v);
  assert.equal(r.name, "Fixture DB");
  assert.equal(r.entries.length, 3);
  assert.equal(r.recycled, 1);           // the recycle bin is not imported
  assert.equal(r.attachments, 1);        // attachments are counted, not imported
  const by = {};
  r.entries.forEach((e) => { by[e.title] = e; });
  const m = by.Mailbox;
  assert.equal(m.user, "maria@example.org");
  assert.equal(m.pw, 'n3w&<Νέος>"pw"');
  assert.equal(m.notes, "Line one\nLine two & <tags>");
  assert.deepEqual(m.urls, ["https://mail.example.org/login", "https://m.example.org"]);
  assert.deepEqual(m.tags, ["Email", "work", "mail"]);
  assert.deepEqual(m.fields, [{ h: 1, n: "PIN", v: "4321" }, { h: 0, n: "Recovery email", v: "backup@example.org" }]);
  assert.deepEqual(m.hist.map((h) => h.pw), ["old-Παλιός-1"]);
  assert.equal(m.c, Date.parse("2023-05-06T07:08:09Z"));
  assert.equal(m.m, Date.parse("2024-02-03T04:05:06Z"));
  assert.match(m.totp, /^otpauth:\/\/totp\/Example:maria\?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ/);
  const visa = by.Visa;
  assert.deepEqual(visa.tags, ["Bank/Cards"]);
  assert.equal(visa.pw, "1234");
  const o = PC.parseOtp(visa.totp);
  assert.equal(o.period, 60);
  assert.equal(o.algo, "SHA-256");
  assert.equal(PC.base32Encode(o.secret), "JBSWY3DPEHPK3PXP");
  assert.deepEqual(by["Root entry"].tags, []);
}

const FIXTURES = [
  ["kdbx3-aeskdf-aes.kdbx", "3.1"],
  ["kdbx4-aeskdf-aes.kdbx", "4.0"],
  ["kdbx4-argon2d-chacha.kdbx", "4.0"],
  ["kdbx4-argon2id-aes.kdbx", "4.0"]
];
for (const [file, v] of FIXTURES) {
  test("KDBX import: " + file, async () => {
    const bytes = fs.readFileSync(path.join(FX, file));
    checkFixture(await K.read(bytes, { password: PW }), v);
    await assert.rejects(K.read(bytes, { password: "wrong" }), /wrong-key/);
  });
}

test("KDBX import: password + key file (XML v2); wrong or missing key file refused", async () => {
  const bytes = fs.readFileSync(path.join(FX, "kdbx4-keyfile.kdbx"));
  const kf = fs.readFileSync(path.join(FX, "keyfile-v2.keyx"));
  checkFixture(await K.read(bytes, { password: PW, keyFile: kf }), "4.0");
  await assert.rejects(K.read(bytes, { password: PW }), /wrong-key/);
  await assert.rejects(K.read(bytes, { password: PW, keyFile: new Uint8Array(32) }), /wrong-key/);
});

test("KDBX import: not a KeePass file, truncated, version and cipher refusals", async () => {
  await assert.rejects(K.read(new Uint8Array(100), { password: PW }), /not-kdbx/);
  const bytes = new Uint8Array(fs.readFileSync(path.join(FX, "kdbx4-aeskdf-aes.kdbx")));
  await assert.rejects(K.read(bytes.slice(0, 200), { password: PW }));
  const v2 = bytes.slice(); v2[10] = 2;
  await assert.rejects(K.read(v2, { password: PW }), /kdbx-version/);
  await assert.rejects(K.read(bytes, {}), /no-key/);
});

test("KDBX 4 export (Argon2id + AES, AES-KDF + ChaCha20) reads back identically", async () => {
  const src = (await K.read(fs.readFileSync(path.join(FX, "kdbx4-argon2id-aes.kdbx")), { password: PW })).entries;
  const strip = (es) => es.map((e) => { const c = Object.assign({}, e); delete c.id; return c; })
    .sort((a, b) => (a.title < b.title ? -1 : 1));
  for (const opts of [{ memory: 8 * 1024 * 1024, iterations: 1 }, { kdf: "aes", rounds: 2000, cipher: "chacha" }]) {
    const out = await K.write(src, "Εξαγωγή-pw", opts);
    const h = K.readHeader(out);
    assert.equal(h.major, 4);
    assert.equal(h.kdf.uuid, opts.kdf === "aes" ? K.UUID.aesKdf : K.UUID.argon2id);
    assert.equal(h.cipher, opts.cipher === "chacha" ? K.UUID.chacha : K.UUID.aes);
    const back = await K.read(out, { password: "Εξαγωγή-pw" });
    assert.deepEqual(strip(back.entries), strip(src));
    // Secrets are never in the file as plain text.
    const raw = Buffer.from(out).toString("latin1");
    assert.ok(!raw.includes("r00t") && !raw.includes("maria"));
    await assert.rejects(K.read(out, { password: "nope" }), /wrong-key/);
  }
  // Default export settings: Argon2id 64 MiB, 3 passes.
  const def = K.readHeader(await K.write([], "x", { kdf: "aes", rounds: 10 }));
  assert.equal(def.kdf.rounds, 10);
});

test("XML reader: entities, CDATA, comments; no DTD expansion", () => {
  const x = K.parseXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "BOOM">]><!-- c --><a k="1 &amp; 2"><b>&lt;&#65;&#x42;&e;</b><c><![CDATA[<raw>]]></c><d/></a>');
  assert.equal(x.n, "a");
  assert.equal(x.a.k, "1 & 2");
  assert.equal(x.c[0].t, "<AB&e;");
  assert.equal(x.c[1].t, "<raw>");
  assert.equal(x.c[2].n, "d");
  assert.throws(() => K.parseXml("<a><b></a"));
});
