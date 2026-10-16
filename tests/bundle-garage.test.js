// The .orosgarage file (Garage, phase 4b wave 4): every vehicle,
// fill, service, plan, tyre set, renewal, expense and km reading
// through the shared kit (recordpkg.js) and bundle.js, the receipt
// photos in media/; opening adds only what is missing, with its ids.
// Tombstones never go in. Plus the app wiring (settings, "Open with",
// receipts, help).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "garage/core.js"));
const P = require(path.join(ROOT, "garage/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const SHA = "a".repeat(64), SHA2 = "b".repeat(64);

function slice() {
  return C.merge({
    ver: 1,
    vehicles: [{ id: "veh001", m: NOW - 1000, name: "Golf", type: "car", fuel: "petrol", plate: "ABC-1234", notes: "my car" }],
    fuel: [{ id: "ful001", m: NOW - 900, v: "veh001", d: "2026-10-01", km: 12000, q: 40500, c: 7290, full: 1,
             st: "Shell", n: "=HYPERLINK(\"x\")", rc: ["20261001-ful001-abcd.jpg"] },
           { id: "ful002", m: NOW - 890, v: "veh001", d: "2026-10-08", km: 12600, q: 38000, c: 6840, full: 1, st: "BP, Athens" }],
    service: [{ id: "srv001", m: NOW - 800, v: "veh001", d: "2026-09-15", km: 11800, items: ["oil", "ofilter", "other"], c: 12000,
                shop: "Nikos", rc: ["20260915-srv001-efgh.jpg"] }],
    plans: [{ id: "pln001", m: NOW - 700, v: "veh001", item: "oil", km: 10000, mo: 12, sd: "2026-01-01", skm: 5000 }],
    tyres: [{ id: "tyr001", m: NOW - 600, v: "veh001", label: "Summer set", season: "s", on: 1, okm: 10000, dot: "1224" }],
    renewals: [{ id: "ren001", m: NOW - 500, v: "veh001", kind: "ins", exp: "2027-03-01", every: 12, c: 25000 }],
    costs: [{ id: "cst001", m: NOW - 400, v: "veh001", d: "2026-10-05", cat: "toll", c: 280 }],
    odo: [{ id: "odo001", m: NOW - 300, v: "veh001", d: "2026-10-10", km: 12700 }],
    settings: { m: NOW - 2000, cur: "EUR" },
    tombs: { gone01: NOW - 100 }
  }, null, NOW);
}
function device() {
  // another device: its own vehicle with a mounted set, a copy of a
  // file row, and a deleted row the file has
  return C.merge({
    ver: 1,
    vehicles: [{ id: "mine01", m: NOW - 50, name: "Vespa", type: "scooter" },
               { id: "veh001", m: NOW - 40, name: "Golf (mine)", type: "car" }],
    tyres: [{ id: "tyrmin", m: NOW - 30, v: "veh001", label: "Winter", season: "w", on: 1, okm: 12000 }],
    odo: [{ id: "odomin", m: NOW - 20, v: "mine01", d: "2026-10-11", km: 800 }],
    settings: { m: NOW - 5, cur: "EUR" },
    tombs: { cst001: NOW - 10 }
  }, null, NOW);
}
// what garage.js's set hook does
const applied = (res, local, inc) => C.merge(P.settle(res.next, local, res.addedIds, inc, NOW), null, NOW);

test("garage: round trip through bundle.js; no tombstones; receipts as media; the CSV preview", async () => {
  const st = slice();
  st.rcs = { "20261001-ful001-abcd.jpg": SHA + ".jpg", "20260915-srv001-efgh.jpg": SHA2 + ".jpg", "20260101-zzzzzz-abcd.jpg": SHA + ".jpg" };
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), jpg2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5]);
  const o = K.pack(D, st, { title: "Garage", lang: "en", now: NOW,
    files: [{ key: SHA + ".jpg", bytes: jpg }, { key: SHA2 + ".jpg", bytes: jpg2 }] });
  assert.equal(o.mime, "application/x-oros-garage");
  assert.equal(o.generator, "orOS Garage");
  const data = o.content.data;
  assert.deepEqual(Object.keys(data).sort(),
    ["costs", "fuel", "odo", "plans", "rcs", "renewals", "service", "settings", "tyres", "vehicles", "ver"]);
  assert.equal(data.tombs, undefined);
  assert.deepEqual(data.rcs, { "20260915-srv001-efgh.jpg": SHA2 + ".jpg", "20261001-ful001-abcd.jpg": SHA + ".jpg" });
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-garage");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-garage-package");
  // media are re-keyed by their real hash; content.json follows
  const keys = Object.keys(r.media);
  assert.equal(keys.length, 2);
  assert.ok(keys.includes(r.content.data.rcs["20261001-ful001-abcd.jpg"]));
  assert.equal(r.media[r.content.data.rcs["20261001-ful001-abcd.jpg"]].type, "image/jpeg");
  // the preview is the app's Export CSV
  const csv = o.preview.find((p) => p.name === "log.csv").data.split("\r\n");
  assert.equal(csv[0], "﻿Date,Vehicle,Kind,Details,Km,Quantity,Cost (EUR),Notes");
  assert.equal(csv[1], "2026-09-15,Golf,Service,\"Oil change, Oil filter, Other · Nikos\",11800,,120,");
  assert.equal(csv[2], "2026-10-01,Golf,Fuel,Shell,12000,40.5,72.9,\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csv[3], "2026-10-05,Golf,Expense,Tolls,,,2.8,");
  assert.equal(csv[4], "2026-10-08,Golf,Fuel,\"BP, Athens\",12600,38,68.4,");
  assert.equal(csv[5], "2026-10-10,Golf,Km reading,,12700,,,");
  const el = D.previews(D.strip(slice()), "el")["log.csv"].split("\r\n");
  assert.equal(el[0], "﻿Ημερομηνία;Όχημα;Είδος;Λεπτομέρειες;Km;Ποσότητα;Κόστος (EUR);Σημειώσεις");
  assert.equal(el[2], "2026-10-01;Golf;Καύσιμα;Shell;12000;40,5;72,9;\"'=HYPERLINK(\"\"x\"\")\"");
  assert.deepEqual(D.previews(D.strip(C.merge(null, null)), "en"), {});

  // into a device with other data
  const mine = device();
  const res = K.open(D, mine, r.content, { now: NOW });
  // veh001 already here, cst001 deleted here; every other record added
  assert.deepEqual(res.report, { added: 7, skipped: 2, updated: 0 });
  assert.ok(res.addedIds.includes("ful001") && !res.addedIds.includes("veh001") && !res.addedIds.includes("cst001"));
  const next = applied(res, mine, r.content.data);
  assert.equal(next.vehicles.find((v) => v.id === "veh001").name, "Golf (mine)");     // a clash keeps the local record
  assert.deepEqual(next.vehicles.map((v) => v.id), ["mine01", "veh001"]);
  assert.deepEqual(next.fuel.map((x) => x.id), ["ful001", "ful002"]);
  assert.deepEqual(next.fuel[0].rc, ["20261001-ful001-abcd.jpg"]);
  assert.deepEqual(next.costs, []);                                              // deleted here stays deleted
  assert.deepEqual(next.tombs, mine.tombs);
  assert.deepEqual(next.settings, mine.settings);
  assert.equal(next.rcs, undefined);
  // the mounted set of this device stays mounted; the file's is not
  assert.equal(next.tyres.find((t) => t.id === "tyrmin").on, 1);
  assert.deepEqual([next.tyres.find((t) => t.id === "tyr001").on, next.tyres.find((t) => t.id === "tyr001").okm], [0, null]);
  assert.deepEqual(next.odo.map((x) => x.id), ["odo001", "odomin"]);
  // and again: nothing
  const again = K.open(D, next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(applied(again, next, r.content.data), next);
});

