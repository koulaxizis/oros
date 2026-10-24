// Notifications with orOS closed on the relay (relay/push.js through
// relay/core.js): endpoint guards, limits, the box's tok, its schedule,
// the alarm (send, retry, late drop, self-delete) and the VAPID token.
// The Durable Object's SQLite storage and the push service are stand-ins.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
let handle, P;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  P = await import("../relay/push.js");
});

const ORIGIN = "https://useoros.online";
const ID = "AbCdEfGhIjKlMnOpQrStUv";            // 22
const TOK = "T".repeat(43);
const EP = "https://fcm.googleapis.com/fcm/send/abc:DEF_123-x";
const CT = "A".repeat(40);

// A tiny SQLite stand-in that knows exactly the statements push.js runs.
function fakeStorage() {
  const st = { meta: new Map(), rows: new Map(), alarm: null, wiped: 0, tx: 0 };
  const rows = () => Array.from(st.rows.values()).sort((a, b) => a.at - b.at);
  const res = (a) => ({ toArray: () => a });
  st.sql = {
    exec(q, ...v) {
      if (q.startsWith("CREATE")) return res([]);
      if (q.startsWith("SELECT v FROM meta")) return res(st.meta.has("box") ? [{ v: st.meta.get("box") }] : []);
      if (q.startsWith("INSERT OR REPLACE INTO meta")) { st.meta.set("box", v[0]); return res([]); }
      if (q === "DELETE FROM rows") { st.rows.clear(); return res([]); }
      if (q.startsWith("INSERT INTO rows")) { st.rows.set(v[0], { k: v[0], at: v[1], ct: v[2], ttl: v[3], tries: 0 }); return res([]); }
      if (q.startsWith("SELECT at FROM rows")) return res(rows().slice(0, 1).map((r) => ({ at: r.at })));
      if (q.startsWith("SELECT k, at")) return res(rows().filter((r) => r.at <= v[0]).slice(0, v[1]).map((r) => Object.assign({}, r)));
      if (q.startsWith("DELETE FROM rows WHERE")) { st.rows.delete(v[0]); return res([]); }
      if (q.startsWith("UPDATE rows")) { const r = st.rows.get(v[2]); r.at = v[0]; r.tries = v[1]; return res([]); }
      throw new Error("unknown SQL " + q);
    }
  };
  st.storage = {
    sql: st.sql,
    setAlarm(t) { st.alarm = t; },
    deleteAlarm() { st.alarm = null; },
    deleteAll() { st.meta.clear(); st.rows.clear(); st.wiped++; },
    transactionSync(fn) {
      st.tx++;
      const m = new Map(st.meta), r = new Map(st.rows);
      try { return fn(); } catch (e) { st.meta = m; st.rows = r; throw e; }
    }
  };
  return st;
}

let VAPID;
async function vapidEnv() {
  if (!VAPID) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    VAPID = { VAPID_PRIVATE: JSON.stringify({ kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y }),
              VAPID_SUBJECT: "mailto:hello@useoros.online", pub: kp.publicKey };
  }
  return VAPID;
}

// One namespace whose boxes live in memory; `sent` records each push.
function world(env) {
  const boxes = new Map(), sent = [];
  let reply = () => ({ status: 201 });
  const ns = {
    idFromName: (n) => n,
    get(id) {
      if (!boxes.has(id)) {
        const st = fakeStorage(), box = new P.PushBox({ storage: st.storage }, env);
        box.fetchFn = async (u, o) => { sent.push({ u, o }); return reply(u, o); };
        boxes.set(id, { st, box });
      }
      const b = boxes.get(id);
      return { fetch: (u, o) => b.box.fetch(new Request(u, o)) };
    }
  };
  env.PUSH = ns;
  return { boxes, sent, setReply: (f) => { reply = f; } };
}

