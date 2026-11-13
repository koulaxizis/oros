// Reply boxes on the share relay (relay/share.js, op "shr" act "box" /
// "boxes", PUT/GET /s/<box>/0): one write, then only the read token
// reads it; the unfinished-upload purge leaves a waiting box alone;
// its 64 KB stay reserved in the store total, which lives in one row
// (shr_tot) so no statement sums shr_obj. On a real SQLite database
// (node:sqlite) behind a D1-shaped adapter, as in share-short.test.js.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
let handle, S;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  S = await import("../relay/share.js");
});

const ORIGIN = "https://useoros.online";
const BASE = "https://oros-mail-relay.koulaxizis.workers.dev";
const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 13, 12, 0, 0);

function d1() {
  const db = new DatabaseSync(":memory:");
  let fail = false;
  const log = [];
  const val = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v);
  function stmt(sql, args) {
    const go = (fn) => { if (fail) throw new Error("D1_ERROR: secret detail"); log.push(sql); return fn(db.prepare(sql)); };
    const a = () => (args || []).map(val);
    return {
      bind: (...x) => stmt(sql, x),
      first: async () => go((p) => { const r = p.get(...a()); return r ? Object.assign({}, r) : null; }),
      all: async () => go((p) => ({ results: p.all(...a()).map((r) => Object.assign({}, r)) })),
      run: async () => go((p) => { const r = p.run(...a()); return { meta: { changes: Number(r.changes) } }; }),
      _run: () => go((p) => { const r = p.run(...a()); return { meta: { changes: Number(r.changes) } }; })
    };
  }
  // a D1 batch is one transaction
  async function batch(ss) {
    if (fail) throw new Error("D1_ERROR: secret detail");
    db.exec("BEGIN");
    try { const out = ss.map((s) => s._run()); db.exec("COMMIT"); return out; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  return { db, log, prepare: (sql) => stmt(sql), batch, breakIt: (v) => { fail = v; } };
}

let ipN = 0;
const nextIp = () => "10.8." + (ipN >> 8 & 255) + "." + (ipN++ & 255);
const b64u = (u) => Buffer.from(u).toString("base64url");
const rnd = (n) => {                     // getRandomValues fills at most 64 KiB a call
  const u = new Uint8Array(n);
  for (let o = 0; o < n; o += 65536) crypto.getRandomValues(u.subarray(o, Math.min(n, o + 65536)));
  return u;
};
const newId = () => b64u(rnd(16));
const secret = () => b64u(rnd(32));
const hex = async (s) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).toString("hex");

async function op(env, body, o) {
  o = o || {};
  const r = new Request(BASE + "/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": o.ip || nextIp() },
    body: JSON.stringify(Object.assign({ op: "shr" }, body)) });
  const res = await handle(r, env, null, o.now || T0);
  return { status: res.status, body: await res.json() };
}
async function piece(env, method, id, i, o) {
  o = o || {};
  const h = { "CF-Connecting-IP": o.ip || nextIp(), Origin: o.origin || ORIGIN };
  if (o.tok) h.Authorization = "Bearer " + o.tok;
  const res = await handle(new Request(BASE + "/s/" + id + "/" + i, { method, headers: h, body: o.body }), env, null, o.now || T0);
  const bytes = res.status === 200 && method === "GET" ? new Uint8Array(await res.arrayBuffer()) : null;
  return { status: res.status, bytes, text: bytes ? "" : await res.text() };
}
async function boxes(env, n, exp) {
  const list = [];
  for (let k = 0; k < n; k++) list.push({ id: newId(), rt: secret(), wt: secret() });
  const r = await op(env, { act: "box", exp: exp || T0 + 37 * DAY,
    boxes: await Promise.all(list.map(async (x) => ({ id: x.id, rh: await hex(x.rt), wh: await hex(x.wt) }))) });
  return { r, list };
}
const fresh = () => ({ SHR_DB: d1() });
const real = (D) => D.db.prepare("SELECT COALESCE(SUM(size), 0) AS s FROM shr_obj").get().s
  + (D.db.prepare("SELECT s FROM shl_tot WHERE id = 1").get() || { s: 0 }).s;
const counted = (D) => D.db.prepare("SELECT s FROM shr_tot WHERE id = 1").get().s
  + (D.db.prepare("SELECT s FROM shl_tot WHERE id = 1").get() || { s: 0 }).s;

