// The .orosinventory file (Storage, phase 4b wave 5): every space,
// room, furniture, position and item through the shared kit
// (recordpkg.js) and bundle.js, the photos and receipts in media/;
// opening adds only what is missing, with its ids. Tombstones never go
// in. Plus the app wiring (menu, "Open with", files, help).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "storage/core.js"));
const P = require(path.join(ROOT, "storage/package.js"));
const I = require(path.join(ROOT, "storage/import.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const SHA = "a".repeat(64), SHA2 = "b".repeat(64);

function row(id, type, parentId, name, extra) {
  return Object.assign({ id, type, name, bi: null, parentId, pos: 0, mtime: NOW - 1000, del: false }, type === "item" ? { qty: 1 } : {}, extra || {});
}
// the slice as storage.js keeps it (normalize: core.mergeRow per row)
function slice() {
  const ents = [
    { id: "seed-sp-home", type: "space", bi: { en: "Home", el: "Σπίτι" }, parentId: null, pos: 0, mtime: 0, del: false },
    row("room01ab", "room", "seed-sp-home", "Garage"),
    row("furn01ab", "furniture", "room01ab", "Metal shelf", { note: "left wall" }),
    row("posn01ab", "position", "furn01ab", "Box 1", { tags: ["Seasonal"] }),
    row("item01ab", "item", "posn01ab", "Drill", { qty: 2, val: 2550, tags: ["tools", "DIY"], note: "=HYPERLINK(\"x\")",
      bought: "2025-03-01", warr: "2027-03-01", ph: ["item01ab-abcd12.jpg"], rc: "item01ab-efgh34.pdf" }),
    row("item02ab", "item", "posn01ab", "Tent, 4 people", { lent: { to: "Γιώργος", on: "2026-09-01", due: "2026-10-01" } }),
    row("gone01ab", "item", "posn01ab", "Old lamp", { del: true, mtime: NOW - 500 })
  ];
  return { ver: 1, ents: ents.map(C.mergeRow).map((e) => JSON.parse(JSON.stringify(e))) };
}
// another device: its own rooms, a copy of a file row (renamed here),
// and a deleted row the file has live
function device() {
  const ents = [
    { id: "seed-sp-home", type: "space", bi: { en: "Home", el: "Σπίτι" }, parentId: null, pos: 0, mtime: 0, del: false },
    row("kitc01ab", "room", "seed-sp-home", "Kitchen", { mtime: NOW - 50 }),
    row("room01ab", "room", "seed-sp-home", "Garage (mine)", { mtime: NOW - 40 }),
    row("item02ab", "item", "posn01ab", "Tent", { del: true, mtime: NOW - 30 })
  ];
  return { ver: 1, ents: ents.map(C.mergeRow).map((e) => JSON.parse(JSON.stringify(e))) };
}
const ids = (s) => s.ents.map((e) => e.id).sort();
// what storage.js's set hook does (settle, then normalize ≈ core.mergeRow per row)
const applied = (res, local) => {
  const s = P.settle(res.next, local, res.addedIds, res.updatedIds);
  return { ver: 1, ents: s.ents.map(C.mergeRow).map((e) => JSON.parse(JSON.stringify(e))) };
};

test("storage: round trip through bundle.js; no tombstones; photos and receipts as media; previews", async () => {
  const st = slice();
  st.phs = { "item01ab-abcd12.jpg": SHA + ".jpg", "zzzz9999-abcd12.jpg": SHA + ".jpg" };
  st.rcs = { "item01ab-efgh34.pdf": SHA2 + ".pdf" };
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const pdf = new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF\n"));
  const o = K.pack(D, st, { title: "Storage", lang: "en", now: NOW,
    files: [{ key: SHA + ".jpg", bytes: jpg }, { key: SHA2 + ".pdf", bytes: pdf }] });
  assert.equal(o.mime, "application/x-oros-inventory");
  assert.equal(o.generator, "orOS Storage");
  const data = o.content.data;
  assert.deepEqual(Object.keys(data).sort(), ["ents", "phs", "rcs", "ver"]);
  assert.ok(!data.ents.some((e) => e.del), "no tombstones");
  assert.equal(data.ents.length, 6);
  assert.deepEqual(data.phs, { "item01ab-abcd12.jpg": SHA + ".jpg" });      // only names a live row holds
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-inventory");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-storage-package");
  // media are re-keyed by their real hash; content.json follows
  const pk = r.content.data.phs["item01ab-abcd12.jpg"], rk = r.content.data.rcs["item01ab-efgh34.pdf"];
  assert.equal(r.media[pk].type, "image/jpeg");
  assert.equal(r.media[rk].type, "application/pdf");
  assert.match(rk, /^[0-9a-f]{64}\.pdf$/);
  // previews
  const csv = o.preview.find((p) => p.name === "inventory.csv").data.split("\r\n");
  assert.equal(csv[0], "﻿Location,Name,Quantity,Value,Tags,Notes,Purchase date,Warranty until,Lent to,Lent on,Return by");
  assert.equal(csv[1], "Home › Garage › Metal shelf › Box 1,Drill,2,25.50,\"tools, DIY\",\"'=HYPERLINK(\"\"x\"\")\",2025-03-01,2027-03-01,,,");
  assert.equal(csv[2], "Home › Garage › Metal shelf › Box 1,\"Tent, 4 people\",1,,,,,,Γιώργος,2026-09-01,2026-10-01");
  assert.equal(csv.length, 4);
  const md = o.preview.find((p) => p.name === "inventory.md").data;
  assert.match(md, /^# Inventory\n\n## Home\n\n- \*\*Garage\*\*\n  - \*\*Metal shelf\*\* — left wall\n    - \*\*Box 1\*\*\n      - Drill × 2/);
  assert.ok(!md.includes("Old lamp"));
  const el = D.previews(D.strip(slice()), "el")["inventory.csv"].split("\r\n");
  assert.equal(el[0], "﻿Τοποθεσία;Όνομα;Ποσότητα;Αξία;Ετικέτες;Σημειώσεις;Ημερομηνία αγοράς;Εγγύηση έως;Δανεισμένο σε;Δανείστηκε στις;Επιστροφή έως");
  assert.ok(el[1].startsWith("Σπίτι › Garage › Metal shelf › Box 1;Drill;2;25,50;tools, DIY;"));
  assert.deepEqual(D.previews(D.strip({ ver: 1, ents: [] }), "en"), {});
  // the CSV preview reads back through Storage's own CSV import
  const back = I.parseText(o.preview.find((p) => p.name === "inventory.csv").data);
  assert.equal(back.source, "generic");
  assert.deepEqual(back.items.map((x) => [x.name, x.path.join("/"), x.qty, x.val, x.tags.join(",")]),
    [["Drill", "Home/Garage/Metal shelf/Box 1", 2, 2550, "tools,DIY"], ["Tent, 4 people", "Home/Garage/Metal shelf/Box 1", 1, 0, ""]]);

  // into a device with other data
  const mine = device();
  const res = K.open(D, mine, r.content, { now: NOW });
  // the space and room01ab are here, item02ab was deleted here; the rest is added
  assert.deepEqual(res.report, { added: 3, skipped: 3, updated: 0 });
  assert.deepEqual(res.addedIds.sort(), ["furn01ab", "item01ab", "posn01ab"]);
  const next = applied(res, mine);
  assert.equal(next.ents.find((e) => e.id === "room01ab").name, "Garage (mine)");     // a clash keeps the local record
  assert.equal(next.ents.find((e) => e.id === "item02ab").del, true);                 // deleted here stays deleted
  assert.deepEqual(ids(next), ["furn01ab", "item01ab", "item02ab", "kitc01ab", "posn01ab", "room01ab", "seed-sp-home"]);
  const drill = next.ents.find((e) => e.id === "item01ab");
  assert.deepEqual([drill.ph, drill.rc, drill.val, drill.qty], [["item01ab-abcd12.jpg"], "item01ab-efgh34.pdf", 2550, 2]);
  assert.deepEqual(C.pathNames(next.ents, "item01ab", "en"), ["Home", "Garage (mine)", "Metal shelf", "Box 1"]);
  assert.equal(next.phs, undefined);
  // and again: nothing
  const again = K.open(D, next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(applied(again, next), next);
  // a fresh device takes everything but the tombstone
  const fresh = { ver: 1, ents: [] };
  const all = K.open(D, fresh, r.content, { now: NOW });
  assert.equal(all.report.added, 6);
  assert.equal(applied(all, fresh).ents.length, 6);
});

test("storage: update takes the newer copy, a deleted one stays deleted, stamps are clamped", () => {
  const theirs = slice();
  const g = theirs.ents.find((e) => e.id === "room01ab");
  g.name = "Big garage"; g.mtime = NOW + 365 * 864e5;                                    // from the future
  const c = K.pack(D, theirs, { now: NOW }).content;
  const mine = device();
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, ["room01ab"]);
  const r = upd.next.ents.find((e) => e.id === "room01ab");
  assert.equal(r.name, "Big garage");
  assert.equal(r.mtime, NOW + K.FUTURE);
  assert.equal(upd.next.ents.find((e) => e.id === "item02ab").del, true);
  assert.deepEqual(D.tombIds(mine), ["item02ab"]);
  // without the box, the local copy stays
  assert.equal(K.open(D, mine, c, { now: NOW }).next.ents.find((e) => e.id === "room01ab").name, "Garage (mine)");
});

test("storage: settle leaves out rows that would hang under nothing here", () => {
  const c = K.pack(D, slice(), { now: NOW }).content;
  // this device deleted the furniture: the file's position and items under it go nowhere
  const mine = device();
  mine.ents.push(C.mergeRow(row("furn01ab", "furniture", "room01ab", "Metal shelf", { del: true, mtime: NOW - 20 })));
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds.sort(), ["item01ab", "posn01ab"]);
  const next = applied(res, mine);
  assert.ok(!next.ents.some((e) => e.id === "posn01ab" || e.id === "item01ab"));
  assert.deepEqual(ids(next), ids(mine));
  // an update that moves a room under a space deleted here takes the local copy back
  const theirs = slice();
  theirs.ents.push(C.mergeRow(row("flat01ab", "space", null, "Flat", { mtime: NOW - 900 })));
  const g = theirs.ents.find((e) => e.id === "room01ab");
  g.parentId = "flat01ab"; g.mtime = NOW - 10;
  const here = device();
  here.ents.push(C.mergeRow(row("flat01ab", "space", null, "Flat", { del: true, mtime: NOW - 5 })));
  const r2 = K.open(D, here, K.pack(D, theirs, { now: NOW }).content, { update: true, now: NOW });
  assert.ok(r2.updatedIds.includes("room01ab"));
  const n2 = applied(r2, here);
  assert.deepEqual(n2.ents.find((e) => e.id === "room01ab"), here.ents.find((e) => e.id === "room01ab"));
  // the furniture added under it still hangs under a live room
  assert.ok(C.isAlive(n2.ents, "item01ab"));
  // a level that does not fit (an item right under a space) is left out
  const odd = { ver: 1, ents: [C.mergeRow(row("odd001ab", "item", "seed-sp-home", "Loose"))] };
  const r3 = K.open(D, device(), K.pack(D, odd, { now: NOW }).content, { now: NOW });
  assert.equal(r3.report.added, 1);
  assert.ok(!applied(r3, device()).ents.some((e) => e.id === "odd001ab"));
});

test("storage: hostile content is cut down to the slice's shape", () => {
  const n = D.norm({
    ents: [
      row("item01ab", "item", "posn01ab", "<img src=x onerror=alert(1)>", { evil: 1, qty: 1e300, val: -5,
        ph: ["item01ab-abcd12.jpg", "other1ab-abcd12.jpg", "../../etc/passwd.jpg", "x.jpg", "item01ab-abcd12.png"],
        rc: "other1ab-efgh34.pdf", tags: "a,b," + "x".repeat(80), lent: { to: "", on: "2026-01-01" }, bought: "2026-02-30" }),
      row("BAD id!", "item", null, "x"),                                   // id
      row("rock01ab", "rocket", null, "x"),                                // no such level
      row("item01ab", "item", null, "dup"),                                // duplicate id
      Object.assign(row("nomt01ab", "room", "seed-sp-home", "x"), { mtime: "soon" }),
      row("self01ab", "room", "self01ab", "x"),                            // its own parent
      row("ppar01ab", "room", "../x", "a\u0000b" + "n".repeat(500), { bi: { en: { x: 1 }, el: 5 } }),
      "nope", null, [1]
    ],
    phs: { "item01ab-abcd12.jpg": "c".repeat(64) + ".pdf", "other1ab-abcd12.jpg": "d".repeat(64) + ".jpg", "__proto__": "e".repeat(64) + ".jpg" },
    rcs: "x", tombs: { a: 1 }, prefs: { remind: 3, cur: "USD" }, evil: "<script>"
  });
  assert.deepEqual(n.ents.map((e) => e.id), ["item01ab", "ppar01ab"]);
  const it = n.ents[0];
  assert.equal(it.evil, undefined);
  assert.equal(it.name, "<img src=x onerror=alert(1)>");          // text only: the app sets textContent
  assert.equal(it.qty, 1e9);
  assert.equal(it.val, undefined);
  assert.deepEqual(it.ph, ["item01ab-abcd12.jpg"]);                // only this row's own files
  assert.equal(it.rc, undefined);
  assert.equal(it.lent, undefined);
  assert.equal(it.bought, undefined);
  assert.equal(it.tags.length, 3);
  assert.equal(it.tags[2].length, 30);
  const pp = n.ents[1];
  assert.equal(pp.parentId, null);
  assert.equal(pp.name.length, 200);
  assert.ok(!/\u0000/.test(pp.name));
  assert.equal(pp.bi, null);
  assert.equal(n.phs, undefined);                                    // a key must carry the name's extension
  assert.equal(n.rcs, undefined);
  assert.equal(n.tombs, undefined);
  assert.equal(n.prefs, undefined);
  assert.equal(n.evil, undefined);
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([]), null);
  assert.deepEqual(D.norm({}), { ver: 1, ents: [] });
  assert.throws(() => K.open(D, device(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, device(), { kind: "oros-storage-package", ver: 9, data: {} }), /newer/);
  // a file's tombstones never reach this device
  const tomb = K.open(D, device(), { kind: "oros-storage-package", ver: 1,
    data: { ents: [row("kitc01ab", "room", "seed-sp-home", "x", { del: true, mtime: NOW })] } }, { now: NOW });
  assert.equal(tomb.report.added, 0);
  assert.equal(tomb.next.ents.find((e) => e.id === "kitc01ab").del, false);
  // what the normaliser keeps of a real row is what core.mergeRow keeps
  const s = slice();
  assert.deepEqual(D.norm(s).ents, s.ents.map(C.mergeRow).map((e) => JSON.parse(JSON.stringify(e))));
});

test("storage: wiring (scripts, menu, Open with, files, Undo, help, file types)", () => {
  const html = read("storage/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "storage.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf('src="package.js') < html.indexOf('src="storage.js'));
  assert.ok(html.indexOf('src="../recordpkg.js') < html.indexOf('src="package.js'));
  const js = read("storage/storage.js");
  assert.match(js, /RP\.ui\(SPK\.DESC,/);
  assert.match(js, /if \(tg && tg\.openFile\) \{ if \(recFile\) recFile\.openTarget\(tg\.openFile\); return; \}/);
  assert.ok(js.indexOf("tg.openFile") < js.indexOf('document.querySelector("dialog[open]")) return;\n    if (tg.view'));
  assert.equal(js.match(/window\.__orosOpenAt\s*=/g).length, 1);
  assert.match(js, /__orosTakeTarget\("storage"\)/);
  assert.match(js, /__orosTakeFile\(/);
  assert.match(js, /encodeImage\(blob\)/);                         // pictures from a file: the attach checks
  assert.match(js, /blob\.size <= PDF_MAX/);
  assert.match(js, /SPK\.settle\(next, db,/);
  assert.match(js, /x\.mtime = Math\.max\(now, \(x\.mtime \|\| 0\) \+ 1\)/);   // Undo: tombstones newer than the row
  ["recFile.save()", "recFile.open()", "recFile.openFolder()"].forEach((s) => assert.ok(js.includes(s), s));
  ["\"pkg.save\":         \"orOS file (.orosinventory)\"", "\"pkg.save\":         \"Αρχείο orOS (.orosinventory)\"",
   "\"pkg.open\":         \"Open orOS file…\"", "\"pkg.open\":         \"Άνοιγμα αρχείου orOS…\"",
   "\"pkg.folder\":       \"Unzipped orOS folder…\"", "\"pkg.folder\":       \"Αποσυμπιεσμένος φάκελος orOS…\""].forEach((s) => assert.ok(js.includes(s), s));
  const en = read("storage/help.en.txt"), el = read("storage/help.el.txt");
  for (const h of [en, el]) { assert.ok(h.includes(".orosinventory")); assert.ok(h.includes("preview/inventory.csv")); }
  assert.deepEqual(en.match(/^## /gm).length, el.match(/^## /gm).length);
  assert.deepEqual(F.appsFor(".orosinventory"), ["storage"]);
  assert.deepEqual(B.TYPES[".orosinventory"], { app: "storage", mime: "application/x-oros-inventory" });
  assert.equal(D.ext, ".orosinventory");
  assert.equal(D.mime, B.TYPES[".orosinventory"].mime);
});