let ipN = 0;   // a fresh address per call, unless a test names one (sub is limited per IP)
function post(body, ip) {
  return new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": ip || "198.51." + (++ipN >> 8 & 255) + "." + (ipN & 255) },
    body: JSON.stringify(Object.assign({ op: "push" }, body)) });
}
async function call(env, body, now, ip) {
  const r = await handle(post(body, ip), env, null, now);
  return { status: r.status, body: await r.json() };
}
async function freshEnv() {
  const v = await vapidEnv();
  const env = { ALLOWED_ORIGINS: ORIGIN, VAPID_PRIVATE: v.VAPID_PRIVATE, VAPID_SUBJECT: v.VAPID_SUBJECT };
  return { env, w: world(env) };
}

test("endpoint guard: only the push services, https, no port, no userinfo", () => {
  assert.equal(P.validEndpoint(EP), true);
  assert.equal(P.validEndpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAAA"), true);
  assert.equal(P.validEndpoint("https://wns2-db5p.notify.windows.com/w/?token=AwYAAAB%2b"), true);
  assert.equal(P.validEndpoint("https://web.push.apple.com/QAbc"), true);
  for (const bad of ["http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com:8443/fcm/send/x",
                     "https://u:p@fcm.googleapis.com/fcm/send/x", "https://evil.example/fcm/send/x",
                     "https://fcm.googleapis.com.evil.example/x", "https://notify.windows.com/x",
                     "https://evilnotify.windows.com/x", "https://fcm.googleapis.com/a b",
                     "https://fcm.googleapis.com/", "https://fcm.googleapis.com/x#frag",
                     "https://fcm.googleapis.com/" + "a".repeat(1100), "https://127.0.0.1/x", 42, null]) {
    assert.equal(P.validEndpoint(bad), false, String(bad));
  }
});

test("validation: id, tok, rows, ct, ttl, duplicate keys", () => {
  const ok = { op: "push", act: "set", id: ID, tok: TOK, items: [{ k: "k1abcdefgh", at: 1000, ct: CT }] };
  assert.equal(P.validPush(ok), "");
  assert.equal(P.validPush(Object.assign({}, ok, { id: ID + "x" })), "id");
  assert.equal(P.validPush(Object.assign({}, ok, { tok: "short" })), "tok");
  assert.equal(P.validPush(Object.assign({}, ok, { act: "nope" })), "act");
  const many = Array.from({ length: P.PUSH_LIMITS.rows + 1 }, (_, i) => ({ k: "key" + String(i).padStart(6, "0"), at: 1000, ct: CT }));
  assert.equal(P.validPush(Object.assign({}, ok, { items: many })), "items");
  assert.equal(P.validPush(Object.assign({}, ok, { items: [ok.items[0], ok.items[0]] })), "items");
  assert.equal(P.validPush(Object.assign({}, ok, { items: [{ k: "k1abcdefgh", at: 1.5, ct: CT }] })), "at");
  assert.equal(P.validPush(Object.assign({}, ok, { items: [{ k: "k1abcdefgh", at: 1000, ct: "A".repeat(P.PUSH_LIMITS.ctChars + 1) }] })), "ct");
  assert.equal(P.validPush(Object.assign({}, ok, { items: [{ k: "k1abcdefgh", at: 1000, ct: CT + "+" }] })), "ct");
  assert.equal(P.validPush(Object.assign({}, ok, { items: [{ k: "k1abcdefgh", at: 1000, ct: CT, ttl: 99999 }] })), "ttl");
  assert.equal(P.validPush({ op: "push", act: "key" }), "");
});

test("503 nopush without the VAPID secrets; key answers the public key", async () => {
  const bare = { ALLOWED_ORIGINS: ORIGIN };
  world(bare);
  const r = await call(bare, { act: "key" }, Date.now());
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "nopush");
  const { env } = await freshEnv();
  const k = await call(env, { act: "key" }, Date.now());
  assert.equal(k.status, 200);
  assert.match(k.body.data.key, /^[A-Za-z0-9_-]{87}$/);       // 65 bytes, uncompressed point
});