test("a box takes one write; then only the read token reads it, and deletes it", async () => {
  const env = fresh();
  const { r, list: [b] } = await boxes(env, 1);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, { exp: T0 + 37 * DAY });
  const reply = rnd(5000);
  assert.equal((await piece(env, "PUT", b.id, 0, { tok: b.wt, body: reply })).status, 200);
  const again = await piece(env, "PUT", b.id, 0, { tok: b.wt, body: rnd(10) });
  assert.equal(again.status, 409, "write once");
  // the read token reads it, byte for byte
  const g = await piece(env, "GET", b.id, 0, { tok: b.rt });
  assert.equal(g.status, 200);
  assert.deepEqual(g.bytes, reply);
  // no token, or the write token, reads nothing
  assert.equal((await piece(env, "GET", b.id, 0)).status, 404);
  assert.equal((await piece(env, "GET", b.id, 0, { tok: b.wt })).status, 404);
  // the write token does not delete it; the read token does
  await op(env, { act: "del", id: b.id, del: b.wt });
  assert.equal((await piece(env, "GET", b.id, 0, { tok: b.rt })).status, 200);
  assert.deepEqual((await op(env, { act: "del", id: b.id, del: b.rt })).body.data, { ok: true });
  assert.equal((await piece(env, "GET", b.id, 0, { tok: b.rt })).status, 404);
  assert.equal(env.SHR_DB.db.prepare("SELECT COUNT(*) AS c FROM shr_chunk").get().c, 0);
  assert.equal(counted(env.SHR_DB), real(env.SHR_DB));
});

test("write-once holds when two answers race", async () => {
  const env = fresh();
  const { list: [b] } = await boxes(env, 1);
  const rs = await Promise.all([1, 2, 3].map((n) => piece(env, "PUT", b.id, 0, { tok: b.wt, body: new Uint8Array([n]) })));
  assert.deepEqual(rs.map((x) => x.status).sort(), [200, 409, 409]);
  const g = await piece(env, "GET", b.id, 0, { tok: b.rt });
  const won = rs.findIndex((x) => x.status === 200) + 1;
  assert.deepEqual([...g.bytes], [won]);
  assert.equal(env.SHR_DB.db.prepare("SELECT COUNT(*) AS c FROM shr_chunk").get().c, 1);
});

test("a wrong token, an expired box and no box look the same; size and piece rules", async () => {
  const env = fresh();
  const { list: [b] } = await boxes(env, 1, T0 + DAY);
  const missing = await piece(env, "PUT", newId(), 0, { tok: b.wt, body: rnd(4) });
  const wrong = await piece(env, "PUT", b.id, 0, { tok: secret(), body: rnd(4) });
  const late = await piece(env, "PUT", b.id, 0, { tok: b.wt, body: rnd(4), now: T0 + DAY });
  assert.deepEqual([missing.status, wrong.status, late.status], [404, 404, 404]);
  assert.equal(missing.text, wrong.text);
  assert.equal(wrong.text, late.text);
  assert.equal((await piece(env, "PUT", b.id, 1, { tok: b.wt, body: rnd(4) })).status, 400);
  assert.equal((await piece(env, "PUT", b.id, 0, { tok: b.wt, body: new Uint8Array(0) })).status, 400);
  assert.equal((await piece(env, "PUT", b.id, 0, { tok: b.wt, body: rnd(S.SHR_LIMITS.boxBytes + 1) })).status, 413);
  assert.equal((await piece(env, "PUT", b.id, 0, { tok: b.wt, body: rnd(4), origin: "https://evil.example" })).status, 403);
  // a filled box: a wrong token still says 404, never 409
  assert.equal((await piece(env, "PUT", b.id, 0, { tok: b.wt, body: rnd(S.SHR_LIMITS.boxBytes) })).status, 200);
  assert.equal((await piece(env, "PUT", b.id, 0, { tok: secret(), body: rnd(4) })).status, 404);
  // fin never finishes a box; an expired box reads nothing
  assert.equal((await op(env, { act: "fin", id: b.id, tok: b.wt })).status, 404);
  assert.equal((await piece(env, "GET", b.id, 0, { tok: b.rt, now: T0 + DAY })).status, 404);
});

