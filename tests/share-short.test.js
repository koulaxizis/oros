// Short links for shared songs (relay/short.js, BR-SHARE-SHORT):
// POST /v1 { op:"shl", code } and GET /p/s.<id>, through relay/core.js,
// on a real SQLite database (node:sqlite) behind a D1-shaped adapter, so
// every statement in SHL_SQL / SHR_SQL runs as SQL. Covers dedupe, the
// conflict rule, caps (rows, bytes, store total, daily), per-IP limits,
// locked / other kinds refused, normalized storage, the idle-year purge,
// `last` updated once a day, escaping on GET, and old long links.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { DatabaseSync } = require("node:sqlite");
let handle, S, SR, P;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  S = await import("../relay/short.js");
  SR = await import("../relay/share.js");
  P = await import("../relay/preview.js");
});

const ORIGIN = "https://useoros.online";
const BASE = "https://oros-mail-relay.koulaxizis.workers.dev";
const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);

// A D1-shaped adapter over node:sqlite.
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

const code = (env) => "1." + zlib.deflateRawSync(Buffer.from(JSON.stringify(env))).toString("base64url");
const song = (d) => code({ v: 1, k: "track", d: Object.assign({ t: "Song", a: "Band", s: "ia" }, d) });
let ipN = 0;
const nextIp = () => "10.7." + (ipN >> 8 & 255) + "." + (ipN++ & 255);
async function mk(env, c, o) {
  o = o || {};
  const r = new Request(BASE + "/v1", { method: "POST",
    headers: { Origin: o.origin || ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": o.ip || nextIp() },
    body: JSON.stringify({ op: "shl", code: c }) });
  const res = await handle(r, env, null, o.now || T0);
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function open(env, id, now, method) {
  P.resetPreviewLimits();
  const res = await handle(new Request(BASE + "/p/" + id, { method: method || "GET", headers: { "CF-Connecting-IP": "1.2.3.4" } }), env, null, now || T0);
  return { status: res.status, loc: res.headers.get("location"), text: await res.text(), headers: res.headers };
}
function fresh() { S.resetShortLimits(); return { SHR_DB: d1() }; }

test("a song gets a short id; the same song the same id; the page forwards to the share page", async () => {
  const env = fresh();
  const c = song({ al: "Live", li: "by-sa 4.0", art: "https://archive.org/services/img/x", u: "https://archive.org/download/x/a.mp3" });
  const a = await mk(env, c);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.match(a.body.data.id, /^s\.[A-Za-z0-9_-]{10}$/);
  const b = await mk(env, c);
  assert.equal(b.body.data.id, a.body.data.id);
  assert.equal(env.SHR_DB.db.prepare("SELECT COUNT(*) AS c FROM shl_link").get().c, 1);
  const g = await open(env, a.body.data.id);
  assert.equal(g.status, 200);
  assert.match(g.text, /<meta property="og:image" content="https:\/\/archive\.org\/services\/img\/x">/);
  assert.match(g.text, /<meta property="og:description" content="Live · CC BY-SA 4\.0 · orOS">/);
  const fwd = /content="0;url=https:\/\/useoros\.online\/share\/#(1\.[A-Za-z0-9_-]+)"/.exec(g.text);
  assert.ok(fwd, "forwards to the share page with a 1. code");
  // the rebuilt code opens as the same song
  const back = JSON.parse(zlib.inflateRawSync(Buffer.from(fwd[1].slice(2), "base64url")).toString());
  assert.deepEqual(back, { v: 1, k: "track", d: (await P.songOf(c)).d });
  const hd = await open(env, a.body.data.id, T0, "HEAD");
  assert.equal(hd.status, 200);
  assert.equal(hd.text, "");
});

test("the normalized JSON is stored, never the sender's extra fields; nothing about the sender", async () => {
  const env = fresh();
  const c = song({ evil: "x".repeat(500), u: "https://evil.example/a.mp3", art: "https://evil.example/c.png" });
  const a = await mk(env, c);
  assert.equal(a.status, 200);
  const row = env.SHR_DB.db.prepare("SELECT * FROM shl_link").get();
  assert.deepEqual(Object.keys(row).sort(), ["at", "d", "id", "k", "last", "size"]);
  assert.deepEqual(JSON.parse(row.d), { t: "Song", a: "Band", s: "ia" });
  assert.equal(row.at, T0);
  assert.ok(row.d.indexOf("evil") < 0);
  assert.ok(JSON.stringify(row).indexOf("10.7.") < 0, "no IP stored");
});

test("hostile fields are escaped on GET; a tampered row is normalized again", async () => {
  const env = fresh();
  const a = await mk(env, song({ t: "<script>alert(1)</script> \"x\" ‮", a: "A & B" }));
  const id = a.body.data.id;
  let g = await open(env, id);
  assert.ok(g.text.indexOf("<script") < 0);
  assert.match(g.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;x&quot; · A &amp; B/);
  assert.ok(g.text.indexOf("‮") < 0);
  // someone with database access puts a foreign cover in: it is dropped
  env.SHR_DB.db.prepare("UPDATE shl_link SET d = ?1 WHERE id = ?2").run(JSON.stringify({ t: "<b>T</b>", a: "B", s: "ia", art: "https://evil.example/x.png" }), id);
  g = await open(env, id);
  assert.equal(g.status, 200);
  assert.ok(g.text.indexOf("evil.example") < 0);
  assert.ok(g.text.indexOf("<b>") < 0);
  // broken JSON or another kind: plain 302, nothing echoed
  env.SHR_DB.db.prepare("UPDATE shl_link SET d = '{bad' WHERE id = ?1").run(id);
  g = await open(env, id);
  assert.equal(g.status, 302);
  assert.equal(g.loc, "https://useoros.online/share/");
  env.SHR_DB.db.prepare("UPDATE shl_link SET d = ?1, k = 'note' WHERE id = ?2").run(JSON.stringify({ t: "x", a: "y", s: "ia" }), id);
  assert.equal((await open(env, id)).status, 302);
});

test("albums and playlists: up to 200 songs; the page shows name and count only", async () => {
  const env = fresh();
  const i = Array.from({ length: 3 }, (_, n) => ({ t: "S" + n, a: "Hidden artist", s: "ia" }));
  const a = await mk(env, code({ v: 1, k: "tracks", d: { t: "My list", ty: "pl", i } }));
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const g = await open(env, a.body.data.id);
  assert.match(g.text, /🎵 My list/);
  assert.match(g.text, /Playlist · 3 songs/);
  assert.ok(g.text.indexOf("Hidden artist") < 0);
  const big = Array.from({ length: 201 }, (_, n) => ({ t: "S" + n, s: "ia" }));
  const b = await mk(env, code({ v: 1, k: "tracks", d: { t: "Big", ty: "pl", i: big } }));
  assert.equal(b.status, 400);
  assert.equal(b.body.error.code, "song");
});

test("locked codes, other kinds, bad codes and foreign origins are refused", async () => {
  const env = fresh();
  const bad = [
    "q1." + "A".repeat(40),                           // a locked code
    "r1." + "A".repeat(22) + "." + "B".repeat(43) + ".1",
    code({ v: 1, k: "note", d: { t: "x" } }),           // another kind
    code({ v: 2, k: "track", d: { t: "x", s: "ia" } }),
    "1.%%%%", "1." + "A".repeat(4001), 42
  ];
  for (const c of bad) {
    const r = await mk(env, c);
    assert.equal(r.status, 400, String(c).slice(0, 20));
    assert.equal(r.body.ok, false);
  }
  const f = await mk(env, song({}), { origin: "https://evil.example" });
  assert.equal(f.status, 403);
  const t = env.SHR_DB.db.prepare("SELECT name FROM sqlite_master WHERE name = 'shl_link'").get();
  assert.ok(!t || env.SHR_DB.db.prepare("SELECT COUNT(*) AS c FROM shl_link").get().c === 0, "nothing stored");
});

test("an id already held by other content is a conflict, never overwritten", async () => {
  const env = fresh();
  const c = song({ t: "Mine" });
  const a = await mk(env, c);
  const id = a.body.data.id;
  env.SHR_DB.db.prepare("UPDATE shl_link SET d = ?1 WHERE id = ?2").run(JSON.stringify({ t: "Other", a: "Band", s: "ia" }), id);
  const b = await mk(env, c);
  assert.equal(b.status, 409);
  assert.equal(b.body.error.code, "conflict");
  assert.equal(JSON.parse(env.SHR_DB.db.prepare("SELECT d FROM shl_link WHERE id = ?1").get(id).d).t, "Other");
});

test("per-IP limits: 10 a minute, 100 a day", async () => {
  const env = fresh();
  for (let n = 0; n < 10; n++) assert.equal((await mk(env, song({ t: "m" + n }), { ip: "9.9.9.9" })).status, 200);
  const r = await mk(env, song({ t: "m10" }), { ip: "9.9.9.9" });
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, "rate");
  assert.equal((await mk(env, song({ t: "other ip" }), { ip: "9.9.9.8" })).status, 200);
  S.resetShortLimits();
  let ok = 0;
  for (let n = 0; n < 101; n++) {
    const x = await mk(env, song({ t: "d" + n }), { ip: "8.8.8.8", now: T0 + n * 61000 });
    if (x.status === 200) ok++;
    else assert.equal(x.body.error.code, "rate");
  }
  assert.equal(ok, 100);
});

test("global daily insert cap kept in the database", async () => {
  const env = fresh();
  await mk(env, song({ t: "first" }));        // creates the tables
  env.SHR_DB.db.prepare("UPDATE shl_day SET n = ?1").run(S.SHL_LIMITS.dayAll);
  const r = await mk(env, song({ t: "one more" }));
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, "rate");
  // an existing song still answers its id
  assert.equal((await mk(env, song({ t: "first" }))).status, 200);
  // the next day is open again
  assert.equal((await mk(env, song({ t: "one more" }), { now: T0 + DAY })).status, 200);
});

