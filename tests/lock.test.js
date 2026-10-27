// Screen lock (lock.js, Settings › Screen lock): the pure core (secret
// rules, stored record, tries, reload grace, PBKDF2 hash) and the sync
// passphrase check behind "Forgot your PIN?" (orosSync.checkPassphrase).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const L = require("../lock.js");
const { FakeDropbox, createDevice, writeKey, readKey } = require("./harness");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("PIN: 4 to 12 digits; passphrase: 6 to 256 characters", () => {
  assert.equal(L.secretProblem("pin", "1234"), "ok");
  assert.equal(L.secretProblem("pin", "123456789012"), "ok");
  assert.equal(L.secretProblem("pin", "123"), "pin");
  assert.equal(L.secretProblem("pin", "1234567890123"), "pin");
  assert.equal(L.secretProblem("pin", "12a4"), "pin");
  assert.equal(L.secretProblem("pin", "١٢٣٤"), "pin", "only ASCII digits");
  assert.equal(L.secretProblem("pass", "abcdef"), "ok");
  assert.equal(L.secretProblem("pass", "  ab  "), "short");
  assert.equal(L.secretProblem("pass", "x".repeat(257)), "long");
  assert.equal(L.secretProblem("other", "1234"), "kind");
});

test("the stored record is read defensively; anything odd means no lock", () => {
  const good = { v: 1, kind: "pin", salt: "c2FsdA==", hash: "aGFzaA==", i: 600000, idle: 10, hidden: true };
  assert.deepEqual(L.parseCfg(JSON.stringify(good)), good);
  assert.equal(L.parseCfg(null), null);
  assert.equal(L.parseCfg("not json"), null);
  assert.equal(L.parseCfg(JSON.stringify(Object.assign({}, good, { v: 2 }))), null);
  assert.equal(L.parseCfg(JSON.stringify(Object.assign({}, good, { kind: "face" }))), null);
  assert.equal(L.parseCfg(JSON.stringify(Object.assign({}, good, { i: 1e9 }))), null, "a huge count would hang the tab");
  assert.equal(L.parseCfg(JSON.stringify(Object.assign({}, good, { i: 1000 }))), null);
  assert.equal(L.parseCfg(JSON.stringify(Object.assign({}, good, { hash: "" }))), null);
  const odd = L.parseCfg(JSON.stringify(Object.assign({}, good, { idle: 7, hidden: "yes" })));
  assert.equal(odd.idle, L.DEFAULT_IDLE);
  assert.equal(odd.hidden, false);
});

test("five free tries, then the wait doubles up to 15 minutes", () => {
  let t = { n: 0, until: 0 };
  const now = 1000000;
  for (let i = 0; i < 4; i++) { t = L.afterFail(t, now); assert.equal(L.waitLeft(t, now), 0); }
  t = L.afterFail(t, now);                       // 5th
  assert.equal(L.waitLeft(t, now), 30000);
  t = L.afterFail(t, now);
  assert.equal(L.waitLeft(t, now), 60000);
  for (let i = 0; i < 10; i++) t = L.afterFail(t, now);
  assert.equal(L.waitLeft(t, now), L.WAIT_MAX);
  assert.equal(L.waitLeft({ n: 9, until: now + 1e9 }, now), L.WAIT_MAX, "a far stamp cannot stretch it");
  assert.equal(L.waitLeft(t, now + L.WAIT_MAX), 0);
  assert.deepEqual(L.parseTries("junk"), { n: 0, until: 0 });
});

test("a reload of the same tab stays open only within the idle time, at most 10 minutes", () => {
  const now = 10 * 3600 * 1000;
  const cfg = (idle) => ({ idle });
  assert.equal(L.stillOpen(cfg(5), now - 60000, now), true);
  assert.equal(L.stillOpen(cfg(5), now - 5 * 60000, now), false);
  assert.equal(L.stillOpen(cfg(0), now - 9 * 60000, now), true, "idle off: 10 minutes");
  assert.equal(L.stillOpen(cfg(0), now - 11 * 60000, now), false);
  assert.equal(L.stillOpen(cfg(60), now - 11 * 60000, now), false);
  assert.equal(L.stillOpen(cfg(5), 0, now), false, "no mark: a fresh start locks");
  assert.equal(L.stillOpen(cfg(5), now + 1000, now), false, "a mark from the future does not count");
});

