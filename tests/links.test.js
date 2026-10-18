// Connected services (links/): accounts slice, ids for imported
// records, the request allowlist (app and relay copies), the relay's
// "ext" operation against a mocked shop, and the WooCommerce mapping
// into Stock, Invoices, Budget and CRM prefills.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../links/core.js");
const W = require("../links/woo.js");
const S = require("../stock/core.js");
const I = require("../invoices/core.js");

let handle, X;
test.before(async () => {
  ({ handle } = await import("../relay/core.js"));
  X = await import("../relay/ext.js");
});

const CK = "ck_" + "a".repeat(40), CS = "cs_" + "b".repeat(40);

// ---------- accounts ----------
const acct = (o) => Object.assign({ id: "abcd1234", m: 10, p: "woo", name: "Shop", site: "shop.example.gr", ks: 0, s: "", sm: 0, d: 0 }, o);

test("normSite: https only, public hosts, wp-json and slashes cut", () => {
  assert.equal(L.normSite("shop.example.gr"), "https://shop.example.gr");
  assert.equal(L.normSite("https://Shop.Example.gr/"), "https://shop.example.gr");
  assert.equal(L.normSite("https://example.gr/shop/wp-json/wc/v3"), "https://example.gr/shop");
  assert.equal(L.normSite("http://example.gr"), null);
  assert.equal(L.normSite("https://localhost"), null);
  assert.equal(L.normSite("https://192.168.1.2"), null);
  assert.equal(L.normSite("https://user@example.gr"), null);
  assert.equal(L.normSite("https://example.gr:8443"), null);
  assert.equal(L.normSite("https://example.gr/a/../b"), null);
  assert.equal(L.normSite("https://example.gr/?x=1"), null);
  assert.deepEqual(L.siteParts("example.gr/shop"), { host: "example.gr", base: "/shop" });
});

test("merge: symmetric, canonical, LWW, removal wins a tie and keeps no fields", () => {
  const a = { accts: [acct({ name: "A", m: 20 }), acct({ id: "zzzz9999", m: 5 })] };
  const b = { accts: [acct({ name: "B", m: 30 }), acct({ id: "zzzz9999", m: 5, d: 1 })] };
  const ab = L.merge(a, b), ba = L.merge(b, a);
  assert.deepEqual(ab, ba);
  assert.equal(JSON.stringify(L.merge(ab, ab)), JSON.stringify(ab));
  assert.equal(ab.accts[0].name, "B");
  assert.deepEqual(ab.accts[1], { id: "zzzz9999", m: 5, p: "woo", d: 1 });
  assert.equal(L.live(ab).length, 1);
  // junk is dropped; keys never ride in clear
  const j = L.merge({ accts: [acct({ id: "BAD" }), acct({ p: "evil" }), acct({ id: "ok123456", site: "http://x.gr" }), acct({ id: "keys1234", ck: CK })] }, null);
  assert.equal(j.accts.length, 1);
  assert.equal(j.accts[0].ck, undefined);
  // the sealed copy only rides with key sync on
  assert.equal(L.merge({ accts: [acct({ s: "sealed", sm: 3 })] }, null).accts[0].s, "");
  assert.equal(L.merge({ accts: [acct({ ks: 1, s: "sealed", sm: 3 })] }, null).accts[0].s, "sealed");
});

test("checkKeys: exact WooCommerce key shapes", () => {
  assert.deepEqual(L.checkKeys("woo", { ck: " " + CK + " ", cs: CS }), { ok: true, keys: { ck: CK, cs: CS }, bad: [] });
  assert.deepEqual(L.checkKeys("woo", { ck: "ck_123", cs: CS }).bad, ["ck"]);
  assert.equal(L.checkKeys("nope", {}).ok, false);
});

