// Screen lock: unlock with fingerprint or face on Android (LK-BIO).
// lock.js keeps a random token wrapped with the app's secret D in the
// device-local "oros-lock-bio"; the app (BioVault / BioActivity, the
// PW-BIO path, BR-PHONE v11 use "lock") gives D back after strong
// biometrics. Here: the record, the 14-day rule, the wrap, and the
// page / bridge / Android source contract.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const L = require("../lock.js");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DAY = 86400000;
const KID = "0123456789abcdef01234567";
const secret = () => new Uint8Array(crypto.randomBytes(32));

test("LK-BIO wrap: the app's secret opens the record; another secret, kid or a changed record does not", async () => {
  const d = secret();
  const rec = await L.bioWrap(KID, d, 1000);
  assert.deepEqual(Object.keys(rec).sort(), ["at", "ct", "iv", "kid", "v"]);
  assert.equal(rec.at, 1000);
  assert.deepEqual(L.parseBio(JSON.stringify(rec)), rec, "survives storage");
  assert.equal(await L.bioOpens(rec, d.slice()), true);
  assert.equal(await L.bioOpens(rec, secret()), false, "another phone's secret");
  assert.equal(await L.bioOpens(Object.assign({}, rec, { kid: "f".repeat(24) }), d.slice()), false, "bound to its kid");
  const ct = L.unb64(rec.ct); ct[0] ^= 1;
  assert.equal(await L.bioOpens(Object.assign({}, rec, { ct: Buffer.from(ct).toString("base64") }), d.slice()), false, "tampered");
  assert.equal(await L.bioOpens(rec, new Uint8Array(16)), false, "a short secret");
  assert.equal(await L.bioOpens(null, d.slice()), false);
  await assert.rejects(L.bioWrap("x", d, 1));
  await assert.rejects(L.bioWrap(KID, new Uint8Array(31), 1));
});

test("LK-BIO record is read defensively", async () => {
  const rec = await L.bioWrap(KID, secret(), 5);
  for (const bad of [null, "", "x", 1, {}, Object.assign({}, rec, { v: 2 }), Object.assign({}, rec, { kid: "ABC" }),
                     Object.assign({}, rec, { iv: "<img src=x>" }), Object.assign({}, rec, { ct: "a".repeat(300) }),
                     Object.assign({}, rec, { at: -1 }), Object.assign({}, rec, { at: "5" })]) {
    assert.equal(L.parseBio(typeof bad === "string" ? bad : JSON.stringify(bad)), null, JSON.stringify(bad));
  }
  assert.equal("extra" in L.parseBio(JSON.stringify(Object.assign({}, rec, { extra: 1 }))), false);
});

test("LK-BIO the PIN is asked every 14 days, and when the clock went back", () => {
  const rec = { v: 1, kid: KID, iv: "A".repeat(16), ct: "A".repeat(64), at: 10 * DAY };
  assert.equal(L.BIO_DAYS, 14);
  assert.equal(L.bioDue(null, 1), "none");
  assert.equal(L.bioDue(rec, 10 * DAY), "ok");
  assert.equal(L.bioDue(rec, 24 * DAY), "ok");
  assert.equal(L.bioDue(rec, 24 * DAY + 1), "days");
  assert.equal(L.bioDue(rec, 9 * DAY + 1), "ok", "a few hours of clock drift");
  assert.equal(L.bioDue(rec, 8 * DAY), "days", "typed 'in the future': ask the PIN");
});

test("LK-BIO page: device-local record, never synced; PIN typed resets the days; off and recovery forget it", () => {
  const src = read("lock.js");
  assert.match(src, /var BIO_KEY = "oros-lock-bio";/);
  assert.doesNotMatch(read("sync.js"), /oros-lock-bio/, "never registered with sync");
  assert.match(src, /if \(ok\) \{ clearTries\(\); bioTyped\(\); unlock\(\); return; \}/, "a typed PIN resets the 14 days");
  assert.match(src, /save\(null\);\n\s+bioForget\(\);\n\s+unlock\(\);/, "sync passphrase recovery ends it");
  assert.match(src, /if \(!save\(null\)\) return \{ ok: false, code: "storage" \};\n\s+bioForget\(\);/, "turning the lock off ends it");
  assert.match(src, /p\.bio\.open\(r\.kid, "lock"\)/);
  assert.match(src, /p\.bio\.seal\(kid, "lock"\)/);
  // the prompt opens before the slow PIN check (the tap's gesture), a
  // wrong PIN throws the new secret away
  assert.match(src, /if \(!r\.ok\) \{ d\.fill\(0\); try \{ p\.bio\.clear\(kid\); \} catch \(e\) \{\} return r; \}/);
  assert.match(src, /c === "invalidated" \|\| c === "none" \|\| c === "wrong"\) \{\n\s+bioForget\(\);/);
});

