// Passwords PW-AF2: autofill on the phone. The fill lists the page
// seals for the orOS Android app (passwords/afindex.js) carry only what
// a fill needs, the same values as the browser add-on's fill, and the
// sealing (AES-256-GCM, key wrapped with RSA-OAEP SHA-1) opens with an
// independent implementation (Node's crypto), as Android's Keystore
// does. The Android side is checked by its source and generated
// manifest; it is built in CI (android.yml).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PC = require(path.join(ROOT, "passwords/pmcore.js"));
const K = require(path.join(ROOT, "passwords/pmkinds.js"));
const A = require(path.join(ROOT, "passwords/afindex.js"));
const F = require(path.join(ROOT, "extension/pmfill.js"));

const NOW = Date.UTC(2026, 10, 1, 12);
const SECRET = "JBSWY3DPEHPK3PXP";
function entry(o) { return PC.normEntry(Object.assign(PC.blankEntry(NOW), { id: PC.newId() }, o), NOW); }
function sample() {
  return [
    entry({ title: "Bank", user: "maria", pw: "s3cret-pw", totp: SECRET, notes: "do not send", hist: [{ pw: "old-pw", at: NOW }],
            urls: ["https://bank.example", "androidapp://com.bank.app", "androidapp://bad pkg", "ftp://x.example"],
            fields: [{ h: 1, n: "PIN", v: "4321" }] }),
    PC.normEntry(K.withData(entry({ title: "GitHub", user: "m", totp: "otpauth://totp/GH:m?secret=" + SECRET + "&algorithm=SHA256&digits=8&period=60" }), "otp", {}), NOW),
    K.withData(entry({ title: "Visa" }), "card", { holder: "MARIA P", num: "4111 1111 1111 1111", exp: "8/27", cvv: "123", pin: "0000" }),
    K.withData(entry({ title: "Me" }), "identity", { first: "Maria", last: "P", email: "m@example.org", tax: "123456789", pass: "AB1234" }),
    K.withData(entry({ title: "Home" }), "address", { name: "Maria Papadopoulou", street: "Ermou 10", floor: "3", city: "Athina", zip: "10563", country: "GR" }),
    K.withData(entry({ title: "Wi-Fi" }), "note", { text: "secret note" }),
    entry({ title: "Empty" })
  ];
}

test("lists: names hold no secrets; index holds only fill values; never PIN, ID numbers, notes, history, fields", () => {
  const l = A.lists(sample(), K, PC);
  assert.deepEqual(l.names.map((n) => n.t), ["Bank", "GitHub", "Visa", "Me", "Home"]);
  const names = JSON.stringify(l.names);
  for (const s of ["s3cret-pw", "4111", "123456789", "AB1234", SECRET, "0000", "do not send"]) assert.ok(!names.includes(s), "names: " + s);
  const idx = JSON.stringify(l.index);
  for (const s of ["do not send", "old-pw", "4321", "0000", "123456789", "AB1234", "secret note"]) assert.ok(!idx.includes(s), "index: " + s);
  const bank = l.names[0];
  assert.deepEqual(bank.w, ["https://bank.example"]);
  assert.deepEqual(bank.a, ["com.bank.app"]);
  assert.equal(bank.o, 1);
  const bi = l.index[0];
  assert.equal(bi.p, "s3cret-pw");
  assert.equal(Buffer.from(bi.o.k, "base64").length, 10);
  assert.equal(bi.o.a, "SHA-1"); assert.equal(bi.o.d, 6); assert.equal(bi.o.n, 30);
  const gh = l.index[1];
  assert.equal(gh.p, ""); assert.equal(gh.o.a, "SHA-256"); assert.equal(gh.o.d, 8); assert.equal(gh.o.n, 60);
});

test("lists: card and person values are exactly the browser add-on's fill values", () => {
  const list = sample();
  const l = A.lists(list, K, PC);
  const card = F.payload(list[2], K);
  assert.deepEqual(l.index[2].c, { name: card.name, num: card.num, mm: card.mm, yyyy: card.yyyy, cvv: card.cvv });
  for (const i of [3, 4]) {
    const p = F.payload(list[i], K);
    delete p.kind;
    assert.deepEqual(l.index[i].h, p);
  }
});

test("seal: Node's RSA-OAEP SHA-1 + AES-256-GCM open it (as Android Keystore does)", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 3072 });
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const obj = A.lists(sample(), K, PC).index;
  const b = await A.seal(obj, spki);
  assert.deepEqual(Object.keys(b).sort(), ["ct", "iv", "w"]);
  const raw = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" }, Buffer.from(b.w, "base64"));
  assert.equal(raw.length, 32);
  const ct = Buffer.from(b.ct, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", raw, Buffer.from(b.iv, "base64"));
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString("utf8");
  assert.deepEqual(JSON.parse(plain), obj);
  // two seals never share a key or iv
  const b2 = await A.seal(obj, spki);
  assert.notEqual(b2.w, b.w); assert.notEqual(b2.iv, b.iv);
});

