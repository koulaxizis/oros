// Newsletter N1 (2026-11): the coupon block and the HTML issue's
// coupon, codes for each reader, the WooCommerce requests that make
// them (and the allowlist that lets them through), the check before
// sending, the e-mail HTML and text, and the engine making the codes
// before the mails go out.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../newsletter/core.js");
const R = require("../newsletter/render.js");
const L = require("../links/core.js");
let X;
test.before(async () => { X = await import("../relay/ext.js"); });

const DAY = 864e5;
const LIST = { id: "list-1", m: 1, name: "News", chan: "chan-1", from: "me@example.com", reply: "", lang: "en",
  addr: "1 Main St, Athens", why: "", theme: "classic", color: "#2f6fde", salt: "abcdefgh12" };
const CPN = { k: "cpn", code: "news10", dt: "pct", amt: "10", exp: "2099-12-31", min: "", t: "For our readers", bt: "Shop", bh: "https://shop.example.gr/" };
function model(issue) {
  return C.normalize({ ver: 1, chans: [], lists: [LIST], subs: [], tpls: [], supp: [],
    issues: [Object.assign({ id: "iss-1", m: 3, list: "list-1", subj: "Hello", pre: "", fmt: "blocks", blocks: [], tags: [], st: "draft" }, issue)] });
}
function render(issue, sub) {
  const d = model(issue);
  return R.email({ issue: d.issues[0], list: d.lists[0], sub: sub === undefined ? { id: "sub-a", name: "Ann", email: "a@x.gr" } : sub,
    lang: "en", img: () => "", unsub: "" });
}

test("N1: a coupon normalizes with limits", () => {
  const b = C.normBlock(Object.assign({}, CPN, { per: 1, sh: "woo", acct: "abcd1234", made: 5 }));
  assert.equal(b.code, "NEWS10");
  assert.equal(b.per, 1);
  assert.equal(b.sh, "woo");
  assert.equal(b.made, undefined, "made is only for a shared code");
  assert.equal(C.normBlock(Object.assign({}, CPN, { sh: "woo", acct: "abcd1234", made: 5 })).made, 5);
  const odd = C.normCoupon({ code: "a b", dt: "x", amt: "150", exp: "2026-13-40", min: "-1", bh: "javascript:alert(1)", sh: "shopify", acct: "x" });
  assert.deepEqual([odd.code, odd.dt, odd.amt, odd.exp, odd.min, odd.bh, odd.sh], ["", "pct", "", "", "", "", undefined]);
  assert.equal(C.normCoupon({ code: "X10", dt: "fix", amt: "150" }).amt, "150", "a fixed amount may be above 100");
  assert.equal(C.normCoupon({ code: "X10", amt: "0" }).amt, "");
  assert.ok(C.knownBlock({ k: "cpn" }));
});

test("N1: codes for each reader are fixed by issue and person, and fit the shop's rules", () => {
  const b = C.normCoupon(Object.assign({}, CPN, { per: 1, sh: "woo", acct: "abcd1234", code: "A".repeat(30) }));
  const one = C.couponCode(b, "iss-1", { id: "sub-a" });
  assert.equal(one, C.couponCode(b, "iss-1", { id: "sub-a" }));
  assert.notEqual(one, C.couponCode(b, "iss-1", { id: "sub-b" }));
  assert.notEqual(one, C.couponCode(b, "iss-2", { id: "sub-a" }));
  assert.match(one, /^A{30}-[A-Z0-9]{6}$/);
  assert.equal(C.couponCode(b, "iss-1", null), "A".repeat(30) + "-TEST00");
  assert.equal(C.couponCode(C.normCoupon(CPN), "iss-1", { id: "sub-a" }), "NEWS10");
  // the request for it passes the app's and the relay's allowlist
  const req = C.couponReq(b, [{ code: one, email: "ann@example.gr" }, { code: one + "X", email: "not an address" }], "orOS Newsletter: Hello");
  assert.equal(L.checkReq("woo", req), "");
  assert.equal(X.checkExtReq("woo", req), "");
  assert.equal(req.body.create[0].usage_limit, 1);
  assert.deepEqual(req.body.create[0].email_restrictions, ["ann@example.gr"]);
  assert.equal(req.body.create[1].email_restrictions, undefined, "an odd address: one use, no restriction");
  assert.equal(req.body.create[1].usage_limit, 1);
  const shared = C.couponReq(C.normCoupon(Object.assign({}, CPN, { dt: "fix", amt: "5.50", min: "20" })), [{ code: "NEWS10" }], "x\ny");
  assert.equal(L.checkReq("woo", shared), "");
  assert.equal(X.checkExtReq("woo", shared), "");
  assert.deepEqual([shared.body.create[0].discount_type, shared.body.create[0].usage_limit_per_user, shared.body.create[0].minimum_amount, shared.body.create[0].date_expires],
    ["fixed_cart", 1, "20", "2099-12-31T23:59:59"]);
  assert.equal(C.couponReq(b, Array.from({ length: 150 }, (_, i) => ({ code: "C" + i })), "").body.create.length, 100);
});

