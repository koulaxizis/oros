// Newsletter phase 3B: the relay's public sign-up form, one-click
// unsubscribe (RFC 8058) and the app's "nl" op (relay/newsletter.js
// through relay/core.js), against an in-memory D1.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
let handle, NL;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  NL = await import("../relay/newsletter.js");
});

const ORIGIN = "https://useoros.online";
const K = "abcdefgh12345678";
const SEC = "A".repeat(16) + "b".repeat(16);

// A D1 that understands exactly the statements in NL.SQL.
function fakeD1() {
  const lists = new Map(), rows = [];
  let seq = 0;
  const log = [];
  function exec(sql, a) {
    const S = NL.SQL;
    log.push(sql);
    switch (sql) {
      case S.list: case S.queue: case S.index: return { meta: {} };
      case S.getList: { const l = lists.get(a[0]); return { first: l ? { pub: l.pub, sec: l.sec, back: l.back } : null }; }
      case S.countLists: return { first: { n: lists.size } };
      case S.addList: lists.set(a[0], { pub: a[1], sec: a[2], back: a[3], at: a[4] }); return { meta: { changes: 1 } };
      case S.setList: { const l = lists.get(a[0]); Object.assign(l, { pub: a[1], back: a[2], at: a[3] }); return { meta: { changes: 1 } }; }
      case S.countRows: return { first: { n: rows.filter((r) => r.k === a[0]).length } };
      case S.addRow: rows.push({ id: ++seq, k: a[0], kind: a[1], v: a[2], at: a[3] }); return { meta: { changes: 1 } };
      case S.seenUnsub: { const r = rows.find((x) => x.k === a[0] && x.kind === "u" && x.v === a[1] && x.at > a[2]); return { first: r ? { id: r.id } : null }; }
      case S.pull: return { all: rows.filter((r) => r.k === a[0] && r.id > a[1]).sort((x, y) => x.id - y.id).slice(0, a[2]).map((r) => ({ ...r })) };
      case S.ack: { const before = rows.length; for (let i = rows.length - 1; i >= 0; i--) if (rows[i].k === a[0] && rows[i].id <= a[1]) rows.splice(i, 1); return { meta: { changes: before - rows.length } }; }
      case S.dropRows: { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].k === a[0]) rows.splice(i, 1); return { meta: {} }; }
      case S.dropList: lists.delete(a[0]); return { meta: {} };
    }
    throw new Error("unknown SQL " + sql);
  }
  function stmt(sql, args) {
    return {
      bind: (...b) => stmt(sql, b),
      first: async () => exec(sql, args || []).first,
      all: async () => ({ results: exec(sql, args || []).all }),
      run: async () => exec(sql, args || []),
      _run: () => exec(sql, args || [])
    };
  }
  return { lists, rows, log, prepare: (sql) => stmt(sql), batch: async (ss) => ss.map((s) => s._run()) };
}

let ip = 0;
function nextIp() { return "10.1." + (ip >> 8 & 255) + "." + (ip++ & 255); }
async function app(env, body, origin) {
  const r = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: origin === undefined ? ORIGIN : origin, "Content-Type": "application/json", "CF-Connecting-IP": nextIp() },
    body: JSON.stringify(Object.assign({ op: "nl", k: K, sec: SEC }, body)) });
  const res = await handle(r, env, null, Date.now());
  return { status: res.status, body: await res.json(), headers: res.headers };
}
async function pub(env, path, init) {
  init = init || {};
  const h = Object.assign({ "CF-Connecting-IP": nextIp() }, init.headers || {});
  const res = await handle(new Request("https://relay.example" + path, Object.assign({}, init, { headers: h })), env, null, Date.now());
  return { status: res.status, text: await res.text(), headers: res.headers };
}
function form(o) {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() };
}
async function keys() {
  const kp = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["encrypt", "decrypt"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  return { priv: kp.privateKey, pub: { kty: "RSA", alg: "RSA-OAEP-256", e: jwk.e, n: jwk.n } };
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function open(priv, v) {
  const o = JSON.parse(atob(v));
  const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, priv, unb64(o.w));
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, key, unb64(o.c))));
}
async function setup(back) {
  const D = fakeD1();
  const env = { ALLOWED_ORIGINS: ORIGIN, NL_DB: D };
  const kp = await keys();
  const r = await app(env, { act: "reg", pub: kp.pub, back: back || "" });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  return { D, env, kp };
}

