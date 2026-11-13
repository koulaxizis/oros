// Forms, relay side (FORMS-2): the public routes /fm/<k> and the app's
// "frm" op (relay/forms.js through relay/core.js), on a real SQLite
// database (node:sqlite) behind a D1-shaped adapter, so every statement
// in FRM_SQL runs as SQL. The form and answers are made with the
// browser client forms/pub.js. Covers the Mail thread's conditions
// (/mnt/project-files/forms/w2-relay-review.md): caps, TTL purge, the
// push wake (gap, gone), the report threshold, "gone" for a wrong
// secret, CORS, honeypot, seats (Calendar RSVP), nothing in clear.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const P = require("../forms/pub.js");
let handle, F, purgeForms;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  F = await import("../relay/forms.js");
  purgeForms = F.purgeForms;
});

const ORIGIN = "https://useoros.online";
const BASE = "https://oros-mail-relay.koulaxizis.workers.dev";
const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 13, 12, 0, 0);

function d1() {
  const db = new DatabaseSync(":memory:");
  let fail = false;
  function stmt(sql, args) {
    const go = (fn) => { if (fail) throw new Error("D1_ERROR: secret detail"); return fn(db.prepare(sql)); };
    return {
      bind: (...a) => stmt(sql, a),
      first: async () => go((p) => { const r = p.get(...(args || [])); return r ? Object.assign({}, r) : null; }),
      all: async () => go((p) => ({ results: p.all(...(args || [])).map((r) => Object.assign({}, r)) })),
      run: async () => go((p) => { const r = p.run(...(args || [])); return { meta: { changes: Number(r.changes) } }; }),
      _run: () => go((p) => { const r = p.run(...(args || [])); return { meta: { changes: Number(r.changes) } }; })
    };
  }
  return { db, prepare: (sql) => stmt(sql), batch: async (ss) => ss.map((s) => s._run()), breakIt: (v) => { fail = v; } };
}
// A push namespace that records every wake.
function pushNs(answer) {
  const wakes = [];
  return { wakes, idFromName: (n) => n, get: (id) => ({ fetch: async (u, init) => {
    wakes.push(Object.assign({ id }, JSON.parse(init.body)));
    return new Response(JSON.stringify(answer || { ok: true }));
  } }) };
}
let ipN = 0;
const nextIp = () => "10.9." + (ipN >> 8 & 255) + "." + (ipN++ & 255);

async function op(env, body, now, o) {
  o = o || {};
  const r = new Request(BASE + "/v1", { method: "POST",
    headers: { Origin: o.origin || ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": nextIp() },
    body: JSON.stringify(Object.assign({ op: "frm" }, body)) });
  const res = await handle(r, env, null, now || T0);
  return { status: res.status, body: await res.json() };
}
async function fm(env, path, init, now, ip) {
  init = init || {};
  const h = Object.assign({ Origin: ORIGIN, "CF-Connecting-IP": ip || nextIp() }, init.headers || {});
  const res = await handle(new Request(BASE + path, Object.assign({}, init, { headers: h })), env, null, now || T0);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) {}
  return { status: res.status, body, text, headers: res.headers };
}
const post = (body) => ({ method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) });

let KEYS = null;
async function keys() { return KEYS || (KEYS = await P.newKeys()); }
const FORM = { id: "f1", title: "Survey", qs: [{ id: "q1", t: "text", label: "Name" }], set: {} };
async function setup(extra) {
  const D = d1();
  const env = Object.assign({ ALLOWED_ORIGINS: ORIGIN, NL_DB: D }, extra || {});
  const k = await keys();
  const def = await P.encDef(k.key, k.k, { v: 1, form: FORM, pub: k.pub });
  const r = await op(env, { act: "put", k: k.k, sec: k.sec, def });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  return { D, env, k, def };
}
async function answer(k, obj, opts) { return Object.assign({ v: await P.seal(k.pub, obj) }, opts || {}); }

test("no D1: the page gets 503 off, the op 503 nostore", async () => {
  const env = { ALLOWED_ORIGINS: ORIGIN };
  const k = await keys();
  const g = await fm(env, "/fm/" + k.k, { method: "GET" });
  assert.equal(g.status, 503);
  assert.equal(g.body.e, "off");
  const r = await op(env, { act: "peek", k: k.k, sec: k.sec });
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "nostore");
});

