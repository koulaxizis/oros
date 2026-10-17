// Links with an expiry, browser side (share/relay.js) against the real
// relay code (relay/core.js + relay/share.js) on an in-memory D1, and
// "My shared links" (share/out.js): its merge and its store.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const R = require(path.join(ROOT, "share/relay.js"));
const O = require(path.join(ROOT, "share/out.js"));
const K = require(path.join(ROOT, "share/kinds.js"));
let handle, SR;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  SR = await import("../relay/share.js");
  R._setIter(1000);                 // PBKDF2 rounds: fast in tests, 600,000 in orOS
});
const DAY = 86400000;
const ORIGIN = "https://useoros.online";

function fakeD1() {
  const objs = new Map(), chunks = new Map();     // chunks: "id|i" → {id,i,len,data}
  const log = [];
  function chunksOf(id) { return [...chunks.values()].filter((c) => c.id === id); }
  function exec(sql, a) {
    const Q = SR.SHR_SQL;
    log.push(sql);
    switch (sql) {
      case Q.obj: case Q.chunk: case Q.indexExp: case Q.indexOpen: return { meta: {} };
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
  return { D, env, clock, seen, fetch };
}
const note = (x) => K.pack("note", { t: "Groceries 🛒", x });

test("a note goes up encrypted and opens back with its expiry", async () => {
  const s = setup();
  const env = note("milk, bread, Φέτα");
  const r = await R.create(env, { days: 7, fetch: s.fetch, now: s.clock.now });
  assert.match(r.code, /^r1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\.1$/);
  assert.equal(r.exp, s.clock.now + 7 * DAY);
  assert.equal(R.parse(r.code).id, r.id);
  // the relay never got the key, the title or the text
  const key = R.parse(r.code).key;
  for (const c of s.seen) {
    const b = c.body instanceof Uint8Array ? Buffer.from(c.body).toString("latin1") : String(c.body || "");
    assert.ok(!c.url.includes(key) && !b.includes(key), "key sent");
    assert.ok(!b.includes("Groceries") && !b.includes("milk"), "clear text sent");
    assert.ok(!b.includes(r.del), "revoke secret sent");
  }
  const o = await R.open(r.code, { fetch: s.fetch });
  assert.deepEqual(o.e, env);
  assert.equal(o.x, r.exp);
});

test("expiry choices: 1, 7, 30 days; anything else is 7", async () => {
  const s = setup();
  for (const [d, want] of [[1, 1], [30, 30], [5, 7], [undefined, 7]]) {
    const r = await R.create(note("x"), { days: d, fetch: s.fetch, now: s.clock.now });
    assert.equal(r.exp - s.clock.now, want * DAY);
  }
});

test("password: q1 link, wrong or missing password says pass", async () => {
  const s = setup();
  const r = await R.create(note("secret plan"), { password: "correct horse", fetch: s.fetch });
  assert.match(r.code, /^q1\./);
  assert.ok(R.isLocked(r.code));
  assert.deepEqual(await R.open(r.code, { fetch: s.fetch }), { error: "pass" });
  assert.deepEqual(await R.open(r.code, { password: "wrong one", fetch: s.fetch }), { error: "pass" });
  const o = await R.open(r.code, { password: "correct horse", fetch: s.fetch });
  assert.equal(o.e.d.x, "secret plan");
  // the key alone (as an r1 link) does not open it
  const c = R.parse(r.code);
  const bare = "r1." + c.id + "." + c.key + "." + c.n;
  assert.deepEqual(await R.open(bare, { fetch: s.fetch }), { error: "bad" });
});

test("big items go in several pieces and come back whole", async () => {
  const s = setup();
  // incompressible text, so it really needs several 256 KiB pieces
  let x = "";
  const abc = "abcdefghijklmnopqrstuvwxyzαβγδεζηθικλμνξοπρστυφχψω0123456789";
  for (let i = 0; i < 400000; i++) x += abc[(Math.random() * abc.length) | 0];
  const env = { v: 1, k: "note", d: { t: "Long", x } };          // past the 20,000 note cap on purpose
  const r = await R.create(env, { fetch: s.fetch });
  const n = R.parse(r.code).n;
  assert.ok(n >= 2, "pieces " + n);
  const o = await R.open(r.code, { fetch: s.fetch });
  assert.equal(o.e.d.x, x);
});

test("revoked, expired and unknown links say gone; a broken link says bad", async () => {
  const s = setup();
  const a = await R.create(note("a"), { fetch: s.fetch, days: 1, now: s.clock.now });
  await R.revoke(a.id, a.del, { fetch: s.fetch });
  assert.deepEqual(await R.open(a.code, { fetch: s.fetch }), { error: "gone" });
  const b = await R.create(note("b"), { fetch: s.fetch, days: 1, now: s.clock.now });
  s.clock.now += DAY + 1;
  assert.deepEqual(await R.open(b.code, { fetch: s.fetch }), { error: "gone" });
  const c = R.parse(b.code);
  assert.deepEqual(await R.open("r1." + "A".repeat(22) + "." + c.key + ".1", { fetch: s.fetch }), { error: "gone" });
  assert.deepEqual(await R.open("r1.short.key.1", { fetch: s.fetch }), { error: "bad" });
  assert.equal(R.parse("q1." + c.id + "." + c.key + ".1"), null);          // q1 needs a salt
  assert.equal(R.parse("r1." + c.id + "." + c.key + ".201"), null);
  // a piece changed on the relay does not open
  const d = await R.create(note("d"), { fetch: s.fetch });
  const ch = [...s.D.chunks.values()].find((x) => x.id === d.id);
  const bytes = new Uint8Array(ch.data); bytes[20] ^= 1;
  assert.deepEqual(await R.open(d.code, { fetch: s.fetch }), { error: "bad" });
});

test("relay errors reach the sender as codes", async () => {
  const s = setup();
  await assert.rejects(R.create(note("x"), { fetch: relayFetch({}, s.clock) }), /nostore/);
  await assert.rejects(R.create(note("x"), { fetch: async () => { throw new Error("offline"); } }), /net/);
  assert.deepEqual(await R.open("r1." + "A".repeat(22) + "." + "B".repeat(43) + ".1", { fetch: async () => { throw new Error("offline"); } }), { error: "net" });
});

test("pieces are bound to their link: swapped pieces do not open", async () => {
  const id = "A".repeat(22), key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const plain = new Uint8Array(600000);
  for (let i = 0; i < plain.length; i += 65536) crypto.getRandomValues(plain.subarray(i, Math.min(plain.length, i + 65536)));
  const p = await R.seal(key, id, plain);
  assert.equal(p.length, 3);
  assert.ok(p.every((x) => x.length <= R.PIECE));
  assert.deepEqual(await R.unseal(key, id, p), plain);
  await assert.rejects(R.unseal(key, id, [p[1], p[0], p[2]]), /bad/);
  await assert.rejects(R.unseal(key, "B".repeat(22), p), /bad/);
  await assert.rejects(R.unseal(key, id, p.slice(0, 2)), /bad/);
});

test("unpack refuses junk and decompression bombs", async () => {
  await assert.rejects(R.unpack(new Uint8Array([7, 1, 2])), /bad/);
  await assert.rejects(R.unpack(new Uint8Array([0, 0x7b])), /bad/);
  const s = new Blob([new Uint8Array(R.MAX_PLAIN + 1024)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const z = new Uint8Array(await new Response(s).arrayBuffer());
  const bomb = new Uint8Array(z.length + 1); bomb[0] = 1; bomb.set(z, 1);
  await assert.rejects(R.unpack(bomb), /big/);
});

// ---------- My shared links ----------
const id = (c) => c.repeat(22);
function live(c, a, x, extra) {
  return Object.assign({ c: "r1." + id(c) + "." + "k".repeat(43) + ".1", d: "d".repeat(43), k: "note", t: "T" + c, x, a }, extra || {});
}
test("merge: union, a revoke wins, secrets of revoked links go", () => {
  const A = { v: 1, items: { [id("a")]: live("a", 100, 10 * DAY), [id("b")]: live("b", 200, 10 * DAY) } };
  const B = { v: 1, items: { [id("b")]: { k: "note", t: "Tb", x: 10 * DAY, a: 200, g: 1 }, [id("c")]: live("c", 300, 10 * DAY) } };
  const m = O.merge(A, B);
  assert.deepEqual(Object.keys(m.items), [id("a"), id("b"), id("c")]);
  assert.equal(m.items[id("b")].g, 1);
  assert.equal("d" in m.items[id("b")], false);
  assert.equal("c" in m.items[id("b")], false);
  assert.deepEqual(O.merge(A, B), O.merge(B, A));
});

test("merge is associative and idempotent, and drops long-expired links", () => {
  const mk = (seed) => {
    const items = {};
    for (let i = 0; i < 8; i++) {
      const c = "abcdefghijkl"[(seed * 7 + i * 3) % 12];
      const a = 1000 + ((seed * 13 + i * 17) % 50) * DAY;
      items[id(c)] = (seed + i) % 3 === 0 ? { k: "list", t: "x", x: a + 7 * DAY, a, g: 1 } : live(c, a, a + ((i % 3) + 1) * 7 * DAY);
    }
    return { v: 1, items };
  };
  for (let s = 0; s < 30; s++) {
    const A = mk(s), B = mk(s + 1), C = mk(s + 2);
    assert.deepEqual(O.merge(O.merge(A, B), C), O.merge(A, O.merge(B, C)), "assoc " + s);
    assert.deepEqual(O.merge(O.merge(A, B), O.merge(A, B)), O.merge(A, B), "idem " + s);
    assert.deepEqual(O.merge(A, B), O.merge(B, A), "comm " + s);
    const m = O.merge(A, B), newest = Math.max(...Object.values(m.items).map((e) => e.a));
    assert.ok(Object.values(m.items).every((e) => e.x >= newest));
  }
});

test("merge refuses junk entries", () => {
  const m = O.merge({ v: 1, items: {
    bad: live("a", 1, 2),                                              // id not 22 chars
    [id("a")]: live("b", 1, 2),                                        // code for another id
    [id("c")]: Object.assign(live("c", 1, 2), { d: "short" }),
    [id("e")]: Object.assign(live("e", 1, 2), { t: "<b>x</b>\u0000" + "y".repeat(300), k: "Not-A-Kind" })
  } }, null);
  assert.deepEqual(Object.keys(m.items), [id("e")]);
  assert.equal(m.items[id("e")].t.length, 120);
  assert.equal(m.items[id("e")].k, "note");
});

test("store: add, list (newest first, live only), revoke mark, sync marked dirty", () => {
  const mem = new Map();
  let dirty = 0;
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  globalThis.orosSync = { markDirty: () => dirty++ };
  try {
    const now = Date.now();
    assert.ok(O.add(Object.assign({ id: id("a") }, live("a", now - 2000, now + DAY))));
    assert.ok(O.add(Object.assign({ id: id("b") }, live("b", now - 1000, now + DAY, { p: 1 }))));
    assert.equal(O.add({ id: "nope" }), false);
    assert.deepEqual(O.list(now).map((e) => e.id), [id("b"), id("a")]);
    assert.equal(O.list(now)[0].p, 1);
    assert.ok(O.markRevoked(id("a")));
    assert.deepEqual(O.list(now).map((e) => e.id), [id("b")]);
    assert.deepEqual(O.list(now + 2 * DAY), []);
    assert.equal(dirty, 3);
    assert.equal(JSON.parse(mem.get(O.KEY)).items[id("a")].g, 1);
  } finally { delete globalThis.localStorage; delete globalThis.orosSync; }
});

test("the shell loads out.js at boot and relay.js before send.js; the page loads relay.js under a CSP", () => {
  const fs = require("fs");
  const idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.match(idx, /<script src="share\/out\.js\?v=/);
  const sh = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
  assert.match(sh, /load\("share\/kinds\.js"\)[\s\S]{0,120}load\("share\/relay\.js"\)[\s\S]{0,120}load\("share\/send\.js"\)/);
  assert.match(sh, /registerSlice\("shareOut"/);
  const page = fs.readFileSync(path.join(ROOT, "share/index.html"), "utf8");
  assert.match(page, /<script src="relay\.js\?v=/);
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(page);
  assert.ok(csp);
  assert.match(csp[1], /script-src 'self';/);
  assert.match(csp[1], /connect-src 'self' https:\/\/oros-mail-relay\.koulaxizis-25b\.workers\.dev;/);
  assert.doesNotMatch(csp[1], /unsafe/);
  // the page's relay address is the one relay.js uses
  assert.ok(csp[1].includes(R.RELAY));
});

test("a whole calendar of 5,000 events travels with an expiry and opens whole", async () => {
  const s = setup();
  const ev = Array.from({ length: 5000 }, (_, i) => ({ id: "e" + i, t: "Event " + i, d: "2026-" + String(1 + i % 12).padStart(2, "0") + "-" + String(1 + i % 28).padStart(2, "0"),
    s: "09:00", e: "10:00", l: "Room " + (i % 40), x: "Note " + i }));
  const env = K.pack("cal", { t: "Team", tz: "Europe/Athens", ev });
  assert.equal(env.d.ev.length, 5000);
  const r = await R.create(env, { days: 30, fetch: s.fetch, now: s.clock.now });
  assert.ok(r.code.split(".")[3] >= 1);
  const o = await R.open(r.code, { fetch: s.fetch });
  assert.deepEqual(K.pack(o.e.k, o.e.d), env);
});