test("caps: rows, bytes and the share store total answer 507 full, nothing evicted", async () => {
  const env = fresh();
  await mk(env, song({ t: "kept" }));
  const ins = env.SHR_DB.db.prepare("INSERT INTO shl_link (id, k, d, size, at, last) VALUES (?1, 'track', '{}', ?2, ?3, ?3)");
  ins.run("s.FILLER0000", S.SHL_LIMITS.bytes, T0);
  let r = await mk(env, song({ t: "new" }));
  assert.equal(r.status, 507);
  assert.equal(r.body.error.code, "full");
  env.SHR_DB.db.prepare("DELETE FROM shl_link WHERE id = 's.FILLER0000'").run();
  // the share store's total counts links with an expiry too
  env.SHR_DB.db.prepare("INSERT INTO shr_obj (id, exp, size, n, delh, tokh, at, fin) VALUES ('x', ?1, ?2, 1, 'a', 'b', ?3, 1)").run(T0 + DAY, SR.SHR_LIMITS.store, T0);
  r = await mk(env, song({ t: "new" }));
  assert.equal(r.status, 507);
  env.SHR_DB.db.prepare("DELETE FROM shr_obj").run();
  assert.equal(env.SHR_DB.db.prepare("SELECT COUNT(*) AS c FROM shl_link").get().c, 1, "nothing evicted");
  // ...and short links count in the expiry links' room
  const used = env.SHR_DB.db.prepare(SR.SHR_SQL.used).get().s;
  assert.ok(used > 0);
});