test("no D1 binding: every route answers 503 nostore", async () => {
  const env = { ALLOWED_ORIGINS: ORIGIN };
  const r = await app(env, { act: "pull", after: 0 });
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "nostore");
  const p = await pub(env, "/nl/s/" + K, form({ email: "a@x.gr" }));
  assert.equal(p.status, 503);
  assert.equal((await pub(env, "/nl/u/" + K + "/tok12345")).status, 503);
});

test("sign-up: stored only encrypted (hybrid, so a long Greek name fits), pulled and acked by the owner", async () => {
  const { D, env, kp } = await setup();
  const name = "Παναγιώτα-Αικατερίνη Παπαδοπούλου-Χατζηγεωργίου του Κωνσταντίνου";
  const email = "very.long.address." + "x".repeat(150) + "@example.com";
  assert.ok(new TextEncoder().encode(JSON.stringify({ e: email, n: name })).length > 190);
  const p = await pub(env, "/nl/s/" + K, form({ email, name, lang: "el" }));
  assert.equal(p.status, 200);
  assert.match(p.text, /Σχεδόν έτοιμο/);
  assert.equal(D.rows.length, 1);
  assert.doesNotMatch(D.rows[0].v, /example\.com/);
  assert.equal(p.headers.get("Access-Control-Allow-Origin"), null);        // no CORS on /nl/
  assert.match(p.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.equal(p.headers.get("X-Frame-Options"), "DENY");
  assert.equal(p.headers.get("Referrer-Policy"), "no-referrer");
  const pulled = await app(env, { act: "pull", after: 0 });
  assert.equal(pulled.body.data.rows.length, 1);
  assert.equal(pulled.body.data.more, false);
  const row = pulled.body.data.rows[0];
  assert.equal(row.kind, "s");
  const got = await open(kp.priv, row.v);
  assert.equal(got.e, email);
  assert.equal(got.n, name);
  assert.equal(got.l, "el");
  const ack = await app(env, { act: "ack", upto: row.id });
  assert.equal(ack.body.data.n, 1);
  assert.equal(D.rows.length, 0);
});

test("sign-up: honeypot, bad address, unknown list and the redirect", async () => {
  const { D, env } = await setup("https://my.site/thanks");
  const bot = await pub(env, "/nl/s/" + K, form({ email: "a@x.gr", website: "http://spam" }));
  assert.equal(bot.status, 303);
  assert.equal(D.rows.length, 0);
  const bad = await pub(env, "/nl/s/" + K, form({ email: "not an address" }));
  assert.equal(bad.status, 400);
  const unknown = await pub(env, "/nl/s/zzzzzzzzzzzzzzzz", form({ email: "a@x.gr" }));
  assert.equal(unknown.status, 404);
  assert.equal(D.rows.length, 0);
  const ok = await pub(env, "/nl/s/" + K, form({ email: "a@x.gr" }));
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("Location"), "https://my.site/thanks");
  assert.equal(D.rows.length, 1);
  assert.equal((await pub(env, "/nl/s/" + K, { method: "GET" })).status, 405);
  assert.equal((await pub(env, "/nl/s/BAD", form({ email: "a@x.gr" }))).status, 404);
});

test("form size: refused before parsing", async () => {
  const { D, env } = await setup();
  const big = await pub(env, "/nl/s/" + K, form({ email: "a@x.gr", name: "x".repeat(5000) }));
  assert.equal(big.status, 413);
  assert.equal(D.rows.length, 0);
});

test("pending cap per list: beyond it nothing is stored", async () => {
  const { D, env } = await setup();
  for (let i = 0; i < NL.NL_LIMITS.pending; i++) D.rows.push({ id: 100000 + i, k: K, kind: "u", v: "t" + i, at: 1 });
  const p = await pub(env, "/nl/s/" + K, form({ email: "a@x.gr" }));
  assert.equal(p.status, 200);
  assert.equal(D.rows.length, NL.NL_LIMITS.pending);
  await pub(env, "/nl/u/" + K + "/abcd1234", { method: "POST", body: "List-Unsubscribe=One-Click" });
  assert.equal(D.rows.length, NL.NL_LIMITS.pending);
});

