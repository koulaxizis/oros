// PW-AF6: with the orOS app and orOS Passwords both on the phone,
// orOS Passwords is the only autofill; the orOS app hands it the sealed
// copy (BR-PHONE v13). Document numbers fill only from a pick by hand.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TW = path.join(ROOT, "android/app/src/main/java/online/useoros/twa");
const tw = (f) => fs.readFileSync(path.join(TW, f), "utf8");
const G = require(path.join(ROOT, "android/tools/gen.js"));
const A = require(path.join(ROOT, "passwords/afindex.js"));
const K = require(path.join(ROOT, "passwords/pmkinds.js"));
const PC = require(path.join(ROOT, "passwords/pmcore.js"));

function overlay(id) {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, id, "manifest.webmanifest"), "utf8"));
  const main = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
  return G.buildSolo(id, G.soloApps()[id], m, main)["AndroidManifest.xml"];
}

test("manifests: a signature permission guards the feed; only orOS Passwords has the provider", () => {
  const main = G.build(JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8")))["AndroidManifest.xml"];
  assert.match(main, /<permission android:name="\$\{afFeedPermission\}" android:protectionLevel="signature" \/>/);
  assert.match(main, /<uses-permission android:name="\$\{afFeedPermission\}" \/>/);
  assert.match(main, /<package android:name="\$\{passPackage\}" \/>/);
  assert.match(main, /<receiver android:name="\.AfFeedReceiver" android:exported="true">[\s\S]*?PACKAGE_FULLY_REMOVED[\s\S]*?<data android:scheme="package" \/>/);
  assert.ok(!main.includes("<provider android:name=\".AfFeedProvider\""), "the orOS app has no provider");
  // the two services are told apart in Android's list
  assert.match(main, /<service android:name="\.OrosAutofillService"\s+android:label="@string\/af_service_oros"/);

  const pw = overlay("passwords");
  assert.match(pw, /<provider android:name="\.AfFeedProvider"\s+android:authorities="\$\{applicationId\}\.affeed"\s+android:exported="true"\s+android:permission="\$\{afFeedPermission\}" \/>/);
  assert.ok(!/<permission android:name="\$\{afFeedPermission\}" tools:node="remove"/.test(pw), "orOS Passwords keeps the permission it enforces");
  assert.match(pw, /<uses-permission android:name="\$\{afFeedPermission\}" tools:node="remove" \/>/);
  assert.match(pw, /<service android:name="\.OrosAutofillService" android:label="@string\/af_service" tools:replace="android:label" \/>/);
  assert.match(pw, /<receiver android:name="\.AfFeedReceiver" tools:node="remove" \/>/);

  for (const id of Object.keys(G.soloApps()).filter((x) => x !== "passwords")) {
    const o = overlay(id);
    assert.ok(!o.includes("AfFeedProvider"), id + ": no provider");
    assert.match(o, /<permission android:name="\$\{afFeedPermission\}" tools:node="remove" \/>/, id);
    assert.match(o, /<receiver android:name="\.AfFeedReceiver" tools:node="remove" \/>/, id);
  }
  const gradle = fs.readFileSync(path.join(ROOT, "android/app/build.gradle"), "utf8");
  assert.match(gradle, /afFeedPermission: 'online\.useoros\.permission\.AF_FEED_DEBUG',\s+passPackage: 'online\.useoros\.passwords\.debug'/);
  assert.match(gradle, /afFeedPermission: 'online\.useoros\.permission\.AF_FEED',\s+passPackage: 'online\.useoros\.passwords'\]/);
});