test("extId: deterministic, distinct, valid as a Stock id", () => {
  const a = L.extId("woo", "abcd1234", "p", "12:0"), b = L.extId("woo", "abcd1234", "p", "12:0");
  assert.equal(a, b);
  assert.notEqual(a, L.extId("woo", "abcd1234", "p", "13:0"));
  assert.notEqual(a, L.extId("woo", "other123", "p", "12:0"));
  assert.match(a, /^[a-z0-9]{6,40}$/);
  assert.ok(S.normItem({ id: a, m: 1, name: "x" }));
});

// ---------- allowlist: one set of cases, both copies ----------
const CASES = [
  [{ m: "GET", path: "/products?per_page=100&page=2" }, ""],
  [{ m: "GET", path: "/products?per_page=101" }, "query"],
  [{ m: "GET", path: "/products?page=1&page=2" }, "query"],
  [{ m: "GET", path: "/products?status=publish&type=simple&modified_after=2026-10-01T00:00:00" }, ""],
  [{ m: "GET", path: "/products/12/variations?per_page=100" }, ""],
  [{ m: "GET", path: "/orders?status=processing,on-hold&after=2026-09-13T00:00:00&orderby=date&order=desc" }, ""],
  [{ m: "GET", path: "/orders/55" }, ""],
  [{ m: "GET", path: "/customers" }, ""],
  [{ m: "GET", path: "/customers?role=customer&per_page=100&page=2&orderby=id&order=asc" }, ""],
  [{ m: "GET", path: "/customers?role=administrator" }, "query"],
  [{ m: "GET", path: "/customers/5" }, "path"],
  [{ m: "PUT", path: "/customers", body: { email: "a@b.gr" } }, "path"],
  [{ m: "GET", path: "/data/currencies/current" }, ""],
  [{ m: "GET", path: "/data/currencies/current?x=1" }, "query"],
  // product pictures (Newsletter wave E4): the shop's uploads only, no keys
  [{ m: "GET", path: "/wp-content/uploads/2026/05/mug-300x300.jpg", img: 1 }, ""],
  [{ m: "GET", path: "/wp-content/uploads/2026/05/%CE%BA%CE%BF%CF%8D%CF%80%CE%B1.webp", img: 1 }, ""],
  [{ m: "GET", path: "/wp-content/uploads/%2E%2E/%2E%2E/x.jpg", img: 1 }, "path"],
  [{ m: "GET", path: "/wp-content/uploads/../x.jpg", img: 1 }, "path"],
  [{ m: "GET", path: "/wp-content/uploads/a.php", img: 1 }, "path"],
  [{ m: "GET", path: "/wp-content/uploads/a.jpg?x=1", img: 1 }, "path"],
  [{ m: "GET", path: "/wp-content/plugins/a.jpg", img: 1 }, "path"],
  [{ m: "GET", path: "/wp-content/uploads/a.jpg", img: true }, "path"],
  [{ m: "PUT", path: "/wp-content/uploads/a.jpg", img: 1, body: { a: 1 } }, "path"],
  [{ m: "GET", path: "/products/../customers" }, "path"],
  [{ m: "GET", path: "/products/%2e%2e/x" }, "path"],
  [{ m: "GET", path: "//evil.com/products" }, "path"],
  [{ m: "GET", path: "/products@evil.com" }, "path"],
  [{ m: "GET", path: "/products?search=a b" }, "path"],
  [{ m: "GET", path: "/products?consumer_key=x" }, "query"],
  [{ m: "DELETE", path: "/products/12" }, "method"],
  [{ m: "PUT", path: "/products/12", body: { stock_quantity: 5, manage_stock: true } }, ""],
  [{ m: "PUT", path: "/products/12/variations/14", body: { stock_quantity: 0 } }, ""],
  [{ m: "PUT", path: "/products/12", body: { regular_price: "1.00" } }, "body"],
  [{ m: "PUT", path: "/products/12", body: { stock_quantity: 1.5 } }, "body"],
  [{ m: "PUT", path: "/products/12", body: {} }, "body"],
  [{ m: "PUT", path: "/products/12" }, "body"],
  [{ m: "PUT", path: "/orders/55", body: { status: "completed" } }, ""],
  [{ m: "PUT", path: "/orders/55", body: { status: "trash" } }, "body"],
  [{ m: "POST", path: "/orders/55/notes", body: { note: "Shipped", customer_note: false } }, ""],
  [{ m: "POST", path: "/orders", body: { status: "pending" } }, "path"],
  [{ m: "GET", path: "/products", body: {} }, "body"]
];
test("checkReq (app) and checkExtReq (relay) agree on every case", () => {
  for (const [r, want] of CASES) {
    assert.equal(L.checkReq("woo", r), want, "app " + r.m + " " + r.path);
    assert.equal(X.checkExtReq("woo", r), want, "relay " + r.m + " " + r.path);
  }
  assert.equal(L.checkReq("evil", CASES[0][0]), "p");
  assert.equal(X.checkExtReq("__proto__", CASES[0][0]), "p");
});

