// Newsletter N2 (2026-11): checkout sign-ups signed with the shop key
// (orOS Connect), purchases per subscriber from the shop's orders, and
// purchase rules in segments (with the win-back preset's rules).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const C = require("../newsletter/core.js");
const L = require("../links/core.js");

const DAY = 864e5, NOW = Date.UTC(2026, 10, 3, 12);
const KEY = "Ab3".repeat(10) + "Z9";
const LIST = { id: "list-1", m: 1, name: "News", chan: "chan-1", from: "me@example.com", lang: "el", addr: "Street 1", salt: "abcdefgh12" };
function sub(email, extra) {
  return Object.assign({ id: C.subId("list-1", email), m: 5, list: "list-1", email, name: "", tags: [], src: "csv",
    basis: "consent", at: NOW - 400 * DAY, conf: NOW - 400 * DAY, off: 0 }, extra || {});
}
function data(subs, extra) {
  return C.normalize(Object.assign({ ver: 1, chans: [], lists: [LIST], subs, issues: [], tpls: [], supp: [], segs: [] }, extra || {}));
}
const sign = (key, email, ts) => nodeCrypto.createHmac("sha256", key).update(email.trim().toLowerCase() + "|" + ts).digest("hex");

test("N2: the shop key is kept on the form; signed sign-ups need a fresh time", () => {
  assert.equal(KEY.length, 32);
  const f = { k: "abcdefgh12345678", sec: "A".repeat(32), priv: { kty: "RSA", n: "x", e: "AQAB", d: "x", p: "x", q: "x", dp: "x", dq: "x", qi: "x" } };
  assert.equal(C.normForm(Object.assign({ shk: KEY }, f)).shk, KEY);
  assert.equal(C.normForm(Object.assign({ shk: "short" }, f)).shk, "");
  const ts = String(Math.floor(NOW / 1000));
  const o = { e: "A@x.gr", t: NOW, s: "shop", ts, sig: sign(KEY, "A@x.gr", ts) };
  assert.ok(C.shopSigned(o));
  assert.ok(!C.shopSigned(Object.assign({}, o, { t: NOW + (C.SHOP_SKEW + 5) * 1000 })), "old or replayed later");
  assert.ok(!C.shopSigned(Object.assign({}, o, { s: undefined })));
  assert.equal(C.shopSigText(" A@X.gr ", ts), "a@x.gr|" + ts);
});

test("N2: the engine checks the HMAC like orOS Connect makes it, and a signed checkout sign-up is active at once", async () => {
  const { sandbox } = require("./newsletter-sandbox.js");
  const S = await sandbox(data([]));
  S.engine.stop();
  const ts = String(Math.floor(Date.now() / 1000));
  const good = { e: "Buyer@X.gr", n: "Ann", l: "el", t: Date.now(), s: "shop", ts, sig: sign(KEY, "Buyer@X.gr", ts) };
  assert.equal(await S.E.shopOk(KEY, good), true);
  assert.equal(await S.E.shopOk("B".repeat(32), good), false, "another key");
  assert.equal(await S.E.shopOk("", good), false, "no key: confirm by e-mail");
  assert.equal(await S.E.shopOk(KEY, Object.assign({}, good, { e: "other@x.gr" })), false, "signature of another address");
  // applied: active, checkout source, consent note; unsigned → waits for confirmation
  const d = data([sub("left@x.gr", { off: NOW - DAY, offSt: "off" }), sub("on@x.gr", { conf: NOW - DAY })]);
  const l = C.list(d, "list-1"), tally = { s: 0, u: 0, c: 0 };
  S.E.applySignup(d, l, Object.assign({ ok: true }, good), tally);
  S.E.applySignup(d, l, { e: "plain@x.gr", t: Date.now() }, tally);
  S.E.applySignup(d, l, { e: "left@x.gr", ok: true, t: Date.now() }, tally);
  assert.equal(S.E.applySignup(d, l, { e: "on@x.gr", ok: true, t: Date.now() }, tally), false, "already active: left as is");
  const st = (e) => { const s = C.sub(d, C.subId("list-1", e)); return [C.status(s), s.src, s.basis, s.cn || ""]; };
  assert.deepEqual(st("buyer@x.gr"), ["on", "chk", "consent", "Checkout (orOS Connect)"]);
  assert.deepEqual(st("plain@x.gr"), ["pend", "form", "optin", ""]);
  assert.deepEqual(st("left@x.gr"), ["on", "chk", "consent", "Checkout (orOS Connect)"], "fresh consent brings them back");
  assert.equal(tally.chk, 2);
  // a checkout sign-up gets the welcome mail like a form sign-up
  const d2 = data(d.subs, { lists: [Object.assign({}, LIST, { welTpl: "tpl-1", welAt: 1 })], tpls: [{ id: "tpl-1", m: 1, name: "W", subj: "Hi", fmt: "md", md: "Hi" }] });
  assert.ok(C.welcomesDue(d2, "list-1", Date.now()).some((s) => s.email.toLowerCase() === "buyer@x.gr"));
});