test("N1: the shop's answer, a code that is already there counts as made", () => {
  const codes = [{ code: "A1" }, { code: "A2" }, { code: "A3" }, { code: "A4" }];
  const out = C.couponResult(codes, { create: [{ id: 7 }, { id: 0, error: { code: "woocommerce_rest_coupon_code_already_exists" } },
    { id: 0, error: { code: "woocommerce_rest_invalid" } }] });
  assert.deepEqual(out, { ok: ["A1", "A2"], bad: ["A3", "A4"] });
  assert.deepEqual(C.couponResult(codes, null).bad.length, 4);
});

test("N1: the check before sending", () => {
  const today = "2026-11-03";
  assert.equal(C.badCoupon(C.normCoupon(CPN), today), "");
  assert.equal(C.badCoupon(C.normCoupon(Object.assign({}, CPN, { amt: "" })), today), "badCoupon");
  assert.equal(C.badCoupon(C.normCoupon(Object.assign({}, CPN, { exp: "2026-11-02" })), today), "oldCoupon");
  assert.equal(C.badCoupon(C.normCoupon(Object.assign({}, CPN, { per: 1 })), today), "perShop");
  assert.equal(C.badCoupon(C.normCoupon(Object.assign({}, CPN, { bh: "" })), today), "badCoupon");
  const info = { chan: { id: "chan-1", kind: "smtp" }, aud: 1, inbox: true };
  const ks = (issue) => { const d = model(issue); return C.preflight(d, d.issues[0], info).map((r) => r.k); };
  assert.deepEqual(ks({ blocks: [CPN] }), []);
  assert.ok(ks({ blocks: [Object.assign({}, CPN, { exp: "2020-01-01" })] }).includes("oldCoupon"));
  assert.ok(ks({ blocks: [Object.assign({}, CPN, { sh: "woo", acct: "abcd1234" })] }).includes("cpnNotMade"));
  assert.ok(!ks({ blocks: [Object.assign({}, CPN, { sh: "woo", acct: "abcd1234", made: Date.now() })] }).includes("cpnNotMade"));
  assert.ok(!ks({ blocks: [Object.assign({}, CPN, { sh: "woo", acct: "abcd1234", per: 1 })] }).includes("cpnNotMade"));
  // an HTML issue's coupon needs {{COUPON}} somewhere
  const html = { fmt: "html", html: "<p>Hi</p>{{UNSUBSCRIBE}}", txt: "Hi", cpn: CPN };
  assert.ok(ks(html).includes("cpnUnused"));
  assert.ok(!ks(Object.assign({}, html, { html: "<p>Your code {{COUPON}}</p>{{UNSUBSCRIBE}}" })).includes("cpnUnused"));
  assert.equal(C.couponsOf(model({ blocks: [CPN, CPN], l2: { lang: "el", subj: "Γεια", fmt: "blocks", blocks: [CPN] } }).issues[0]).length, 1);
});