test("LK-BIO bridge: phone.js adds use \"lock\" to the announce only for the screen lock", () => {
  const src = read("phone.js");
  assert.match(src, /function bioAsk\(act, kid, use\)/);
  assert.match(src, /if \(use === "lock"\) want\.use = "lock";/);
  assert.match(src, /seal: function \(kid, use\) \{ return bioAsk\("seal", kid, use\); \}/);
  assert.match(src, /open: function \(kid, use\) \{ return bioAsk\("open", kid, use\); \}/);
});

test("LK-BIO Android: the prompt names orOS and the PIN for the lock; strings EN/EL/DE", () => {
  const dir = "android/app/src/main/java/online/useoros/twa/";
  assert.match(read(dir + "PhoneBridge.java"), /BioVault\.announce\(m\.optString\("act"\), kid, m\.optString\("n"\), m\.optString\("use"\)\);/);
  const v = read(dir + "BioVault.java");
  assert.match(v, /new Want\(act, kid, n, "lock"\.equals\(use\), System\.currentTimeMillis\(\)\)/);
  const a = read(dir + "BioActivity.java");
  assert.match(a, /w\.lock \? R\.string\.bio_title_on_lock : R\.string\.bio_title_on/);
  assert.match(a, /w\.lock \? R\.string\.bio_title_lock : R\.string\.bio_title/);
  assert.match(a, /w\.lock \? R\.string\.bio_use_lock : R\.string\.bio_use_pw/);
  assert.match(a, /BIOMETRIC_STRONG/, "still strong biometrics only");
  for (const f of ["values", "values-el", "values-de"]) {
    const s = read("android/app/src/main/res/" + f + "/strings.xml");
    for (const k of ["bio_title_lock", "bio_title_on_lock", "bio_use_lock"]) assert.match(s, new RegExp('<string name="' + k + '">[^<]+</string>'), f + " " + k);
  }
});

test("LK-BIO strings: lock screen and Settings in EN, EL and DE", () => {
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  const core = read("settings/core.js"), deS = read("i18n/de/settings.js");
  const shellKeys = ["lock.bio.unlockHello", "lock.bio.unlockFinger", "lock.bio.touch", "lock.bio.prompt", "lock.bio.err.nonePc", "lock.bio.unlock", "lock.bio.days", "lock.bio.daysPass", "lock.bio.err.invalidated", "lock.bio.err.none",
                     "lock.bio.err.lockout", "lock.bio.err.timeout", "lock.bio.err.failed"];
  for (const k of shellKeys) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, "EN + EL " + k);
    assert.ok(de.includes('"' + k + '":'), "DE " + k);
  }
  const used = new Set([...read("settings/settings.js").matchAll(/"(l\.bio[a-zA-Z.\-]*)"/g)].map((m) => m[1]));
  const lib = read("settings/settings.js").match(/"l\.bio\.err\." \+ \(\/\^\(([a-z|]+)\)\$\//)[1].split("|").concat(["failed"]);
  lib.forEach((c) => used.add("l.bio.err." + c));
  ["none", "no-hw", "no-lock", "old"].forEach((c) => used.add("l.bio.can." + c));
  ["hello", "finger"].forEach((k) => ["l.bio.text.", "l.bio.pinHint.", "l.bio.can.none.", "l.bio.can.no-hw."].forEach((p) => used.add(p + k)));
  for (const k of [...used]) if (k.endsWith(".")) used.delete(k);
  for (const k of used) {
    assert.equal(core.split('"' + k + '":').length - 1, 2, "settings EN + EL " + k);
    assert.ok(deS.includes('"' + k + '":'), "settings DE " + k);
  }
});

test("LK-BIO computer: lock.js talks to the System extension only through oros-bio events, bound by a one-time n", () => {
  const src = read("lock.js");
  assert.match(src, /getAttribute\("data-oros-sys-bio"\) === "1"/);
  assert.match(src, /new root\.CustomEvent\("oros-bio", \{ detail: JSON\.stringify\(\{ n: n, op: op, kid: kid \|\| "", text: text \|\| "" \}\) \}\)/);
  assert.match(src, /doc\.addEventListener\("oros-bio-done"/);
  assert.match(src, /var w = r && typeof r\.n === "string" \? waits\[r\.n\] : null;/, "an answer without the request's n is dropped");
  assert.match(src, /\/\^\[A-Za-z0-9\+\/\]\{43\}=\$\/\.test\(r\.d\)/, "only a 32-byte secret is taken");
  // the phone wins when both are there; a computer uses desk
  assert.match(src, /p\.bio\.available\(\)\) return p;\n\s+\} catch \(e\) \{\}\n\s+if \(desk\.available\(\)\) return deskSource;/);
});