test("the row cap", async () => {
  const env = fresh();
  await mk(env, song({ t: "kept" }));
  const save = S.SHL_LIMITS.rows;
  S.SHL_LIMITS.rows = 1;
  try {
    const r = await mk(env, song({ t: "new" }));
    assert.equal(r.status, 507);
    assert.equal((await mk(env, song({ t: "kept" }))).status, 200, "an existing song still answers");
  } finally { S.SHL_LIMITS.rows = save; }
});

test("`last` moves at most once a day; a year unopened: gone (GET and purge)", async () => {
  const env = fresh();
  const id = (await mk(env, song({}))).body.data.id;
  const last = () => env.SHR_DB.db.prepare("SELECT last FROM shl_link WHERE id = ?1").get(id).last;
  await open(env, id, T0 + 1000);
  assert.equal(last(), T0, "not touched within a day");
  await open(env, id, T0 + DAY + 5);
  assert.equal(last(), T0 + DAY + 5);
  const later = T0 + DAY + 5 + 366 * DAY;
  const g = await open(env, id, later);
  assert.equal(g.status, 302, "expired: plain 302");
  assert.equal(g.loc, "https://useoros.online/share/");
  assert.equal(await S.purgeShort(env, T0 + 300 * DAY), 0, "a recent link stays");
  assert.equal(await S.purgeShort(env, later), 1);
  assert.equal(env.SHR_DB.db.prepare("SELECT COUNT(*) AS c FROM shl_link").get().c, 0);
});

