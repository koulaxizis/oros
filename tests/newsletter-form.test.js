// Newsletter phase 3B (app side): the web sign-up form and one-click
// unsubscribe. The engine in its sandbox talks to the real relay code
// (relay/core.js + relay/newsletter.js) over an in-memory D1.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../newsletter/core.js");
const R = require("../newsletter/render.js");
const M = require("../mail/compose.js");
const { sandbox } = require("./newsletter-sandbox.js");

let handle, NL;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  NL = await import("../relay/newsletter.js");
});

const LIST = { id: "list-1", m: 1, name: "Friends", chan: "chan-1", from: "me@example.com", reply: "", lang: "el",
  addr: "1 Main St, Athens", why: "You signed up on my site.", theme: "classic", color: "#2f6fde", salt: "abcdefgh12" };
const CHAN = { id: "chan-1", m: 1, name: "My mail", kind: "mail", acct: "acct01", rate: 1, cap: 300 };
function model(o) { return C.normalize(Object.assign({ chans: [CHAN], lists: [LIST], subs: [], issues: [] }, o || {})); }

// The D1 the relay test uses, trimmed: exactly the statements in NL.SQL.
function fakeD1() {
  const lists = new Map(), rows = [];
  let seq = 0;
  function exec(sql, a) {
    const S = NL.SQL;
    switch (sql) {
      case S.list: case S.queue: case S.index: return {};
      case S.getList: { const l = lists.get(a[0]); return { first: l ? { ...l } : null }; }
      case S.countLists: return { first: { n: lists.size } };
      case S.addList: lists.set(a[0], { pub: a[1], sec: a[2], back: a[3], at: a[4] }); return {};
      case S.setList: Object.assign(lists.get(a[0]), { pub: a[1], back: a[2], at: a[3] }); return {};
      case S.countRows: return { first: { n: rows.filter((r) => r.k === a[0]).length } };
      case S.addRow: rows.push({ id: ++seq, k: a[0], kind: a[1], v: a[2], at: a[3] }); return {};
      case S.seenUnsub: return { first: rows.find((x) => x.k === a[0] && x.kind === "u" && x.v === a[1] && x.at > a[2]) || null };
      case S.pull: return { all: rows.filter((r) => r.k === a[0] && r.id > a[1]).slice(0, a[2]).map((r) => ({ ...r })) };
      case S.ack: { const n = rows.length; for (let i = rows.length - 1; i >= 0; i--) if (rows[i].k === a[0] && rows[i].id <= a[1]) rows.splice(i, 1); return { meta: { changes: n - rows.length } }; }
      case S.dropRows: for (let i = rows.length - 1; i >= 0; i--) if (rows[i].k === a[0]) rows.splice(i, 1); return {};
      case S.dropList: lists.delete(a[0]); return {};
    }
    throw new Error("unknown SQL " + sql);
  }
  const stmt = (sql, args) => ({ bind: (...b) => stmt(sql, b), first: async () => exec(sql, args || []).first,
    all: async () => ({ results: exec(sql, args || []).all }), run: async () => exec(sql, args || []), _run: () => exec(sql, args || []) });
  return { lists, rows, prepare: (sql) => stmt(sql), batch: async (ss) => ss.map((s) => s._run()) };
}
const ORIGIN = "https://useoros.online";
let ip = 0;
async function wire(S) {
  const D = fakeD1();
  const env = { ALLOWED_ORIGINS: ORIGIN, NL_DB: D };
  S.ctx.fetch = async (url, o) => {
    const op = JSON.parse(o.body).op;
    if (op !== "nl") return { json: async () => ({ ok: true, data: op === "search" ? { msgs: [] } : {} }) };   // Mail's IMAP ops
    const r = new Request(url, { method: o.method, body: o.body, headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.9.0." + (ip++ % 250) } });
    const res = await handle(r, env, null, Date.now());
    const text = await res.text();
    return { json: async () => JSON.parse(text) };
  };
  const pub = async (path, init) => handle(new Request("https://relay.example" + path,
    Object.assign({}, init, { headers: Object.assign({ "CF-Connecting-IP": "10.8.0." + (ip++ % 250) }, (init && init.headers) || {}) })), env, null, Date.now());
  return { D, env, pub };
}
const form = (o) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });

test("form record: validated, synced with the list, merged with it", () => {
  assert.equal(C.normForm({ k: "short", sec: "x" }), null);
  const good = { k: "abcdefgh12345678", sec: "A".repeat(32), priv: { kty: "RSA", n: "n1", e: "AQAB", d: "d1", p: "p", q: "q", dp: "dp", dq: "dq", qi: "qi" },
                 back: "javascript:alert(1)", dev: "devaaa1", at: 5 };
  const f = C.normForm(good);
  assert.equal(f.back, "");
  assert.equal(f.priv.alg, "RSA-OAEP-256");
  assert.equal(C.normForm(Object.assign({}, good, { priv: Object.assign({}, good.priv, { d: "bad value!" }) })), null);
  assert.deepEqual(C.formPub(f), { kty: "RSA", alg: "RSA-OAEP-256", n: "n1", e: "AQAB" });
  const d = model({ lists: [Object.assign({}, LIST, { form: good })] });
  assert.equal(d.lists[0].form.k, "abcdefgh12345678");
  assert.equal(model().lists[0].form, null);
  const s = { id: "sub-1" };
  assert.match(C.unsubPath(d.lists[0], s), /^\/nl\/u\/abcdefgh12345678\/[a-z0-9]{11}$/);
  assert.equal("nl-" + C.unsubPath(d.lists[0], s).split("/").pop(), C.token(d.lists[0], "sub-1"));
});

test("form HTML: no script, escaped, honeypot and list language", () => {
  const l = model({ lists: [Object.assign({}, LIST, { form: { k: "abcdefgh12345678", sec: "A".repeat(32),
    priv: { kty: "RSA", n: "n", e: "AQAB", d: "d", p: "p", q: "q", dp: "a", dq: "b", qi: "c" } } })] }).lists[0];
  const h = C.formHtml(l, "https://relay.example", { email: "E\"mail<", name: "Name", btn: "Go" });
  assert.match(h, /action="https:\/\/relay\.example\/nl\/s\/abcdefgh12345678"/);
  assert.match(h, /name="website"/);
  assert.match(h, /name="lang" value="el"/);
  assert.match(h, /placeholder="E&quot;mail&lt;"/);
  assert.doesNotMatch(h, /<script/i);
});

test("message: one-click https first, mailto as fallback, List-Unsubscribe-Post", () => {
  const l = C.normList(LIST);
  const e = R.email({ issue: C.normIssue({ id: "iss-1", m: 1, list: "list-1", subj: "S", fmt: "md", md: "Hi", st: "draft" }), list: l,
                      sub: { name: "" }, lang: "en", unsub: "mailto:me@example.com?subject=unsubscribe%20nl-x", unsubWeb: "https://relay.example/nl/u/k/t", tok: "nl-x", mailbox: "me@example.com" });
  assert.match(e.html, /href="https:\/\/relay\.example\/nl\/u\/k\/t"/);
  assert.match(e.text, /https:\/\/relay\.example\/nl\/u\/k\/t/);
  const m = R.message(M, { from: { name: "", addr: "me@example.com" }, to: { name: "", addr: "a@x.gr" }, subject: "S", text: "t", html: "<p>t</p>",
                           listId: "list-1", unsub: "mailto:me@example.com?subject=x", unsubWeb: "https://relay.example/nl/u/k/t" });
  assert.match(m.bin, /List-Unsubscribe: <https:\/\/relay\.example\/nl\/u\/k\/t>, <mailto:me@example\.com\?subject=x>\r\n/);
  assert.match(m.bin, /List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/);
  const plain = R.message(M, { from: { name: "", addr: "me@example.com" }, to: { name: "", addr: "a@x.gr" }, subject: "S", text: "t", html: "<p>t</p>",
                               listId: "list-1", unsub: "mailto:me@example.com?subject=x" });
  assert.doesNotMatch(plain.bin, /List-Unsubscribe-Post/);
});