test("garage: update takes the newer copy, a deleted one stays deleted, stamps are clamped", () => {
  const theirs = slice();
  theirs.vehicles[0].name = "Golf GTI"; theirs.vehicles[0].m = NOW + 365 * 864e5;   // from the future
  const c = K.pack(D, theirs, { now: NOW }).content;
  const mine = device();
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, ["veh001"]);
  const v = upd.next.vehicles.find((x) => x.id === "veh001");
  assert.equal(v.name, "Golf GTI");
  assert.equal(v.m, NOW + K.FUTURE);
  assert.ok(!upd.next.costs.some((x) => x.id === "cst001"));
  assert.deepEqual(D.tombIds(mine), ["cst001"]);
});

test("garage: Undo deletes the added rows with tombstones; an added vehicle goes unless rows were added to it", () => {
  const mine = device(), c = K.pack(D, slice(), { now: NOW }).content;
  const fresh = C.merge(null, null, NOW);
  const res = K.open(D, fresh, c, { now: NOW });
  const next = applied(res, fresh, c.data);
  assert.equal(next.vehicles.length, 1);
  assert.equal(next.costs.length, 1);
  // a fresh device that never chose a currency takes the file's
  const usd = slice(); usd.settings = { m: NOW - 7, cur: "USD" };
  const n2 = applied(K.open(D, fresh, K.pack(D, usd, { now: NOW }).content, { now: NOW }), fresh, usd);
  assert.deepEqual(n2.settings, { m: NOW - 7, cur: "USD" });
  assert.deepEqual(applied(K.open(D, mine, K.pack(D, usd, { now: NOW }).content, { now: NOW }), mine, usd).settings, mine.settings);
  // Undo
  const u = P.undo(next, res.addedIds, NOW + 1000);
  assert.deepEqual(u.data.vehicles, []);
  C.LIST_KEYS.forEach((k) => assert.deepEqual(u.data[k], [], k));
  res.addedIds.forEach((id) => assert.ok(u.data.tombs[id] >= NOW, id));
  assert.deepEqual(u.files.sort(), ["20260915-srv001-efgh.jpg", "20261001-ful001-abcd.jpg"]);
  // reopening after Undo adds nothing: they are deleted here now
  assert.equal(K.open(D, u.data, c, { now: NOW + 2000 }).report.added, 0);
  // a row added to the vehicle since keeps the vehicle
  const later = JSON.parse(JSON.stringify(next));
  later.odo.push({ id: "odonew", m: NOW + 500, v: "veh001", d: "2026-10-12", km: 13000 });
  const u2 = P.undo(later, res.addedIds, NOW + 1000);
  assert.deepEqual(u2.data.vehicles.map((v) => v.id), ["veh001"]);
  assert.deepEqual(u2.data.odo.map((x) => x.id), ["odonew"]);
});

