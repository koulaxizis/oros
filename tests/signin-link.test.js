// LINK-1 — sign-in link: a signed-in device seals the PAIR-1 bundle as
// a password link of "Send to someone" (pair.js sendLink over
// share/relay.js), against the real relay code (relay/core.js +
// relay/share.js) on an in-memory D1; a new browser opens it with the
// 8-character code (openLink), adopts it (sync.js pairAdopt) and
// deletes it.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const R = require(path.join(ROOT, "share/relay.js"));
const P = require(path.join(ROOT, "pair.js"));
const { RealFakeDropbox, createDevice, writeKey, readKey } = require("./harness");
let handle, SR;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  SR = await import("../relay/share.js");
  R._setIter(1000);                 // PBKDF2 rounds: fast in tests, 600,000 in orOS
});
const ORIGIN = "https://useoros.online";
const SLICES = { "oros-slices": { notes: "app-notes" } };

// relay/share.js on an in-memory D1 (tests/shr-fake.js)
function fakeD1() { return require("./shr-fake.js").fakeD1(SR.SHR_SQL); }


// fetch as the browser on useoros.online would call the relay
function relayFetch(env, clock, seen) {
  let n = 0;
  return async (url, init) => {
    init = init || {};
    const h = Object.assign({}, init.headers || {}, { Origin: ORIGIN, "CF-Connecting-IP": "10.50." + (n >> 8 & 255) + "." + (n++ & 255) });
    if (seen) seen.push({ url, method: init.method || "GET", body: init.body });
    return handle(new Request(url, { method: init.method || "GET", headers: h, body: init.body }), env, null, clock.now);
  };
}
function setup() {
  const D = fakeD1(), env = { SHR_DB: D }, clock = { now: Date.now() }, seen = [];
  const fetch = relayFetch(env, clock, seen);
  return { D, env, clock, seen, fetch, o: { R, fetch, now: undefined } };
}
const BUNDLE = { v: 1, p: "dropbox", r: "refresh-SECRET-token", a: "access", e: 0, acc: { email: "me@example.org", name: "Me" }, pw: "correct horse battery" };

test("codes: 8 Crockford characters, typed loosely; links parse only as q1", () => {
  const c = P.newLinkCode();
  assert.match(c, P.LINK_CODE_RE);
  assert.equal(P.fmtLinkCode("ABCD2345"), "ABCD-2345");
  assert.equal(P.normLinkCode(" abcd-2345 "), "ABCD2345");
  assert.equal(P.normLinkCode("ABCD-23O5"), "ABCD2305", "O reads as 0");
  assert.equal(P.normLinkCode("ABCD-234"), "");
  assert.equal(P.normLinkCode("ABCD-2345-6789"), "");
  const share = "q1." + "a".repeat(22) + "." + "b".repeat(43) + ".1." + "c".repeat(22);
  assert.equal(P.linkFromText("https://useoros.online/#signin=" + share), share);
  assert.equal(P.linkFromText(share), share);
  assert.equal(P.linkFromText("r1." + "a".repeat(22) + "." + "b".repeat(43) + ".1"), "", "a link without a code is never a sign-in link");
  assert.equal(P.linkUrl(share, "http://localhost:8080"), "https://useoros.online/#signin=" + share, "a local copy links to useoros.online");
  assert.equal(P.linkUrl(share, "https://oros.example.org"), "https://oros.example.org/#signin=" + share);
});

test("send and open: the right code gets the bundle; the relay sees neither the code nor the bundle", async () => {
  const s = setup();
  const r = await P.sendLink(BUNDLE, Object.assign({ dev: "Chrome · Windows", origin: ORIGIN }, s.o));
  assert.match(r.code, P.LINK_CODE_RE);
  assert.ok(r.url.startsWith(ORIGIN + "/#signin=q1."));
  assert.ok(!r.url.includes(r.code), "the code is not in the link");
  const lifetime = r.exp - Date.now();
  assert.ok(lifetime > 14 * 60000 && lifetime <= 15 * 60000 + 1000, "lives 15 minutes");
  const obj = s.D.objs.get(r.id);
  assert.ok(obj && obj.fin === 1);
  assert.equal(obj.exp, r.exp, "the relay deletes it at the same time");
  // Nothing the relay received holds the code, the token, the passphrase or the link key.
  const share = P.linkFromText(r.url), key = share.split(".")[2];
  for (const x of s.seen) {
    const body = x.body == null ? "" : typeof x.body === "string" ? x.body : Buffer.from(x.body).toString("latin1");
    for (const secret of [r.code, BUNDLE.r, BUNDLE.pw, key, "me@example.org"]) assert.ok(!body.includes(secret) && !x.url.includes(secret), "relay saw " + secret);
  }
  const wrong = await P.openLink(r.url, "ZZZZ-ZZZZ", s.o);
  assert.deepEqual(wrong, { error: "pass" });
  const got = await P.openLink(r.url, r.code.toLowerCase(), s.o);
  assert.deepEqual(got.b, BUNDLE);
  assert.equal(got.dev, "Chrome · Windows");
  assert.equal(got.id, r.id);
  assert.equal(got.del, r.del, "the revoke secret travels sealed inside");
});