test("sub, set, wrong tok and missing box both answer gone", async () => {
  const { env, w } = await freshEnv();
  const now = 1_800_000_000_000;
  assert.equal((await call(env, { act: "set", id: ID, tok: TOK, items: [] }, now)).body.error.code, "gone");
  assert.equal((await call(env, { act: "sub", id: ID, tok: TOK, endpoint: EP }, now)).status, 200);
  const box = w.boxes.get(ID);
  assert.ok(!box.st.meta.get("box").includes(TOK), "tok kept only as its hash");
  assert.equal(box.st.alarm, now + P.PUSH_LIMITS.idleMs);
  const bad = await call(env, { act: "set", id: ID, tok: "U".repeat(43), items: [] }, now);
  assert.equal(bad.status, 404);
  assert.equal(bad.body.error.code, "gone");
  assert.equal((await call(env, { act: "sub", id: ID, tok: "U".repeat(43), endpoint: EP }, now)).body.error.code, "gone");
  const s = await call(env, { act: "set", id: ID, tok: TOK, items: [{ k: "alarm0001", at: now + 60000, ct: CT }] }, now);
  assert.equal(s.body.data.n, 1);
  assert.equal(box.st.alarm, now + 60000);
  // beyond the horizon
  const far = await call(env, { act: "set", id: ID, tok: TOK, items: [{ k: "alarm0001", at: now + P.PUSH_LIMITS.horizonMs + 1, ct: CT }] }, now);
  assert.equal(far.status, 400);
});

test("set replaces the whole schedule in one transaction and re-arms", async () => {
  const { env, w } = await freshEnv();
  const now = 1_800_000_000_000;
  await call(env, { act: "sub", id: ID, tok: TOK, endpoint: EP }, now);
  const st = w.boxes.get(ID).st;
  await call(env, { act: "set", id: ID, tok: TOK, items: [{ k: "aaaaaaaa", at: now + 5000, ct: CT }, { k: "bbbbbbbb", at: now + 9000, ct: CT }] }, now);
  assert.equal(st.rows.size, 2);
  const tx = st.tx;
  await call(env, { act: "set", id: ID, tok: TOK, items: [{ k: "cccccccc", at: now + 70000, ct: CT, ttl: 120 }] }, now + 1);
  assert.equal(st.tx, tx + 1);
  assert.deepEqual(Array.from(st.rows.keys()), ["cccccccc"]);
  assert.equal(st.rows.get("cccccccc").ttl, 120);
  assert.equal(st.alarm, now + 70000);
  await call(env, { act: "set", id: ID, tok: TOK, items: [] }, now + 2);
  assert.equal(st.rows.size, 0);
  assert.equal(st.alarm, now + 2 + P.PUSH_LIMITS.idleMs);
});

test("limits: set per hour, test every 30 s, sub per IP per day", async () => {
  const { env } = await freshEnv();
  const now = 1_800_000_000_000;
  await call(env, { act: "sub", id: ID, tok: TOK, endpoint: EP }, now, "203.0.113.50");
  let last;
  for (let i = 0; i <= P.PUSH_LIMITS.setPerHour; i++) last = await call(env, { act: "set", id: ID, tok: TOK, items: [] }, now + i);
  assert.equal(last.status, 429);
  assert.equal((await call(env, { act: "set", id: ID, tok: TOK, items: [] }, now + 3600001)).status, 200);
  assert.equal((await call(env, { act: "test", id: ID, tok: TOK, ct: CT }, now)).status, 200);
  assert.equal((await call(env, { act: "test", id: ID, tok: TOK, ct: CT }, now + 1000)).status, 429);
  assert.equal((await call(env, { act: "test", id: ID, tok: TOK, ct: CT }, now + 31000)).status, 200);
  for (let i = 1; i < P.PUSH_LIMITS.subPerDay; i++) {
    assert.equal((await call(env, { act: "sub", id: ID, tok: TOK, endpoint: EP }, now, "203.0.113.50")).status, 200);
  }
  assert.equal((await call(env, { act: "sub", id: ID, tok: TOK, endpoint: EP }, now, "203.0.113.50")).status, 429);
});