test("unknown ids, bad ids and no database: plain 302; a D1 failure: fixed text", async () => {
  const env = fresh();
  await mk(env, song({}));
  for (const id of ["s.AAAAAAAAAA", "s.short", "s.AAAAAAAAAAA", "s.AAAA%2FAAAAA"]) {
    const g = await open(env, id);
    assert.equal(g.status, 302, id);
    assert.equal(g.loc, "https://useoros.online/share/");
  }
  assert.equal((await open({}, "s.AAAAAAAAAA")).status, 302);
  const none = await mk({}, song({}));
  assert.equal(none.status, 503);
  assert.equal(none.body.error.code, "nostore");
  env.SHR_DB.breakIt(true);
  const r = await mk(env, song({ t: "x" }));
  assert.equal(r.status, 503);
  assert.ok(JSON.stringify(r.body).indexOf("secret detail") < 0);
  const g = await open(env, "s.AAAAAAAAAA");
  assert.equal(g.status, 503);
  assert.ok(g.text.indexOf("secret detail") < 0);
});

test("old long links keep working", async () => {
  const c = song({ t: "Long" });
  const g = await open({}, c);
  assert.equal(g.status, 200);
  assert.ok(g.text.indexOf("https://useoros.online/share/#" + c) > 0);
});

test("share/relay.js short(): asks the relay and checks the answer", async () => {
  global.window = global.window || {};
  const R = require("../share/relay.js");
  const env = fresh();
  const f = async (url, init) => handle(new Request(url, { method: init.method, headers: Object.assign({}, init.headers, { Origin: ORIGIN, "CF-Connecting-IP": nextIp() }), body: init.body }), env, null, T0);
  const c = song({ t: "Client" });
  const id = await R.short(c, { fetch: f });
  assert.match(id, /^s\.[A-Za-z0-9_-]{10}$/);
  assert.equal(id, (await mk(env, c)).body.data.id);
  await assert.rejects(R.short("q1." + "A".repeat(40), { fetch: f }), /bad/);
  await assert.rejects(R.short(c, { fetch: async () => { throw new Error("offline"); } }), /net/);
  await assert.rejects(R.short(c, { fetch: async () => new Response(JSON.stringify({ ok: true, data: { id: "s.<script>xx" } })) }), /bad/);
});

test("send window: the short link is a choice under the preview, EN/EL/DE, long link as fallback", () => {
  const fs = require("fs"), path = require("path");
  const s = fs.readFileSync(path.join(__dirname, "..", "share/send.js"), "utf8");
  assert.match(s, /var canShort = !!\(R && typeof R\.short === "function"\), shOn = true/);
  assert.match(s, /if \(pv && canShort && shOn\)/);
  assert.match(s, /T\("shFail"\);\s*useLink\(what, link\);/);
  const de = fs.readFileSync(path.join(__dirname, "..", "i18n/de/share.js"), "utf8");
  ["sh", "shNote", "shFail"].forEach((k) => {
    assert.equal((s.match(new RegExp("\\b" + k + ": \"", "g")) || []).length, 2, k);
    assert.ok(de.indexOf('"' + k + '":') >= 0, k + " DE");
  });
  assert.match(s, /stops working if nobody opens it for a year/);
  assert.match(s, /cannot be taken back/);
});