test("one use: after the new browser deletes it, the link is gone for everyone", async () => {
  const s = setup();
  const r = await P.sendLink(BUNDLE, s.o);
  assert.equal(await P.linkAlive(r.id, { fetch: s.fetch }), true);
  const got = await P.openLink(r.url, r.code, s.o);
  await R.revoke(got.id, got.del, { fetch: s.fetch });
  assert.equal(s.D.objs.has(r.id), false);
  assert.deepEqual(await P.openLink(r.url, r.code, s.o), { error: "gone" });
  assert.equal(await P.linkAlive(r.id, { fetch: s.fetch }), false, "the sender sees it was used");
});

test("expiry: after 15 minutes the relay no longer hands it out", async () => {
  const s = setup();
  const r = await P.sendLink(BUNDLE, s.o);
  s.clock.now = Date.now() + 15 * 60000 + 1000;
  assert.deepEqual(await P.openLink(r.url, r.code, Object.assign({}, s.o, { now: s.clock.now })), { error: "gone" });
  assert.equal(await P.linkAlive(r.id, { fetch: s.fetch }), false);
});

test("the sender cancels: the link is gone", async () => {
  const s = setup();
  const r = await P.sendLink(BUNDLE, s.o);
  await R.revoke(r.id, r.del, { fetch: s.fetch });
  assert.deepEqual(await P.openLink(r.url, r.code, s.o), { error: "gone" });
});

test("anything else is refused: bad links, no code, a plain shared item with the same password", async () => {
  const s = setup();
  assert.deepEqual(await P.openLink("https://useoros.online/#signin=nope", "ABCD2345", s.o), { error: "bad" });
  const r = await P.sendLink(BUNDLE, s.o);
  assert.deepEqual(await P.openLink(r.url, "", s.o), { error: "pass" });
  // A "Send to someone" item locked with a password is not a sign-in bundle.
  const other = await R.create({ v: 1, k: "note", d: { t: "hi" } }, { days: 1, password: "ABCD2345", fetch: s.fetch });
  assert.deepEqual(await P.openLink(other.code, "ABCD2345", s.o), { error: "bad" });
  await assert.rejects(P.sendLink(null, s.o), /bad/);
});

test("share/relay.js: ms and del options; out-of-range values fall back", async () => {
  const s = setup();
  const del = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const a = await R.create({ v: 1, k: "note", d: {} }, { ms: 120000, del, fetch: s.fetch });
  assert.equal(a.del, del);
  assert.ok(a.exp - Date.now() <= 120000 + 1000);
  const b = await R.create({ v: 1, k: "note", d: {} }, { ms: 5, del: "short", days: 1, fetch: s.fetch });
  assert.notEqual(b.del, "short");
  assert.ok(b.exp - Date.now() > 23 * 3600000, "a too short ms keeps the days");
});

test("end to end: a new browser signs in from the link and syncs; the sign-in is shared", async () => {
  const db = new RealFakeDropbox();
  const A = await createDevice(db, "A", SLICES);
  writeKey(A, "app-notes", { items: { a: { v: "from A", t: 1 } } });
  A.sync.markDirty();
  await A.sync.push();
  const s = setup();
  const sent = await P.sendLink(await A.sync.pairBundle(), s.o);
  assert.equal(A.sync.isPaired(), true);

  const B = await createDevice(db, "B", SLICES, { connect: false });
  B.sync.forgetPassphrase();
  const got = await P.openLink(sent.url, sent.code, s.o);
  const res = await B.sync.pairAdopt(got.b, { session: false });
  await R.revoke(got.id, got.del, { fetch: s.fetch });
  assert.equal(B.sync.isConnected(), true);
  assert.equal(B.sync.isPaired(), true);
  B.sync.setPassphrase(res.pw, false);
  await B.sync.pull();
  assert.deepEqual(readKey(B, "app-notes"), { items: { a: { v: "from A", t: 1 } } });
  assert.equal(s.D.objs.size, 0, "nothing stays on the relay");
});
