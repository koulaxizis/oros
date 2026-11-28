// AS-PF (Assistant wave 6, AH-5, Chris 2026-11-28): the Assistant reads
// the owner's Printful store through the token in Connected services,
// GET only; orders by number and status, never the recipient.
// Run: node --test tests/assistant-printful.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../assistant/core.js");
const L = require("../links/core.js");
const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
const RT = fs.readFileSync(path.join(ROOT, "assistant/routines.js"), "utf8");

test("pfReq: fixed GET paths only", () => {
  const p = (a) => C.pfReq(a).req.path;
  assert.equal(p({ what: "stores" }), "/stores");
  assert.equal(p({ what: "products" }), "/sync/products?offset=0&limit=20");
  assert.equal(p({ what: "products", status: "synced", search: "mug cup", count: 500, offset: 40 }), "/sync/products?offset=40&limit=100&status=synced&search=mug+cup");
  assert.equal(p({ what: "product", id: 497951426 }), "/sync/products/497951426");
  assert.equal(p({ what: "orders", status: "fulfilled", count: 5 }), "/orders?offset=0&limit=5&status=fulfilled");
  assert.equal(p({ what: "order", id: 12 }), "/orders/12");
  assert.equal(p({ what: "catalog" }), "/products");
  assert.equal(p({ what: "catalog", category: 24 }), "/products?category_id=24");
  assert.equal(p({ what: "catalog_product", id: 679 }), "/products/679");
  for (const a of [{ what: "x" }, { what: "order" }, { what: "order", id: "@ext" }, { what: "product", id: -1 }, { what: "products", search: "Φυσιογνωμία" },
                   { what: "products", search: "a&b=c" }, { what: "orders", status: "shipped" }]) assert.ok(C.pfReq(a).err, JSON.stringify(a));
  Object.values(C.PF_WHAT).forEach((w) => assert.equal(C.pfReq({ what: w, id: 5 }).req.m, "GET"));
});

test("every request pfReq makes passes links/core.js, and nothing that writes does", () => {
  const reqs = [{ what: "stores" }, { what: "products", status: "all", search: "tee", offset: 3, count: 100 }, { what: "product", id: 1 },
    { what: "orders", status: "onhold" }, { what: "order", id: 99 }, { what: "catalog", category: 7 }, { what: "catalog_product", id: 71 }].map((a) => C.pfReq(a).req);
  for (const r of reqs) assert.equal(L.checkReq("printful", r), "", r.path);
  for (const r of [{ m: "POST", path: "/orders", body: { a: 1 } }, { m: "PUT", path: "/sync/products/1", body: { a: 1 } }, { m: "GET", path: "/orders/1/confirm" },
                   { m: "GET", path: "/webhooks" }, { m: "GET", path: "/store/products/@x" }, { m: "GET", path: "/orders?limit=101" }, { m: "GET", path: "/oauth/scopes" }])
    assert.notEqual(L.checkReq("printful", r), "", r.m + " " + r.path);
  assert.equal(L.PLATFORMS.printful.host, "api.printful.com");
  assert.equal(L.checkKeys("printful", { key: "Ab12".repeat(10) }).ok, true);
  assert.equal(L.checkKeys("printful", { key: "short" }).ok, false);
});

test("relay/ext.js has the same Printful rows as links/core.js", () => {
  const EXT = fs.readFileSync(path.join(ROOT, "relay/ext.js"), "utf8");
  const CORE = fs.readFileSync(path.join(ROOT, "links/core.js"), "utf8");
  const e = EXT.slice(EXT.indexOf("  printful: {"), EXT.indexOf("  // Kimai 2: the person's own install"));
  const c = CORE.slice(CORE.indexOf("    printful: [\n"), CORE.indexOf("    shopify: [\n"));
  const norm = (x) => x.split("\n").map((l) => l.trim().replace(/,$/, "")).filter((l) => l.startsWith("["));
  assert.ok(norm(c).length === 7, "7 rows in links/core.js");
  assert.deepEqual(norm(e), norm(c));
  assert.match(e, /host: "api\.printful\.com"/);
  assert.doesNotMatch(e + c, /"(POST|PUT|DELETE|PATCH)"/);
});