test("unsubscribe: GET never writes; one-click POST stores the token once a day", async () => {
  const { D, env } = await setup();
  const g = await pub(env, "/nl/u/" + K + "/abcd1234", { headers: { "Accept-Language": "el-GR,el;q=0.9" } });
  assert.equal(g.status, 200);
  assert.match(g.text, /<form method="post" action="\/nl\/u\/abcdefgh12345678\/abcd1234">/);
  assert.match(g.text, /name="List-Unsubscribe" value="One-Click"/);
  assert.match(g.text, /Διαγραφή/);
  assert.doesNotMatch(g.text, /<script/i);
  assert.equal(D.rows.length, 0);
  const post = () => pub(env, "/nl/u/" + K + "/abcd1234", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  assert.equal(D.rows.length, 1);
  assert.deepEqual([D.rows[0].kind, D.rows[0].v], ["u", "abcd1234"]);
  assert.equal((await pub(env, "/nl/u/" + K + "/BAD!")).status, 404);
  assert.equal((await pub(env, "/nl/u/zzzzzzzzzzzzzzzz/abcd1234", { method: "POST", body: "x" })).status, 404);
  assert.equal(D.rows.length, 1);
});

test("op nl: a wrong secret is refused; reg validates its input; the list cap", async () => {
  const { D, env, kp } = await setup();
  const wrong = await app(env, { act: "pull", after: 0, sec: "Z".repeat(32) });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error.code, "auth");
  const steal = await app(env, { act: "reg", pub: kp.pub, back: "", sec: "Z".repeat(32) });
  assert.equal(steal.status, 403);
  const v = (o) => NL.validNl(Object.assign({ op: "nl", act: "reg", k: K, sec: SEC, pub: kp.pub, back: "" }, o));
  assert.equal(v({}), "");
  assert.equal(v({ k: "short" }), "k");
  assert.equal(v({ sec: "x" }), "sec");
  assert.equal(v({ pub: Object.assign({}, kp.pub, { e: "Aw" }) }), "pub");
  assert.equal(v({ pub: Object.assign({}, kp.pub, { n: kp.pub.n.slice(0, 100) }) }), "pub");
  assert.equal(v({ back: "http://my.site/" }), "back");
  assert.equal(v({ back: "https://u:p@my.site/" }), "back");
  assert.equal(v({ act: "pull", after: -1 }), "after");
  assert.equal(v({ act: "ack" }), "upto");
  const junk = await app(env, { act: "reg", k: "zzzzzzzzzzzzzzzz", pub: Object.assign({}, kp.pub, { n: "A".repeat(343) }) });
  assert.equal(junk.status, 400);
  for (let i = D.lists.size; i < NL.NL_LIMITS.lists; i++) D.lists.set("x" + i, { pub: "{}", sec: "", back: "", at: 1 });
  const full = await app(env, { act: "reg", k: "newlist000000000", pub: kp.pub, back: "" });
  assert.equal(full.body.error.code, "full");
  // the owner updates its own list and drops it
  assert.equal((await app(env, { act: "reg", pub: kp.pub, back: "https://my.site/ok" })).body.ok, true);
  assert.equal(D.lists.get(K).back, "https://my.site/ok");
  assert.equal(D.lists.get(K).sec.length, 64);                      // only the hash is kept
  assert.equal((await app(env, { act: "drop" })).body.ok, true);
  assert.equal(D.lists.has(K), false);
});

test("op nl: still origin-gated; Mail ops untouched", async () => {
  const D = fakeD1();
  const r = await app({ ALLOWED_ORIGINS: ORIGIN, NL_DB: D }, { act: "pull", after: 0 }, "https://evil.example");
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "origin");
  assert.equal(D.log.length, 0);
});

test("pull pages by 200", async () => {
  const { D, env } = await setup();
  for (let i = 0; i < 250; i++) D.rows.push({ id: i + 1, k: K, kind: "u", v: "tok" + (10000 + i), at: 1 });
  const a = await app(env, { act: "pull", after: 0 });
  assert.equal(a.body.data.rows.length, 200);
  assert.equal(a.body.data.more, true);
  const b = await app(env, { act: "pull", after: a.body.data.rows[199].id });
  assert.equal(b.body.data.rows.length, 50);
  assert.equal(b.body.data.more, false);
});