// ---------- relay ----------
const ORIGIN = "https://useoros.online";
const ENV = { ALLOWED_ORIGINS: ORIGIN };
let ip = 0;
async function relay(body, f) {
  const r = new Request("https://relay.example/v1", { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.7.0." + (ip++ % 250) }, body: JSON.stringify(body) });
  const res = await handle(r, ENV, null, Date.now(), f);
  return { status: res.status, json: await res.json() };
}
function mock(fn) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return fn ? fn(url, init) : new Response("[{\"id\":1}]", { status: 200 }); };
  f.calls = calls;
  return f;
}
const ext = (o) => Object.assign({ op: "ext", p: "woo", host: "shop.example.gr", base: "", ck: CK, cs: CS, reqs: [{ m: "GET", path: "/products?per_page=1" }] }, o);

test("relay validation: host, base, keys, requests", () => {
  assert.equal(X.validExt(ext({})), "");
  assert.equal(X.validExt(ext({ host: "localhost" })), "host");
  assert.equal(X.validExt(ext({ host: "10.0.0.1" })), "host");
  assert.equal(X.validExt(ext({ host: "shop.internal" })), "host");
  assert.equal(X.validExt(ext({ base: "/shop" })), "");
  assert.equal(X.validExt(ext({ base: "/../x" })), "base");
  assert.equal(X.validExt(ext({ base: "shop" })), "base");
  assert.equal(X.validExt(ext({ ck: "ck_x" })), "key");
  assert.equal(X.validExt(ext({ cs: CS + "\r\nX: 1" })), "key");
  assert.equal(X.validExt(ext({ reqs: [] })), "reqs");
  assert.equal(X.validExt(ext({ reqs: Array.from({ length: 11 }, () => ({ m: "GET", path: "/orders" })) })), "reqs");
  assert.equal(X.validExt(ext({ reqs: [{ m: "PUT", path: "/products/1", body: "{\"stock_quantity\":3}" }] })), "");
  assert.equal(X.validExt(ext({ reqs: [{ m: "PUT", path: "/products/1", body: "{\"name\":\"x\"}" }] })), "body");
  assert.equal(X.validExt(ext({ reqs: [{ m: "PUT", path: "/products/1", body: "not json" }] })), "body");
  assert.equal(X.validExt(ext({ p: "evil" })), "p");
});

test("relay call: URL under the shop's API root, Basic auth, no redirects, keys never echoed", async () => {
  const f = mock();
  const r = await relay(ext({ base: "/shop", reqs: [{ m: "GET", path: "/orders?status=processing" }, { m: "GET", path: "/products/9" }] }), f);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.data.res.length, 2);
  assert.equal(r.json.data.res[0].status, 200);
  assert.equal(f.calls[0].url, "https://shop.example.gr/shop/wp-json/wc/v3/orders?status=processing");
  assert.equal(f.calls[0].init.redirect, "manual");
  assert.equal(f.calls[0].init.headers.Authorization, "Basic " + btoa(CK + ":" + CS));
  assert.equal(JSON.stringify(r.json).indexOf(CK), -1);
  // a refused request never leaves
  const g = mock();
  const bad = await relay(ext({ reqs: [{ m: "GET", path: "/customers/5" }] }), g);
  assert.equal(bad.status, 400);
  assert.equal(g.calls.length, 0);
  // network errors carry no message
  const h = mock(() => { throw new Error("connect failed to https://" + CK); });
  const ne = await relay(ext({}), h);
  assert.deepEqual(ne.json.data.res[0], { err: "network" });
});