test("pfShape: orders never carry the recipient", () => {
  const order = { id: 7, external_id: "88015", status: "fulfilled", created: 1764300000, updated: 1764310000, shipping: "STANDARD", shipping_service_name: "Flat Rate",
    recipient: { name: "Μαρία Π.", address1: "Οδός 1", city: "Αθήνα", email: "m@example.com", phone: "+30 69", tax_number: "EL123" },
    items: [{ name: "Mug", quantity: 2, sku: "M-1", retail_price: "12.00", files: [{ url: "https://x" }] }],
    costs: { currency: "EUR", subtotal: "10.00", shipping: "4.00", tax: "0", vat: "2.40", total: "16.40" }, retail_costs: { total: "24.00" },
    shipments: [{ carrier: "ACS", service: "Standard", tracking_number: "TN1", tracking_url: "https://track/TN1", shipped_at: 1764320000 }] };
  const one = C.pfShape("order", { code: 200, result: order });
  const s = JSON.stringify(one);
  for (const bad of ["Μαρία", "Οδός", "Αθήνα", "m@example.com", "+30 69", "EL123", "TN1", "track"]) assert.ok(!s.includes(bad), bad);
  assert.equal(one.id, 7);
  assert.equal(one.items[0].quantity, 2);
  assert.equal(one.costs.total, "16.40");
  assert.equal(one.created, new Date(1764300000 * 1000).toISOString());
  const list = C.pfShape("orders", { result: [order], paging: { total: 31, offset: 0 } });
  assert.equal(list.total, 31);
  assert.ok(!JSON.stringify(list).includes("Μαρία"));
});

test("pfShape: products, a product, the catalogue (shapes of real answers)", () => {
  const ps = C.pfShape("products", { result: [{ id: 1, external_id: "88015", name: "Φυσιογνωμία", variants: 1, synced: 0, thumbnail_url: "https://img", is_ignored: false }], paging: { total: 1547, offset: 0 } });
  assert.deepEqual(ps, { total: 1547, offset: 0, items: [{ id: 1, external_id: "88015", name: "Φυσιογνωμία", variants: 1, synced: 0, ignored: false }] });
  const p = C.pfShape("product", { result: { sync_product: { id: 1, name: "Tee" }, sync_variants: [{ id: 2, name: "Tee / M", sku: "T-M", retail_price: "20.00", currency: "EUR", synced: true, variant_id: 4012, product: { product_id: 71 }, availability_status: "active" }] } });
  assert.equal(p.variants[0].catalog_variant, 4012);
  assert.equal(p.variants[0].catalog_product, 71);
  const cp = C.pfShape("catalog_product", { result: { product: { id: 71, title: "Tee", currency: "EUR" }, variants: [{ id: 4012, size: "M", color: "Black", price: "9.25", in_stock: true, availability_status: [{ region: "EU", status: "in_stock" }] }] } });
  assert.deepEqual(cp.variants[0].regions, ["EU:in_stock"]);
  assert.equal(C.pfShape("stores", { result: [{ id: 3, name: "Shop", type: "woocommerce" }] })[0].type, "woocommerce");
  assert.equal(C.pfShape("order", { result: null }), null);
});

test("the Assistant offers printful_read only with a Printful account; routines need their switch", () => {
  assert.deepEqual(C.toolsFor({ printful: true }).map((x) => x.name), ["printful_read"]);
  assert.match(SRC, /var pfOn = !builtin && pfAccts\(\)\.length > 0 && \(!ro \|\| !!\(rtCtx && rtCtx\.r\.pf\)\);/);
  assert.match(SRC, /github: ghOn, printful: pfOn,/);
  assert.match(SRC, /printful_read: 1,/);
  assert.match(SRC, /lk\.list\("printful"\)/);
  assert.match(SRC, /if \(call\.name === "printful_read"\) return pfRead\(call\.args\);/);
  assert.match(RT, /pf: x\.pf === 1 \? 1 : 0,/);
  assert.match(RT, /printful_read/);
  // the token never reaches the Assistant: only id and name of the account
  const accts = SRC.slice(SRC.indexOf("function pfAccts()"), SRC.indexOf("var PF_WHY"));
  assert.match(accts, /return \{ id: a\.id, name: a\.name \|\| "" \};/);
});