test("garage: added vehicles over the app's cap are left out, never one of this device", () => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push({ id: "zz" + String(i).padStart(4, "0"), m: NOW - 10, name: "V" + i, type: "bike" });
  const local = C.merge({ vehicles: many }, null, NOW);
  const c = K.pack(D, slice(), { now: NOW }).content;
  const res = K.open(D, local, c, { now: NOW });
  const next = applied(res, local, c.data);
  assert.equal(next.vehicles.length, 30);
  assert.deepEqual(next.vehicles.map((v) => v.id), local.vehicles.map((v) => v.id));
  assert.deepEqual(next.fuel, []);
});

test("garage: hostile content is cut down to the slice's shape", () => {
  const n = D.norm({
    vehicles: [{ id: "veh001", m: 1, name: "<img src=x onerror=alert(1)>", type: "car", evil: 1 },
               { id: "BAD", m: 1, name: "x", type: "car" },                             // id case
               { id: "veh002", m: 1, name: "x", type: "rocket" },                       // no such type
               { id: "veh001", m: 2, name: "dup", type: "car" }],                       // duplicate id
    fuel: [{ id: "ful001", m: 1, v: "veh001", d: "2026-02-30", km: 1, q: 1 },          // no such day
           { id: "ful002", m: 1, v: "veh001", d: "2026-02-28", km: 1, q: 1, c: -5, n: "a\u0000b",
             rc: ["20260228-ful002-abcd.jpg", "20260228-other1-abcd.jpg", "../../etc/passwd.jpg", "x.jpg"] }],
    service: [{ id: "srv001", m: 1, v: "veh001", d: "2026-02-28", items: ["nope"] }],
    costs: [{ id: "cst001", m: 1, v: "veh001", d: "2026-02-28", cat: "toll", c: 0 }],
    rcs: { "20260228-ful002-abcd.jpg": "c".repeat(64) + ".png", "20260228-other1-abcd.jpg": "d".repeat(64) + ".jpg",
           "__proto__": "e".repeat(64) + ".jpg" },
    settings: { m: 1, cur: "XXX" }, tombs: { gone01: 1, "../x": 1 }, evil: "<script>", prefs: { remind: 3 }
  });
  assert.deepEqual(n.vehicles.map((v) => v.id), ["veh001"]);
  assert.equal(n.vehicles[0].evil, undefined);
  assert.equal(n.vehicles[0].name, "<img src=x onerror=alert(1)>");          // text only: the app sets textContent
  assert.deepEqual(n.fuel.map((x) => [x.id, x.c, x.n, x.rc]), [["ful002", 0, "ab", ["20260228-ful002-abcd.jpg"]]]);
  assert.deepEqual(n.service, []);
  assert.deepEqual(n.costs, []);
  assert.equal(n.rcs, undefined);                         // only <sha256>.jpg keys of names a row holds
  assert.deepEqual(n.settings, { m: 1, cur: "EUR" });
  assert.deepEqual(D.tombIds(n), ["gone01"]);
  assert.equal(n.evil, undefined);
  assert.equal(n.prefs, undefined);
  assert.equal(D.strip(n).tombs, undefined);
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([]), null);
  assert.throws(() => K.open(D, device(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, device(), { kind: "oros-garage-package", ver: 9, data: {} }), /newer/);
  // what the normaliser keeps is what core.merge keeps
  const s = slice(), mine = D.norm(D.strip(s)), app = C.merge(s, s, NOW);
  P.LISTS.concat(["settings"]).forEach((k) => assert.deepEqual(mine[k], app[k], k));
});