test("the push request: VAPID header verifies, aes128gcm, TTL, Urgency, never follows a redirect", async () => {
  const { env, w } = await freshEnv();
  const now = Date.now();
  await call(env, { act: "sub", id: ID, tok: TOK, endpoint: EP }, now);
  await call(env, { act: "test", id: ID, tok: TOK, ct: CT }, now);
  assert.equal(w.sent.length, 1);
  const { u, o } = w.sent[0];
  assert.equal(u, EP);
  assert.equal(o.redirect, "manual");
  assert.equal("credentials" in o, false);
  assert.equal(o.headers["Content-Encoding"], "aes128gcm");
  assert.equal(o.headers.TTL, "60");
  assert.equal(o.headers.Urgency, "high");
  const m = /^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/.exec(o.headers.Authorization);
  assert.ok(m);
  const [h, c, s] = m[1].split(".");
  const dec = (x) => Buffer.from(x, "base64url");
  const claims = JSON.parse(dec(c).toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "mailto:hello@useoros.online");
  assert.ok(claims.exp * 1000 <= now + 12 * 3600000 + 1000);
  const v = await vapidEnv();
  assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, v.pub, dec(s), new TextEncoder().encode(h + "." + c)), true);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", v.pub));
  assert.equal(m[2], Buffer.from(raw).toString("base64url"));
  assert.deepEqual(Buffer.from(o.body), dec(CT));
  // a redirect is not followed: one fetch, and the row is dropped
  w.setReply(() => ({ status: 301 }));
  const st = w.boxes.get(ID).st, box = w.boxes.get(ID).box;
  st.rows.set("redir001", { k: "redir001", at: Date.now() - 1000, ct: CT, ttl: 900, tries: 0 });
  await box.alarm();
  assert.equal(w.sent.length, 2);
  assert.equal(st.rows.size, 0);
});

test("alarm: sends what is due, drops late rows, retries 429 twice then drops", async () => {
  const { env, w } = await freshEnv();
  const now = Date.now();
  await call(env, { act: "sub", id: ID, tok: TOK, endpoint: EP }, now);
  const { st, box } = w.boxes.get(ID);
  await call(env, { act: "set", id: ID, tok: TOK, items: [
    { k: "duenow01", at: now + 5000, ct: CT },
    { k: "later001", at: now + 3600000, ct: CT }] }, now);
  st.rows.get("duenow01").at = now - 1000;                          // due
  st.rows.set("toolate1", { k: "toolate1", at: now - P.PUSH_LIMITS.lateMs - 1, ct: CT, ttl: 900, tries: 0 });
  await box.alarm();
  assert.equal(w.sent.length, 1);                                    // the late one was never sent
  assert.deepEqual(Array.from(st.rows.keys()), ["later001"]);
  assert.equal(st.alarm, now + 3600000);
  // 429: +30 s, then +2 min, then dropped
  w.setReply(() => ({ status: 429 }));
  st.rows.get("later001").at = Date.now() - 10;
  await box.alarm();
  assert.equal(st.rows.get("later001").tries, 1);
  assert.ok(st.rows.get("later001").at - Date.now() > 25000);
  st.rows.get("later001").at = Date.now() - 10;
  await box.alarm();
  assert.equal(st.rows.get("later001").tries, 2);
  st.rows.get("later001").at = Date.now() - 10;
  await box.alarm();
  assert.equal(st.rows.size, 0);
  // 413: dropped at once
  w.setReply(() => ({ status: 413 }));
  st.rows.set("toobig01", { k: "toobig01", at: Date.now() - 10, ct: CT, ttl: 900, tries: 0 });
  await box.alarm();
  assert.equal(st.rows.size, 0);
  assert.ok(st.meta.has("box"));
});

test("404 / 410 from the push service: the box deletes itself", async () => {
  for (const code of [404, 410]) {
    const { env, w } = await freshEnv();
    const now = Date.now();
    await call(env, { act: "sub", id: ID, tok: TOK, endpoint: EP }, now);
    const { st, box } = w.boxes.get(ID);
    st.rows.set("gone0001", { k: "gone0001", at: now - 10, ct: CT, ttl: 900, tries: 0 });
    w.setReply(() => ({ status: code }));
    await box.alarm();
    assert.equal(st.wiped, 1);
    assert.equal(st.meta.size, 0);
    assert.equal(st.alarm, null);
    assert.equal((await call(env, { act: "set", id: ID, tok: TOK, items: [] }, now)).body.error.code, "gone");
  }
});

