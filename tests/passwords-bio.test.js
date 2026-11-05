// Passwords: unlock with fingerprint or face (PW-BIO, BR-PHONE v9).
// The crypto (passwords/pmcrypto.js section 7) round trips and refuses
// what it must; the lock-screen rules (14 days, password changed);
// and the page / Android contract read from the sources: phone.js,
// solo.js (the single app relays only pw-bio), pmapp.js, the manifest
// generator, Gradle, BioVault / BioActivity / PhoneBridge and strings.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PV = require(path.join(ROOT, "passwords", "pmcrypto.js"));
const FAST = { kdf: { alg: "argon2id", m: 8192, t: 1, p: 1 } };
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const JAVA = ["android", "app", "src", "main", "java", "online", "useoros", "twa"];
const DAY = 86400000;

function secret() { return PV.random(32); }

test("PW-BIO crypto: the phone's secret opens the vault key; nothing else does", async () => {
  const v = await PV.create("correct horse battery staple", FAST);
  const d = secret(), keep = d.slice();
  const rec = await PV.bioEnable(v.vault, v.kid, "correct horse battery staple", d, { now: 1000 });
  assert.ok(d.every((b) => b === 0), "D wiped after enabling");
  assert.deepEqual(Object.keys(rec).sort(), ["at", "ct", "iv", "kid", "kt", "pw", "v"]);
  assert.equal(rec.kid, v.kid); assert.equal(rec.kt, v.vault.kt); assert.equal(rec.pw, 1000);
  assert.deepEqual(PV.bioNorm(JSON.parse(JSON.stringify(rec))), rec, "survives storage");

  // the same secret gives a session that opens what the password's session sealed
  const sealed = await PV.seal(v.session, v.vault, { e: [], g: {} });
  const d2 = keep.slice();
  const s = await PV.bioUnlock(rec, v.kid, d2);
  assert.ok(d2.every((b) => b === 0), "D wiped after unlocking");
  assert.deepEqual(await PV.openBlob(s, sealed.id, sealed.blob), { e: [], g: {} });

  // a wrong secret, another vault's id or a changed record: refused
  await assert.rejects(PV.bioUnlock(rec, v.kid, secret()), /bio-wrong/);
  await assert.rejects(PV.bioUnlock(Object.assign({}, rec, { kid: "0".repeat(24) }), "0".repeat(24), keep.slice()), /bio-wrong/);
  await assert.rejects(PV.bioUnlock(rec, "f".repeat(24), keep.slice()), /bio-none/);
  const ct = PV.unb64(rec.ct); ct[0] ^= 1;
  await assert.rejects(PV.bioUnlock(Object.assign({}, rec, { ct: PV.b64(ct) }), v.kid, keep.slice()), /bio-wrong/);
  await assert.rejects(PV.bioUnlock(rec, v.kid, new Uint8Array(16)), /bad-key/);
});

test("PW-BIO crypto: turning it on needs the right master password", async () => {
  const v = await PV.create("correct horse battery staple", FAST);
  const d = secret();
  await assert.rejects(PV.bioEnable(v.vault, v.kid, "wrong password here", d), /wrong-password/);
  assert.ok(d.every((b) => b === 0), "D wiped on a wrong password too");
});

test("PW-BIO crypto: a master password change keeps the vault key, so the copy still opens it", async () => {
  const v = await PV.create("correct horse battery staple", FAST);
  const d = secret();
  const rec = await PV.bioEnable(v.vault, v.kid, "correct horse battery staple", d.slice());
  const r = await PV.rewrap(v.vault, v.kid, { password: "correct horse battery staple" }, "a brand new passphrase", FAST);
  assert.ok(r.vault.kt > v.vault.kt);
  assert.equal(PV.bioCheck(rec, r.vault, v.kid, Date.now()), "changed", "the lock screen asks the password once");
  const s = await PV.bioUnlock(rec, v.kid, d.slice());
  assert.equal(s.kid, v.kid);
  const typed = PV.bioTyped(rec, r.vault, Date.now());
  assert.equal(PV.bioCheck(typed, r.vault, v.kid, Date.now()), "ok", "after typing it once, the finger works again");
});