test("orOS app: its own service is off exactly while orOS Passwords takes the feed", () => {
  const f = tw("AfFeed.java");
  assert.match(f, /pm\.checkSignatures\(c\.getPackageName\(\), passPkg\(c\)\) == PackageManager\.SIGNATURE_MATCH/);
  assert.match(f, /int want = pass \? PackageManager\.COMPONENT_ENABLED_STATE_DISABLED : PackageManager\.COMPONENT_ENABLED_STATE_DEFAULT;/);
  assert.match(f, /if \(!PhoneBridge\.FULL\) return false;/);
  assert.match(f, /AfVault\.dropCopy\(c\);\s*AfVault\.deleteFillKeys\(\);/, "own copy and fill keys go; saves stay");
  assert.match(f, /static final int CHUNK = 128 \* 1024;/);
  assert.match(tw("OrosApp.java"), /if \(PhoneBridge\.FULL\) new Thread\(\(\) -> AfFeed\.sync\(this\), "af-feed"\)\.start\(\);/);
  assert.match(tw("AfFeedReceiver.java"), /AfFeed\.passPkg\(c\)\.equals\(i\.getData\(\)\.getSchemeSpecificPart\(\)\)/);
  const v = tw("AfVault.java");
  assert.match(v, /static void dropCopy\(Context c\) \{\s*prefs\(c\)\.edit\(\)\.remove\("index"\)\.remove\("names"\)\.remove\("at"\)\.commit\(\);/);
  assert.match(v, /static synchronized void deleteFillKeys\(\) \{[\s\S]*?k\.deleteEntry\(ALIAS_INDEX\);\s*k\.deleteEntry\(ALIAS_NAMES\);\s*\} catch/);
});

test("orOS Passwords: the provider answers only the orOS app and hands out nothing secret", () => {
  const p = tw("AfFeedProvider.java");
  assert.match(p, /!AfFeed\.fullPkg\(getContext\(\)\)\.equals\(getCallingPackage\(\)\)/);
  for (const m of ["state", "keys", "clear", "index"]) assert.match(p, new RegExp('case "' + m + '":'));
  assert.match(p, /r\.put\("idx", AfVault\.publicKey\(AfVault\.ALIAS_INDEX\)\);/);
  assert.ok(!/AfVault\.(index|names)\(/.test(p), "never opens the lists");
  assert.match(p, /if \(!AfFeed\.keyFits\(p\.optString\("k", ""\), AfVault\.publicKey\(AfVault\.ALIAS_INDEX\)\)\)/);
  assert.match(p, /if \(buf\.length\(\) > AfFeed\.MAX_PAYLOAD\)/);
  assert.match(p, /i != next/, "parts in order");
  for (const m of ["query", "insert", "delete", "update"]) assert.match(p, new RegExp("public [A-Za-z]+ " + m + "\\("));
});

test("bridge v13: af-keys, af-index and clear af go to orOS Passwords; via pass reaches the page", () => {
  const b = tw("PhoneBridge.java");
  assert.match(b, /if \(AfFeed\.sync\(app\)\) \{\s*\/\/ v13 \(PW-AF6\): orOS Passwords' keys/);
  assert.match(b, /JSONObject r = AfFeed\.index\(app, idx, names, at, k\);/);
  assert.match(b, /if \(r\.optBoolean\("keys"\)\) keyIo\.execute\(this::sendAfKeys\);/);
  assert.match(b, /if \(AfFeed\.sync\(app\)\) AfFeed\.clear\(app\);/);
  assert.match(b, /a\.put\("via", "pass"\);/);
  assert.match(b, /if \(!AfFeed\.keyFits\(k, AfVault\.publicKey\(AfVault\.ALIAS_INDEX\)\)\)/);
  assert.match(tw("PermissionActivity.java"), /\.setPackage\(AfFeed\.passPkg\(this\)\)/);

  const ph = fs.readFileSync(path.join(ROOT, "phone.js"), "utf8");
  assert.match(ph, /via: a\.via === "pass" \? "pass" : ""/);
  assert.match(ph, /t: "af-index", seq: \+\+seq, idx: sealed\.idx, names: sealed\.names, at: Date\.now\(\), k: k/);
  const app = fs.readFileSync(path.join(ROOT, "passwords/pmapp.js"), "utf8");
  assert.match(app, /if \(info\.via === "pass"\) lines\.push\(t\("af\.pass"\), info\.svc \? t\("af\.pass\.yes"\) : t\("af\.pass\.no"\)\);/);
  assert.match(app, /if \(now && now !== had\) afSoon\(\);/, "new keys: sealed again");
  for (const k of ["af.pass", "af.pass.yes", "af.pass.no"]) assert.equal(app.split('"' + k + '":').length, 3, k + " in EN and EL");
});

test("sealBoth tells which index key it sealed for", async () => {
  const crypto = require("crypto");
  const kp = () => crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const keys = { idx: kp(), names: kp() };
  const s = await A.sealBoth([], K, PC, keys);
  assert.equal(s.k, keys.idx.slice(-24));
  assert.ok(keys.idx.endsWith(s.k));
});

test("document numbers: in the index only, offered only as a pick by hand", () => {
  const NOW = Date.now();
  const e = PC.normEntry(Object.assign(PC.blankEntry(NOW), { id: "abcdefabcdefabcd", title: "Me" }), NOW);
  const id = K.withData(e, "identity", { first: "Maria", tax: "123456789", iban: "GR16 0110 1250 0000 0001 2300 695", idno: "AK 123456", pass: "AB1234", ssn: "99999", lic: "L-77" });
  const l = A.lists([id], K, PC);
  assert.deepEqual(l.index[0].x, { tax: "123456789", iban: "GR16 0110 1250 0000 0001 2300 695", idno: "AK 123456", pass: "AB1234" });
  const names = JSON.stringify(l.names);
  for (const s of ["123456789", "GR16", "AK 123456", "AB1234", "99999", "L-77"]) assert.ok(!names.includes(s), s);
  assert.ok(!JSON.stringify(l.index).includes("99999") && !JSON.stringify(l.index).includes("L-77"), "only the four approved numbers");
  // IBAN is a field of identities (EN label, Bitwarden export)
  const kinds = fs.readFileSync(path.join(ROOT, "passwords/pmkinds.js"), "utf8");
  assert.match(kinds, /\{ k: "iban", t: "text", h: 1 \}/);
  assert.match(kinds, /"id\.iban": "IBAN"/);

  const svc = tw("OrosAutofillService.java"), auth = tw("AfAuthActivity.java"), m = tw("AfMatch.java");
  assert.match(m, /TAX = 23, IBAN = 24, ID_NO = 25, PASSPORT = 26;/);
  assert.match(svc, /if \(k\.equals\("identity"\) && form\.any\(4\)\) wantDoc = true;/);
  assert.match(svc, /dataset\(form, "", getString\(R\.string\.af_pick_doc\), "", "doc", PICK, n, null, false\)/);
  assert.match(svc, /: kind\.equals\("doc"\) \? AfMatch\.isDoc\(f\.kind\)/);
  assert.match(auth, /if \(getIntent\(\)\.getBooleanExtra\(X_DOC, false\)\) pickDoc\(index\);/);
  assert.match(auth, /chooser\(all, getString\(R\.string\.af_pick_doc_title, place\(\)\), this::fill, true\);/);
  assert.match(auth, /case AfMatch\.IBAN: return x != null \? x\.optString\("iban"\) : null;/);
  // a person or card suggestion never fills a document field
  assert.match(svc, /\? AfMatch\.isPerson\(f\.kind\)/);
  assert.ok(!/isPerson\(int k\) \{\s*return k >= FIRST && k <= (PASSPORT|ID_NO|TAX|IBAN)/.test(m));
});