test("idle 30 days: the box deletes itself; del forgets it; errors never carry text", async () => {
  const { env, w } = await freshEnv();
  const long = Date.now() - P.PUSH_LIMITS.idleMs - 1000;
  await call(env, { act: "sub", id: ID, tok: TOK, endpoint: EP }, long);
  const { st, box } = w.boxes.get(ID);
  await box.alarm();
  assert.equal(st.wiped, 1);
  assert.equal(st.alarm, null);
  await call(env, { act: "sub", id: ID, tok: TOK, endpoint: EP }, Date.now(), "198.51.100.77");
  assert.equal((await call(env, { act: "del", id: ID, tok: TOK }, Date.now())).status, 200);
  assert.equal(st.meta.size, 0);
  // a broken box: fixed code, no message from inside
  env.PUSH = { idFromName: (n) => n, get: () => ({ fetch: () => { throw new Error("secret endpoint https://x"); } }) };
  const r = await call(env, { act: "set", id: ID, tok: TOK, items: [] }, Date.now());
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "nostore");
  assert.ok(!JSON.stringify(r.body).includes("secret"));
});

test("alarm without the secrets keeps the rows and looks again in an hour", async () => {
  const { env, w } = await freshEnv();
  const now = Date.now();
  await call(env, { act: "sub", id: ID, tok: TOK, endpoint: EP }, now);
  const { st, box } = w.boxes.get(ID);
  st.rows.set("waiting1", { k: "waiting1", at: now - 10, ct: CT, ttl: 900, tries: 0 });
  box.env = { ALLOWED_ORIGINS: ORIGIN };
  await box.alarm();
  assert.equal(w.sent.length, 0);
  assert.equal(st.rows.size, 1);
  assert.ok(st.alarm >= now + 3590000);
});

// ---------- household wakes (relay/house.js → PushBox "wake") ----------
const crypto2 = require("node:crypto");
const hex = (s) => crypto2.createHash("sha256").update(s).digest("hex");
const HBOX = "HoUsEbOx0123456789_-ab", HW = "W".repeat(43), HA = "A".repeat(43);
const ID2 = "ZyXwVuTsRqPoNmLkJiHgFe", TOK2 = "S".repeat(43);

test("wake token: issued per box, can only wake, revoked by wdel; wake is not a public act", async () => {
  const { env, w } = await freshEnv();
  const now = 1_800_000_000_000;
  await call(env, { act: "sub", id: ID, tok: TOK, endpoint: EP }, now);
  const r = await call(env, { act: "wtok", id: ID, tok: TOK }, now);
  assert.equal(r.status, 200);
  const wt = r.body.data.wt;
  assert.match(wt, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!w.boxes.get(ID).st.meta.get("box").includes(wt), "kept only as its hash");
  assert.equal((await call(env, { act: "wtok", id: ID, tok: "U".repeat(43) }, now)).body.error.code, "gone");
  // the wake token is no tok: set, del, sub, test refuse it
  for (const act of ["set", "del", "test"]) {
    const x = await call(env, { act, id: ID, tok: wt, items: [], ct: CT }, now + 60000);
    assert.equal(x.body.error.code, "gone", act);
  }
  assert.equal((await call(env, { act: "sub", id: ID, tok: wt, endpoint: EP }, now)).body.error.code, "gone");
  assert.equal(P.validPush({ op: "push", act: "wake", id: ID, tok: TOK }), "act");
  // the box itself answers wake (stub to stub): once per 15 minutes, Urgency normal, last untouched
  const stub = env.PUSH.get(ID);
  const wake = async (t, x) => (await stub.fetch("https://push.box/", { method: "POST", body: JSON.stringify({ act: "wake", wt: x || wt, ct: CT, now: t }) })).json();
  const last = JSON.parse(w.boxes.get(ID).st.meta.get("box")).last;
  assert.equal((await wake(now + 1)).ok, true);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].o.headers.Urgency, "normal");
  assert.equal(w.sent[0].o.headers.TTL, String(P.PUSH_LIMITS.wakeTtl));
  assert.equal((await wake(now + 2)).code, "rate");
  assert.equal((await wake(now + 2, "X".repeat(43))).code, "gone");
  assert.equal(JSON.parse(w.boxes.get(ID).st.meta.get("box")).last, last);
  assert.equal((await call(env, { act: "wdel", id: ID, tok: TOK, wt }, now)).status, 200);
  assert.equal((await wake(now + P.PUSH_LIMITS.wakeGapMs + 10)).code, "gone");
  assert.equal(P.validPush({ op: "push", act: "wdel", id: ID, tok: TOK, wt: "short" }), "wt");
});