test("the link key opens the form only for its own k; the relay keeps no readable text", async () => {
  const { D, env, k } = await setup();
  const g = await fm(env, "/fm/" + k.k, { method: "GET" });
  assert.equal(g.status, 200);
  assert.equal(g.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(g.headers.get("Cache-Control"), "no-store");
  assert.equal(g.body.open, 1);
  const obj = await P.decDef(k.key, k.k, g.body.def);
  assert.equal(obj.form.title, "Survey");
  await assert.rejects(P.decDef(k.key, "zzzzzzzzzzzzzzzz", g.body.def));          // AAD binds it to k
  await assert.rejects(P.decDef(P.b64u(new Uint8Array(32)), k.k, g.body.def));    // another key
  const dump = JSON.stringify(D.db.prepare("SELECT * FROM frm_form").all());
  assert.doesNotMatch(dump, /Survey|Name/);
  assert.doesNotMatch(dump, new RegExp(k.sec));                                   // only its hash
});

test("routing and CORS: other origins are refused, unknown paths 404, preflight answered", async () => {
  const { env, k } = await setup();
  assert.equal((await fm(env, "/fm/" + k.k, { method: "GET", headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await fm(env, "/fm/" + k.k, { method: "GET", headers: { Origin: "" } })).status, 403);
  assert.equal((await fm(env, "/fm/SHORT", { method: "GET" })).status, 404);
  assert.equal((await fm(env, "/fm/" + k.k + "/x", { method: "GET" })).status, 404);
  assert.equal((await fm(env, "/fm/zzzzzzzzzzzzzzzz", { method: "GET" })).status, 404);
  const pre = await fm(env, "/fm/" + k.k, { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("Access-Control-Allow-Methods"), /POST/);
  assert.equal((await fm(env, "/fm/" + k.k, { method: "OPTIONS", headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await fm(env, "/fm/" + k.k, { method: "PUT", body: "x" })).status, 405);
  // the app's op stays origin-gated as before
  assert.equal((await op(env, { act: "peek", k: k.k, sec: k.sec }, T0, { origin: "https://evil.example" })).status, 403);
});

test("an answer: sealed for the form, pulled, opened, acked; counters follow", async () => {
  const { D, env, k } = await setup();
  const s = await fm(env, "/fm/" + k.k, post(await answer(k, { a: { q1: "Μαρία" }, t: T0 })));
  assert.deepEqual(s.body, { ok: true });
  assert.equal((await op(env, { act: "peek", k: k.k, sec: k.sec })).body.data.n, 1);
  const p = await op(env, { act: "pull", k: k.k, sec: k.sec, after: 0 });
  const rows = p.body.data.rows;
  assert.equal(rows.length, 1);
  assert.equal(p.body.data.more, false);
  assert.equal(p.body.data.open, 1);
  assert.deepEqual((await P.open(k.priv, rows[0].v)).a, { q1: "Μαρία" });
  assert.doesNotMatch(JSON.stringify(D.db.prepare("SELECT * FROM frm_q").all()), /Μαρία/);
  const a = await op(env, { act: "ack", k: k.k, sec: k.sec, upto: rows[0].id });
  assert.equal(a.body.data.n, 1);
  assert.equal((await op(env, { act: "peek", k: k.k, sec: k.sec })).body.data.n, 0);
  const tot = D.db.prepare("SELECT c, b FROM frm_tot").get();
  const form = D.db.prepare("SELECT dlen, wn, wb FROM frm_form").get();
  assert.equal(tot.c, 1);
  assert.equal(tot.b, form.dlen);                                                 // answers gone from the total
  assert.equal(form.wn, 0);
  assert.equal(form.wb, 0);
});

test("a wrong secret and a missing form get the same 'gone'", async () => {
  const { env, k } = await setup();
  const bad = await op(env, { act: "pull", k: k.k, sec: "Z".repeat(32), after: 0 });
  const missing = await op(env, { act: "pull", k: "zzzzzzzzzzzzzzzz", sec: k.sec, after: 0 });
  assert.equal(bad.status, 404);
  assert.deepEqual(bad.body, missing.body);
  assert.equal(bad.body.error.code, "gone");
  const steal = await op(env, { act: "put", k: k.k, sec: "Z".repeat(32), def: "A".repeat(64) });
  assert.equal(steal.body.error.code, "gone");                                    // nobody else replaces it
});

test("validation: bad k, sec, def, sizes and fields are refused before storage", async () => {
  const { env, k } = await setup();
  for (const b of [{ act: "nope" }, { act: "put", def: "!" }, { act: "put", def: "A".repeat(65537) },
                   { act: "upd", open: 2 }, { act: "upd", cap: -1 }, { act: "upd", push: { pid: "x" } },
                   { act: "pull" }, { act: "ack", upto: -1 }]) {
    const r = await op(env, Object.assign({ k: k.k, sec: k.sec }, b));
    assert.ok(r.status === 400 || r.status === 413, JSON.stringify(b).slice(0, 80));   // 413: over the /v1 body cap
  }
  assert.equal((await op(env, { act: "peek", k: "UPPERCASE1234567", sec: k.sec })).status, 400);
  // public: an answer over 16 KB, a body over 20 KB, not JSON, bad seats
  assert.equal((await fm(env, "/fm/" + k.k, post({ v: "A".repeat(16388) }))).body.e, "bad");
  assert.equal((await fm(env, "/fm/" + k.k, { method: "POST", body: "x".repeat(20481) })).status, 413);
  assert.equal((await fm(env, "/fm/" + k.k, { method: "POST", body: "not json" })).status, 400);
  assert.equal((await fm(env, "/fm/" + k.k, post({ v: "A".repeat(100), seats: 22 }))).status, 400);
  assert.equal((await fm(env, "/fm/" + k.k, post({ v: "A".repeat(100), yes: 3 }))).status, 400);
});

test("honeypot and closed forms store nothing; closing time is kept by the relay", async () => {
  const { D, env, k } = await setup();
  const hp = await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} }, { hp: "http://spam" })));
  assert.deepEqual(hp.body, { ok: true });
  assert.equal(D.db.prepare("SELECT COUNT(*) AS n FROM frm_q").get().n, 0);
  await op(env, { act: "upd", k: k.k, sec: k.sec, close: T0 + 1000 });
  assert.equal((await fm(env, "/fm/" + k.k, { method: "GET" }, T0 + 1000)).body.open, 0);
  assert.equal((await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} })), T0 + 2000)).body.e, "closed");
  await op(env, { act: "upd", k: k.k, sec: k.sec, close: 0, open: 0 });
  assert.equal((await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} })))).body.e, "closed");
  await op(env, { act: "upd", k: k.k, sec: k.sec, open: 1 });
  assert.deepEqual((await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} })))).body, { ok: true });
});

