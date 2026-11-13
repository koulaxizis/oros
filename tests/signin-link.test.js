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

function fakeD1() {
  const objs = new Map(), chunks = new Map();     // chunks: "id|i" → {id,i,len,data}
  const log = [];
  function chunksOf(id) { return [...chunks.values()].filter((c) => c.id === id); }
  function exec(sql, a) {
    const Q = SR.SHR_SQL;
    log.push(sql);
    switch (sql) {
      case Q.obj: case Q.chunk: case Q.indexExp: case Q.indexOpen: case Q.shl: case Q.shlLast: case Q.shlDay: case Q.shlTot: case Q.shlTot1: return { meta: {} };
      case Q.getObj: { const o = objs.get(a[0]); return { first: o ? { ...o } : null }; }
      case Q.used: return { first: { s: [...objs.values()].reduce((x, o) => x + o.size, 0) } };
      case Q.addObj:
        if (objs.has(a[0])) return { meta: { changes: 0 } };
        objs.set(a[0], { exp: a[1], size: a[2], n: a[3], delh: a[4], tokh: a[5], at: a[6], fin: 0 });
        return { meta: { changes: 1 } };
      case Q.got: { const cs = chunksOf(a[0]); return { first: { c: cs.length, s: cs.reduce((x, c) => x + c.len, 0) } }; }
      case Q.addChunk: {
        const k = a[0] + "|" + a[1];
        if (chunks.has(k)) return { meta: { changes: 0 } };
        assert.ok(a[3] instanceof ArrayBuffer, "pieces are stored as BLOB");
        chunks.set(k, { id: a[0], i: a[1], len: a[2], data: a[3] });
        return { meta: { changes: 1 } };
      }
      case Q.dropChunk: chunks.delete(a[0] + "|" + a[1]); return { meta: {} };
      case Q.fin: { const o = objs.get(a[0]); if (o && !o.fin) { o.fin = 1; return { meta: { changes: 1 } }; } return { meta: { changes: 0 } }; }
      case Q.read: {
        const o = objs.get(a[0]), c = chunks.get(a[0] + "|" + a[1]);
        return { first: o && c && o.fin === 1 && o.exp > a[2] ? { data: Array.from(new Uint8Array(c.data)) } : null };
      }
      case Q.dropChunks: for (const c of chunksOf(a[0])) chunks.delete(c.id + "|" + c.i); return { meta: {} };
      case Q.dropObj: objs.delete(a[0]); return { meta: {} };
      case Q.stale: return { all: [...objs.entries()].filter(([, o]) => o.exp <= a[0] || (o.fin === 0 && o.at < a[1])).slice(0, a[2]).map(([id]) => ({ id })) };
    }
    throw new Error("unknown SQL " + sql);
  }
  function stmt(sql, args) {
    return { bind: (...b) => stmt(sql, b), first: async () => exec(sql, args || []).first,
             all: async () => ({ results: exec(sql, args || []).all }), run: async () => exec(sql, args || []),
             _run: () => exec(sql, args || []) };
  }
  return { objs, chunks, log, prepare: (sql) => stmt(sql), batch: async (ss) => ss.map((s) => s._run()) };
}


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
