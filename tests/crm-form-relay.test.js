// CRM web form, relay side: the public contact form POST /crm/f/<k> and
// the app's "crmf" op (relay/crmform.js through relay/core.js), against
// an in-memory D1 that knows exactly the statements in CRMF_SQL.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
let handle, F;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  F = await import("../relay/crmform.js");
});

const ORIGIN = "https://useoros.online";
const K = "crmform123456789";
const SEC = "C".repeat(16) + "d".repeat(16);
const DAY = 86400000;

function fakeD1() {
  const forms = new Map(), rows = [];
  let seq = 0;
  const log = [];
  function exec(sql, a) {
    const S = F.CRMF_SQL;
    log.push(sql);
    switch (sql) {
      case S.form: case S.queue: case S.index: case S.indexAt: return { meta: {} };
      case S.getForm: { const f = forms.get(a[0]); return { first: f ? { pub: f.pub, sec: f.sec, back: f.back, day: f.day, n: f.n } : null }; }
      case S.countForms: return { first: { n: forms.size } };
      case S.addForm: forms.set(a[0], { pub: a[1], sec: a[2], back: a[3], at: a[4], day: 0, n: 0 }); return { meta: { changes: 1 } };
      case S.setForm: Object.assign(forms.get(a[0]), { pub: a[1], back: a[2], at: a[3] }); return { meta: { changes: 1 } };
      case S.bump: Object.assign(forms.get(a[0]), { day: a[1], n: a[2] }); return { meta: { changes: 1 } };
      case S.countRows: return { first: { n: rows.filter((r) => r.k === a[0]).length } };
      case S.addRow: rows.push({ id: ++seq, k: a[0], v: a[1], at: a[2] }); return { meta: { changes: 1 } };
      case S.purge: { const n = rows.length; for (let i = rows.length - 1; i >= 0; i--) if (rows[i].at < a[0]) rows.splice(i, 1); return { meta: { changes: n - rows.length } }; }
      case S.pull: return { all: rows.filter((r) => r.k === a[0] && r.id > a[1]).sort((x, y) => x.id - y.id).slice(0, a[2]).map((r) => ({ ...r })) };
      case S.ack: { const n = rows.length; for (let i = rows.length - 1; i >= 0; i--) if (rows[i].k === a[0] && rows[i].id <= a[1]) rows.splice(i, 1); return { meta: { changes: n - rows.length } }; }
      case S.dropRows: for (let i = rows.length - 1; i >= 0; i--) if (rows[i].k === a[0]) rows.splice(i, 1); return { meta: {} };
      case S.dropForm: forms.delete(a[0]); return { meta: {} };
    }
    throw new Error("unknown SQL " + sql);
  }
  function stmt(sql, args) {
    return { bind: (...b) => stmt(sql, b), first: async () => exec(sql, args || []).first,
             all: async () => ({ results: exec(sql, args || []).all }), run: async () => exec(sql, args || []),
             _run: () => exec(sql, args || []) };
  }
  return { forms, rows, log, prepare: (sql) => stmt(sql), batch: async (ss) => ss.map((s) => s._run()) };
}

let ip = 0;
function nextIp() { return "10.7." + (ip >> 8 & 255) + "." + (ip++ & 255); }
async function app(env, body, now) {
  const r = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": nextIp() },
    body: JSON.stringify(Object.assign({ op: "crmf", k: K, sec: SEC }, body)) });
  const res = await handle(r, env, null, now || Date.now());
  return { status: res.status, body: await res.json(), headers: res.headers };
}
async function pub(env, path, init, now, ipAddr) {
  init = init || {};
  const h = Object.assign({ "CF-Connecting-IP": ipAddr || nextIp() }, init.headers || {});
  const res = await handle(new Request("https://relay.example" + path, Object.assign({}, init, { headers: h })), env, null, now || Date.now());
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
let KP = null;
async function setup(back) {
  const D = fakeD1();
  const env = { ALLOWED_ORIGINS: ORIGIN, NL_DB: D };
  KP = KP || await keys();
  const r = await app(env, { act: "reg", pub: KP.pub, back: back || "" });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  return { D, env, kp: KP };
}
const PATH = "/crm/f/" + K;

test("no D1 binding: the form answers 503 'off', the op 503 nostore", async () => {
  const env = { ALLOWED_ORIGINS: ORIGIN };
  const p = await pub(env, PATH, form({ email: "a@x.gr" }));
  assert.equal(p.status, 503);
  assert.match(p.text, /Not available/);
  const r = await app(env, { act: "pull", after: 0 });
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "nostore");
});