test("garage: the CSV names are garage.js's own", () => {
  const js = read("garage/garage.js");
  for (const lang of ["en", "el"]) {
    const W = P.WORDS[lang];
    // the en table comes first in garage.js, then el
    const part = lang === "en" ? js.slice(0, js.indexOf("    el: {")) : js.slice(js.indexOf("    el: {"));
    Object.keys(W.kind).forEach((k) => assert.ok(part.includes("\"kind." + k + "\": \"" + W.kind[k] + "\""), lang + " kind." + k));
    Object.keys(W.cat).forEach((k) => assert.ok(part.includes("\"cat." + k + "\": \"" + W.cat[k] + "\""), lang + " cat." + k));
    // the header of exportCsv: ["Date", …, "Cost (" + cur + ")", "Notes"]
    W.head.forEach((h) => assert.ok(js.includes(h.includes("{c}") ? "\"" + h.replace("{c})", "") : "\"" + h + "\""), lang + " " + h));
  }
  assert.deepEqual(Object.keys(P.WORDS.en.cat).sort(), C.COST_CATS.slice().sort());
});

test("garage: wiring (scripts, settings, Open with, receipts, help, file types)", () => {
  const html = read("garage/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "garage.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf("core.js") < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("package.js") < html.indexOf('src="garage.js'));
  const js = read("garage/garage.js");
  assert.match(js, /RP\.ui\(GPK\.DESC,/);
  assert.match(js, /if \(tg\.openFile\) \{ if \(recFile\) recFile\.openTarget\(tg\.openFile\); return; \}/);
  assert.match(js, /window\.__orosOpenAt = openTarget;/);
  assert.match(js, /__orosTakeTarget\("garage"\)/);
  assert.match(js, /__orosTakeFile\(/);
  assert.match(js, /encodeReceipt\(blob\)/);                  // photos from a file: the attach checks
  assert.match(js, /GPK\.undo\(data, ids, Date\.now\(\)\)/);   // Undo through tombstones
  assert.match(js, /GPK\.settle\(next, data,/);
  assert.equal(js.match(/window\.__orosOpenAt\s*=/g).length, 1);
  ["\"set.osave\": \"orOS file (.orosgarage)\"", "\"set.osave\": \"Αρχείο orOS (.orosgarage)\"",
   "\"set.oopen\": \"Open orOS file…\"", "\"set.oopen\": \"Άνοιγμα αρχείου orOS…\"",
   "\"set.ofolder\": \"Unzipped orOS folder…\"", "\"set.ofolder\": \"Αποσυμπιεσμένος φάκελος orOS…\""].forEach((s) => assert.ok(js.includes(s), s));
  const en = read("garage/help.en.txt"), el = read("garage/help.el.txt");
  for (const h of [en, el]) { assert.ok(h.includes(".orosgarage")); assert.ok(h.includes("preview/log.csv")); }
  assert.deepEqual(en.match(/^## /gm).length, el.match(/^## /gm).length);
  assert.deepEqual(F.appsFor(".orosgarage"), ["garage"]);
  assert.deepEqual(B.TYPES[".orosgarage"], { app: "garage", mime: "application/x-oros-garage" });
});