test("phone bridge v8 and the Android side: keys, service, auth, strings", () => {
  const phone = fs.readFileSync(path.join(ROOT, "phone.js"), "utf8");
  for (const s of ['t: "af-keys"', 't: "af-index"', 'what: "af"', "intent://autofill#Intent;scheme=oros-permission"]) assert.ok(phone.includes(s), s);
  const tw = (f) => fs.readFileSync(path.join(ROOT, "android/app/src/main/java/online/useoros/twa", f), "utf8");
  const v = tw("AfVault.java");
  assert.match(v, /RSA\/ECB\/OAEPWithSHA-1AndMGF1Padding/);
  assert.match(v, /setInvalidatedByBiometricEnrollment\(true\)/);
  assert.match(v, /setUserAuthenticationRequired\(true\)/);
  assert.match(v, /AUTH_BIOMETRIC_STRONG \| KeyProperties\.AUTH_DEVICE_CREDENTIAL/);
  const b = tw("PhoneBridge.java");
  for (const s of ['case "af-keys"', 'case "af-index"', '"af".equals(what)']) assert.ok(b.includes(s), s);
  assert.match(tw("PermissionActivity.java"), /ACTION_REQUEST_SET_AUTOFILL_SERVICE/);
  const svc = tw("OrosAutofillService.java");
  assert.match(svc, /setAuthentication\(auth\)/, "every suggestion is locked");
  assert.match(svc, /form\.pkg\.equals\(getPackageName\(\)\)/, "never inside orOS itself");
  assert.match(svc, /AfMatch\.BROWSERS\.contains/, "a web domain counts only from a known browser");
  // the generated manifest: only the system binds the service; single apps leave it out for now
  const { build, REMOVE_NODES } = require(path.join(ROOT, "android/tools/gen.js"));
  const xml = build(JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8")))["AndroidManifest.xml"];
  assert.match(xml, /<service android:name="\.OrosAutofillService"[\s\S]*?android:permission="android\.permission\.BIND_AUTOFILL_SERVICE"/);
  assert.match(xml, /<activity android:name="\.AfAuthActivity"\s+android:exported="false"/);
  assert.ok(REMOVE_NODES.some(([t, n]) => t === "service" && n === ".OrosAutofillService"));
  // strings in English, Greek and German
  const res = (d) => fs.readFileSync(path.join(ROOT, "android/app/src/main/res", d, "strings.xml"), "utf8");
  const names = (s) => (s.match(/name="(af_[a-z_]+)"/g) || []).sort();
  const en = names(res("values"));
  assert.ok(en.length >= 10);
  for (const d of ["values-el", "values-de"]) assert.deepEqual(names(res(d)), en, d);
  // the Java field words follow the add-on's (EN / EL / DE, no accents)
  const m = tw("AfMatch.java"), f = fs.readFileSync(path.join(ROOT, "extension/pmfill.js"), "utf8");
  for (const w of ["κατοχ", "αριθμ.*καρτας", "ταχυδρομικος", "(?<!ονοματ)επωνυμο", "ονοματεπωνυμο", "postleitzahl", "karteninhaber"]) {
    assert.ok(m.includes(w) && f.includes(w), w);
  }
});

test("Passwords: the phone dialog appears only inside the orOS app, afindex.js loads on demand", () => {
  const app = fs.readFileSync(path.join(ROOT, "passwords/pmapp.js"), "utf8");
  assert.match(app, /concat\(phone\(\) \? \[\["m\.autofill", autofillDialog\]\] : \[\]\)/);
  assert.match(app, /sc\.src = "afindex\.js"/);
  const html = fs.readFileSync(path.join(ROOT, "passwords/index.html"), "utf8");
  assert.ok(!html.includes("afindex.js"), "not loaded at first open");
  assert.ok(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").includes('"passwords/afindex.js"'));
});

test("PW-AF3 saveItem: needs a password and an http(s) page or an Android package; cleans the rest", () => {
  assert.equal(A.saveItem({ url: "https://x.example", user: "u" }), null, "no password");
  assert.equal(A.saveItem({ url: "javascript:alert(1)", pw: "p" }), null);
  assert.equal(A.saveItem({ url: "file:///etc/passwd", pw: "p" }), null);
  assert.equal(A.saveItem({ app: "bad pkg", pw: "p" }), null);
  assert.equal(A.saveItem({ pw: "p" }), null, "no place");
  const w = A.saveItem({ url: "https://www.Shop.Example/login?next=/x#y", user: " ana\n ", pw: " p w ", title: "Shop\u0000 login" }, PC.LIM);
  assert.deepEqual(w, { site: "https://www.shop.example", host: "shop.example", user: "ana", pw: " p w ", title: "Shop login" },
    "only the origin is kept, the password exactly as typed");
  const a = A.saveItem({ app: "com.bank.app", user: "m", pw: "x" });
  assert.equal(a.site, "androidapp://com.bank.app");
  assert.equal(a.title, "com.bank.app");
});

test("PW-AF3 findSave: same place and user name → that login (newest); same password → nothing to do", () => {
  const list = sample();
  const bank = list[0];
  const it = (o) => A.saveItem(Object.assign({ url: "https://bank.example/in", user: "Maria", pw: "new-pw" }, o));
  const f = A.findSave(list, it(), K);
  assert.equal(f.entry.id, bank.id, "user names compare without case");
  assert.equal(f.same, false);
  assert.equal(A.findSave(list, it({ pw: "s3cret-pw" }), K).same, true);
  assert.equal(A.findSave(list, it({ user: "other" }), K), null, "another user name is a new entry");
  assert.equal(A.findSave(list, it({ url: "https://evil-bank.example" }), K), null, "another site is a new entry");
  assert.equal(A.findSave(list, it({ url: "https://www.bank.example" }), K).entry.id, bank.id, "www. is the same site");
  assert.equal(A.findSave(list, A.saveItem({ app: "com.bank.app", user: "maria", pw: "z" }), K).entry.id, bank.id);
  // a card, identity or 2FA-only entry is never the target
  assert.equal(A.findSave(list, A.saveItem({ url: "https://github.com", user: "m", pw: "z" }), K), null);
  const newer = entry({ title: "Bank 2", user: "maria", pw: "b", urls: ["bank.example"] });
  newer.m = bank.m + 10;
  assert.equal(A.findSave(list.concat([newer]), it(), K).entry.id, newer.id, "newest first; a bare host counts");
});

test("PW-AF3: the login travels in memory only and is stored only from the editor's Save", () => {
  const shell = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
  const i = shell.indexOf("var pwSaves = [];"), j = shell.indexOf("// This computer (orOS USB");
  assert.ok(i > 0 && j > i);
  const part = shell.slice(i, j);
  assert.ok(!/sessionStorage|localStorage|location\.(href|hash|search)\s*=|history\./.test(part), "never in storage or a URL");
  assert.match(part, /ev\.source !== window \|\| ev\.origin !== location\.origin/, "only this window's own messages");
  const app = fs.readFileSync(path.join(ROOT, "passwords/pmapp.js"), "utf8");
  const q = app.slice(app.indexOf("function queueSave("), app.indexOf("function afSoon("));
  assert.ok(!/save\(|PC\.upsert|writeStored/.test(q), "queueSave / nextSave never write the vault");
  assert.match(q, /openEditor\(f\.entry, null, \{ newPw: it\.pw/);
  assert.match(app, /if \(was\) saveQ = \[\];/, "locking drops what waited");
  const phone = fs.readFileSync(path.join(ROOT, "phone.js"), "utf8");
  assert.match(phone, /m\.t === "af-save" && Array\.isArray\(m\.items\)/);
  const bg = fs.readFileSync(path.join(ROOT, "extension/background.js"), "utf8");
  assert.match(bg, /sender\.id !== api\.runtime\.id \|\| sender\.tab/, "only the popup hands a login over");
  // Android: queued sealed, sent until answered, gone when autofill goes off
  const v = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/online/useoros/twa/AfVault.java"), "utf8");
  assert.match(v, /remove\("saves"\)/);
  assert.match(v, /KeyGenParameterSpec\.Builder\(ALIAS_SAVE/);
  const br = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/online/useoros/twa/PhoneBridge.java"), "utf8");
  assert.match(br, /"af-save"\.equals\(w\)[\s\S]*?AfVault\.takenSaves/);
});

test("PW-AF3 readLogin rule matches Android's pickPassword", () => {
  const m = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/online/useoros/twa/AfMatch.java"), "utf8");
  assert.match(m, /if \(n >= 3\) return 1;/);
  assert.match(m, /if \(n == 2 && values\.get\(0\)\.equals\(values\.get\(1\)\)\) return 0;/);
  const f = fs.readFileSync(path.join(ROOT, "extension/pmfill.js"), "utf8");
  assert.match(f, /else if \(pws\.length >= 3\) pick = pws\[1\];/);
  assert.match(f, /else if \(pws\.length === 2 && pws\[0\]\.value === pws\[1\]\.value\) pick = pws\[0\];/);
  assert.equal(typeof F.readLogin, "function");
});
