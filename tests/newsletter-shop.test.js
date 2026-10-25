// Newsletter editor wave E4: the product block (products from a
// connected WooCommerce or Shopify shop), its e-mail HTML and text,
// fresh prices, product pictures through the relay, the Shopify
// Storefront allowlist, and shop customers as subscribers.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../newsletter/core.js");
const R = require("../newsletter/render.js");
const Sh = require("../newsletter/shop.js");
const I2 = require("../newsletter/import2.js");
const P = require("../newsletter/package.js");
const L = require("../links/core.js");
let X;
test.before(async () => { X = await import("../relay/ext.js"); });

const LIST = { id: "list-1", m: 1, name: "Friends", chan: "chan-1", from: "me@example.com", reply: "", lang: "en",
  addr: "1 Main St, Athens", why: "", theme: "classic", color: "#2f6fde", salt: "abcdefgh12" };
const CHAN = { id: "chan-1", m: 1, name: "SMTP", kind: "smtp", preset: "", host: "smtp.example.com", port: 587, user: "u", rate: 60, cap: 300 };
function model(blocks, list) {
  return C.normalize({ chans: [CHAN], lists: [Object.assign({}, LIST, list || {})], subs: [],
    issues: [{ id: "iss-1", m: 3, list: "list-1", subj: "Hello", pre: "", fmt: "blocks", blocks, tags: [], st: "draft" }] });
}
function render(blocks, list, img) {
  const d = model(blocks, list);
  return R.email({ issue: d.issues[0], list: d.lists[0], sub: { name: "Ann", email: "a@x.gr" }, lang: d.lists[0].lang, img: img || (() => ""), unsub: "" });
}
const PIC = "/internal/Newsletter/img-abc.jpg";
function prod(items, more) {
  return Object.assign({ k: "prod", sh: "woo", acct: "abcd1234", at: Date.now(), bt: "", items }, more || {});
}
const MUG = { id: "12", name: "Mug", t: "A big mug", href: "https://shop.example.gr/product/mug/", price: 990, was: 1200, cur: "EUR",
  src: "https://shop.example.gr/wp-content/uploads/2026/05/mug.jpg", alt: "", f: PIC, w: 600, h: 600, b: 9000 };

test("E4: a product block normalizes with limits", () => {
  const b = C.normBlock(prod(Array.from({ length: 12 }, (_, i) => Object.assign({}, MUG, { id: String(i) })), { per: 3 }));
  assert.equal(b.items.length, 9);
  assert.equal(b.per, 3);
  assert.equal(b.sh, "woo");
  assert.equal(C.normBlock(prod([], { per: 2 })).per, undefined);
  assert.equal(C.normBlock(prod([], { sh: "amazon" })).sh, undefined);
  assert.equal(C.normBlock(prod([], { acct: "../x" })).acct, undefined);
  const odd = C.normBlock(prod([{ id: "a b", name: " X\n", href: "javascript:alert(1)", price: "5", was: 3, cur: "eur", src: "http://x.gr/a.jpg", f: "/etc/passwd", out: true }])).items[0];
  assert.deepEqual([odd.id, odd.name, odd.href, odd.price, odd.was, odd.cur, odd.src, odd.f, odd.out], ["", "X", "", -1, 0, "EUR", "http://x.gr/a.jpg", "", undefined]);
  // an old price only above the price
  assert.equal(C.normBlock(prod([Object.assign({}, MUG, { was: 900 })])).items[0].was, 0);
  // an older orOS keeps the block whole (forward compatibility)
  assert.ok(C.knownBlock({ k: "prod" }));
});