test("PW-BIO lock-screen rules: none, changed, 14 days, ok", () => {
  const kid = "a".repeat(24), vault = { kt: 5 };
  const rec = { v: 1, kid, ct: PV.b64(new Uint8Array(48)), iv: PV.b64(new Uint8Array(12)), kt: 5, pw: 0, at: 0 };
  assert.equal(PV.BIO_DAYS, 14);
  assert.equal(PV.bioCheck(rec, vault, kid, 13 * DAY), "ok");
  assert.equal(PV.bioCheck(rec, vault, kid, 14 * DAY), "ok");
  assert.equal(PV.bioCheck(rec, vault, kid, 14 * DAY + 1), "days");
  assert.equal(PV.bioCheck(rec, { kt: 6 }, kid, 1), "changed");
  assert.equal(PV.bioCheck(rec, vault, "b".repeat(24), 1), "none");
  assert.equal(PV.bioCheck(rec, null, kid, 1), "none");
  assert.equal(PV.bioCheck(null, vault, kid, 1), "none");
  const t = PV.bioTyped(rec, { kt: 6 }, 20 * DAY);
  assert.equal(t.kt, 6); assert.equal(t.pw, 20 * DAY);
  assert.equal(PV.bioCheck(t, { kt: 6 }, kid, 33 * DAY), "ok");
  // junk is not a record
  for (const bad of [null, 1, "x", {}, Object.assign({}, rec, { v: 2 }), Object.assign({}, rec, { kid: "x" }),
                     Object.assign({}, rec, { iv: "<script>" }), Object.assign({}, rec, { ct: "a".repeat(300) })]) {
    assert.equal(PV.bioNorm(bad), null, JSON.stringify(bad));
  }
  assert.equal(PV.bioNorm(Object.assign({}, rec, { pw: -5, extra: 1 })).pw, 0);
  assert.equal("extra" in PV.bioNorm(Object.assign({}, rec, { extra: 1 })), false);
});