test("boxes: one call tells wait, ready or gone; a wrong read token is gone", async () => {
  const env = fresh();
  const { list } = await boxes(env, 3);
  await piece(env, "PUT", list[1].id, 0, { tok: list[1].wt, body: rnd(9) });
  await op(env, { act: "del", id: list[2].id, del: list[2].rt });
  const other = newId();
  const r = await op(env, { act: "boxes", boxes: [...list.map((x) => ({ id: x.id, rt: x.rt })), { id: other, rt: secret() },
                                                 { id: list[0].id === other ? newId() : newId(), rt: secret() }] });
  assert.equal(r.status, 200);
  const st = r.body.data.st;
  assert.equal(st[list[0].id], "wait");
  assert.equal(st[list[1].id], "ready");
  assert.equal(st[list[2].id], "gone");
  assert.equal(st[other], "gone");
  const bad = await op(env, { act: "boxes", boxes: [{ id: list[1].id, rt: list[1].wt }] });
  assert.equal(bad.body.data.st[list[1].id], "gone", "the write token is not a read token");
  assert.equal((await op(env, { act: "boxes", boxes: [{ id: list[0].id, rt: list[0].rt }] }, { now: T0 + 37 * DAY })).body.data.st[list[0].id], "gone");
  // a share item is never a box
  const sid = newId();
  await op(env, { act: "new", id: sid, delh: await hex(secret()), exp: T0 + DAY, n: 1, size: 4 });
  assert.equal((await op(env, { act: "boxes", boxes: [{ id: sid, rt: secret() }] })).body.data.st[sid], "gone");
});

test("validation: at most 20 boxes a call, 50 asked about, expiry up to 120 days, hashes and ids", async () => {
  const env = fresh();
  const h = await hex("x");
  const one = (o) => Object.assign({ id: newId(), rh: h, wh: h }, o);
  const bad = async (body) => (await op(env, body)).status;
  assert.equal(await bad({ act: "box", exp: T0 + DAY, boxes: [] }), 400);
  assert.equal(await bad({ act: "box", exp: T0 + DAY, boxes: Array.from({ length: 21 }, () => one()) }), 400);
  assert.equal(await bad({ act: "box", exp: T0 + 121 * DAY, boxes: [one()] }), 400);
  assert.equal(await bad({ act: "box", exp: T0, boxes: [one()] }), 400);
  assert.equal(await bad({ act: "box", exp: T0 + DAY, boxes: [one({ rh: "ab" })] }), 400);
  assert.equal(await bad({ act: "box", exp: T0 + DAY, boxes: [one({ id: "short" })] }), 400);
  const dup = one();
  assert.equal(await bad({ act: "box", exp: T0 + DAY, boxes: [dup, Object.assign({}, dup)] }), 400);
  assert.equal(await bad({ act: "boxes", boxes: Array.from({ length: 51 }, () => ({ id: newId(), rt: secret() })) }), 400);
  assert.equal(await bad({ act: "boxes", boxes: [{ id: newId(), rt: h }] }), 400);
  assert.equal((await op(env, { act: "box", exp: T0 + 120 * DAY, boxes: Array.from({ length: 20 }, () => one()) })).status, 200);
  // an id in use: none of the call's boxes stays
  const taken = newId();
  await op(env, { act: "box", exp: T0 + DAY, boxes: [one({ id: taken })] });
  const fresh2 = newId();
  const r = await op(env, { act: "box", exp: T0 + DAY, boxes: [one({ id: fresh2 }), one({ id: taken })] });
  assert.equal(r.status, 409);
  assert.equal(env.SHR_DB.db.prepare("SELECT COUNT(*) AS c FROM shr_obj WHERE id = ?1").get(fresh2).c, 0);
  assert.equal(counted(env.SHR_DB), real(env.SHR_DB));
});

test("the purge leaves a waiting box alone until its expiry; unfinished uploads still go", async () => {
  const env = fresh();
  const { list: [wait] } = await boxes(env, 1, T0 + 10 * DAY);
  const { list: [done] } = await boxes(env, 1, T0 + 10 * DAY);
  await piece(env, "PUT", done.id, 0, { tok: done.wt, body: rnd(9) });
  const up = newId();
  await op(env, { act: "new", id: up, delh: await hex(secret()), exp: T0 + DAY, n: 1, size: 4 });
  assert.equal(await S.purgeShares(env, T0 + 2 * 3600000), 1, "only the unfinished upload");
  assert.equal((await op(env, { act: "boxes", boxes: [{ id: wait.id, rt: wait.rt }] }, { now: T0 + 9 * DAY })).body.data.st[wait.id], "wait");
  assert.equal((await piece(env, "PUT", wait.id, 0, { tok: wait.wt, body: rnd(3), now: T0 + 9 * DAY })).status, 200);
  assert.equal(await S.purgeShares(env, T0 + 10 * DAY), 2, "both boxes at their expiry");
  assert.equal(env.SHR_DB.db.prepare("SELECT COUNT(*) AS c FROM shr_obj").get().c, 0);
  assert.equal(env.SHR_DB.db.prepare("SELECT COUNT(*) AS c FROM shr_chunk").get().c, 0);
  assert.equal(counted(env.SHR_DB), 0);
});