test("N1: the coupon in the e-mail, escaped, with each reader's own code", () => {
  const evil = Object.assign({}, CPN, { t: "<img src=x onerror=alert(1)>", per: 1, sh: "woo", acct: "abcd1234" });
  const r = render({ blocks: [evil] });
  const code = C.couponCode(C.normCoupon(evil), "iss-1", { id: "sub-a" });
  assert.ok(r.html.includes(code));
  assert.ok(r.html.includes("10%"));
  assert.ok(r.html.includes("&lt;img src=x"));
  assert.ok(!r.html.includes("<img src=x"));
  assert.ok(r.text.includes(code));
  assert.ok(r.text.includes("https://shop.example.gr/"));
  // the preview and tests show a sample code
  assert.ok(render({ blocks: [evil] }, null).html.includes("NEWS10-TEST00"));
  // {{COUPON}} in an HTML issue becomes the reader's code
  const h = render({ fmt: "html", html: "<p>Code: {{COUPON}}</p>", txt: "Code: {{COUPON}}", cpn: Object.assign({}, CPN, { per: 1, sh: "woo", acct: "abcd1234" }) });
  assert.ok(h.html.includes("Code: " + code));
  assert.ok(h.text.includes("Code: " + code));
  assert.ok(!/\{\{\s*COUPON/.test(h.html + h.text));
});

test("N1: the engine makes each reader's code before the mail, and stops on a refusal", async () => {
  const { sandbox } = require("./newsletter-sandbox.js");
  const S = await sandbox(C.normalize({ ver: 1, chans: [], lists: [LIST], subs: [], issues: [], tpls: [], supp: [] }));
  S.engine.stop();
  const calls = [];
  let answer = (body) => ({ status: 200, data: { create: body.create.map((c, i) => (i === 0 ? { id: 0, error: { code: "woocommerce_rest_coupon_code_already_exists" } } : { id: 10 + i })) } });
  S.ctx.orosLinks = {
    call: async (acct, reqs) => { calls.push([acct, reqs[0]]); return [answer(reqs[0].body)]; },
    statusCode: (x) => (x.status >= 200 && x.status < 300 ? "" : x.status === 0 ? "network" : "server")
  };
  const x = model({ blocks: [Object.assign({}, CPN, { per: 1, sh: "woo", acct: "abcd1234" }), CPN] }).issues[0];
  const subs = Array.from({ length: 130 }, (_, i) => ({ id: "s" + i, email: "p" + i + "@example.gr" }));
  await S.E.ensureCoupons(x, subs);
  assert.equal(calls.length, 2, "two chunks of up to 100; the shared code is not made here");
  assert.equal(calls[0][0], "abcd1234");
  assert.equal(calls[0][1].body.create.length, 100);
  assert.equal(calls[1][1].body.create.length, 30);
  calls.forEach((c) => assert.equal(L.checkReq("woo", c[1]), ""));
  // made once per device: nothing asked again
  await S.E.ensureCoupons(x, subs);
  assert.equal(calls.length, 2);
  // a refused code stops the send
  answer = (body) => ({ status: 200, data: { create: body.create.map(() => ({ id: 0, error: { code: "woocommerce_rest_invalid" } })) } });
  await assert.rejects(S.E.ensureCoupons(x, [{ id: "new", email: "n@example.gr" }]), (e) => e.code === "coupon");
  answer = () => ({ status: 500 });
  await assert.rejects(S.E.ensureCoupons(x, [{ id: "new2", email: "n2@example.gr" }]), (e) => e.code === "coupon");
  answer = () => ({ status: 0 });
  await assert.rejects(S.E.ensureCoupons(x, [{ id: "new3", email: "n3@example.gr" }]), (e) => e.code === "network");
  // no connected services at all: stops too
  delete S.ctx.orosLinks;
  await assert.rejects(S.E.ensureCoupons(x, [{ id: "new4", email: "n4@example.gr" }]), (e) => e.code === "coupon");
  // an issue without a per-reader coupon asks nothing
  await S.E.ensureCoupons(model({ blocks: [CPN] }).issues[0], subs);
});