async function houseCall(env, method, path, opts) {
  opts = opts || {};
  const h = { Origin: ORIGIN, "CF-Connecting-IP": "10.9.0.1" };
  if (opts.w) h.Authorization = "Bearer " + opts.w;
  if (opts.a) h["X-HH-Admin"] = opts.a;
  if (opts.rev !== undefined) h["If-Match"] = '"' + opts.rev + '"';
  if (opts.dev) h["X-HH-Dev"] = opts.dev;
  let body = opts.body;
  if (opts.json) { body = JSON.stringify(opts.json); h["Content-Type"] = "application/json"; }
  const r = await handle(new Request("https://relay.example" + path, { method, headers: h, body }), env, null, opts.now);
  return { status: r.status, body: await r.json().catch(() => null) };
}

test("household box: a change wakes the other devices once, after 2 minutes, never the writer", async () => {
  const HF = require("./house-fake.js");
  const H = await HF.load();
  const hw = HF.world();
  const v = await vapidEnv();
  Object.assign(hw.env, { VAPID_PRIVATE: v.VAPID_PRIVATE, VAPID_SUBJECT: v.VAPID_SUBJECT });
  const pw = world(hw.env);
  const env = hw.env, now = 1_800_000_000_000;
  assert.equal((await houseCall(env, "POST", "/h/" + HBOX, { json: { act: "new", wh: hex(HW), ah: hex(HA) }, now })).status, 200);
  // two devices with push boxes, each registered with the household
  const wts = {};
  for (const [id, tk] of [[ID, TOK], [ID2, TOK2]]) {
    await call(env, { act: "sub", id, tok: tk, endpoint: EP + id }, now);
    wts[id] = (await call(env, { act: "wtok", id, tok: tk }, now)).body.data.wt;
    assert.equal((await houseCall(env, "POST", "/h/" + HBOX + "/p", { w: HW, json: { pid: id, wt: wts[id], ct: CT, extra: 1 }, now })).status, 200);
  }
  assert.equal((await houseCall(env, "POST", "/h/" + HBOX + "/p", { w: HW, json: { pid: ID, wt: "x", ct: CT }, now })).status, 400);
  assert.equal((await houseCall(env, "POST", "/h/" + HBOX + "/p", { w: "Q".repeat(43), json: { pid: ID, wt: wts[ID], ct: CT }, now })).status, 404);
  const hb = hw.boxes.get(HBOX);
  // never returned
  const info = await houseCall(env, "GET", "/h/" + HBOX, { w: HW, now });
  assert.ok(!JSON.stringify(info.body).includes(wts[ID]) && !JSON.stringify(info.body).includes(ID));
  // device 1 writes twice: one wake for device 2 only, 2 minutes later; the idle deadline stays
  await houseCall(env, "PUT", "/h/" + HBOX + "/d/doc1", { w: HW, rev: 0, body: new Uint8Array(5), dev: ID, now });
  await houseCall(env, "PUT", "/h/" + HBOX + "/d/doc1", { w: HW, rev: 1, body: new Uint8Array(5), dev: ID, now: now + 1000 });
  assert.equal(hb.st.alarm, now + H.HOUSE_LIMITS.wakeDelayMs);
  const realNow = Date.now;
  try {
    Date.now = () => now + H.HOUSE_LIMITS.wakeDelayMs;
    await hb.box.alarm();
    assert.deepEqual(pw.sent.map((x) => x.u), [EP + ID2]);
    assert.equal(hb.st.alarm, now + H.HOUSE_LIMITS.idleMs);                  // back to the idle deadline
    // a write from device 2 inside device 1's quiet gap: device 1 woken; device 2 is not
    await houseCall(env, "PUT", "/h/" + HBOX + "/d/doc1", { w: HW, rev: 2, body: new Uint8Array(5), dev: ID2, now: now + 200000 });
    // and one from device 1 again: device 2 was woken under 15 min ago, so it waits for the gap
    await houseCall(env, "PUT", "/h/" + HBOX + "/d/doc1", { w: HW, rev: 3, body: new Uint8Array(5), dev: ID, now: now + 200001 });
    Date.now = () => now + 200000 + H.HOUSE_LIMITS.wakeDelayMs;
    await hb.box.alarm();
    assert.deepEqual(pw.sent.map((x) => x.u), [EP + ID2, EP + ID]);
    const gapEnd = now + H.HOUSE_LIMITS.wakeDelayMs + H.HOUSE_LIMITS.wakeGapMs;
    assert.equal(hb.st.alarm, gapEnd);
    Date.now = () => gapEnd;
    await hb.box.alarm();
    assert.deepEqual(pw.sent.map((x) => x.u), [EP + ID2, EP + ID, EP + ID2]);
    // a dead subscription: the push box wipes itself and the row goes
    pw.setReply(() => ({ status: 410 }));
    await houseCall(env, "PUT", "/h/" + HBOX + "/d/doc1", { w: HW, rev: 4, body: new Uint8Array(5), now: gapEnd + 1 });
    Date.now = () => gapEnd + H.HOUSE_LIMITS.wakeGapMs + 10;
    await hb.box.alarm();
    assert.equal(hb.st.ping.size, 0);
    // the idle deadline still wins when it comes
    Date.now = () => now + H.HOUSE_LIMITS.idleMs + 10;
    await hb.box.alarm();
    assert.equal(hb.st.wiped, 1);
  } finally { Date.now = realNow; }
});