test("PW-BIO page side: Passwords keeps the record on this device only and offers it only through the bridge", () => {
  const app = read("passwords", "pmapp.js");
  assert.match(app, /var BIO_KEY = "oros-passwords-bio";/);
  // the synced slice is the vault key only
  assert.match(app, /api\.registerSlice\("passwords", sliceGet, sliceSet, VAULT_KEY, PV\.mergeSlice\)/);
  assert.ok(!/registerSlice\([^)]*BIO_KEY/.test(app));
  // menu item and lock screen only with the bridge; the master password always stays
  assert.match(app, /concat\(bio\(\) \? \[\["m\.bio", bioDialog\]\] : \[\]\)/);
  assert.match(app, /bioLockBox\(bioBox, primary\(\), startSession/);
  assert.match(app, /PV\.unlock\(V, k, pw\.value\)[\s\S]{0,80}bioTyped\(k\)/, "a typed master password resets the 14 days");
  // a wrong master password while turning it on removes the phone's new secret
  assert.match(app, /wrong-password"\) \{ p\.bio\.clear\(k\)/);
  // strings in English and Greek (German in its pack)
  const keys = (app.match(/"(m\.bio|bio\.[A-Za-z.-]+)":/g) || []).map((s) => s.slice(1, -2));
  const en = keys.slice(0, keys.length / 2), el = keys.slice(keys.length / 2);
  assert.ok(en.length >= 20); assert.deepEqual(el, en);
  const de = read("i18n", "de", "passwords.js");
  en.forEach((k) => assert.ok(de.includes('"' + k + '":'), "de " + k));
  for (const c of ["none", "no-hw", "no-lock", "old"]) assert.ok(en.includes("bio.can." + c), c);
  for (const c of ["lockout", "invalidated", "none", "timeout", "failed"]) assert.ok(en.includes("bio.err." + c), c);
});

test("PW-BIO bridge (phone.js v9): announce first, then the intent from the tap; answers bound by the one-time n", () => {
  const ph = read("phone.js");
  assert.match(ph, /\{ t: "pw-bio", op: "want", act: act, kid: kid, n: n \}/);
  assert.match(ph, /"intent:\/\/" \+ act \+ "\?n=" \+ n \+ "#Intent;scheme=oros-bio;package=" \+ bioInfo\.pkg \+ ";end"/);
  assert.match(ph, /BIO_PKG = \/\^online\\\.useoros\\\.\(twa\|passwords\)\$\//);
  assert.match(ph, /m\.n !== bioWait\.n\) return;/, "an answer for another request is ignored");
  assert.match(ph, /\/\^\[A-Za-z0-9\+\/\]\{43\}=\$\/\.test\(m\.d\)/, "only a 32-byte secret is taken");
  assert.match(ph, /\} else if \(m\.t === "pw-bio"\) \{\s*bioIn\(m\);/);
  assert.match(ph, /bio: \{\s*available:/);
});

test("PW-BIO single app: solo.js relays only pw-bio and autofill, and only for Passwords", () => {
  const so = read("solo.js");
  assert.match(so, /if \(id === "passwords"\) \{\s*win\.addEventListener\("message"/);
  assert.match(so, /if \(!ev\.ports \|\| !ev\.ports\[0\] \|\| ev\.source\) return;/, "only a port the browser posted");
  assert.match(so, /var TO_APP = \{ "pw-bio": 1, "af-keys": 1, "af-index": 1, "af-state": 1 \};/);
  assert.match(so, /var TO_PAGE = \{ "pw-bio": 1, "af-keys": 1, "af-state": 1, "af-save": 1 \};/);
  assert.match(so, /\(m\.t === "clear" && m\.what === "af"\) \|\| \(m\.t === "applied" && m\.what === "af-save"\)/);
  assert.match(so, /\(m\.t === "done" \|\| m\.t === "error"\) && m\.what === "af-index"/);
  assert.match(so, /\^intent:\\\/\\\/autofill#Intent;scheme=oros-permission;package=online\\\.useoros\\\.passwords;end\$/);
  assert.match(so, /bio: id !== "passwords" \? null :/);
  assert.match(so, /\^intent:\\\/\\\/\(seal\|open\)\\\?n=\[0-9a-f\]\{32\}#Intent;scheme=oros-bio;package=online\\\.useoros\\\.\(twa\|passwords\);end\$/);
  // the frame's phone.js listens there
  assert.match(read("phone.js"), /root\.parent\.__orosSoloHost/);
  // (the relay itself is exercised in the real shell with Playwright)
});

test("PW-BIO Android: BioActivity in the orOS app and orOS Passwords only, its own scheme, strong biometrics per use", () => {
  const gen = require(path.join(ROOT, "android", "tools", "gen.js"));
  assert.deepEqual(gen.BIO_APPS, ["passwords"]);
  const main = gen.build(JSON.parse(read("manifest.webmanifest")))["AndroidManifest.xml"];
  const act = /<activity android:name="\.BioActivity"[\s\S]*?<\/activity>/.exec(main)[0];
  assert.match(act, /android:exported="true"/);
  assert.match(act, /<data android:scheme="\$\{bioScheme\}" \/>/);
  // BiometricManager.canAuthenticate and BiometricPrompt throw a
  // SecurityException without it (the phone never answered "state").
  const PERM = '<uses-permission android:name="android.permission.USE_BIOMETRIC" />';
  const NOPERM = '<uses-permission android:name="android.permission.USE_BIOMETRIC" tools:node="remove" />';
  assert.ok(main.includes(PERM), "USE_BIOMETRIC in the orOS app");
  const apps = gen.soloApps();
  for (const id of Object.keys(apps)) {
    const m = JSON.parse(read(id, "manifest.webmanifest"));
    const x = gen.buildSolo(id, apps[id], m, JSON.parse(read("manifest.webmanifest")))["AndroidManifest.xml"];
    const removed = x.includes('<activity android:name=".BioActivity" tools:node="remove" />');
    assert.equal(removed, id !== "passwords", id);
    assert.equal(x.includes(NOPERM), id !== "passwords", id + " USE_BIOMETRIC");
  }
  const pages = gen.pageApps();
  for (const id of Object.keys(pages)) {
    const m = JSON.parse(read(pages[id].page, "manifest.webmanifest"));
    const x = gen.buildPage(id, pages[id], m, JSON.parse(read("manifest.webmanifest")))["AndroidManifest.xml"];
    assert.ok(x.includes('<activity android:name=".BioActivity" tools:node="remove" />'), id);
    assert.ok(x.includes(NOPERM), id + " USE_BIOMETRIC");
  }
  const gradle = read("android", "app", "build.gradle");
  assert.match(gradle, /bioScheme: 'oros-bio-debug'/);
  assert.match(gradle, /bioScheme: 'oros-bio'\]/);

  const vault = read(...JAVA, "BioVault.java");
  assert.match(vault, /setUserAuthenticationRequired\(true\)/);
  assert.match(vault, /setInvalidatedByBiometricEnrollment\(true\)/);
  assert.match(vault, /setUserAuthenticationParameters\(0, KeyProperties\.AUTH_BIOMETRIC_STRONG\)/);
  assert.ok(!/AUTH_DEVICE_CREDENTIAL|DEVICE_CREDENTIAL/.test(vault), "never the screen PIN");
  assert.match(vault, /new SecureRandom\(\)\.nextBytes\(d\)/);
  const bioAct = read(...JAVA, "BioActivity.java");
  assert.match(bioAct, /BioVault\.take\(act, n\)/, "acts only on the announced request");
  assert.match(bioAct, /new BiometricPrompt\.CryptoObject\(c\)/);
  assert.match(bioAct, /setAllowedAuthenticators\(BiometricManager\.Authenticators\.BIOMETRIC_STRONG\)/);
  assert.ok(!/DEVICE_CREDENTIAL|setDeviceCredentialAllowed/.test(bioAct), "never the screen PIN");
  const br = read(...JAVA, "PhoneBridge.java");
  assert.match(br, /static final boolean FULL = "oros"\.equals\(BuildConfig\.FLAVOR\);/);
  assert.match(br, /if \(!FULL && !\(BIO && soloTakes\(t, m\)\)\) return;/, "a single app takes nothing else");
  const takes = /static boolean soloTakes\(String t, JSONObject m\) \{([\s\S]*?)\n    \}/.exec(br)[1];
  assert.ok(!/"state"|contacts|calendar|reminders|health|ticks/.test(takes.replace(/"af-state"/g, "")), "only pw-bio and autofill");
  assert.match(read(...JAVA, "PermissionActivity.java"), /if \(!PhoneBridge\.FULL && !"autofill"\.equals\(kind\)\) \{ finish\(\); return; \}/);
  assert.match(br, /case "pw-bio": \{/);

  for (const dir of ["values", "values-el", "values-de"]) {
    const s = read("android", "app", "src", "main", "res", dir, "strings.xml");
    for (const k of ["bio_title", "bio_title_on", "bio_sub", "bio_use_pw"]) assert.ok(s.includes('name="' + k + '"'), dir + " " + k);
  }
});