test("relay call: a product picture comes from the shop's uploads, without the keys (Newsletter E4)", async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const f = mock((url) => url.endsWith(".png")
    ? new Response(png, { status: 200, headers: { "Content-Type": "image/png" } })
    : new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } }));
  const r = await relay(ext({ base: "/shop", reqs: [{ m: "GET", path: "/wp-content/uploads/2026/05/a.png", img: 1 }] }), f);
  assert.equal(r.status, 200);
  assert.equal(f.calls[0].url, "https://shop.example.gr/shop/wp-content/uploads/2026/05/a.png");
  assert.equal(f.calls[0].init.redirect, "manual");
  assert.equal(f.calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(r.json.data.res[0], { status: 200, type: "image/png", b64: Buffer.from(png).toString("base64") });
  assert.equal(JSON.stringify(r.json).indexOf(CK), -1);
  const r2 = await relay(ext({ base: "/shop", reqs: [{ m: "GET", path: "/wp-content/uploads/2026/05/b.jpg", img: 1 }] }), f);
  assert.deepEqual(r2.json.data.res[0], { status: 200, err: "type" });
  // over 512 KB is too big (base64 costs relay CPU)
  const big = mock(() => new Response(new Uint8Array(512 * 1024 + 1), { status: 200, headers: { "Content-Type": "image/jpeg" } }));
  const r3 = await relay(ext({ reqs: [{ m: "GET", path: "/wp-content/uploads/big.jpg", img: 1 }] }), big);
  assert.deepEqual(r3.json.data.res[0], { status: 200, err: "too-big" });
  const fits = mock(() => new Response(new Uint8Array(512 * 1024), { status: 200, headers: { "Content-Type": "image/jpeg" } }));
  assert.equal((await relay(ext({ reqs: [{ m: "GET", path: "/wp-content/uploads/ok.jpg", img: 1 }] }), fits)).json.data.res[0].b64.length, 699052);
  // anything else is refused before it leaves: two pictures, or a picture with another request
  const g = mock();
  assert.equal((await relay(ext({ reqs: [{ m: "GET", path: "/wp-content/uploads/a.png", img: 1 }, { m: "GET", path: "/wp-content/uploads/b.png", img: 1 }] }), g)).status, 400);
  assert.equal((await relay(ext({ reqs: [{ m: "GET", path: "/wp-content/uploads/a.png", img: 1 }, { m: "GET", path: "/products" }] }), g)).status, 400);
  assert.equal((await relay(ext({ reqs: [{ m: "GET", path: "/wp-content/uploads/a.php", img: 1 }] }), g)).status, 400);
  assert.equal((await relay(ext({ p: "mlite", host: undefined, base: undefined, ck: undefined, cs: undefined, key: "x".repeat(30),
    reqs: [{ m: "GET", path: "/wp-content/uploads/a.png", img: 1 }] }), g)).status, 400);
  assert.equal(g.calls.length, 0);
});

test("relay call: writes go one at a time, in order", async () => {
  const order = [];
  let open = 0, maxOpen = 0;
  const f = mock(async (url) => {
    open++; maxOpen = Math.max(maxOpen, open);
    order.push(url);
    await new Promise((r) => setTimeout(r, 5));
    open--;
    return new Response("{}", { status: 200 });
  });
  const reqs = [1, 2, 3].map((n) => ({ m: "PUT", path: "/products/" + n, body: JSON.stringify({ stock_quantity: n }) }));
  const r = await relay(ext({ reqs }), f);
  assert.equal(r.json.data.res.length, 3);
  assert.equal(maxOpen, 1);
  assert.deepEqual(order.map((u) => u.split("/").pop()), ["1", "2", "3"]);
  assert.equal(f.calls[0].init.body, "{\"stock_quantity\":1}");
});