test("end to end: form on, a web sign-up becomes a pending subscriber, one-click unsubscribes, form off", async () => {
  const S = await sandbox(model({ subs: [{ id: C.subId("list-1", "old@x.gr"), m: 1, list: "list-1", email: "old@x.gr", basis: "consent", at: 1, conf: 1 }] }));
  const W = await wire(S);
  const f = await S.E.formOn("list-1", "");
  assert.match(f.k, /^[a-z0-9]{16}$/);
  let d = S.read();
  assert.equal(d.lists[0].form.k, f.k);
  assert.equal(d.lists[0].form.dev, "devaaa1");
  assert.ok(W.D.lists.has(f.k));
  assert.notEqual(W.D.lists.get(f.k).sec, f.sec);                   // the relay keeps only the hash
  // someone signs up on the user's site, with a long Greek name
  const name = "Παναγιώτα-Αικατερίνη Παπαδοπούλου-Χατζηγεωργίου";
  const res = await W.pub("/nl/s/" + f.k, form({ email: "New@X.gr", name, lang: "el", website: "" }));
  assert.equal(res.status, 200);
  // and an old subscriber unsubscribes with one click from an issue
  const old = d.subs[0];
  const path = C.unsubPath(d.lists[0], old);
  assert.equal((await W.pub(path, { method: "POST", body: "List-Unsubscribe=One-Click" })).status, 200);
  assert.equal(W.D.rows.length, 2);
  const tally = await S.engine.checkInbox();
  assert.equal(tally.s, 1);
  assert.equal(tally.u, 1);
  assert.equal(tally.err, null);
  assert.equal(W.D.rows.length, 0, "acked");
  d = S.read();
  const n = d.subs.find((s) => s.email.toLowerCase() === "new@x.gr");
  assert.ok(n, JSON.stringify(d.subs.map((s) => s.email)));
  assert.equal(n.name, name);
  assert.equal(n.lang, "el");
  assert.equal(n.src, "form");
  assert.equal(C.status(n), "pend");                                   // confirmation request next
  assert.equal(C.status(d.subs.find((s) => s.email === "old@x.gr")), "off");
  // the engine's next job is the confirmation request
  // (and issues now carry the one-click address)
  const l = d.lists[0];
  const bin = S.E.buildFor(C.normIssue({ id: "iss-1", m: 1, list: "list-1", subj: "S", fmt: "md", md: "Hi", st: "draft" }), l, n).bin;
  assert.match(bin, new RegExp("List-Unsubscribe: <https://[^>]+" + C.unsubPath(l, n).replace(/\//g, "\\/") + ">"));
  // off: the relay forgets the list
  await S.E.formOff("list-1");
  assert.equal(S.read().lists[0].form, null);
  assert.equal(W.D.lists.has(f.k), false);
});

test("another device's form is left alone until 'Collect here'; no relay store is no error", async () => {
  const S = await sandbox(model());
  const W = await wire(S);
  await S.E.formOn("list-1", "https://my.site/thanks");
  const cur = S.E.read();
  cur.lists[0].form.dev = "devzzz9"; cur.lists[0].m += 1;
  S.E.write(cur);
  await W.pub("/nl/s/" + cur.lists[0].form.k, form({ email: "a@x.gr" }));
  let t = await S.engine.checkInbox();
  assert.equal(t.s, 0);
  assert.equal(W.D.rows.length, 1);
  S.E.formHere("list-1");
  t = await S.engine.checkInbox();
  assert.equal(t.s, 1);
  // a relay without D1: pulls fail quietly (the e-mail way goes on)
  delete W.env.NL_DB;
  t = await S.engine.checkInbox();
  assert.equal(t.err, null);
});