test("only a slow salted hash is stored, and it checks the secret", async () => {
  const c = await L.makeCfg("pin", "2468", null);
  assert.equal(c.i, 600000);
  assert.equal(c.kind, "pin");
  assert.ok(!JSON.stringify(c).includes("2468"));
  assert.equal(Buffer.from(c.salt, "base64").length, 16);
  assert.equal(Buffer.from(c.hash, "base64").length, 32);
  assert.deepEqual(L.parseCfg(JSON.stringify(c)), c);
  assert.equal(await L.matches(c, "2468"), true);
  assert.equal(await L.matches(c, "2469"), false);
  const c2 = await L.makeCfg("pin", "2468", { idle: 30, hidden: true });
  assert.notEqual(c2.salt, c.salt, "a fresh salt every time");
  assert.equal(c2.idle, 30);
  assert.equal(c2.hidden, true);
  const p = await L.makeCfg("pass", "Café au lait", null);
  assert.equal(await L.matches(p, "Café au lait"), true, "NFC: the same word typed two ways");
});

test("the lock never travels: not a slice, not in sync.js, and the factory reset sweep removes it", () => {
  assert.ok(L.KEY.indexOf("oros-") === 0 && L.TRIES_KEY.indexOf("oros-") === 0);
  assert.ok(!read("sync.js").includes('"oros-lock'), "sync.js never names the lock keys");
  const src = read("lock.js");
  assert.ok(!/registerSlice/.test(src));
  assert.ok(!/\beval\b|new Function/.test(src));
});

test("index.html loads lock.js before sync.js and shell.js", () => {
  const html = read("index.html");
  const at = (f) => html.indexOf('<script src="' + f);
  assert.ok(at("lock.js") > at("translations.js"));
  assert.ok(at("lock.js") < at("sync.js"));
  assert.ok(at("lock.js") < at("shell.js"));
});

test("every lock string exists in English, Greek and German", () => {
  global.window = global.window || {};
  const shellKeys = read("lock.js").match(/"lock\.[a-zA-Z.]+"/g).map((k) => JSON.parse(k));
  const tr = read("translations.js");
  const de = read("i18n/de/shell.js");
  new Set(shellKeys.concat(["menu.lock", "lock.recovered"])).forEach((k) => {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, k + " in en + el");
    assert.ok(de.includes('"' + k + '":'), k + " in de");
  });
  const S = require("../settings/core.js");
  const setKeys = read("settings/settings.js").match(/"l\.[a-zA-Z.]+"/g).map((k) => JSON.parse(k));
  const deSet = read("i18n/de/settings.js");
  ["s.lock", "d.lock"].concat(setKeys).forEach((k) => {
    if (/\.$/.test(k)) return;                   // a prefix ("l.msg." + code)
    assert.ok(S.STRINGS.en[k], k + " en");
    assert.ok(S.STRINGS.el[k], k + " el");
    assert.ok(deSet.includes('"' + k + '":'), k + " de");
  });
  ["wrong", "pin", "short", "long", "storage", "busy", "crypto", "wait", "mismatch", "working", "on", "off", "changed"]
    .forEach((c) => { assert.ok(S.STRINGS.en["l.msg." + c] && S.STRINGS.el["l.msg." + c], "l.msg." + c); });
  assert.ok(S.SECTIONS.includes("lock"));
  assert.equal(S.scopeOf("lock"), "device");
});

// ---------- orosSync.checkPassphrase ----------

test("checkPassphrase: this device's passphrase in memory", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  assert.equal(await A.sync.checkPassphrase("test-passphrase"), true);
  assert.equal(await A.sync.checkPassphrase("nope"), false);
  assert.equal(await A.sync.checkPassphrase(""), false);
});

test("checkPassphrase: without it here, the cloud blob decides and nothing is applied", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A", { "oros-slices": { notes: "app-notes" } });
  writeKey(A, "app-notes", { items: { a: 1 } });
  A.sync.markDirty();
  await A.sync.push();

  const B = await createDevice(db, "B", { "oros-slices": { notes: "app-notes" } });
  B.sync.forgetPassphrase();
  writeKey(B, "app-notes", { items: { b: 2 } });
  assert.equal(await B.sync.checkPassphrase("wrong one"), false);
  assert.equal(await B.sync.checkPassphrase("test-passphrase"), true);
  assert.deepEqual(readKey(B, "app-notes"), { items: { b: 2 } }, "nothing applied");
  assert.equal(B.sync.hasPassphrase(), false, "the session passphrase is not set by a check");
});

test("checkPassphrase: an empty cloud or no connection cannot tell (null)", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  A.sync.forgetPassphrase();
  assert.equal(await A.sync.checkPassphrase("anything"), null, "empty cloud proves nothing");
  const C = await createDevice(new FakeDropbox(), "C", null, { connect: false });
  C.sync.forgetPassphrase();
  assert.equal(await C.sync.checkPassphrase("anything"), null);
});