test("routing: only POST /crm/f/<16 a-z0-9>; no CORS; other /crm/ paths 404; /nl/ untouched", async () => {
  const { D, env } = await setup();
  assert.equal((await pub(env, PATH, { method: "GET" })).status, 405);
  assert.equal((await pub(env, PATH, { method: "GET" })).headers.get("Allow"), "POST");
  assert.equal((await pub(env, "/crm/f/SHORT", form({ email: "a@x.gr" }))).status, 404);
  assert.equal((await pub(env, "/crm/x/" + K, form({ email: "a@x.gr" }))).status, 404);
  assert.equal((await pub(env, PATH + "/more", form({ email: "a@x.gr" }))).status, 404);
  assert.equal((await pub(env, "/crm/f/zzzzzzzzzzzzzzzz", form({ email: "a@x.gr" }))).status, 404);
  const ok = await pub(env, PATH, Object.assign(form({ email: "a@x.gr" }), { headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://someone.example" } }));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), null);
  assert.match(ok.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.equal(ok.headers.get("X-Frame-Options"), "DENY");
  assert.doesNotMatch(ok.text, /<script/i);
  assert.equal(D.rows.length, 1);
  // Newsletter's routes still answer with their own pages
  assert.equal((await pub(env, "/nl/s/" + K, form({ email: "a@x.gr" }))).status, 503);
});

test("a message: sealed for the form (nothing in clear), never echoed, picked up and deleted", async () => {
  const { D, env, kp } = await setup();
  const name = "Παναγιώτα <script>alert(1)</script>";
  const message = "Γεια σας,\r\nθα ήθελα προσφορά.\u0007\n\n\n\nΕυχαριστώ";
  const p = await pub(env, PATH, form({ name, email: "lead@example.com", phone: "+30 210 1234567", company: "Acme\tΑΕ", message, lang: "el", website: "" }));
  assert.equal(p.status, 200);
  assert.match(p.text, /Το μήνυμα στάλθηκε/);
  assert.doesNotMatch(p.text, /Παναγιώτα|script|example\.com/);
  assert.equal(D.rows.length, 1);
  assert.deepEqual(Object.keys(D.rows[0]).sort(), ["at", "id", "k", "v"]);
  assert.doesNotMatch(D.rows[0].v, /example|Acme|1234567/);
  const pulled = await app(env, { act: "pull", after: 0 });
  assert.equal(pulled.body.data.rows.length, 1);
  const row = pulled.body.data.rows[0];
  const got = await open(kp.priv, row.v);
  assert.equal(got.e, "lead@example.com");
  assert.equal(got.n, name);                         // the app escapes it; the relay stores text as given
  assert.equal(got.p, "+30 210 1234567");
  assert.equal(got.c, "Acme ΑΕ");
  assert.equal(got.m, "Γεια σας,\nθα ήθελα προσφορά.\n\nΕυχαριστώ");
  assert.equal(got.l, "el");
  const ack = await app(env, { act: "ack", upto: row.id });
  assert.equal(ack.body.data.n, 1);
  assert.equal(D.rows.length, 0);
});

test("limits: 20 KB body, field lengths, e-mail check", async () => {
  const { D, env, kp } = await setup();
  const big = await pub(env, PATH, form({ email: "a@x.gr", message: "x".repeat(20600) }));
  assert.equal(big.status, 413);
  assert.match(big.text, /too long/);
  assert.equal(D.rows.length, 0);
  for (const e of ["not an address", "a@b", "a\r\nb@x.gr", "x".repeat(196) + "@x.gr", ""]) {
    assert.equal((await pub(env, PATH, form({ email: e }))).status, 400, e);
  }
  assert.equal(D.rows.length, 0);
  const ok = await pub(env, PATH, form({ email: "a@x.gr", name: "n".repeat(300), company: "c".repeat(300), phone: "1".repeat(300), message: "m".repeat(3000).slice(0, 7000) }));
  assert.equal(ok.status, 200);
  const got = await open(kp.priv, D.rows[0].v);
  assert.equal(got.n.length, 200);
  assert.equal(got.c.length, 200);
  assert.equal(got.p.length, 200);
  assert.equal(got.m.length, 2000);
  const o = F.leadOf(new URLSearchParams("email=a%40x.gr"), "en", 5);
  assert.deepEqual(o, { e: "a@x.gr", l: "en", t: 5 });         // no empty fields sealed
});

test("honeypot: a bot gets the thank-you page and nothing is stored; the redirect is the registered one", async () => {
  const { D, env } = await setup("https://my.site/thanks");
  const bot = await pub(env, PATH + "?back=https://evil.example", form({ email: "a@x.gr", website: "http://spam", back: "https://evil.example" }));
  assert.equal(bot.status, 303);
  assert.equal(bot.headers.get("Location"), "https://my.site/thanks");
  assert.equal(D.rows.length, 0);
  const ok = await pub(env, PATH, form({ email: "a@x.gr", back: "https://evil.example" }));
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("Location"), "https://my.site/thanks");
  assert.equal(D.rows.length, 1);
});

test("floods: at most 500 waiting per form and 100 a day per form; the per-IP limit", async () => {
  const { D, env } = await setup();
  for (let i = 0; i < F.CRMF_LIMITS.pending; i++) D.rows.push({ id: 100000 + i, k: K, v: "x", at: Date.now() });
  assert.equal((await pub(env, PATH, form({ email: "a@x.gr" }))).status, 200);
  assert.equal(D.rows.length, F.CRMF_LIMITS.pending);
  D.rows.length = 0;
  const now = Date.UTC(2026, 9, 14, 10);
  for (let i = 0; i < F.CRMF_LIMITS.perDay + 5; i++) await pub(env, PATH, form({ email: "a" + i + "@x.gr" }), now + i);
  assert.equal(D.rows.length, F.CRMF_LIMITS.perDay);
  await pub(env, PATH, form({ email: "next@x.gr" }), now + DAY);   // a new day
  assert.equal(D.rows.length, F.CRMF_LIMITS.perDay + 1);
  // one IP: 60 a minute, then 429 (shared with /nl/ and /v1)
  let last = null;
  for (let i = 0; i < 62; i++) last = await pub(env, PATH, form({ email: "a@x.gr" }), now + 2 * DAY, "192.0.2.77");
  assert.equal(last.status, 429);
  assert.match(last.text, /Too many requests/);
});

test("TTL: a message nobody picked up in 30 days is deleted", async () => {
  const { D, env } = await setup();
  const t0 = Date.UTC(2026, 9, 1);
  await pub(env, PATH, form({ email: "old@x.gr" }), t0);
  await pub(env, PATH, form({ email: "new@x.gr" }), t0 + 20 * DAY);
  assert.equal(D.rows.length, 2);
  const r = await app(env, { act: "pull", after: 0 }, t0 + 31 * DAY);
  assert.equal(r.body.data.rows.length, 1);
  assert.equal(D.rows.length, 1);
  // a form POST purges too (here for every form)
  D.rows.push({ id: 999, k: "otherform0000000", v: "x", at: t0 });
  await pub(env, PATH, form({ email: "x@x.gr", website: "bot" }), t0 + 31 * DAY);
  assert.equal(D.rows.some((x) => x.id === 999), false);
});

test("op crmf: a wrong secret is refused; validation; the form cap; drop", async () => {
  const { D, env, kp } = await setup();
  await pub(env, PATH, form({ email: "a@x.gr" }));
  const wrong = await app(env, { act: "pull", after: 0, sec: "Z".repeat(32) });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error.code, "auth");
  assert.equal((await app(env, { act: "ack", upto: 99, sec: "Z".repeat(32) })).status, 403);
  assert.equal((await app(env, { act: "drop", sec: "Z".repeat(32) })).status, 403);
  assert.equal((await app(env, { act: "reg", pub: kp.pub, back: "https://evil.example/", sec: "Z".repeat(32) })).status, 403);
  assert.equal(D.rows.length, 1);
  assert.equal(D.forms.get(K).back, "");
  assert.equal(D.forms.get(K).sec.length, 64);                      // only the hash
  assert.equal((await app(env, { act: "pull", after: 0, k: "zzzzzzzzzzzzzzzz" })).body.error.code, "gone");
  const v = (o) => F.validCrmf(Object.assign({ op: "crmf", act: "reg", k: K, sec: SEC, pub: kp.pub, back: "" }, o));
  assert.equal(v({}), "");
  assert.equal(v({ act: "x" }), "act");
  assert.equal(v({ k: "short" }), "k");
  assert.equal(v({ sec: "x" }), "sec");
  assert.equal(v({ pub: Object.assign({}, kp.pub, { e: "Aw" }) }), "pub");
  assert.equal(v({ back: "http://my.site/" }), "back");
  assert.equal(v({ back: "javascript:alert(1)" }), "back");
  assert.equal(v({ act: "pull", after: -1 }), "after");
  assert.equal(v({ act: "ack" }), "upto");
  assert.equal((await app(env, { act: "pull" })).status, 400);
  for (let i = D.forms.size; i < F.CRMF_LIMITS.forms; i++) D.forms.set("x" + i, { pub: "{}", sec: "", back: "", at: 1, day: 0, n: 0 });
  assert.equal((await app(env, { act: "reg", k: "newform000000000", pub: kp.pub, back: "" })).body.error.code, "full");
  assert.equal((await app(env, { act: "reg", pub: kp.pub, back: "https://my.site/ok" })).body.ok, true);
  assert.equal(D.forms.get(K).back, "https://my.site/ok");
  assert.equal((await app(env, { act: "drop" })).body.ok, true);
  assert.equal(D.forms.has(K), false);
  assert.equal(D.rows.length, 0);
  assert.equal((await pub(env, PATH, form({ email: "a@x.gr" }))).status, 404);
});

test("op crmf: origin-gated like every op", async () => {
  const D = fakeD1();
  const r = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "application/json", "CF-Connecting-IP": nextIp() },
    body: JSON.stringify({ op: "crmf", act: "pull", k: K, sec: SEC, after: 0 }) });
  const res = await handle(r, { ALLOWED_ORIGINS: ORIGIN, NL_DB: D }, null, Date.now());
  assert.equal(res.status, 403);
  assert.equal(D.log.length, 0);
});

test("a failing D1 call: the visitor gets a 503 page and the op a 503, nothing throws", async () => {
  const { D, env, kp } = await setup();
  const prep = D.prepare;
  D.prepare = (sql) => {
    const st = prep(sql);
    const wrap = (x) => Object.assign({}, x, { bind: (...b) => wrap(x.bind(...b)),
      run: async () => { throw new Error("D1 quota"); }, all: async () => { throw new Error("D1 down"); },
      first: sql === F.CRMF_SQL.getForm ? x.first : async () => { throw new Error("D1 down"); } });
    return wrap(st);
  };
  const p = await pub(env, PATH, form({ email: "a@x.gr" }));
  assert.equal(p.status, 503);
  assert.match(p.text, /Not available/);
  const r = await app(env, { act: "pull", after: 0 });
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "nostore");
  assert.doesNotMatch(JSON.stringify(r.body), /quota|down/);
  // batch failing as well
  D.prepare = prep;
  D.batch = async () => { throw new Error("D1 batch"); };
  const p2 = await pub(env, PATH, form({ email: "a@x.gr" }));
  assert.equal(p2.status, 503);
  const r2 = await app(env, { act: "drop" });
  assert.equal(r2.status, 503);
  void kp;
});