test("room: each box reserves 64 KB in the store total; full is 507; day limit as for new", async () => {
  const env = fresh();
  await boxes(env, 2);
  assert.equal(counted(env.SHR_DB), 2 * S.SHR_LIMITS.boxBytes);
  // the reservation stays whatever the answer's size
  const { list: [b] } = await boxes(env, 1);
  await piece(env, "PUT", b.id, 0, { tok: b.wt, body: rnd(10) });
  assert.equal(counted(env.SHR_DB), 3 * S.SHR_LIMITS.boxBytes);
  env.SHR_DB.db.prepare("UPDATE shr_tot SET s = ?1").run(S.SHR_LIMITS.store - S.SHR_LIMITS.boxBytes);
  const h = await hex("x");
  const full = await op(env, { act: "box", exp: T0 + DAY, boxes: [{ id: newId(), rh: h, wh: h }, { id: newId(), rh: h, wh: h }] });
  assert.equal(full.status, 507);
  assert.equal(full.body.error.code, "full");
  const env2 = fresh(), ip = "10.99.0.1";
  let last;
  for (let n = 0; n <= S.SHR_LIMITS.perIpDay; n++) last = await op(env2, { act: "box", exp: T0 + DAY, boxes: [{ id: newId(), rh: h, wh: h }] }, { ip });
  assert.equal(last.status, 429);
});

test("polling has its own per-minute limit", async () => {
  const env = fresh(), ip = "10.98.0.1";
  const q = { act: "boxes", boxes: [{ id: newId(), rt: secret() }] };
  for (let n = 0; n < S.SHR_LIMITS.pollPerMin; n++) assert.equal((await op(env, q, { ip })).status, 200);
  assert.equal((await op(env, q, { ip })).status, 429);
  assert.equal((await op(env, q, { ip, now: T0 + 61000 })).status, 200);
});

test("the store total lives in one row: seeded once, kept in step, never a SUM over shr_obj after", async () => {
  const env = fresh(), D = env.SHR_DB;
  // a database from before this row: items already there are counted once
  for (const sql of [S.SHR_SQL.obj, S.SHR_SQL.chunk]) D.db.exec(sql);
  D.db.prepare("INSERT INTO shr_obj (id, exp, size, n, delh, tokh, at, fin) VALUES ('old', ?1, 1234, 1, 'a', 'b', ?2, 1)").run(T0 + DAY, T0);
  const { list } = await boxes(env, 2);
  assert.equal(counted(D), 1234 + 2 * S.SHR_LIMITS.boxBytes);
  const sid = newId(), del = secret();
  const r = await op(env, { act: "new", id: sid, delh: await hex(del), exp: T0 + DAY, n: 1, size: 77 });
  assert.equal(r.status, 200);
  assert.equal(counted(D), real(D));
  await op(env, { act: "del", id: sid, del });
  await op(env, { act: "del", id: list[0].id, del: list[0].rt });
  await op(env, { act: "del", id: list[0].id, del: list[0].rt });       // twice: counted once
  assert.equal(counted(D), real(D));
  await S.purgeShares(env, T0 + 40 * DAY);
  assert.equal(counted(D), 0);
  assert.equal(real(D), 0);
  const sums = D.log.filter((s) => /SUM\s*\(\s*size\s*\)\s*,?\s*0?\s*\)?\s*FROM shr_obj/i.test(s) && s !== S.SHR_SQL.tot1);
  assert.deepEqual(sums, []);
  assert.equal(D.log.filter((s) => s === S.SHR_SQL.tot1).length, 1, "the seed runs with the schema, once");
});

test("no D1 or a failing one: fixed answers, nothing thrown", async () => {
  const env = fresh();
  const { list: [b] } = await boxes(env, 1);
  env.SHR_DB.breakIt(true);
  const p = await piece(env, "PUT", b.id, 0, { tok: b.wt, body: rnd(3) });
  assert.equal(p.status, 503);
  assert.doesNotMatch(p.text, /secret/);
  const o = await op(env, { act: "boxes", boxes: [{ id: b.id, rt: b.rt }] });
  assert.equal(o.status >= 500, true);
  assert.doesNotMatch(JSON.stringify(o.body), /secret/);
  assert.equal((await op({}, { act: "boxes", boxes: [{ id: b.id, rt: b.rt }] })).status, 503);
});
