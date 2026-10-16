// The .orosstock file (Stock): products, suppliers, orders, warehouses,
// movements and the till's lists through the shared kit (recordpkg.js)
// and bundle.js, product photos in media/; opening adds only what is
// missing, with its ids, through core.merge. A closed period travels as
// its opening balance. Plus the app wiring (Save, Open, unzipped
// folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "stock/core.js"));
const P = require(path.join(ROOT, "stock/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = Date.now();
const clone = (x) => JSON.parse(JSON.stringify(x));
const PIC = "a".repeat(64) + ".jpg";

function slice() {
  return C.merge({
    items: [
      { id: "item01", m: NOW - 9000, name: "Blue mug", sku: "=MUG", bc: "5012345678900", cat: "cat001", sup: "sup001", cost: 400, price: 900, unit: "pcs" },
      { id: "item02", m: NOW - 9000, name: "Rice", sku: "RICE", unit: "kg", price: 250 }
    ],
    cats: [{ id: "cat001", m: NOW - 9000, name: "Kitchen" }],
    sups: [{ id: "sup001", m: NOW - 9000, name: "Acme", email: "a@b.c" }],
    whs: [{ id: "wh0002", m: NOW - 9000, name: "Shop floor" }],
    pics: [{ id: "item01", m: NOW - 8000, f: "20261001-item01-abcd.jpg", key: PIC }],
    moves: [
      { id: "mv0001", m: NOW - 7000, t: "in", d: "2026-10-01", sup: "sup001", lines: [{ i: "item01", q: 10000, c: 400 }, { i: "item02", q: 5500, lot: "L1", exp: "2027-01-01" }] },
      { id: "mv0002", m: NOW - 6000, t: "out", d: "2026-10-02", lines: [{ i: "item01", q: -2000, p: 900 }], src: "pos:sale01" },
      { id: "mv0003", m: NOW - 5000, t: "xfer", d: "2026-10-03", w2: "wh0002", lines: [{ i: "item01", q: 1000 }] }
    ],
    sales: [{ id: "sale01", m: NOW - 6000, d: "2026-10-02", at: NOW - 6000, no: "A-1", pay: "card", mv: "mv0002", lines: [{ i: "item01", q: 2000, p: 900, vat: 24, n: "Blue mug" }] }],
    pls: [{ id: "pl0001", m: NOW - 6000, name: "Wholesale", pct: -10, p: { item01: 700 } }],
    settings: { m: NOW - 9000, cur: "EUR", vat: 24, neg: 1 },
    tombs: { gone01: NOW - 100 }
  }, null, NOW);
}
// a device with its own, other stock
function other() {
  return C.merge({
    items: [{ id: "item09", m: NOW - 100, name: "Tea", unit: "pcs" }],
    moves: [{ id: "mv0909", m: NOW - 100, t: "in", d: "2026-10-05", lines: [{ i: "item09", q: 3000 }] }],
    settings: { m: NOW - 50, cur: "USD", vat: 13, neg: 0 }
  }, null, NOW);
}

test("stock: round trip through bundle.js (writeBlob too); no tombstones, the CSV previews have the formula guard", async () => {
  const s = slice();
  const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const key = (await B.sha256(photo)) + ".jpg";
  s.pics[0].key = key;   // what the app's files hook adds
  const o = K.pack(D, s, { title: "Stock", lang: "en", files: [{ key: key, bytes: photo, type: "image/jpeg" }] });
  assert.equal(o.mime, "application/x-oros-stock");
  assert.equal(o.content.kind, "oros-stock-package");
  assert.deepEqual(Object.keys(o.content.data).sort(),
    ["cats", "items", "moves", "pics", "pls", "pos", "sales", "settings", "sups", "units", "ver", "whs"]);
  assert.equal(o.content.data.tombs, undefined);
  assert.equal(o.content.data.pics[0].key, key);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-stock");
  if (typeof Blob === "function") {
    const blob = await B.writeBlob(o);
    assert.equal(blob.size, bytes.length);
  }
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-stock-package");
  assert.deepEqual(Array.from(r.media[key].bytes), Array.from(photo));
  assert.equal(r.media[key].type, "image/jpeg");
  assert.equal(D.norm(r.content.data).pics[0].key, key);
  const prod = o.preview.find((p) => p.name === "products.csv").data;
  assert.match(prod, /^﻿SKU,Name,Barcode,/);
  assert.match(prod, /'=MUG,Blue mug,5012345678900,Kitchen,pcs,8,/);   // 10 in, 2 sold
  const mv = o.preview.find((p) => p.name === "movements.csv").data;
  assert.match(mv, /Warehouse,To warehouse,Lot,Expiry\r\n/);
  assert.match(mv, /2026-10-02,Sale,,,'=MUG,Blue mug,-2,9,/);
  const el = K.pack(D, s, { lang: "el" }).preview.find((p) => p.name === "products.csv").data;
  assert.match(el, /^﻿SKU;Όνομα;/);
  assert.match(el, /;5,5;/);   // Greek decimal comma (5.5 kg rice)
  // into a device with other data: everything added, its own rows stay
  const res = K.open(D, other(), r.content);
  assert.equal(res.report.skipped, 0);
  assert.equal(res.report.added, 2 + 1 + 1 + 1 + 1 + 3 + 1 + 1);
  assert.deepEqual(res.next.items.map((x) => x.id), ["item01", "item02", "item09"]);
  assert.deepEqual(res.next.settings, other().settings);                     // settings stay this device's
  const q = C.qtyMap(res.next);
  assert.deepEqual([q.item01, q.item02, q.item09], [8000, 5500, 3000]);
  assert.equal(res.next.pics[0].key, undefined);                              // core keeps its own fields
  // and again: nothing
  const again = K.open(D, res.next, r.content);
  assert.equal(again.report.added, 0);
  assert.deepEqual(again.next, res.next);
  // the device it came from: nothing either
  assert.equal(K.open(D, slice(), r.content).report.added, 0);
});

test("stock: a clash keeps the local row; a row deleted here stays deleted; update takes the newer copy", () => {
  const theirs = slice();
  theirs.items[0].name = "Changed mug"; theirs.items[0].m = NOW - 10;
  theirs.items.push({ id: "gone01", m: NOW - 500, name: "Deleted here", unit: "pcs", cost: 0, price: 0, vat: 24 });
  const c = K.pack(D, theirs).content;
  const mine = slice();
  const res = K.open(D, mine, c);
  assert.equal(res.report.added, 0);
  assert.equal(res.next.items.find((x) => x.id === "item01").name, "Blue mug");
  assert.ok(!res.next.items.some((x) => x.id === "gone01"));
  const upd = K.open(D, mine, c, { update: true });
  assert.deepEqual(upd.updatedIds, ["item01"]);
  assert.equal(upd.next.items.find((x) => x.id === "item01").name, "Changed mug");
  assert.deepEqual(upd.next.tombs, mine.tombs);
});

test("stock: a closed period travels as its opening balance; reopening on the closing device adds nothing", () => {
  const s = slice();
  const closed = C.closePeriod(s, "2026-10-02", NOW - 1000, "close01");
  const q0 = C.qtyMap(closed);
  const ops = P.opening(closed.close);
  assert.ok(ops.length >= 1 && ops.every((x) => x.t === "fix" && /^op[0-9a-f]{16}0$/.test(x.id) && x.src === "close:close01"));
  assert.deepEqual(P.opening(closed.close), ops);                            // the same ids every time
  const c = K.pack(D, closed).content;
  assert.equal(c.data.close, undefined);
  const res = K.open(D, other(), c);
  const q = C.qtyMap(res.next);
  assert.deepEqual([q.item01, q.item02], [q0.item01, q0.item02]);
  assert.equal(K.open(D, closed, c).report.added, 0);
});

test("stock: Undo voids movements and receipts, archives used products, tombstones the rest", () => {
  const c = K.pack(D, slice()).content;
  const res = K.open(D, other(), c);
  const u = P.undo(res.next, res.addedIds, NOW + 1);
  const d = u.data;
  assert.ok(d.moves.filter((x) => x.id !== "mv0909").every((x) => x.v === 1));
  assert.ok(!d.moves.find((x) => x.id === "mv0909").v);
  assert.equal(d.sales[0].v, 1);
  assert.ok(d.items.filter((x) => x.id !== "item09").every((x) => x.arch === 1));
  assert.ok(d.cats.length === 1 && d.sups.length === 1);                       // still named by the archived product
  assert.equal(d.pls, undefined);
  assert.ok(d.tombs.pl0001 > 0);
  assert.equal(d.pics[0].f, "");
  assert.deepEqual(u.files, ["20261001-item01-abcd.jpg"]);
  const q = C.qtyMap(d);
  assert.equal(q.item09, 3000);
  assert.ok(!q.item01);
  // a product without movements goes: tombstoned
  const lone = K.pack(D, C.merge({ items: [{ id: "item77", m: NOW - 5, name: "Lone" }], cats: [{ id: "cat077", m: NOW - 5, name: "Solo" }] }, null)).content;
  const r2 = K.open(D, other(), lone);
  const d2 = P.undo(r2.next, r2.addedIds, NOW + 1).data;
  assert.ok(!d2.items.some((x) => x.id === "item77"));
  assert.ok(d2.tombs.item77 && d2.tombs.cat077);
  assert.equal(K.open(D, d2, lone).report.added, 0);                           // and it stays deleted
});

test("stock: hostile content is cut down (unknown fields, bad ids, wrong signs, keys, tombstones, close)", () => {
  const evil = {
    kind: "oros-stock-package", ver: 1,
    data: {
      items: [{ id: "item01", m: NOW + 1e12, name: "x".repeat(500), onclick: "alert(1)", price: -5, vat: 900 },
              { id: "../../etc", m: 1, name: "bad" }, { id: "__proto__", m: 1, name: "p" }, "junk", null],
      moves: [{ id: "mv0001", m: 1, t: "out", d: "2026-10-01", lines: [{ i: "item01", q: 5000 }] },
              { id: "mv0002", m: 1, t: "boom", d: "2026-10-01", lines: [{ i: "item01", q: 1 }] }],
      pics: [{ id: "item01", m: 1, f: "../../../internal/Stock/Archive/x.json", key: "../evil" }],
      tombs: { item09: NOW },
      close: { id: "close9", m: 1, d: "2026-01-01", at: 1, bal: [{ i: "item09", q: -999999 }] },
      shop: { key: "ck_secret" }, settings: { cur: "BTC", m: 1 }
    }
  };
  const res = K.open(D, other(), evil);
  const it = res.next.items.find((x) => x.id === "item01");
  assert.equal(it.name.length, 80);
  assert.equal(it.onclick, undefined);
  assert.equal(it.price, 0);
  assert.equal(it.vat, 24);
  assert.ok(it.m <= Date.now() + K.FUTURE);
  assert.deepEqual(res.next.items.map((x) => x.id), ["item01", "item09"]);
  assert.deepEqual(res.next.moves.map((x) => x.id), ["mv0909"]);               // a sale must be negative
  assert.equal(res.next.pics[0].f, "");
  assert.equal(res.next.close, undefined);
  assert.equal(res.next.shop, undefined);
  assert.equal(res.next.settings.cur, "USD");
  assert.ok(res.next.items.some((x) => x.id === "item09"));                   // a file never deletes
  assert.throws(() => K.open(D, other(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm({ pics: [{ id: "item01", m: 1, f: "", key: "A".repeat(64) + ".jpg" }] }).pics[0].key, undefined);
});

test("stock: the file never carries the shop's keys or device prefs", () => {
  const s = slice();
  s.shop = { url: "https://x", ck: "ck_123", cs: "cs_456" };
  s.prefs = { pos: { dev: "AB" } };
  const txt = JSON.stringify(K.pack(D, s).content);
  assert.ok(!/ck_123|cs_456|"prefs"|"shop"/.test(txt));
});

test("stock: wiring (scripts, buttons, Open with, help, file types)", () => {
  const html = read("stock/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "stock.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf("core.js") < html.indexOf("package.js?"));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="stock.js'));
  const js = read("stock/stock.js");
  assert.match(js, /RP\.ui\(SPK\.DESC,/);
  assert.match(js, /if \(target\.openFile\) \{ if \(recFile\) recFile\.openTarget\(target\.openFile\); return; \}/);
  assert.match(js, /__orosTakeFile\(/);
  assert.match(js, /window\.__orosOpenAt = openTarget;/);
  assert.match(js, /__orosTakeTarget\("stock"\)/);
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  ["st-osave", "st-oopen", "st-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.match(js, /SPK\.undo\(data, ids, Date\.now\(\)\)/);
  assert.match(js, /encodePic\(new Blob\(\[item\.bytes\]/);
  for (const f of ["stock/help.en.txt", "stock/help.el.txt"]) assert.ok(read(f).includes(".orosstock"), f);
  assert.deepEqual(F.appsFor(".orosstock"), ["stock"]);
  assert.deepEqual(B.TYPES[".orosstock"], { app: "stock", mime: "application/x-oros-stock" });
});