// ---------- WooCommerce → Stock ----------
const PRODUCTS = [
  { id: 10, name: "Mug &amp; Saucer <b>XL</b>", type: "simple", sku: "MUG-1", regular_price: "12.50", manage_stock: true, stock_quantity: 7, categories: [{ id: 3, name: "Kitchen &gt; Cups" }] },
  { id: 11, name: "T-shirt", type: "variable", sku: "", categories: [{ id: 4, name: "Clothes" }] },
  { id: 12, name: "Gift card", type: "simple", sku: "", regular_price: "20", manage_stock: false, stock_quantity: null, categories: [] },
  { id: 13, name: "Bundle", type: "grouped" },
  { id: "x", name: "bad" }
];
const VARS = { 11: [
  { id: 21, sku: "TS-S", regular_price: "9.90", manage_stock: true, stock_quantity: 3, attributes: [{ name: "Size", option: "S" }] },
  { id: 22, sku: "TS-M", regular_price: "9.90", manage_stock: "parent", stock_quantity: 5, attributes: [{ name: "Size", option: "M" }] }
] };
const emptyStock = () => S.merge({ items: [], moves: [] }, null, 1e12);

test("sellables: simple + variations; entities decoded, tags gone; grouped left out", () => {
  const s = W.sellables(PRODUCTS, VARS);
  assert.deepEqual(s.map((r) => r.name), ["Mug & Saucer XL", "T-shirt – S", "T-shirt – M", "Gift card"]);
  assert.equal(s[0].price, 1250);
  assert.equal(s[0].q, 7000);
  assert.equal(s[0].cat, "Kitchen > Cups");
  assert.equal(s[2].managed, false);     // shares its parent's stock
  assert.equal(s[3].managed, false);
});

test("productPlan: deterministic ids, SKU match, count move to the shop's quantities", () => {
  const opts = { acct: "abcd1234", now: 1000, today: "2026-10-13", setQty: true, vat: 24 };
  const p1 = W.productPlan(S, emptyStock(), PRODUCTS, VARS, opts);
  const p2 = W.productPlan(S, emptyStock(), PRODUCTS, VARS, opts);
  assert.deepEqual(p1.items.map((i) => i.id), p2.items.map((i) => i.id));
  assert.equal(p1.stats.added, 4);
  assert.equal(p1.cats.length, 2);
  assert.equal(p1.move.t, "count");
  assert.deepEqual(p1.move.lines.map((l) => l.n), [7000, 3000]);
  assert.ok(S.normMove(p1.move));
  // apply like Stock does, then a second import changes nothing
  const data = S.merge({ items: p1.items, cats: p1.cats, moves: [p1.move] }, null, 1e12);
  const again = W.productPlan(S, data, PRODUCTS, VARS, Object.assign({}, opts, { now: 2000 }));
  assert.equal(again.stats.same, 4);
  assert.equal(again.items.length, 0);
  assert.equal(again.move, null);
  // an existing product with the same SKU is updated, not doubled
  const own = S.merge({ items: [{ id: "own000001", m: 1, name: "Old mug name", sku: "mug-1", price: 100 }] }, null, 1e12);
  const p3 = W.productPlan(S, own, PRODUCTS, VARS, opts);
  assert.equal(p3.items.find((i) => i.sku === "MUG-1").id, "own000001");
  assert.equal(p3.stats.updated, 1);
});