test("per-IP limits: 5 a minute and 20 a day per form, GET 60 a minute", async () => {
  const { env, k } = await setup();
  const v = await answer(k, { a: {} });
  const ip = "10.1.1.1";
  for (let i = 0; i < 5; i++) assert.deepEqual((await fm(env, "/fm/" + k.k, post(v), T0, ip)).body, { ok: true });
  assert.equal((await fm(env, "/fm/" + k.k, post(v), T0, ip)).status, 429);
  let ok = 5;
  for (let m = 1; m <= 5; m++) {
    for (let i = 0; i < 5; i++) if ((await fm(env, "/fm/" + k.k, post(v), T0 + m * 61000, ip)).body.ok) ok++;
  }
  assert.equal(ok, 20);
  assert.equal((await fm(env, "/fm/" + k.k, post(v), T0 + DAY, ip)).body.ok, true);  // a new day
  const gip = "10.1.1.2";
  for (let i = 0; i < 60; i++) assert.equal((await fm(env, "/fm/" + k.k, { method: "GET" }, T0, gip)).status, 200);
  assert.equal((await fm(env, "/fm/" + k.k, { method: "GET" }, T0, gip)).status, 429);
});

test("per-form caps: 500 a day, 1000 waiting, 5 MB waiting; the store total gives 507 full", async () => {
  const { D, env, k } = await setup();
  const v = await answer(k, { a: {} });
  D.db.prepare("UPDATE frm_form SET day = ?, dn = 500").run(Math.floor(T0 / DAY));
  assert.equal((await fm(env, "/fm/" + k.k, post(v))).body.e, "busy");
  D.db.prepare("UPDATE frm_form SET dn = 0, wn = 1000").run();
  assert.equal((await fm(env, "/fm/" + k.k, post(v))).body.e, "busy");
  D.db.prepare("UPDATE frm_form SET wn = 0, wb = ?").run(5 * 1048576 - 10);
  assert.equal((await fm(env, "/fm/" + k.k, post(v))).body.e, "busy");
  D.db.prepare("UPDATE frm_form SET wb = 0").run();
  D.db.prepare("UPDATE frm_tot SET b = ?").run(150 * 1048576 - 10);
  const full = await fm(env, "/fm/" + k.k, post(v));
  assert.equal(full.status, 507);
  assert.equal(full.body.e, "full");
  // a new form does not fit either, nor more than 5000 forms
  const k2 = await P.newKeys();
  assert.equal((await op(env, { act: "put", k: k2.k, sec: k2.sec, def: "A".repeat(64) })).body.error.code, "full");
  D.db.prepare("UPDATE frm_tot SET b = 0, c = 5000").run();
  assert.equal((await op(env, { act: "put", k: k2.k, sec: k2.sec, def: "A".repeat(64) })).status, 507);
});