test("N2: orders → purchases by e-mail, only paid ones; the request passes the allowlist", () => {
  const orders = [
    { id: 1, status: "completed", total: "20.00", date_created_gmt: "2025-01-10T10:00:00", billing: { email: "Ann@x.gr" } },
    { id: 2, status: "processing", total: "15.50", date_created_gmt: "2025-06-01T10:00:00", billing: { email: "ann@x.gr" } },
    { id: 3, status: "refunded", total: "99.00", date_created_gmt: "2025-07-01T10:00:00", billing: { email: "ann@x.gr" } },
    { id: 4, status: "completed", total: "abc", date_created_gmt: "bad", billing: { email: "bob@x.gr" } },
    { id: 5, status: "completed", total: "5.00", billing: {} }
  ];
  const b = C.purchasesOf(orders);
  assert.deepEqual(b["ann@x.gr"], { n: 2, s: 3550, f: Date.UTC(2025, 0, 10, 10), l: Date.UTC(2025, 5, 1, 10) });
  assert.deepEqual(b["bob@x.gr"], { n: 1, s: 0, f: 0, l: 0 });
  assert.equal(Object.keys(b).length, 2);
  assert.equal(L.checkReq("woo", { m: "GET", path: "/orders?status=processing,completed&per_page=100&page=3&orderby=id&order=asc" }), "");
});

test("N2: purchases go on the list's subscribers (synced fields), removed when gone", () => {
  const d = data([sub("ann@x.gr"), sub("bob@x.gr", { bn: 3, bs: 100, bf: 1, bl: 2 }), sub("cy@x.gr")]);
  const n = C.applyPurchases(d, "list-1", { "ann@x.gr": { n: 2, s: 3550, f: 10, l: 20 } }, { acct: "abcd1234", cur: "EUR" }, NOW);
  assert.equal(n, 2);
  const a = C.sub(d, C.subId("list-1", "ann@x.gr")), b = C.sub(d, C.subId("list-1", "bob@x.gr"));
  assert.deepEqual([a.bn, a.bs, a.bf, a.bl], [2, 3550, 10, 20]);
  assert.ok(a.m >= NOW);
  assert.equal(b.bn, undefined);
  const l = C.list(d, "list-1");
  assert.deepEqual([l.buyAt, l.buyAcct, l.buyCur], [NOW, "abcd1234", "EUR"]);
  // the same again changes nobody; survives normalize and merge
  assert.equal(C.applyPurchases(d, "list-1", { "ann@x.gr": { n: 2, s: 3550, f: 10, l: 20 } }, null, NOW + 1), 0);
  const again = C.normalize(JSON.parse(JSON.stringify(d)));
  assert.equal(C.sub(again, a.id).bs, 3550);
  assert.equal(C.list(again, "list-1").buyAcct, "abcd1234");
});

test("N2: purchase rules in segments, and the win-back rules", () => {
  const recent = NOW - 30 * DAY, old = NOW - 400 * DAY;
  const d = data([
    sub("never@x.gr"),
    sub("once@x.gr", { bn: 1, bs: 2000, bf: recent, bl: recent }),
    sub("loyal@x.gr", { bn: 6, bs: 30000, bf: old, bl: recent }),
    sub("gone@x.gr", { bn: 2, bs: 4000, bf: old - DAY, bl: old })
  ]);
  const l = C.list(d, "list-1");
  const who = (g) => C.subsOf(d, "list-1").filter((s) => C.segMatch(C.normSeg(Object.assign({ id: "g1", list: "list-1", name: "x" }, g)), s, l, NOW))
    .map((s) => s.email.split("@")[0]).sort();
  assert.deepEqual(who({}), ["gone", "loyal", "never", "once"]);
  assert.deepEqual(who({ buy: "none" }), ["never"]);
  assert.deepEqual(who({ buy: "one" }), ["once"]);
  assert.deepEqual(who({ buy: "more", bn: 5 }), ["loyal"]);
  assert.deepEqual(who({ bs: 3000 }), ["gone", "loyal"]);
  assert.deepEqual(who({ buy: "ever", bago: 12 }), ["gone"], "win-back: bought, not in the last 12 months");
  // rules are normalized; "none" ignores spend and age
  assert.deepEqual(C.normSeg({ id: "g", list: "list-1", buy: "none", bs: 500, bago: 3 }).bs, undefined);
  assert.equal(C.normSeg({ id: "g", list: "list-1", buy: "zzz" }).buy, undefined);
  assert.equal(C.normSeg({ id: "g", list: "list-1", buy: "more", bn: 1 }).bn, 2);
});