test("compare + stockReq", () => {
  const p = W.productPlan(S, emptyStock(), PRODUCTS, VARS, { acct: "abcd1234", now: 1000, today: "2026-10-13" });
  const data = S.merge({ items: p.items, cats: p.cats, moves: [] }, null, 1e12);
  const diff = W.compare(S, data, p.links);
  assert.deepEqual(diff.map((d) => [d.item.sku, d.mine, d.shop]), [["MUG-1", 0, 7000], ["TS-S", 0, 3000]]);
  assert.deepEqual(W.stockReq(diff[1].link, 4000), { m: "PUT", path: "/products/11/variations/21", body: { stock_quantity: 4, manage_stock: true } });
  assert.equal(L.checkReq("woo", W.stockReq(diff[0].link, 2500)), "");
});

// ---------- orders → prefills ----------
const ORDER = {
  id: 55, number: "1055", status: "processing", currency: "EUR", date_created: "2026-10-12T18:20:11",
  total: "38.70", total_tax: "6.30", shipping_total: "5.00", shipping_tax: "1.20", payment_method_title: "Κάρτα",
  customer_note: "<script>alert(1)</script>Ring twice",
  billing: { first_name: "Μαρία", last_name: "Π.", company: "", address_1: "Οδός 1", city: "Αθήνα", postcode: "11111", country: "GR", email: "Maria@Example.gr", phone: "210" },
  line_items: [
    { name: "Mug &amp; Saucer", sku: "MUG-1", quantity: 2, total: "20.16", total_tax: "4.84", product_id: 10, variation_id: 0 },
    { name: "Gift card", sku: "", quantity: 1, total: "0.24", total_tax: "0.06", product_id: 12, variation_id: 0 }
  ],
  shipping_lines: [{ method_title: "Courier", total: "5.00" }]
};
test("normOrder: plain text only, money in cents", () => {
  const o = W.normOrder(ORDER);
  assert.equal(o.no, "1055");
  assert.equal(o.d, "2026-10-12");
  assert.equal(o.total, 3870);
  assert.equal(o.note.indexOf("<"), -1);
  assert.equal(o.lines[0].name, "Mug & Saucer");
  assert.equal(o.bill.email, "maria@example.gr");
  assert.equal(o.bill.addr, "Οδός 1\n11111 Αθήνα");
  assert.equal(W.normOrder({ id: -1 }), null);
});

test("order → Stock sale (BR-ST-OUT), Invoices, Budget, CRM prefills that the apps accept", () => {
  const o = W.normOrder(ORDER);
  const out = W.outRequest(o, "abcd1234");
  assert.deepEqual(out.nocode, ["Gift card"]);
  assert.equal(out.req.src, "woo:abcd1234-55");
  const p = W.productPlan(S, emptyStock(), PRODUCTS, VARS, { acct: "abcd1234", now: 1000, today: "2026-10-13" });
  const data = S.merge({ items: p.items, cats: p.cats, moves: [] }, null, 1e12);
  const r = S.outRequest(data, out.req, "2026-10-13");
  assert.equal(r.src, "woo:abcd1234-55");
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].q, 2000);
  assert.equal(r.lines[0].p, 1250);           // gross unit price
  const inv = I.normPrefill(W.invoicePrefill(o, "abcd1234", "el"));
  assert.ok(inv);
  assert.equal(inv.client.name, "Μαρία Π.");
  assert.equal(inv.items.length, 3);
  assert.equal(inv.items[0].p, 1008);
  assert.equal(inv.items[0].vat, 24);
  assert.equal(inv.items[2].d, "Μεταφορικά · Courier");
  assert.equal(inv.items[2].vat, 24);
  assert.equal(inv.ref.app, "stock");
  const bud = W.budgetPrefill(o, "en");
  assert.deepEqual([bud.k, bud.a, bud.d, bud.c], ["i", 3870, "2026-10-12", "i-other"]);
  const crm = W.crmLog(o, "en", "€38.70");
  assert.equal(crm.email, "maria@example.gr");
  assert.equal(crm.subject, "Order #1055 · €38.70");
});