test("replacing the form keeps the byte total in step; drop removes everything", async () => {
  const { D, env, k } = await setup();
  await fm(env, "/fm/" + k.k, post(await answer(k, { a: { q1: "x" } })));
  const def2 = await P.encDef(k.key, k.k, { v: 1, form: Object.assign({}, FORM, { title: "Longer survey title" }), pub: k.pub });
  assert.equal((await op(env, { act: "put", k: k.k, sec: k.sec, def: def2 })).body.ok, true);
  const f = D.db.prepare("SELECT dlen, wb FROM frm_form").get();
  assert.equal(f.dlen, def2.length);
  assert.equal(D.db.prepare("SELECT b FROM frm_tot").get().b, f.dlen + f.wb);
  assert.equal((await P.decDef(k.key, k.k, (await fm(env, "/fm/" + k.k, { method: "GET" })).body.def)).form.title, "Longer survey title");
  assert.equal((await op(env, { act: "drop", k: k.k, sec: k.sec })).body.ok, true);
  assert.deepEqual({ ...D.db.prepare("SELECT c, b FROM frm_tot").get() }, { c: 0, b: 0 });
  assert.equal(D.db.prepare("SELECT COUNT(*) AS n FROM frm_q").get().n, 0);
  assert.equal((await fm(env, "/fm/" + k.k, { method: "GET" })).status, 404);
});

test("TTL purge: answers after 30 days, forms 30 days after closing or 90 days without a pull", async () => {
  const { D, env, k } = await setup();
  await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} })));
  await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} })), T0 + 20 * DAY);
  assert.equal(await purgeForms(env, T0 + 31 * DAY), 1);                          // the older one
  assert.equal(D.db.prepare("SELECT COUNT(*) AS n FROM frm_q").get().n, 1);
  const f = D.db.prepare("SELECT dlen, wn, wb FROM frm_form").get();
  assert.equal(f.wn, 1);
  assert.equal(D.db.prepare("SELECT b FROM frm_tot").get().b, f.dlen + f.wb);
  await op(env, { act: "pull", k: k.k, sec: k.sec, after: 0 }, T0 + 31 * DAY);
  await op(env, { act: "upd", k: k.k, sec: k.sec, close: T0 + 32 * DAY }, T0 + 31 * DAY);
  await purgeForms(env, T0 + 61 * DAY);
  assert.equal(D.db.prepare("SELECT COUNT(*) AS n FROM frm_form").get().n, 1);   // closed 29 days ago
  await purgeForms(env, T0 + 63 * DAY);
  assert.equal(D.db.prepare("SELECT COUNT(*) AS n FROM frm_form").get().n, 0);
  assert.deepEqual({ ...D.db.prepare("SELECT c, b FROM frm_tot").get() }, { c: 0, b: 0 });
  // 90 days without a pull
  const s2 = await setup();
  await purgeForms(s2.env, T0 + 89 * DAY);
  assert.equal(s2.D.db.prepare("SELECT COUNT(*) AS n FROM frm_form").get().n, 1);
  await purgeForms(s2.env, T0 + 91 * DAY);
  assert.equal(s2.D.db.prepare("SELECT COUNT(*) AS n FROM frm_form").get().n, 0);
  // storage trouble: purge never throws
  s2.D.breakIt(true);
  assert.equal(await purgeForms(s2.env, T0), 0);
});

test("push wake: a new answer wakes the owner's box, at most once per 15 minutes; 'gone' forgets it", async () => {
  const PUSH = pushNs();
  const { D, env, k } = await setup({ PUSH });
  const push = { pid: "A".repeat(22), wt: "B".repeat(43), ct: "C".repeat(40) };
  assert.equal((await op(env, { act: "upd", k: k.k, sec: k.sec, push })).body.ok, true);
  await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} })), T0);
  await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} })), T0 + 60000);
  assert.equal(PUSH.wakes.length, 1);
  assert.deepEqual(PUSH.wakes[0], { id: push.pid, act: "wake", wt: push.wt, ct: push.ct, now: T0 });
  await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} })), T0 + 15 * 60000);
  assert.equal(PUSH.wakes.length, 2);
  // the box is gone: the form forgets the token
  const GONE = pushNs({ ok: false, code: "gone" });
  env.PUSH = GONE;
  await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} })), T0 + 31 * 60000);
  assert.equal(GONE.wakes.length, 1);
  assert.equal(D.db.prepare("SELECT pid FROM frm_form").get().pid, null);
  await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} })), T0 + 50 * 60000);
  assert.equal(GONE.wakes.length, 1);
  // the push fields stay out of the public answer
  assert.deepEqual(Object.keys((await fm(env, "/fm/" + k.k, { method: "GET" })).body).sort(), ["def", "open"]);
});