test("E4: product cards render escaped, with sale and sold-out prices, and as plain text", () => {
  const evil = Object.assign({}, MUG, { id: "13", name: "<img src=x onerror=alert(1)>", t: "\"quoted\" & <b>", out: 1, was: 0 });
  const r = render([prod([MUG, evil])], null, (b) => b.f ? "cid:img" : "");
  assert.ok(r.html.includes("Mug"));
  assert.ok(r.html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!r.html.includes("<img src=x"));
  assert.ok(r.html.includes("line-through"));
  assert.match(r.html, /€9\.90/);
  assert.match(r.html, /€12\.00/);
  assert.ok(r.html.includes("Sold out"));
  assert.ok(r.html.includes(">Buy now<"));
  // the sold-out card has no button
  assert.equal(r.html.split(">Buy now<").length - 1, 1);
  assert.ok(r.html.includes("max-width:262px"));
  assert.match(r.text, /Mug — €9\.90 \(€12\.00\)\nhttps:\/\/shop\.example\.gr\/product\/mug\//);
  assert.match(r.text, /Sold out/);
  // one per row = picture beside the text; three = small cards; own button text; Greek money
  assert.ok(render([prod([MUG], { per: 1 })]).html.includes("max-width:258px"));
  assert.ok(render([prod([MUG], { per: 3, bt: "Get it" })]).html.includes(">Get it<"));
  const el = render([prod([MUG])], { lang: "el" });
  assert.ok(el.html.includes(">Αγορά<"));
  assert.match(el.html, /9,90\s€/);
  // a product without a page is not drawn
  assert.equal(render([prod([Object.assign({}, MUG, { href: "" })])]).html.includes("Mug"), false);
});

test("E4: preflight wants names and pages, and warns about prices older than a day", () => {
  const d = model([prod([MUG])]);
  const ks = (blocks, now) => {
    const m = model(blocks);
    return C.preflight(m, m.issues[0], { chan: m.chans[0], aud: 1, now }).map((f) => f.lvl + ":" + f.k);
  };
  assert.ok(!ks([prod([MUG])]).some((k) => /badBlock|noBody|oldPrices/.test(k)));
  assert.ok(ks([prod([])]).includes("err:noBody"));
  assert.ok(ks([prod([Object.assign({}, MUG, { href: "" })])]).includes("err:badBlock"));
  const old = Date.now() - C.PRICE_AGE - 1000;
  assert.ok(ks([prod([MUG], { at: old })]).includes("warn:oldPrices"));
  assert.ok(ks([prod([MUG], { at: 0 })]).includes("warn:oldPrices"));
  assert.ok(!ks([prod([MUG], { at: old })], old + 1000).includes("warn:oldPrices"));
  assert.ok(d.issues[0].blocks[0].items.length === 1);
});

test("E4: product pictures are sent and carried in bundles", () => {
  const d = model([prod([MUG, Object.assign({}, MUG, { id: "2", f: "" })])]);
  assert.deepEqual(C.picsOf(d.issues[0].blocks).map((p) => p.f), [PIC]);
  assert.deepEqual(C.picRefs(d.issues[0].blocks[0]).length, 2);
  assert.ok(P.imgPaths(d).includes(PIC));
});

test("E4: WooCommerce products map to block items", () => {
  const w = Sh.wooItem({ id: 5, name: "Caf&eacute; <b>Mug</b> &#8211; big", permalink: "https://noxpress.gr/product/mug/", price: "9.90", regular_price: "12",
    on_sale: true, short_description: "<p>Hand made &amp; glazed</p>", images: [{ src: "https://noxpress.gr/wp-content/uploads/2026/05/mug.jpg", alt: "mug" }],
    categories: [{ name: "Kitchen" }], stock_status: "outofstock", status: "publish" }, "EUR");
  assert.deepEqual(w, { id: "5", name: "Café Mug – big", t: "Hand made & glazed", href: "https://noxpress.gr/product/mug/", price: 990, was: 1200, cur: "EUR",
    src: "https://noxpress.gr/wp-content/uploads/2026/05/mug.jpg", alt: "mug", out: 1, cats: ["Kitchen"] });
  assert.equal(Sh.wooItem({ id: 6, name: "Draft", permalink: "https://x.gr/p", status: "draft" }), null);
  assert.equal(Sh.wooItem({ id: 7, name: "No page", permalink: "javascript:x" }), null);
  assert.equal(Sh.wooItem({ id: 8, name: "Free", permalink: "https://x.gr/p", price: "" }).price, -1);
  assert.equal(Sh.wooItem({ id: 9, name: "Not on sale", permalink: "https://x.gr/p", price: "5", regular_price: "8", on_sale: false }).was, 0);
  for (const r of Sh.wooReqs(4)) assert.equal(L.checkReq("woo", r), "", r.path);
});

test("E4: Shopify Storefront products map to block items; pages carry their cursor", () => {
  const node = { id: "gid://shopify/Product/42", title: "Tee", handle: "tee", onlineStoreUrl: null, description: "Soft cotton",
    availableForSale: false, featuredImage: { url: "https://cdn.shopify.com/s/files/1/tee.jpg?v=1", altText: "A tee" },
    priceRange: { minVariantPrice: { amount: "19.0", currencyCode: "USD" } }, compareAtPriceRange: { minVariantPrice: { amount: "25.0", currencyCode: "USD" } },
    collections: { nodes: [{ title: "Summer" }] } };
  const pg = Sh.sfPage({ data: { products: { pageInfo: { hasNextPage: true, endCursor: "eyJsYXN0X2lkIjo0Mn0=" }, nodes: [node, { id: "bad" }] } } }, "https://tees.myshopify.com");
  assert.equal(pg.next, "eyJsYXN0X2lkIjo0Mn0=");
  assert.deepEqual(pg.items, [{ id: "gid://shopify/Product/42", name: "Tee", t: "Soft cotton", href: "https://tees.myshopify.com/products/tee",
    price: 1900, was: 2500, cur: "USD", src: "https://cdn.shopify.com/s/files/1/tee.jpg?v=1&width=1200", alt: "A tee", out: 1, cats: ["Summer"] }]);
  assert.equal(Sh.sfPage({ errors: [{ message: "x" }] }), null);
  assert.equal(Sh.sfPage({ data: { products: { pageInfo: { hasNextPage: false }, nodes: [] } } }).next, "");
});

test("E4: Shopify goes only through the fixed Storefront queries, never through the relay", () => {
  assert.equal(L.checkReq("shopify", L.probeReq("shopify")), "");
  assert.equal(L.checkReq("shopify", Sh.sfReq()), "");
  assert.equal(L.checkReq("shopify", Sh.sfReq("abc123==", "κούπα \"x\" {y}")), "");
  const ok = Sh.sfReq();
  const bad = (body) => L.checkReq("shopify", { m: "POST", path: "/graphql.json", body });
  assert.equal(bad({ query: "{shop{name}} {customers(first:5){nodes{email}}}" }), "body");
  assert.equal(bad({ query: L.SHOPIFY_Q.products, variables: { first: 51 } }), "body");
  assert.equal(bad({ query: L.SHOPIFY_Q.products, variables: { first: 5, ids: ["gid://shopify/Product/1"] } }), "body");
  assert.equal(bad({ query: L.SHOPIFY_Q.products }), "body");
  assert.equal(bad({ query: L.SHOPIFY_Q.products, variables: { first: 5, query: "a\nb" } }), "body");
  assert.equal(bad({ query: L.SHOPIFY_Q.nodes, variables: { ids: ["gid://shopify/Customer/1"] } }), "body");
  assert.equal(bad({ query: L.SHOPIFY_Q.nodes, variables: { ids: ["gid://shopify/Product/1"] } }), "");
  assert.equal(bad({ query: L.SHOPIFY_Q.shop, variables: {} }), "body");
  assert.equal(L.checkReq("shopify", { m: "GET", path: "/graphql.json" }), "path");
  assert.equal(L.checkReq("shopify", Object.assign({}, ok, { path: "/admin/api/graphql.json" })), "path");
  assert.equal(L.apiUrl("shopify", { site: "https://tees.myshopify.com" }, "/graphql.json"), "https://tees.myshopify.com/api/2025-10/graphql.json");
  assert.deepEqual(L.authHeader("shopify", { key: "a".repeat(32) }), ["X-Shopify-Storefront-Access-Token", "a".repeat(32)]);
  assert.equal(L.normSite("tees.myshopify.com/admin/products", "shopify"), "https://tees.myshopify.com");
  assert.equal(L.checkKeys("shopify", { key: "0123456789abcdef0123456789abcdef" }).ok, true);
  assert.equal(L.checkKeys("shopify", { key: "0123456789abcdef0123456789abcdefa" }).ok, false);
  assert.equal(L.PLATFORMS.shopify.direct, true);
  assert.equal(X.checkExtReq("shopify", ok), "p");
  assert.deepEqual(L.PLATFORMS.woo.apps, ["stock", "newsletter", "publish"]);
});

test("E4: fresh prices update name, page, prices and stock, keep the picture, count the gone", () => {
  const b = C.normBlock(prod([MUG, Object.assign({}, MUG, { id: "99", name: "Old" })]));
  const reqs = Sh.refreshReqs(b);
  assert.deepEqual(reqs.map((r) => r.path), ["/data/currencies/current", "/products/12", "/products/99"]);
  for (const r of reqs) assert.equal(L.checkReq("woo", r), "");
  const res = Sh.applyFresh(b, { 12: { id: "12", name: "Mug 2", href: "https://shop.example.gr/p/mug-2/", price: 800, was: 0, cur: "EUR", out: 1 } });
  assert.equal(res.gone, 1);
  assert.deepEqual([res.items[0].name, res.items[0].price, res.items[0].was, res.items[0].out, res.items[0].f], ["Mug 2", 800, 0, 1, PIC]);
  assert.equal(res.items[1].name, "Old");
  const sb = C.normBlock(prod([Object.assign({}, MUG, { id: "gid://shopify/Product/42" })], { sh: "shopify" }));
  const sr = Sh.refreshReqs(sb);
  assert.equal(sr.length, 1);
  assert.equal(L.checkReq("shopify", sr[0]), "");
  assert.deepEqual(sr[0].body.variables, { ids: ["gid://shopify/Product/42"] });
});

test("E4: a product picture goes through the relay only from the shop's own uploads", () => {
  assert.equal(Sh.imgPath("https://noxpress.gr/wp-content/uploads/2026/05/mug.jpg", "https://noxpress.gr"), "/wp-content/uploads/2026/05/mug.jpg");
  assert.equal(Sh.imgPath("https://ex.gr/shop/wp-content/uploads/a.png", "https://ex.gr/shop"), "/wp-content/uploads/a.png");
  assert.equal(Sh.imgPath("https://ex.gr/wp-content/uploads/a.png", "https://ex.gr/shop"), "");
  assert.equal(Sh.imgPath("https://i0.wp.com/noxpress.gr/wp-content/uploads/a.jpg", "https://noxpress.gr"), "");
  assert.equal(Sh.imgPath("https://noxpress.gr/wp-content/uploads/a.jpg?resize=300", "https://noxpress.gr"), "");
  assert.equal(Sh.imgPath("https://noxpress.gr/wp-admin/a.jpg", "https://noxpress.gr"), "");
});

test("E4: WooCommerce customers become people for the import, with basis customer", () => {
  const people = Sh.wooPeople([
    { email: "Ann@Example.gr", first_name: "Ann", last_name: "Lee" },
    { email: "", billing: { email: "bob@example.gr", first_name: "Bob", last_name: "" } },
    { email: "not-an-address" }, null
  ], "Noxpress");
  assert.deepEqual(people, [{ email: "Ann@Example.gr", name: "Ann Lee", c: "", lt: ["Noxpress"] }, { email: "bob@example.gr", name: "Bob", c: "", lt: ["Noxpress"] }]);
  const d = C.normalize({ chans: [CHAN], lists: [LIST], subs: [
    { id: C.subId("list-1", "bob@example.gr"), m: 1, list: "list-1", email: "bob@example.gr", src: "manual", basis: "optin", at: 1, off: 2, offSt: "off" }
  ] });
  const plan = C.planImport(d, "list-1", people, { basis: "customer", src: "shop" });
  assert.equal(plan.add.length, 1);
  assert.equal(plan.left, 1);                                  // who left never comes back
  assert.equal(plan.add[0].basis, "customer");
  assert.equal(plan.add[0].src, "shop");
  assert.ok(plan.add[0].conf > 0);
  for (const p of [1, 50]) assert.equal(L.checkReq("woo", { m: "GET", path: "/customers?role=customer&per_page=100&page=" + p + "&orderby=id&order=asc" }), "");
});

test("E4: a Shopify customer export brings only those who accept e-mail marketing", async () => {
  const csv = "Customer ID,First Name,Last Name,Email,Accepts Email Marketing,Default Address Company,Tags\n" +
    "1,Ann,Lee,ann@example.gr,yes,,\"vip, summer\"\n2,Bob,,bob@example.gr,no,,\n3,Cy,,bad-address,yes,,\n";
  assert.equal(I2.kindOfCsv(csv), "sh-subs");
  const res = await I2.read("customers_export.csv", csv);
  assert.equal(res.source, "shopify");
  assert.deepEqual(res.people, [{ email: "ann@example.gr", name: "Ann Lee", tags: ["vip", "summer"], lang: "" }]);
  assert.equal(res.pSkip, 1);
  assert.equal(res.pBad, 1);
  const old = "First Name,Last Name,Email,Company,Accepts Marketing,Tags\nDee,,dee@example.gr,,yes,\n";
  assert.equal((await I2.read("customers.csv", old)).people.length, 1);
  // a plain CSV stays with the old reader
  assert.equal(I2.kindOfCsv("email,name\na@b.gr,A\n"), "");
});