test("household box: a key rotation clears the wake rows; unping removes one", async () => {
  const HF = require("./house-fake.js");
  await HF.load();
  const hw = HF.world();
  const env = hw.env, now = 1_800_000_000_000;
  await houseCall(env, "POST", "/h/" + HBOX, { json: { act: "new", wh: hex(HW), ah: hex(HA) }, now });
  await houseCall(env, "POST", "/h/" + HBOX + "/p", { w: HW, json: { pid: ID, wt: "w".repeat(43), ct: CT }, now });
  await houseCall(env, "POST", "/h/" + HBOX + "/p", { w: HW, json: { pid: ID2, wt: "v".repeat(43), ct: CT }, now });
  const hb = hw.boxes.get(HBOX);
  assert.equal(hb.st.ping.size, 2);
  assert.equal((await houseCall(env, "DELETE", "/h/" + HBOX + "/p/" + ID2, { w: HW, now })).status, 200);
  assert.equal(hb.st.ping.size, 1);
  const W2 = "V".repeat(43);
  const rot = await houseCall(env, "POST", "/h/" + HBOX + "/rot", { w: HW, a: HA, json: { epoch: 2, wh: hex(W2), env: { [ID]: Buffer.from(new Uint8Array(30)).toString("base64url") } }, now });
  assert.equal(rot.status, 200);
  assert.equal(hb.st.ping.size, 0);
  // no PUSH binding, or a failing one: a change and its alarm never throw
  await houseCall(env, "POST", "/h/" + HBOX + "/p", { w: W2, json: { pid: ID, wt: "w".repeat(43), ct: CT }, now });
  await houseCall(env, "PUT", "/h/" + HBOX + "/d/d", { w: W2, rev: 0, body: new Uint8Array(3), now });
  env.PUSH = { idFromName: (n) => n, get() { return { fetch: async () => { throw new Error("down"); } }; } };
  const realNow = Date.now;
  try { Date.now = () => now + 3 * 60000; await hb.box.alarm(); } finally { Date.now = realNow; }
  assert.equal(hb.st.ping.size, 1);
  assert.equal(hb.st.ping.get(ID).due, 0);
});