test("reports: one per IP a day counts; the third closes the form until the owner opens it", async () => {
  const PUSH = pushNs();
  const { D, env, k } = await setup({ PUSH });
  const rep = (ip, now) => fm(env, "/fm/" + k.k + "/report", { method: "POST", body: "{}" }, now || T0, ip);
  assert.deepEqual((await rep("10.2.0.1")).body, { ok: true });
  assert.deepEqual((await rep("10.2.0.1")).body, { ok: true });                     // the same IP again
  assert.equal(D.db.prepare("SELECT rn, open FROM frm_form").get().rn, 1);
  await rep("10.2.0.2");
  assert.equal((await fm(env, "/fm/" + k.k, { method: "GET" })).body.open, 1);
  await rep("10.2.0.3");
  assert.equal((await fm(env, "/fm/" + k.k, { method: "GET" })).body.open, 0);
  const peek = (await op(env, { act: "peek", k: k.k, sec: k.sec })).body.data;
  assert.deepEqual(peek, { n: 0, open: 0, rep: 1 });
  // the table holds hashes only, and they leave after two days
  assert.doesNotMatch(JSON.stringify(D.db.prepare("SELECT * FROM frm_rep").all()), /10\.2\./);
  await op(env, { act: "upd", k: k.k, sec: k.sec, open: 1 });
  assert.deepEqual((await op(env, { act: "peek", k: k.k, sec: k.sec })).body.data, { n: 0, open: 1, rep: 0 });
  await purgeForms(env, T0 + 3 * DAY);
  assert.equal(D.db.prepare("SELECT COUNT(*) AS n FROM frm_rep").get().n, 0);
  // an unknown form gets the same answer
  assert.deepEqual((await fm(env, "/fm/zzzzzzzzzzzzzzzz/report", { method: "POST", body: "{}" })).body, { ok: true });
});

test("seats (Calendar RSVP): yes answers take seats up to the cap, the rest wait; upd corrects taken", async () => {
  const { env, k } = await setup();
  await op(env, { act: "upd", k: k.k, sec: k.sec, cap: 5 });
  const g = await fm(env, "/fm/" + k.k, { method: "GET" });
  assert.equal(g.body.cap, 5);
  assert.equal(g.body.taken, 0);
  assert.deepEqual((await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} }, { yes: 1, seats: 4 })))).body, { ok: true });
  assert.deepEqual((await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} }, { yes: 0 })))).body, { ok: true });
  assert.deepEqual((await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} }, { yes: 1, seats: 2 })))).body, { ok: true, wait: true });
  assert.deepEqual((await fm(env, "/fm/" + k.k, post(await answer(k, { a: {} }, { yes: 1 })))).body, { ok: true });
  const p = (await op(env, { act: "pull", k: k.k, sec: k.sec, after: 0 })).body.data;
  assert.equal(p.taken, 5);
  assert.deepEqual(p.rows.map((r) => r.w || 0), [0, 0, 1, 0]);
  await op(env, { act: "upd", k: k.k, sec: k.sec, taken: 3 });
  assert.equal((await fm(env, "/fm/" + k.k, { method: "GET" })).body.taken, 3);
});

test("pull pages by 100; storage failures are fixed codes, never the D1 text", async () => {
  const { D, env, k } = await setup();
  const ins = D.db.prepare("INSERT INTO frm_q (k, v, n, w, at) VALUES (?, ?, 4, 0, ?)");
  for (let i = 0; i < 150; i++) ins.run(k.k, "AAAA", T0);
  const p1 = (await op(env, { act: "pull", k: k.k, sec: k.sec, after: 0 })).body.data;
  assert.equal(p1.rows.length, 100);
  assert.equal(p1.more, true);
  const p2 = (await op(env, { act: "pull", k: k.k, sec: k.sec, after: p1.rows[99].id })).body.data;
  assert.equal(p2.rows.length, 50);
  assert.equal(p2.more, false);
  D.breakIt(true);
  const r = await op(env, { act: "peek", k: k.k, sec: k.sec });
  assert.equal(r.status, 503);
  assert.doesNotMatch(JSON.stringify(r.body), /secret detail/);
  const g = await fm(env, "/fm/" + k.k, { method: "GET" });
  assert.equal(g.status, 503);
  assert.doesNotMatch(g.text, /secret detail/);
});
